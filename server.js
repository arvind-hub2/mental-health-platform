/* SYNAPSE — Backend Server
   AI-Based Predictive Personnel Stress & Welfare Monitoring System
*/
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const Database = require('better-sqlite3');

// Load .env if present (no dependency on dotenv package — keep it zero-deps)
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (!m) continue;
      const k = m[1];
      let v = m[2];
      // strip surrounding quotes
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
} catch (e) {}

const app = express();
const PORT = process.env.PORT || 8765;

app.use(cors());
app.use(bodyParser.json({ limit: '4mb' }));
app.use(express.static(__dirname));

/* ============================================================
   CONFIG
   ============================================================ */
const CONFIG = {
  AI_PROVIDER: process.env.AI_PROVIDER || 'demo',         // demo | anthropic | openai | google
  AI_MODEL:    process.env.AI_MODEL    || 'claude-sonnet',
  AI_API_KEY:  process.env.AI_API_KEY  || '',
  VOICE_PROVIDER: process.env.VOICE_PROVIDER || (process.env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'demo'),
  VOICE_API_KEY:  process.env.VOICE_API_KEY  || '',
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || '',
  ELEVENLABS_DEFAULT_VOICE_ID: process.env.ELEVENLABS_VOICE_ID || '',
  TTS_PROVIDER:   process.env.TTS_PROVIDER || (process.env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'demo'),
  TTS_API_KEY:    process.env.TTS_API_KEY  || '',
  UPLOAD_DIR: path.join(__dirname, 'uploads', 'voice'),
  MAX_SAMPLE_BYTES: 8 * 1024 * 1024,    // 8 MB
  ALLOWED_SAMPLE_MIME: ['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/m4a','audio/x-m4a','audio/mp4','audio/webm','audio/ogg'],
  PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER || 'demo', // demo | razorpay | stripe
  PAYMENT_KEY_ID:   process.env.PAYMENT_KEY_ID   || '',
  PAYMENT_KEY_SECRET: process.env.PAYMENT_KEY_SECRET || '',
  COUNSELLOR_DEMO: true,
  COUNSELLOR_RATE_PER_MIN: 25, // ₹ per minute baseline
  EMERGENCY: {
    IN: { name: 'India Emergency', numbers: ['112'] },
    US: { name: 'United States', numbers: ['988'] },
    UK: { name: 'United Kingdom', numbers: ['116 123'] },
    IN_HELPLINES: [
      { name: 'iCall India', number: '9152987821' },
      { name: 'Vandrevala Foundation', number: '1860-2662-345' }
    ]
  }
};

// Map of voice_style → ElevenLabs voice_settings (stability / similarity / style)
// Calm/Reassuring → stable, low style; Warm → more expressive; Professional → precise
const VOICE_STYLE_SETTINGS = {
  calm:        { stability: 0.75, similarity_boost: 0.7, style: 0.0,  use_speaker_boost: false },
  professional:{ stability: 0.85, similarity_boost: 0.6, style: 0.0,  use_speaker_boost: false },
  warm:        { stability: 0.55, similarity_boost: 0.75,style: 0.35, use_speaker_boost: true  },
  neutral:     { stability: 0.65, similarity_boost: 0.6, style: 0.0,  use_speaker_boost: false },
  reassuring:  { stability: 0.8,  similarity_boost: 0.75,style: 0.15, use_speaker_boost: true  }
};

/* ============================================================
   DATABASE
   ============================================================ */
const db = new Database(path.join(__dirname, 'synapse.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'personnel',
  rank TEXT,
  service TEXT,
  country TEXT DEFAULT 'IN',
  preferred_voice TEXT DEFAULT 'calm',
  voice_consent INTEGER DEFAULT 0,
  ai_consent INTEGER DEFAULT 0,
  notify_checkin INTEGER DEFAULT 1,
  notify_screening INTEGER DEFAULT 1,
  notify_session INTEGER DEFAULT 1,
  notify_streak INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  mood INTEGER, stress INTEGER, sleep INTEGER, energy INTEGER, focus INTEGER, recovery INTEGER,
  note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS screenings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  instrument TEXT, score INTEGER, severity TEXT,
  answers TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role TEXT, content TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS voice_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  provider TEXT,                         -- demo | elevenlabs | playht
  provider_voice_id TEXT,                -- the cloned voice id used for TTS
  status TEXT DEFAULT 'pending',         -- pending | ready | failed
  consent_given INTEGER DEFAULT 0,
  consent_timestamp DATETIME,
  phrase TEXT,                           -- the verification phrase
  audio_path TEXT,                       -- path to the latest sample on disk
  sample_count INTEGER DEFAULT 0,
  total_duration_sec INTEGER DEFAULT 0,
  embedding TEXT,                        -- speaker embedding (mock hash in demo)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS voice_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  voice_profile_id INTEGER,
  filename TEXT,
  mime TEXT,
  size_bytes INTEGER,
  duration_sec INTEGER,
  provider_sample_id TEXT,               -- id returned by cloning provider
  status TEXT DEFAULT 'uploaded',        -- uploaded | processing | ready | failed
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS conversation_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  channel TEXT DEFAULT 'text',           -- text | voice
  intent  TEXT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT, content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES conversation_sessions(id)
);
CREATE TABLE IF NOT EXISTS voice_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME,
  duration_sec INTEGER,
  transcript TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

/* ---- Schema migrations for tables that may exist with older shapes ---- */
function migrateSchema() {
  const cmCols = db.prepare("PRAGMA table_info(conversation_messages)").all().map(c => c.name);
  if (cmCols.length && !cmCols.includes('user_id')) {
    try { db.exec("ALTER TABLE conversation_messages ADD COLUMN user_id INTEGER"); } catch (_) {}
  }
  if (cmCols.length && !cmCols.includes('created_at')) {
    try { db.exec("ALTER TABLE conversation_messages RENAME COLUMN ts TO created_at"); } catch (_) {}
  }
  const csCols = db.prepare("PRAGMA table_info(conversation_sessions)").all().map(c => c.name);
  if (csCols.length && !csCols.includes('channel')) {
    try { db.exec("ALTER TABLE conversation_sessions ADD COLUMN channel TEXT DEFAULT 'text'"); } catch (_) {}
  }
  if (csCols.length && !csCols.includes('intent')) {
    try { db.exec("ALTER TABLE conversation_sessions ADD COLUMN intent TEXT"); } catch (_) {}
  }
  const vpCols = db.prepare("PRAGMA table_info(voice_profiles)").all().map(c => c.name);
  if (vpCols.length && !vpCols.includes('provider')) {
    try { db.exec("ALTER TABLE voice_profiles ADD COLUMN provider TEXT"); } catch (_) {}
  }
  if (vpCols.length && !vpCols.includes('provider_voice_id')) {
    try { db.exec("ALTER TABLE voice_profiles ADD COLUMN provider_voice_id TEXT"); } catch (_) {}
  }
  if (vpCols.length && !vpCols.includes('status')) {
    try { db.exec("ALTER TABLE voice_profiles ADD COLUMN status TEXT DEFAULT 'pending'"); } catch (_) {}
  }
  if (vpCols.length && !vpCols.includes('consent_given')) {
    try { db.exec("ALTER TABLE voice_profiles ADD COLUMN consent_given INTEGER DEFAULT 0"); } catch (_) {}
  }
  if (vpCols.length && !vpCols.includes('consent_timestamp')) {
    try { db.exec("ALTER TABLE voice_profiles ADD COLUMN consent_timestamp DATETIME"); } catch (_) {}
  }
  if (vpCols.length && !vpCols.includes('audio_path')) {
    try { db.exec("ALTER TABLE voice_profiles ADD COLUMN audio_path TEXT"); } catch (_) {}
  }
  if (vpCols.length && !vpCols.includes('sample_count')) {
    try { db.exec("ALTER TABLE voice_profiles ADD COLUMN sample_count INTEGER DEFAULT 0"); } catch (_) {}
  }
  if (vpCols.length && !vpCols.includes('total_duration_sec')) {
    try { db.exec("ALTER TABLE voice_profiles ADD COLUMN total_duration_sec INTEGER DEFAULT 0"); } catch (_) {}
  }
  if (vpCols.length && !vpCols.includes('updated_at')) {
    try { db.exec("ALTER TABLE voice_profiles ADD COLUMN updated_at DATETIME"); } catch (_) {}
  }
  // voice_samples may exist with a partial schema in older DBs
  const vsCols = db.prepare("PRAGMA table_info(voice_samples)").all().map(c => c.name);
  if (vsCols.length && !vsCols.includes('id')) {
    try { db.exec("ALTER TABLE voice_samples ADD COLUMN id TEXT"); } catch (_) {}
  }
  if (vsCols.length && !vsCols.includes('voice_profile_id')) {
    try { db.exec("ALTER TABLE voice_samples ADD COLUMN voice_profile_id INTEGER"); } catch (_) {}
  }
  if (vsCols.length && !vsCols.includes('filename')) {
    try { db.exec("ALTER TABLE voice_samples ADD COLUMN filename TEXT"); } catch (_) {}
  }
  if (vsCols.length && !vsCols.includes('mime')) {
    try { db.exec("ALTER TABLE voice_samples ADD COLUMN mime TEXT"); } catch (_) {}
  }
  if (vsCols.length && !vsCols.includes('size_bytes')) {
    try { db.exec("ALTER TABLE voice_samples ADD COLUMN size_bytes INTEGER"); } catch (_) {}
  }
  if (vsCols.length && !vsCols.includes('duration_sec')) {
    try { db.exec("ALTER TABLE voice_samples ADD COLUMN duration_sec INTEGER"); } catch (_) {}
  }
  if (vsCols.length && !vsCols.includes('transcript')) {
    try { db.exec("ALTER TABLE voice_samples ADD COLUMN transcript TEXT"); } catch (_) {}
  }
  if (vsCols.length && !vsCols.includes('provider_sample_id')) {
    try { db.exec("ALTER TABLE voice_samples ADD COLUMN provider_sample_id TEXT"); } catch (_) {}
  }
  if (vsCols.length && !vsCols.includes('status')) {
    try { db.exec("ALTER TABLE voice_samples ADD COLUMN status TEXT DEFAULT 'uploaded'"); } catch (_) {}
  }
}
migrateSchema();

/* Re-open the original CREATE TABLE block for the remaining tables */
db.exec(`
CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE, title TEXT, kind TEXT, duration_sec INTEGER,
  description TEXT, pattern TEXT, category TEXT
);
CREATE TABLE IF NOT EXISTS exercise_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, exercise_id INTEGER NOT NULL,
  duration_sec INTEGER, completed INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (exercise_id) REFERENCES exercises(id)
);
CREATE TABLE IF NOT EXISTS counsellors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, qualification TEXT, specialty TEXT, languages TEXT,
  experience_years INTEGER DEFAULT 0, rating REAL DEFAULT 4.7,
  reviews_count INTEGER DEFAULT 0, price_per_min INTEGER DEFAULT 25,
  bio TEXT, avatar TEXT, available INTEGER DEFAULT 1,
  online INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS counsellor_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  counsellor_id INTEGER NOT NULL, weekday INTEGER, start_min INTEGER, end_min INTEGER,
  FOREIGN KEY (counsellor_id) REFERENCES counsellors(id)
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, counsellor_id INTEGER NOT NULL,
  duration_min INTEGER NOT NULL, price INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending | confirmed | in_session | completed | cancelled
  payment_id INTEGER, session_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (counsellor_id) REFERENCES counsellors(id)
);
CREATE TABLE IF NOT EXISTS counselling_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL, counsellor_id INTEGER NOT NULL,
  started_at DATETIME, ended_at DATETIME,
  duration_sec INTEGER, mode TEXT,            -- text | voice | video
  transcript TEXT, rating INTEGER, review TEXT,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (counsellor_id) REFERENCES counsellors(id)
);
CREATE TABLE IF NOT EXISTS session_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  sender TEXT, content TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES counselling_sessions(id)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'INR', method TEXT DEFAULT 'demo',
  provider TEXT, provider_ref TEXT, status TEXT DEFAULT 'pending',
  purpose TEXT, meta TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS wallets (
  user_id INTEGER PRIMARY KEY,
  balance INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, kind TEXT, title TEXT, body TEXT,
  read INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, kind TEXT, granted INTEGER, ts DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, kind TEXT, target_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS research (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT, authors TEXT, year INTEGER, journal TEXT,
  topic TEXT, summary TEXT, url TEXT
);
CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT, kind TEXT, duration TEXT, description TEXT, url TEXT
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, action TEXT, meta TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS crisis_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, message TEXT, severity TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  counsellor_id INTEGER NOT NULL,
  datetime TEXT,
  topic TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (counsellor_id) REFERENCES counsellors(id)
);
CREATE TABLE IF NOT EXISTS mindful_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  game_slug TEXT NOT NULL,
  duration_sec INTEGER DEFAULT 0,
  completed INTEGER DEFAULT 0,
  score INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

/* ============================================================
   SIH 26186 — Personnel Welfare & Predictive Risk Tables
   (extends without disturbing existing schema)
   ============================================================ */
db.exec(`
CREATE TABLE IF NOT EXISTS personnel_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE,
  pseudo_id TEXT UNIQUE NOT NULL,        -- e.g. PF-1042
  rank TEXT,
  unit TEXT,
  role TEXT,
  service_years REAL DEFAULT 0,
  duty_pattern TEXT,                      -- regular | rotating | on_call | field
  deployment_status TEXT,                 -- home | deployed | returning | on_leave
  deployment_duration_days INTEGER DEFAULT 0,
  recent_leave_days INTEGER DEFAULT 0,
  training_load_hours REAL DEFAULT 0,
  workload_index INTEGER DEFAULT 0,       -- 0-100
  recovery_index INTEGER DEFAULT 0,       -- 0-100
  transfer_count INTEGER DEFAULT 0,
  risk_level TEXT DEFAULT 'low',          -- low | moderate | high | urgent
  risk_score INTEGER DEFAULT 0,           -- 0-100
  confidence INTEGER DEFAULT 0,           -- 0-100
  last_predicted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS hr_workload_indicators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personnel_id INTEGER NOT NULL,
  week_start DATE,
  duty_hours REAL DEFAULT 0,
  overtime_hours REAL DEFAULT 0,
  night_duties INTEGER DEFAULT 0,
  leave_taken_days INTEGER DEFAULT 0,
  training_hours REAL DEFAULT 0,
  recovery_allocated_hours REAL DEFAULT 0,
  operational_tempo TEXT,                  -- low | normal | high | surge
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (personnel_id) REFERENCES personnel_profiles(id)
);
CREATE TABLE IF NOT EXISTS welfare_screenings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personnel_id INTEGER NOT NULL,
  user_id INTEGER,
  instrument TEXT,                         -- K10 | PHQ-9 | GAD-7 | custom
  score INTEGER,
  severity TEXT,                           -- minimal | mild | moderate | severe
  answers TEXT,                            -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (personnel_id) REFERENCES personnel_profiles(id)
);
CREATE TABLE IF NOT EXISTS risk_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personnel_id INTEGER NOT NULL,
  current_risk_score INTEGER,
  current_risk_level TEXT,                 -- low | moderate | high | urgent
  predicted_7d_score INTEGER,
  predicted_7d_level TEXT,
  confidence INTEGER,
  contributing_signals TEXT,               -- JSON [{label, delta, direction}]
  protective_factors TEXT,                 -- JSON [{label, delta, direction}]
  trend_7d INTEGER,
  trend_14d INTEGER,
  trend_30d INTEGER,
  trend_90d INTEGER,
  model_version TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (personnel_id) REFERENCES personnel_profiles(id)
);
CREATE TABLE IF NOT EXISTS welfare_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personnel_id INTEGER NOT NULL,
  severity TEXT,                           -- info | moderate | high | urgent
  type TEXT,                               -- risk_increase | rapid_deterioration | persistent_fatigue | workload_imbalance | urgent_welfare
  message TEXT,                            -- human-readable, minimum-necessary
  reason TEXT,                             -- sanitised summary, no conversation content
  recommended_action TEXT,
  acknowledged INTEGER DEFAULT 0,
  acknowledged_by INTEGER,
  acknowledged_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (personnel_id) REFERENCES personnel_profiles(id)
);
CREATE TABLE IF NOT EXISTS intervention_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personnel_id INTEGER NOT NULL,
  intervention_type TEXT,                   -- welfare_check | counsellor | recovery | leave
  before_risk_score INTEGER,
  after_risk_score INTEGER,
  before_risk_level TEXT,
  after_risk_level TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (personnel_id) REFERENCES personnel_profiles(id)
);
CREATE TABLE IF NOT EXISTS emotional_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source TEXT,                              -- chat | voice | self_report
  scores TEXT,                              -- JSON: {mood, stress, anxiety, ...}
  dominant_emotions TEXT,                   -- JSON array
  detected_topics TEXT,                     -- JSON array
  risk_level TEXT,                          -- low | moderate | high | urgent
  recommended_support TEXT,                 -- JSON array
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS ai_friend_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  mode TEXT,                                -- chat | voice | just_listen | calm | late_night | motivation | problem_solving
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS wellbeing_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  snapshot TEXT NOT NULL,                   -- JSON: full report payload
  signal_count INTEGER NOT NULL DEFAULT 0,
  source TEXT,                              -- ai_friend_chat | ai_friend_voice | self_report | aggregation
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS biometric_optional (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  consent_given INTEGER DEFAULT 0,
  metric TEXT,                              -- hrv | resting_hr | sleep_minutes | steps
  value REAL,
  recorded_at DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS hr_import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  source TEXT,                              -- csv | json | demo
  records_imported INTEGER DEFAULT 0,
  errors TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

/* ----- Canonical counsellor prices (authoritative; written to DB on every boot) ----- */
const COUNSELLOR_PRICES = {
  'Dr. Maya Chen':      15,
  'Dr. Rohan Verma':    14,
  'Dr. Neha Banerjee':  12,
  'Dr. Aarav Kapoor':   11,
  'Lt Cdr (Dr) S. Rao': 18,
  'Dr. Priya Iyer':     13
};

function normaliseCounsellorPrices() {
  /* One-shot on boot. Reconciles every row to the canonical map above.
     New rows added later (or rows whose name was renamed) are left alone —
     only known names get their price aligned with the source of truth. */
  const upd = db.prepare('UPDATE counsellors SET price_per_min = ? WHERE name = ?');
  const tx = db.transaction((map) => {
    for (const [name, price] of Object.entries(map)) upd.run(price, name);
  });
  tx(COUNSELLOR_PRICES);
}

/* ----- SEED ----- */
const seedCounsellors = () => {
  const c = db.prepare('SELECT COUNT(*) AS n FROM counsellors').get().n;
  if (c > 0) return;
  const ins = db.prepare(`INSERT INTO counsellors
    (name, qualification, specialty, languages, experience_years, rating, reviews_count, price_per_min, bio, avatar, online)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const list = [
    ['Dr. Maya Chen',  'Clinical Psychologist',   'Anxiety · Stress · Trauma',  'English, Hindi',  11, 4.9, 312, COUNSELLOR_PRICES['Dr. Maya Chen'],
     'Licensed clinical psychologist with extensive experience supporting personnel under high operational pressure.', 'MC', 1],
    ['Dr. Rohan Verma','Rehabilitation Psychologist','Depression · Mood · Adjustment','English, Hindi, Marathi', 9, 4.8, 256, COUNSELLOR_PRICES['Dr. Rohan Verma'],
     'Cognitive behavioural therapist specialising in mood, adjustment, and high-tempo occupational stress.', 'RV', 1],
    ['Dr. Priya Iyer', 'Sleep & Behavioural Medicine', 'Sleep · Burnout · Recovery','English, Tamil, Hindi', 8, 4.9, 198, COUNSELLOR_PRICES['Dr. Priya Iyer'],
     'Sleep specialist supporting shift workers, command staff, and high-readiness personnel.', 'PI', 0],
    ['Dr. Aarav Kapoor','Counselling Psychologist', 'Identity · Transitions · Family','English, Hindi, Punjabi', 7, 4.7, 174, COUNSELLOR_PRICES['Dr. Aarav Kapoor'],
     'Counselling psychologist with deep experience in life transitions and family support for service families.', 'AK', 1],
    ['Lt Cdr (Dr) S. Rao', 'Military Psychiatrist', 'Operational Stress · Resilience','English, Telugu, Hindi', 14, 4.95, 421, COUNSELLOR_PRICES['Lt Cdr (Dr) S. Rao'],
     'Former armed forces psychiatrist. Trauma-informed, mission-aware, with no judgement.', 'SR', 0],
    ['Dr. Neha Banerjee','Wellbeing Practitioner','Mindfulness · Burnout · Focus','English, Bengali, Hindi', 6, 4.8, 142, COUNSELLOR_PRICES['Dr. Neha Banerjee'],
     'Mindfulness-based stress reduction practitioner supporting performance and recovery.', 'NB', 1]
  ];
  list.forEach(c => ins.run(...c));
};

const seedExercises = () => {
  const c = db.prepare('SELECT COUNT(*) AS n FROM exercises').get().n;
  if (c > 0) return;
  const ins = db.prepare('INSERT INTO exercises (slug, title, kind, duration_sec, description, pattern, category) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const items = [
    ['box-breathing', 'Box Breathing', 'breathing', 240,
      'Four equal sides of breath for steady regulation.', JSON.stringify({inhale:4, hold:4, exhale:4, hold:4, cycles:6}), 'stress'],
    ['478-breathing', '4-7-8 Calming Breath', 'breathing', 180,
      'Calming breath to downshift before sleep or after a shock.', JSON.stringify({inhale:4, hold:7, exhale:8, cycles:4}), 'sleep'],
    ['coherent-breathing', 'Coherent Breathing', 'breathing', 300,
      'Slow, even breathing to balance the autonomic system.', JSON.stringify({inhale:5, hold:0, exhale:5, cycles:6}), 'stress'],
    ['grounding-54321', 'Grounding 5-4-3-2-1', 'grounding', 180,
      'Engage five senses to anchor yourself to the present moment.', null, 'anxiety'],
    ['body-scan', 'Quick Body Scan', 'scan', 240,
      'Scan the body from crown to feet, releasing tension.', null, 'recovery'],
    ['focus-reset', 'Focus Reset', 'focus', 120,
      'A 2-minute attention reset between tasks.', null, 'focus'],
    ['guided-relaxation', 'Guided Relaxation', 'audio', 480,
      'Eight-minute guided relaxation for full-body release.', null, 'recovery'],
    ['sleep-prep', 'Sleep Preparation', 'audio', 600,
      'Wind-down sequence to prepare the nervous system for sleep.', null, 'sleep'],
    ['pmr', 'Progressive Muscle Relaxation', 'audio', 600,
      'Tense and release each major muscle group.', null, 'recovery'],
    ['quick-recovery', 'Quick Recovery', 'breathing', 90,
      'A 90-second recovery for between tasks.', JSON.stringify({inhale:3, hold:2, exhale:4, cycles:6}), 'recovery']
  ];
  items.forEach(i => ins.run(...i));
};

const seedResources = () => {
  const c = db.prepare('SELECT COUNT(*) AS n FROM resources').get().n;
  if (c > 0) return;
  const ins = db.prepare('INSERT INTO resources (title, kind, duration, description, url) VALUES (?, ?, ?, ?, ?)');
  const items = [
    ['Sleep Hygiene for Shift Work', 'article', '6 min read', 'Practical habits to stabilise sleep across rotating shifts.', '#sleep'],
    ['Managing Operational Stress', 'article', '7 min read', 'Recognising early signs and regulating the stress response.', '#stress'],
    ['Box Breathing Technique', 'breathing', '4 min', 'A four-sided breath technique to reduce acute stress.', '#box-breathing'],
    ['Grounding 5-4-3-2-1', 'exercise', '3 min', 'Anchor yourself in the present using your five senses.', '#grounding-54321'],
    ['Thought Reframing', 'worksheet', '8 min', 'Identify and reframe unhelpful thought patterns.', '#reframing'],
    ['Mindful Walk', 'exercise', '15 min', 'A short walking practice to reset your day.', '#mindful-walk'],
    ['Three Good Things', 'journal', '5 min', 'Write three positive events from your day and why they happened.', '#three-good'],
    ['Family Communication', 'article', '5 min', 'Maintaining strong family connection during long deployments.', '#family'],
    ['Burnout Self-Check', 'worksheet', '4 min', 'A short reflective inventory of burnout indicators.', '#burnout'],
    ['Focus & Attention', 'audio', '9 min', 'A guided attention primer to re-engage focus.', '#focus']
  ];
  items.forEach(i => ins.run(...i));
};

const seedResearch = () => {
  const c = db.prepare('SELECT COUNT(*) AS n FROM research').get().n;
  if (c > 0) return;
  const ins = db.prepare('INSERT INTO research (title, authors, year, journal, topic, summary, url) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const items = [
    ['Stress and the Military: A Scoping Review', 'Bray RM et al.', 2022, 'Military Medicine', 'operational stress',
      'A scoping review of stress prevalence and mitigation strategies in uniformed services.', '#ref1'],
    ['Digital Mental Health in High-Reliability Organisations', 'Sailer M et al.', 2023, 'JMIR Mental Health', 'digital health',
      'Patterns of digital mental-health adoption in safety-critical organisations.', '#ref2'],
    ['Sleep, Readiness, and Performance', 'Good CH et al.', 2020, 'Sleep Health', 'sleep',
      'Sleep continuity is a measurable contributor to operational readiness.', '#ref3'],
    ['AI-assisted Conversational Support: A Systematic Review', 'Abd-Alrazaq A et al.', 2023, 'Journal of Medical Internet Research', 'AI',
      'How AI conversational systems have been used as adjuncts to psychological care.', '#ref4'],
    ['Trauma-Informed Digital Design', 'Hall T et al.', 2022, 'Digital Health', 'trauma',
      'Principles for trauma-informed design in digital health systems.', '#ref5'],
    ['Mindfulness and Stress Regulation', 'Hofmann SG et al.', 2017, 'Clinical Psychology Review', 'mindfulness',
      'Meta-analytic evidence for mindfulness-based stress regulation.', '#ref6'],
    ['Brief Screening Tools for Distress in Uniformed Populations', 'Stetz MC et al.', 2018, 'Military Psychology', 'screening',
      'Validation patterns of brief distress screens used in uniformed populations.', '#ref7']
  ];
  items.forEach(i => ins.run(...i));
};

seedCounsellors();
normaliseCounsellorPrices();
seedExercises();
seedResources();
seedResearch();

/* ============================================================
   HELPERS
   ============================================================ */
const hash = (p) => crypto.createHash('sha256').update(p).digest('hex');
const token = () => crypto.randomBytes(24).toString('hex');
const auth = (req, res, next) => {
  // Defensive: trim and length-cap the Authorization header so an oversized value
  // cannot slow down the token lookup or leak through error messages.
  const raw = req.headers['authorization'];
  const t = typeof raw === 'string' ? raw.trim().slice(0, 128) : '';
  if (!t) return res.status(401).json({ error: 'no token' });
  // Token format: 40-char hex by convention. Reject obviously invalid tokens
  // early without a DB lookup, but always do a DB lookup as the source of truth.
  if (!/^[a-f0-9]{16,128}$/i.test(t)) return res.status(401).json({ error: 'bad token' });
  const s = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(t);
  if (!s) return res.status(401).json({ error: 'bad token' });
  req.user = s.user_id;
  next();
};
const role = (allowed) => (req, res, next) => {
  const u = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user);
  if (!u || !allowed.includes(u.role)) return res.status(403).json({ error: 'forbidden' });
  next();
};
const audit = (userId, action, meta) => {
  try { db.prepare('INSERT INTO audit_logs (user_id, action, meta) VALUES (?, ?, ?)').run(userId || null, action, meta ? JSON.stringify(meta) : null); }
  catch (e) {}
};
const notify = (userId, kind, title, body) => {
  const prefs = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) || {};
  const allow = ({
    checkin: prefs.notify_checkin,
    screening: prefs.notify_screening,
    session: prefs.notify_session,
    streak: prefs.notify_streak
  })[kind];
  if (allow === 0) return;
  db.prepare('INSERT INTO notifications (user_id, kind, title, body) VALUES (?, ?, ?, ?)').run(userId, kind, title, body);
};

/* Seed demo accounts so the platform works on first open */
(function seedDemoUsers(){
  const demoUsers = [
    { name: 'Demo Personnel',     email: 'demo@synapse.io',     password: 'password', role: 'personnel' },
    { name: 'Admin',              email: 'admin@synapse.io',    password: 'password', role: 'admin' },
    { name: 'Dr. Maya Chen',      email: 'maya@synapse.io',     password: 'password', role: 'counsellor' },
    { name: 'Welfare Officer',    email: 'welfare@synapse.io',  password: 'password', role: 'welfare_officer' },
    { name: 'Unit Commander',     email: 'commander@synapse.io', password: 'password', role: 'commander' }
  ];
  const ins = db.prepare('INSERT OR IGNORE INTO users (name, email, password, role) VALUES (?, ?, ?, ?)');
  const wall = db.prepare('INSERT OR IGNORE INTO wallets (user_id, balance) VALUES (?, 0)');
  for (const u of demoUsers) {
    const r = ins.run(u.name, u.email, hash(u.password), u.role);
    if (r.changes) {
      wall.run(r.lastInsertRowid);
    }
  }
})();

/* ============================================================
   AI PROVIDER (abstraction)
   ============================================================ */
const AIProvider = {
  provider: CONFIG.AI_PROVIDER,
  async chat({ system, user, history = [], context = {} }) {
    if (this.provider === 'demo' || !CONFIG.AI_API_KEY) {
      return { reply: demoAssistant({ input: user, history, context }), intent: classifyIntent(user), source: 'demo' };
    }
    // Real provider routing — placeholder; in production:
    //   if (this.provider === 'anthropic') call Anthropic Messages API with model from AI_MODEL
    //   if (this.provider === 'openai')    call OpenAI Chat Completions
    //   if (this.provider === 'google')    call Google Generative AI
    return { reply: demoAssistant({ input: user, history, context }), intent: classifyIntent(user), source: 'demo-fallback' };
  }
};

/* --- Crisis detection --- */
const CRISIS = /\b(suicid|kill myself|end my life|self[- ]?harm|hurt myself|want to die|don.?t want to live)\b/i;

/* --- Intent router --- *
 * Reads the *actual* user text, scores it against intent patterns, and
 * builds a response that incorporates:
 *   - the user's last message (not a generic "thank you for sharing")
 *   - recent conversation history (so turn 2 understands turn 1)
 *   - wellbeing context when relevant (with consent)
 * Returns a string reply.  Different intents return meaningfully different replies.
 */
function classifyIntent(text) {
  const t = (text || '').toLowerCase();
  const has = (re) => re.test(t);
  if (CRISIS.test(t)) return 'crisis';
  if (has(/\b(box|4-7-8|coherent|478)\s*breath/) || has(/\bguide\s+me\s+through\s+(a\s+)?(breath|breathing)/) || has(/\b(do|start|begin|run)\s+(a\s+)?breath/))
    return 'breathing_guide';
  if (has(/\bbreath|breathe|relax|calm\s+down|grounding|ground\s+myself/))
    return 'breathing';
  if (has(/\b(book|talk to|see|find|need)\b.*\b(counsellor|counselor|therapist|psycholog|session|appoint)/) || has(/\b(connect\s+me|put\s+me\s+in\s+touch)/))
    return 'counsellor';
  if (has(/\b(screening|screen\s+myself|phq|gad|questionnaire|self[- ]?check)/))
    return 'screening';
  if (has(/\b(my\s+stress\s+trend|stress\s+trend|stress\s+level|how.{0,5}(is|are)\s+my|how\s+am\s+i|wellbeing\s+snapshot|tell\s+me\s+about\s+my\s+stress|what.{0,5}my\s+(stress|sleep|mood|focus))/))
    return 'wellbeing';
  if (has(/\b(can'?t|cannot|insomnia|didn'?t|struggle|trouble).{0,20}(sleep|rest|fall\s+asleep|stay\s+asleep)/) || has(/\b(sleep|tired|exhausted|fatigue|drowsy)/))
    return 'sleep';
  if (has(/\b(anxi|panic|worry|worried|nervous|on\s+edge|restless)/))
    return 'anxiety';
  if (has(/\b(stress|overwhelm|under\s+pressure|burn(ed|out)|too\s+much|can'?t\s+cope)/))
    return 'stress';
  if (has(/\b(sad|hopeless|empty|down|low\s+mood|unmotivated|numb)/))
    return 'sadness';
  if (has(/\b(lonely|alone|isolat|miss\s+(my\s+)?(family|home|partner))/) )
    return 'lonely';
  if (has(/\b(angry|frustrat|annoyed|irritat|rage)/))
    return 'anger';
  if (has(/\b(focus|concentrat|distract(ed|ion)|can'?t\s+focus|attention)/))
    return 'focus';
  if (has(/\b(joke|funny|cheer\s+me\s+up|something\s+light)/))
    return 'joke';
  if (has(/\b(hi|hello|hey|good\s+(morning|evening|afternoon))/) && t.length < 30)
    return 'greeting';
  if (has(/\b(thank|appreciate|grateful|that\s+helped|better\s+now)/))
    return 'gratitude';
  return 'general';
}

function extractTopic(text) {
  if (!text) return '';
  const t = text.toLowerCase();
  const m = t.match(/\b(work|job|boss|colleague|family|partner|kid|child|children|money|finance|health|exercise|food|drink|alcohol|duty|mission|operation|deployment|training|exam|test|study|relationship|marriage|wedding|anniversary|death|funeral|loss|grief|fight|argument|accident|injur|hospital|move|moving|relocat|holiday|vacation|leave|home|friend|pet|dog|cat|birth|baby|new\s+role|promotion|transfer|retire)/);
  return m ? m[0] : '';
}

function demoAssistant({ input, history = [], context = {} }) {
  const intent = classifyIntent(input);
  const topic  = extractTopic(input);
  const name   = context.name ? String(context.name).split(' ')[0] : '';
  const user   = name || 'there';

  const lastUser = history.filter(h => h.role === 'user').slice(-1)[0];
  const lastAi   = history.filter(h => h.role === 'assistant').slice(-1)[0];
  const followup = lastAi && lastUser;
  const variants = (arr) => arr[Math.floor(Math.random() * arr.length)];

  switch (intent) {
    case 'crisis':
      return `I'm concerned about what you've shared. Your safety matters more than anything else right now.\n\n• If you are in immediate danger, please contact emergency services (112 in India / 988 in the US / 116 123 in the UK).\n• iCall India: 9152987821\n• Vandrevala Foundation: 1860-2662-345\n\nWould you like me to help you book a counsellor right now, or stay here with you?`;

    case 'greeting':
      return variants([
        `Good to see you, ${user}. What's on your mind today?`,
        `Hello ${user}. I'm here and listening. How are you feeling right now?`,
        `Hi ${user}. How has today been treating you so far?`,
        `Hey ${user} — quiet day, or a lot happening?`,
        `Welcome back, ${user}. Anything specific you want to talk through, or just want company for a bit?`
      ]);

    case 'breathing_guide':
      return `Of course — let's slow the system down. Open the Recovery Studio and choose Box Breathing (4-4-4-4). I'll narrate each phase with you. Want me to open it now?`;

    case 'breathing':
      return `A short breath practice can bring the system down quickly. The 4-4-4-4 box breath is a strong default; 4-7-8 is great for sleep. Which one would you like?`;

    case 'counsellor':
      return `Yes — I can show you available counsellors and their specialisations, or open a short paid session (5 / 10 / 20 / 30 / 60 minutes). Would you like to browse the marketplace, or go straight to booking?`;

    case 'screening':
      return `A short screening can help you see what your body and mind are signalling. The PHQ-style check focuses on mood; the GAD-style check focuses on anxiety. Which feels most relevant right now?`;

    case 'wellbeing': {
      const s = context.snapshot;
      if (!s || s.status === 'NO_DATA') {
        return `You haven't logged a check-in yet, so I can't see a trend. Log a quick check-in on the dashboard and I'll give you a real read. Want me to open the check-in form?`;
      }
      const sn = s.snapshot || {};
      const parts = [];
      if (typeof sn.stress === 'number') parts.push(`stress ${sn.stress}/100`);
      if (typeof sn.sleep === 'number')  parts.push(`sleep ${sn.sleep}/100`);
      if (typeof sn.mood === 'number')   parts.push(`mood ${sn.mood}/100`);
      if (typeof sn.focus === 'number')  parts.push(`focus ${sn.focus}/100`);
      const list = parts.length ? parts.join(', ') : 'a few signals logged';
      return `Based on your self-reported data (not a clinical read): ${list}. Your current wellbeing state is ${s.status}. ${s.message || ''}`.trim();
    }

    case 'sleep': {
      if (followup && /breath|sleep/.test(lastAi.content)) {
        return `Got it. Let me open a Sleep Preparation exercise for you — dim screens, slow 4-7-8 breath, and a brain-dump of tomorrow. Want me to start it?`;
      }
      return variants([
        `Sleep is mission-critical recovery. Tonight: dim screens 60 minutes before bed, slow 4-7-8 breathing, and a 3-line brain-dump of tomorrow. Should I start a 10-minute Sleep Preparation exercise?`,
        `Tough sleep hits everything. Two fast wins: cut caffeine after 2pm, and do a 5-minute wind-down before bed. Want me to guide the wind-down?`,
        `A consistent wind-down makes a real difference. I can guide a 10-minute Sleep Preparation in the Recovery Studio — say the word.`
      ]);
    }

    case 'anxiety':
      return variants([
        `That sounds edgy. A slow exhale tends to drop the body's alarm fastest — try inhale 3, hold 2, exhale 5, three rounds. I can guide a 90-second recovery now if you want.${topic ? ` And you mentioned ${topic} — want to unpack what's driving it?` : ''}`.trim(),
        `Anxiety has a way of pulling the future into this moment. One thing at a time: what's the most present worry right now?${topic ? ` The ${topic} piece, or something else?` : ''}`.trim(),
        `I hear you. A quick reset first: feet on the floor, long slow exhale, name five things you can see. Then — want to talk through it or just sit with it for a minute?`
      ]);

    case 'stress': {
      if (topic) {
        return variants([
          `Stress around ${topic} is heavy. If you could remove one piece of ${topic} today, which would relieve the most pressure? In the meantime, a 2-minute Focus Reset will help.`,
          `${topic} sounds like the heaviest thing right now. Two questions — what's in your control about it today, and what isn't? Naming that split usually loosens the grip. A 2-minute reset can help too if you want one.`
        ]);
      }
      return variants([
        `Sounds like the load is heavy. Pick the one thing — if it were easier — that would relieve the most pressure. I'll stay with you on it.`,
        `A lot on your plate. Fastest reset: 2-minute Focus Reset, then name the single next action. Which feels more useful right now?`,
        `Understood. Let's split it: name the one thing weighing on you most, and I'll help you decide whether to act on it, defer it, or breathe through it.`,
        `Heavy day. Three quick wins: drink water, step outside for 60 seconds, then write the single next action. Which of those is easiest to start with right now?`
      ]);
    }

    case 'sadness':
      return variants([
        `That heaviness is real. You don't have to do anything about it right now — sometimes the most useful thing is to let it be there. What would feel gentle for you in the next ten minutes?`,
        `Sounds like you're carrying something quiet but heavy. A small step: a slow walk, a familiar song, or just one sentence in a journal. Want me to stay with you while you do any of those?`,
        `I hear that. If it keeps showing up for days, a short screening or a counsellor can give you a clearer mirror — but only if and when you want it. For now, what's one kind thing you could do for yourself today?`
      ]);

    case 'lonely': {
      if (topic) {
        return variants([
          `Missing ${topic} is one of the hardest parts of service life. A tiny step helps: send one short message today — "thinking of you" counts. I can also share a resource on staying connected during long duty hours. Which feels right?`,
          `${topic} being far away hurts. Two things that help most people: one short message to them today, and one short message to anyone close to you who can hold space. Want help thinking through who, or shall I open the family-connection resource?`
        ]);
      }
      return variants([
        `Disconnection is painful. A small step that usually helps: message one person today — even a brief "thinking of you" counts. Want me to help you pick who, or open the connection resource?`,
        `Loneliness tends to shrink our world. One thing that breaks it: even ten minutes in a shared space — a mess, a call, a walk near others. What's the smallest version of that you could do this week?`
      ]);
    }

    case 'anger':
      return `Anger often points to a boundary that was crossed or a need that's not being met. Try the 5-4-3-2-1 grounding technique first, then ask yourself: what is this anger protecting? Want to talk through it?`;

    case 'focus':
      return variants([
        `Focus is a renewable resource. Try a 25-minute single-task block, no notifications, then a 2-minute reset. I can start a 2-minute Focus Reset for you.`,
        `Scattered focus usually means too many open loops. One question: if you could only finish one thing today, which would matter most by evening?`,
        `Quick win: close every tab you don't need, set a 20-minute timer on the single task, and silence notifications. Want me to set the timer?`
      ]);

    case 'joke':
      return variants([
        `Sure — why did the neural network go to therapy? It had too many unprocessed layers. (Demo AI here — want to talk about what's actually on your mind?)`,
        `Okay, here's one: I told my circuits a joke about RAM, but they forgot it immediately. Want to talk about something real, or keep it light?`
      ]);

    case 'gratitude':
      return variants([
        `I'm glad that helped. Keep noticing what worked — that's data for your future self. Would you like to log a quick check-in to capture today's signals?`,
        `Nice. Anything you want to remember about what just worked? Even a one-line note is useful later.`
      ]);

    case 'general':
    default: {
      const text = (input || '').trim();
      if (text.length < 4) return `I caught a fragment — could you say that again? I'm listening.`;
      if (topic) {
        return variants([
          `You mentioned ${topic}. Tell me a little more about what's happening with it — I'll help you think it through.`,
          `${topic} — got it. What's the part of that feels heaviest right now?`,
          `Heard you on ${topic}. What's the single thing you'd like to be different about it by tomorrow?`
        ]);
      }
      // Casual / everyday questions — answer like a normal companion, not a clinician.
      const t = text.toLowerCase();
      const isQuestion = /[?]\s*$/.test(text) || /^(what|why|how|when|where|who|which|can\s+you|could\s+you|do\s+you|are\s+you|is\s+there|tell\s+me)\b/.test(t);
      if (isQuestion) {
        return variants([
          `Good question. Honest answer: I'm a demo assistant here — I can listen, help you think, and point you toward small practices or a counsellor when useful, but I don't have live web access. Want to talk it through together?`,
          `Honestly, I'm running in demo mode — I can be a thinking partner and a wellbeing companion, but I can't fetch live facts. If you tell me a bit more about what you're trying to figure out, I can help you sort it.`,
          `Good to ask. I'm a wellbeing companion first — great at listening, reflecting, and small steps. For general-knowledge questions I'd rather not make things up; tell me more about what you need and we'll figure it out together.`
        ]);
      }
      return variants([
        `Got it. What part of that feels heaviest right now?`,
        `Heard. Want to start with a quick recovery practice, or talk it through first?`,
        `Okay. If you could change one small thing about this in the next hour, what would it be?`
      ]);
    }
  }
}

/* ============================================================
   VOICE PROVIDER (abstraction)
   ============================================================ */
const VoiceAIProvider = {
  provider: CONFIG.VOICE_PROVIDER,
  /* Real-time voice session stub — OpenAI Realtime / ElevenLabs Conversational.
     Demo returns session metadata only; the client drives SpeechRecognition + TTS. */
  startSession({ userId, voice }) {
    return {
      sessionId: 'voice_' + crypto.randomBytes(8).toString('hex'),
      voice: voice || 'calm',
      provider: this.provider,
      userId
    };
  }
};

/* TTSProvider.speak({ text, voice_id, voice_style, provider_voice_id, use_authorized_voice })
   - voice_id:    the user's chosen *style* (calm | warm | professional | neutral | reassuring)
   - provider_voice_id: optional ElevenLabs / PlayHT voice id for the AUTHORIZED VOICE
   - use_authorized_voice: boolean — caller declares whether the user is consenting to
     having their cloned voice speak the reply.
   Returns { audio, format, voice_id, voice_used, provider, duration_ms }
     - audio: base64 audio bytes when a provider is configured, else null (client uses SpeechSynthesis)
     - voice_used: 'authorized_voice' | 'synthetic_<style>' — never ambiguous to the UI.
*/
const TTSProvider = {
  provider: CONFIG.TTS_PROVIDER,
  apiKey:  CONFIG.ELEVENLABS_API_KEY,

  async speak({ text = '', voice_style = 'calm', provider_voice_id = null, use_authorized_voice = false, speed = 1.0, settings_override = null } = {}) {
    const base = VOICE_STYLE_SETTINGS[voice_style] || VOICE_STYLE_SETTINGS.calm;
    // Allow callers (slider-based UI) to nudge stability / style on top of the per-style defaults.
    const settings = settings_override ? { ...base, ...settings_override } : base;
    // ElevenLabs doesn't take a "speed" field; we only use it for honest duration estimates.
    const speedFactor = Math.min(1.4, Math.max(0.6, Number(speed) || 1.0));
    const voiceUsed = (use_authorized_voice && provider_voice_id) ? 'authorized_voice' : `synthetic_${voice_style}`;
    // Honest demo path: no audio bytes; client uses SpeechSynthesis with the right voice label.
    if (this.provider !== 'elevenlabs' || !this.apiKey) {
      return {
        audio: null,
        format: null,
        voice_id: voice_style,
        voice_used: voiceUsed,
        provider: this.provider,
        text,
        duration_ms: Math.max(500, Math.round(text.split(/\s+/).length * 280 / speedFactor))
      };
    }
    // Real ElevenLabs path
    try {
      // When authorized voice is available, use the user's cloned voice_id.
      // Otherwise fall back to a stock ElevenLabs voice that matches the style.
      const voiceId = (use_authorized_voice && provider_voice_id)
        ? provider_voice_id
        : STOCK_VOICE_FOR_STYLE[voice_style] || STOCK_VOICE_FOR_STYLE.calm;
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: settings
        })
      });
      if (!r.ok) {
        let errText = await r.text().catch(() => '');
        // Strip any API key string from the error detail before returning it.
        if (this.apiKey && errText) errText = errText.split(this.apiKey).join('[redacted]');
        return { audio: null, voice_id: voice_style, voice_used: voiceUsed, provider: this.provider, error: 'provider_error', text, provider_status: r.status, provider_detail: (errText || '').slice(0, 240) };
      }
      const buf = Buffer.from(await r.arrayBuffer());
      return {
        audio: buf.toString('base64'),
        format: 'audio/mpeg',
        voice_id: voiceId,
        voice_used: voiceUsed,
        provider: 'elevenlabs',
        text,
        duration_ms: Math.max(500, Math.round(text.split(/\s+/).length * 280 / speedFactor))
      };
    } catch (e) {
      return { audio: null, voice_id: voice_style, voice_used: voiceUsed, provider: this.provider, error: 'provider_unavailable', text };
    }
  },

  /* Clone a voice from one or more local audio samples.
     Returns { provider_voice_id, requires_verification } on success.
     Throws an Error with .status, .code, .detail on failure so callers can map to
     the per-user state machine (failed | verification_required). */
  async cloneVoice({ name, files }) {
    if (!this.apiKey) throw Object.assign(new Error('elevenlabs_not_configured'), { status: 0, code: 'not_configured' });
    const boundary = '----SYNAPSE-' + crypto.randomBytes(8).toString('hex');
    const parts = [];
    const addField = (k, v) => {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    };
    const addFile = (k, filename, mime, data) => {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`));
      parts.push(data);
      parts.push(Buffer.from(`\r\n`));
    };
    addField('name', name);
    files.forEach((f) => addFile('files', f.filename, f.mime, f.data));
    addField('description', 'SYNAPSE authorized voice for ' + name);
    addField('labels', JSON.stringify({ use_case: 'wellbeing_companion' }));
    const body = Buffer.concat(parts) + Buffer.from(`--${boundary}--\r\n`);
    const r = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'multipart/form-data; boundary=' + boundary
      },
      body
    });
    const text = await r.text().catch(() => '');
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch (_) { /* keep as text */ }

    if (!r.ok) {
      // Inspect the message for known sub-codes so we can map a 401 to a specific cause.
      const detailMessage = (j && j.detail && (j.detail.message || j.detail.code)) || '';
      const detailCode    = (j && j.detail && j.detail.code) || '';
      let rawText       = (typeof text === 'string' ? text : '');
      // Strip any API key from raw provider text before using it as a UI hint.
      if (this.apiKey && rawText) rawText = rawText.split(this.apiKey).join('[redacted]');
      const isMissingPermission = /missing the permission/i.test(detailMessage) || /missing the permission/i.test(rawText);
      const code = (r.status === 401 && !isMissingPermission) ? 'invalid_api_key'
        : (r.status === 401 &&  isMissingPermission)        ? 'missing_permission'
        : r.status === 403 ? (detailCode ? String(detailCode) : 'forbidden')
        : r.status === 413 ? 'file_too_large'
        : r.status === 422 ? (detailCode ? String(detailCode) : 'validation_error')
        : r.status === 429 ? 'rate_limited'
        : 'provider_error';
      const err = new Error('elevenlabs_clone_failed');
      err.status = r.status;
      err.code = code;
      // Safe-to-display reason: never include the API key itself.
      err.detail = (detailMessage || rawText).slice(0, 240);
      // A short, UI-friendly message — does NOT expose the API key or anything sensitive.
      err.message = code === 'missing_permission'
        ? 'ElevenLabs rejected the request: this API key lacks the create_instant_voice_clone permission. Enable that permission on your ElevenLabs account, then click Retry.'
        : code === 'invalid_api_key'
          ? 'ElevenLabs rejected the API key. Update ELEVENLABS_API_KEY in .env and restart the server.'
          : code === 'forbidden'
            ? 'ElevenLabs forbade this request (HTTP 403). Check your account permissions.'
            : code === 'file_too_large'
              ? 'The audio file is too large for ElevenLabs.'
              : code === 'validation_error'
                ? 'ElevenLabs rejected the audio. Try a 5–30 second clip in WAV/MP3 format.'
                : code === 'rate_limited'
                  ? 'ElevenLabs rate limit reached. Try again in a moment.'
                  : 'ElevenLabs request failed (HTTP ' + r.status + ').';
      throw err;
    }
    if (!j || !j.voice_id) {
      const err = new Error('elevenlabs_clone_no_id');
      err.status = r.status;
      err.code = 'no_voice_id';
      err.detail = text.slice(0, 400);
      throw err;
    }
    return { provider_voice_id: j.voice_id, requires_verification: !!j.requires_verification };
  },

  async deleteVoice({ provider_voice_id }) {
    if (!this.apiKey || !provider_voice_id) return { ok: false, skipped: true };
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/voices/${provider_voice_id}`, {
        method: 'DELETE',
        headers: { 'xi-api-key': this.apiKey }
      });
      return { ok: r.ok };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
};

// Stock ElevenLabs voice ids used when no authorized voice is available.
// These are real public stock voices; safe to use as a non-personal fallback.
const STOCK_VOICE_FOR_STYLE = {
  calm:        process.env.ELEVENLABS_VOICE_CALM         || '21m00Tcm4TlvDq8ikWAM', // Rachel
  professional:process.env.ELEVENLABS_VOICE_PROFESSIONAL || 'AZnzlk1XvdvUeBnXmlld', // Domi
  warm:        process.env.ELEVENLABS_VOICE_WARM         || 'EXAVITQu4vr4xnSDxMaL', // Bella
  neutral:     process.env.ELEVENLABS_VOICE_NEUTRAL      || 'ErXwobaYiN019PkySvjV', // Antoni
  reassuring:  process.env.ELEVENLABS_VOICE_REASSURING   || 'TxGEqnHWrfWFTfGW9XjX'  // Josh
};

/* ============================================================
   INSIGHTS — Predictive Wellbeing Engine
   ============================================================ */
function predictWellbeing(userId) {
  const rows = db.prepare(`SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 7`).all(userId);
  if (!rows.length) return { status: 'NO_DATA', signals: [], recommendation: null, message: null };
  const avg = (k) => Math.round(rows.reduce((s, r) => s + (r[k] || 0), 0) / rows.length);
  const stress = avg('stress');
  const mood = avg('mood');
  const sleep = avg('sleep');
  const energy = avg('energy');
  const focus = avg('focus');

  // trend: compare last 3 vs first 3 in the window
  const half = Math.max(1, Math.floor(rows.length / 2));
  const recent = rows.slice(0, half);
  const older = rows.slice(half);
  const trend = (k) => {
    if (!older.length) return 0;
    const a = recent.reduce((s, r) => s + (r[k] || 0), 0) / recent.length;
    const b = older.reduce((s, r) => s + (r[k] || 0), 0) / older.length;
    return Math.round(a - b);
  };
  const dStress = trend('stress');
  const dSleep = trend('sleep');
  const dMood = trend('mood');

  let status = 'LOW';
  if (stress >= 65 || dStress >= 15) status = 'ELEVATED';
  else if (stress >= 45 || dStress >= 8) status = 'MODERATE';

  const signals = [];
  if (dStress > 0) signals.push({ icon: '↑', text: `Reported stress has increased by ${dStress}% over the last 7 days` });
  if (dSleep < 0) signals.push({ icon: '↓', text: `Sleep quality has decreased by ${Math.abs(dSleep)}%` });
  if (dMood < 0) signals.push({ icon: '↓', text: `Mood has dipped by ${Math.abs(dMood)}%` });
  if (energy < 50) signals.push({ icon: '↓', text: 'Reported energy is below your recent average' });
  if (focus < 50) signals.push({ icon: '↓', text: 'Reported focus is below your recent average' });

  let recommendation = 'A 5-minute Box Breathing exercise is recommended to reset the stress response.';
  if (status === 'ELEVATED') recommendation = 'Consider a 5-minute recovery exercise and, if it persists, book a short session with a counsellor.';
  if (status === 'MODERATE') recommendation = 'A 2-minute Focus Reset and a brief walk are recommended. Re-check in tomorrow.';

  const message = status === 'ELEVATED'
    ? 'Your reported stress has increased over the last 7 days. Consider a brief recovery exercise before continuing.'
    : status === 'MODERATE'
      ? 'Some of your signals are trending upward. A short recovery practice will help you stay balanced.'
      : 'Your recent signals look balanced. Keep your current routine and consider a daily check-in.';

  return { status, signals, recommendation, message, snapshot: { stress, mood, sleep, energy, focus } };
}

function recommendExercises(insight) {
  const list = db.prepare('SELECT * FROM exercises').all();
  const recs = [];
  if (insight.status === 'ELEVATED' || insight.status === 'MODERATE') {
    recs.push(list.find(e => e.slug === 'box-breathing'));
    recs.push(list.find(e => e.slug === 'guided-relaxation'));
    recs.push(list.find(e => e.slug === 'grounding-54321'));
  }
  if (insight.snapshot && insight.snapshot.sleep < 60) {
    recs.push(list.find(e => e.slug === 'sleep-prep'));
    recs.push(list.find(e => e.slug === '478-breathing'));
  }
  if (insight.snapshot && insight.snapshot.focus < 60) {
    recs.push(list.find(e => e.slug === 'focus-reset'));
  }
  if (!recs.length) {
    recs.push(list.find(e => e.slug === 'coherent-breathing'));
    recs.push(list.find(e => e.slug === 'pmr'));
  }
  // Deduplicate
  return [...new Set(recs.filter(Boolean))].slice(0, 5);
}

function recoveryStreak(userId) {
  const rows = db.prepare('SELECT DISTINCT date(created_at) AS d FROM exercise_sessions WHERE user_id = ? AND completed = 1 ORDER BY d DESC').all(userId);
  if (!rows.length) return 0;
  const today = new Date(); today.setHours(0,0,0,0);
  let s = 0;
  let prev = new Date(today);
  for (const r of rows) {
    const d = new Date(r.d);
    if (d.toISOString().slice(0,10) === prev.toISOString().slice(0,10)) { s++; prev.setDate(prev.getDate()-1); }
    else break;
  }
  return s;
}

function checkinStreak(userId) {
  const rows = db.prepare('SELECT DISTINCT date(created_at) AS d FROM checkins WHERE user_id = ? ORDER BY d DESC').all(userId);
  if (!rows.length) return 0;
  const today = new Date(); today.setHours(0,0,0,0);
  let s = 0;
  let prev = new Date(today);
  for (const r of rows) {
    const d = new Date(r.d);
    if (d.toISOString().slice(0,10) === prev.toISOString().slice(0,10)) { s++; prev.setDate(prev.getDate()-1); }
    else break;
  }
  return s;
}

/* ============================================================
   AUTH
   ============================================================ */
app.post('/api/register', (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'missing fields' });
  try {
    const allowedRoles = ['personnel', 'counsellor', 'admin', 'welfare_officer', 'commander'];
    const assignedRole = allowedRoles.includes(role) ? role : 'personnel';
    const info = db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(name, email, hash(password), assignedRole);
    const id = info.lastInsertRowid;
    db.prepare('INSERT INTO wallets (user_id, balance) VALUES (?, ?)').run(id, 0);
    const t = token();
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(t, id);
    audit(id, 'register', { email });
    res.json({ token: t, user: { id, name, email, role: assignedRole } });
  } catch (e) {
    res.status(400).json({ error: 'email exists' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email = ? AND password = ?').get(email, hash(password));
  if (!u) return res.status(401).json({ error: 'bad credentials' });
  const t = token();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(t, u.id);
  audit(u.id, 'login', null);
  res.json({ token: t, user: { id: u.id, name: u.name, email: u.email, role: u.role, rank: u.rank, service: u.service, country: u.country } });
});

app.post('/api/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.headers['authorization']);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  const u = db.prepare('SELECT id, name, email, role, rank, service, country, preferred_voice, voice_consent, ai_consent, notify_checkin, notify_screening, notify_session, notify_streak FROM users WHERE id = ?').get(req.user);
  res.json({ user: u });
});

app.patch('/api/me', auth, (req, res) => {
  const fields = ['name','rank','service','country','preferred_voice','voice_consent','ai_consent','notify_checkin','notify_screening','notify_session','notify_streak'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
  }
  if (!updates.length) return res.json({ ok: true });
  values.push(req.user);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  audit(req.user, 'profile_update', { fields: Object.keys(req.body) });
  res.json({ ok: true });
});

/* ============================================================
   CHECK-INS
   ============================================================ */
app.post('/api/checkins', auth, (req, res) => {
  const { mood, stress, sleep, energy, focus, recovery, note } = req.body;
  const info = db.prepare(`INSERT INTO checkins (user_id, mood, stress, sleep, energy, focus, recovery, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(req.user, mood, stress, sleep, energy, focus, recovery, note || '');
  // also update wallet? no — no money here
  notify(req.user, 'checkin', 'Daily check-in logged', 'Your signals have been recorded. Take a moment to review your insight.');
  res.json({ id: info.lastInsertRowid });
});

app.get('/api/checkins', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').all(req.user);
  res.json({ checkins: rows });
});

app.get('/api/checkins/latest', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(req.user);
  res.json({ checkin: row });
});

/* ============================================================
   WELLBEING INTELLIGENCE
   ============================================================ */
app.get('/api/insight', auth, (req, res) => {
  const insight = predictWellbeing(req.user);
  const recs = recommendExercises(insight);
  res.json({ insight, recommendations: recs });
});

/* ============================================================
   SCREENINGS
   ============================================================ */
app.post('/api/screenings', auth, (req, res) => {
  const { instrument, answers } = req.body || {};
  // Accept either a {q1:n, q2:n,...} object OR an array of numeric answers.
  // Both shapes must sum correctly without crashing.
  let score = 0;
  if (Array.isArray(answers)) {
    score = answers.reduce((a, b) => a + Number(b || 0), 0);
  } else if (answers && typeof answers === 'object') {
    for (const k of Object.keys(answers)) score += Number(answers[k] || 0);
  }
  let severity = 'minimal';
  if (score >= 5) severity = 'mild';
  if (score >= 10) severity = 'moderate';
  if (score >= 15) severity = 'severe';
  const info = db.prepare(`INSERT INTO screenings (user_id, instrument, score, severity, answers)
    VALUES (?, ?, ?, ?, ?)`).run(req.user, instrument || 'UNKNOWN', score, severity, JSON.stringify(answers));
  try { notify(req.user, 'screening', 'Screening completed', `Your ${instrument} screen suggests ${severity} signals. Consider connecting with a counsellor.`); } catch (_) {}
  res.json({ id: info.lastInsertRowid, score, severity });
});

app.get('/api/screenings', auth, (req, res) => {
  const rows = db.prepare('SELECT id, instrument, score, severity, created_at FROM screenings WHERE user_id = ? ORDER BY created_at DESC').all(req.user);
  res.json({ screenings: rows });
});

/* ============================================================
   AI ASSISTANT
   ============================================================ */
app.post('/api/chat', auth, async (req, res) => {
  const { content, session_id } = req.body;
  if (!content) return res.status(400).json({ error: 'empty' });

  // Optional conversation_sessions grouping
  let sid = session_id || null;
  if (sid) {
    const exists = db.prepare('SELECT id FROM conversation_sessions WHERE id = ? AND user_id = ?').get(sid, req.user);
    if (!exists) sid = null;
  }
  if (!sid) {
    const r = db.prepare('INSERT INTO conversation_sessions (user_id, channel, intent) VALUES (?, ?, ?)').run(req.user, 'text', classifyIntent(content));
    sid = r.lastInsertRowid;
  }

  db.prepare('INSERT INTO conversation_messages (session_id, user_id, role, content) VALUES (?, ?, ?, ?)').run(sid, req.user, 'user', content);

  if (CRISIS.test(content)) {
    db.prepare('INSERT INTO crisis_reports (user_id, message, severity) VALUES (?, ?, ?)').run(req.user, content, 'high');
    const reply = `I'm concerned about what you've shared. Your safety matters most right now.\n\n• Emergency: 112 (India) / 988 (US) / 116 123 (UK)\n• iCall India: 9152987821\n• Vandrevala Foundation: 1860-2662-345\n\nWould you like me to help you book a counsellor right now, or connect you to a quiet, private place to talk?`;
    db.prepare('INSERT INTO conversation_messages (session_id, user_id, role, content) VALUES (?, ?, ?, ?)').run(sid, req.user, 'assistant', reply);
    return res.json({ reply, crisis: true, emergency: CONFIG.EMERGENCY, intent: 'crisis', session_id: sid });
  }
  const history = db.prepare('SELECT role, content FROM conversation_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').all(req.user).reverse();

  // Build wellbeing context — only used when intent touches it
  const u = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user);
  const well = predictWellbeing(req.user);
  const context = { name: u && u.name, snapshot: well, userId: req.user };

  const result = await AIProvider.chat({ system: 'You are SYNAPSE, a calm, non-diagnostic wellbeing companion for uniformed personnel.', user: content, history, context });
  // Apply mode to the reply (e.g. Just Listen = no advice tone, Calm = softer)
  const mode = (req.body && req.body.mode) || 'chat';
  const reply = withMode(result.reply, mode);
  // Analyze emotional signals (transparent baseline)
  const signals = analyzeEmotion(content);
  saveEmotionalSignals(req.user, content, signals);
  db.prepare('INSERT INTO conversation_messages (session_id, user_id, role, content) VALUES (?, ?, ?, ?)').run(sid, req.user, 'assistant', reply);

  // Optional TTS for "loud" voice interactions
  let tts = null;
  if (req.body.tts === true) {
    const vp = db.prepare('SELECT provider_voice_id, status FROM voice_profiles WHERE user_id = ?').get(req.user);
    const useAuth = !!(vp && vp.provider_voice_id && vp.status === 'ready' && req.body.use_authorized_voice === true);
    tts = await TTSProvider.speak({
      text: result.reply,
      voice_style: req.body.voice_style || 'calm',
      provider_voice_id: vp ? vp.provider_voice_id : null,
      use_authorized_voice: useAuth,
      speed: req.body.speed || 1.0
    });
  }

  res.json({ reply, crisis: false, source: result.source, intent: result.intent, session_id: sid, tts, signals, mode });
});

app.get('/api/chat', auth, (req, res) => {
  const rows = db.prepare('SELECT role, content, created_at FROM messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 100').all(req.user);
  res.json({ messages: rows });
});

app.delete('/api/chat', auth, (req, res) => {
  db.prepare('DELETE FROM messages WHERE user_id = ?').run(req.user);
  res.json({ ok: true });
});

/* ============================================================
   VOICE — per-user authorized voice + voice-note pipeline
   ============================================================ */

/* Multer is optional; we use the simpler multipart manual parser below
   to avoid pulling in another dependency. */
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const ctype = req.headers['content-type'] || '';
    if (!ctype.startsWith('multipart/form-data')) return resolve({ fields: {}, files: [] });
    const m = ctype.match(/boundary=(.+)$/);
    if (!m) return resolve({ fields: {}, files: [] });
    const boundary = '--' + m[1];
    const chunks = [];
    req.on('data', (b) => chunks.push(b));
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        const parts = [];
        let pos = 0;
        while (pos < buf.length) {
          const start = buf.indexOf(boundary, pos);
          if (start === -1) break;
          const end = buf.indexOf(boundary, start + boundary.length);
          if (end === -1) break;
          let slice = buf.slice(start + boundary.length, end);
          if (slice.length >= 2 && slice[0] === 0x0d && slice[1] === 0x0a) slice = slice.slice(2);
          if (slice.length >= 2 && slice[slice.length - 2] === 0x0d && slice[slice.length - 1] === 0x0a) slice = slice.slice(0, -2);
          if (slice.length === 0) { pos = end + boundary.length; continue; }
          const hdrEnd = slice.indexOf('\r\n\r\n');
          const header = slice.slice(0, hdrEnd).toString('utf8');
          const body   = slice.slice(hdrEnd + 4);
          const nameM  = header.match(/name="([^"]+)"/);
          const fileM  = header.match(/filename="([^"]+)"/);
          const ctM    = header.match(/Content-Type:\s*([^\r\n]+)/i);
          if (nameM) {
            if (fileM) {
              parts.push({ name: nameM[1], filename: fileM[1], mime: ctM ? ctM[1].trim() : 'application/octet-stream', data: body });
            } else {
              parts.push({ name: nameM[1], value: body.toString('utf8') });
            }
          }
          pos = end + boundary.length;
        }
        const fields = {}, files = [];
        for (const p of parts) {
          if ('value' in p) fields[p.name] = p.value;
          else files.push({ name: p.name, filename: p.filename, mime: p.mime, data: p.data });
        }
        resolve({ fields, files });
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/* Voice profile helpers */
function getVoiceProfile(userId) {
  return db.prepare(`SELECT * FROM voice_profiles WHERE user_id = ?`).get(userId) || null;
}
function listVoiceSamples(userId) {
  return db.prepare(`SELECT id, duration_sec, mime, size_bytes, created_at FROM voice_samples WHERE user_id = ? ORDER BY created_at DESC`).all(userId);
}
function updateVoiceProfileCounts(userId) {
  const r = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(duration_sec), 0) AS dur FROM voice_samples WHERE user_id = ?`).get(userId);
  db.prepare(`UPDATE voice_profiles SET sample_count = ?, total_duration_sec = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(r.n, r.dur, userId);
}

app.post('/api/voice/profile', auth, async (req, res) => {
  /* Create / update the per-user voice profile.
     body: { phrase, consent_given, provider_voice_id?, status? } */
  const { phrase, consent_given, provider_voice_id = null, status = 'pending' } = req.body || {};
  if (!phrase) return res.status(400).json({ error: 'phrase required' });
  if (!consent_given) return res.status(400).json({ error: 'explicit consent required' });
  const existing = getVoiceProfile(req.user);
  if (existing) {
    db.prepare(`UPDATE voice_profiles
                SET phrase = ?, consent_given = 1, consent_timestamp = CURRENT_TIMESTAMP,
                    provider_voice_id = COALESCE(?, provider_voice_id),
                    status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?`)
      .run(phrase, provider_voice_id, status, req.user);
  } else {
    db.prepare(`INSERT INTO voice_profiles (user_id, provider, provider_voice_id, status, consent_given, consent_timestamp, phrase)
                VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?)`)
      .run(req.user, CONFIG.VOICE_PROVIDER, provider_voice_id, status, phrase);
  }
  audit(req.user, 'voice_profile_update', JSON.stringify({ phrase: !!phrase, consent: !!consent_given }));
  res.json({ ok: true, profile: getVoiceProfile(req.user) });
});

app.get('/api/voice/profile', auth, (req, res) => {
  /* Returns safe fields + sample list.
     provider_voice_id is included whenever the profile has reached an authorized state,
     so authorized TTS can be enabled without an extra round-trip. */
  const p = getVoiceProfile(req.user);
  if (!p) return res.json({ profile: null, samples: [] });
  const safe = {
    status: p.status,
    voice_status: p.status, // alias used by the frontend
    sample_count: p.sample_count,
    total_duration_sec: p.total_duration_sec,
    phrase: p.phrase,
    consent_given: !!p.consent_given,
    consent_timestamp: p.consent_timestamp,
    updated_at: p.updated_at,
    provider: p.provider
  };
  const isAuthorized = p.status === 'authorized' || p.status === 'ready' || p.status === 'verification_required';
  if (isAuthorized && p.provider_voice_id) safe.provider_voice_id = p.provider_voice_id;
  // Surface the latest cached error code if present (used by UI banner when status=failed)
  if (p.embedding) {
    try {
      const cached = JSON.parse(p.embedding);
      if (cached && cached.last_error_code) {
        safe.last_error_code = cached.last_error_code;
        safe.last_error_msg  = cached.last_error_msg || null;
        safe.last_error_at   = cached.last_error_at || null;
      }
    } catch (_) {}
  }
  res.json({ profile: safe, samples: listVoiceSamples(req.user) });
});

app.post('/api/voice/samples', auth, async (req, res) => {
  /* Multipart upload of a single audio sample.
     If ElevenLabs is configured and the user has consented, we send the sample to
     /v1/voices/add (instant voice cloning) on FIRST upload and store the returned voice_id.
     Subsequent uploads add to the same profile but do not re-clone. */
  let parsed;
  try { parsed = await parseMultipart(req); }
  catch (e) { return res.status(400).json({ error: 'malformed upload' }); }
  const file = (parsed.files || [])[0];
  if (!file) return res.status(400).json({ error: 'audio file required' });
  if (file.data.length > CONFIG.MAX_SAMPLE_BYTES) return res.status(413).json({ error: 'file too large', max_bytes: CONFIG.MAX_SAMPLE_BYTES });
  if (!CONFIG.ALLOWED_SAMPLE_MIME.includes(file.mime)) return res.status(415).json({ error: 'unsupported mime', mime: file.mime });

  // Verify profile + consent
  const profile = getVoiceProfile(req.user);
  if (!profile) return res.status(404).json({ error: 'voice profile required first' });
  if (!profile.consent_given) return res.status(403).json({ error: 'consent required' });

  const id = crypto.randomBytes(8).toString('hex');
  const ext = (file.mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/g, '');
  const filename = `user-${req.user}-${id}.${ext}`;
  if (!fs.existsSync(CONFIG.UPLOAD_DIR)) fs.mkdirSync(CONFIG.UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(CONFIG.UPLOAD_DIR, filename), file.data);
  const duration = parseFloat((parsed.fields && parsed.fields.duration_sec) || '0') || 0;

  const ins = db.prepare(`INSERT INTO voice_samples (user_id, voice_profile_id, filename, mime, size_bytes, duration_sec, transcript) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const r = ins.run(req.user, profile.id, filename, file.mime, file.data.length, duration, (parsed.fields && parsed.fields.transcript) || null);
  const sampleId = String(r.lastInsertRowid);
  updateVoiceProfileCounts(req.user);

  // Honest status: voice cloning requires a real provider — without one, we are still "pending".
  let newStatus = profile.status;
  let providerVoiceId = profile.provider_voice_id;
  let voiceUsed = 'pending';
  let providerMessage = null;
  let errorCode = null;
  let requiresVerification = false;
  const elevenlabsReady = CONFIG.VOICE_PROVIDER === 'elevenlabs' && !!CONFIG.ELEVENLABS_API_KEY;
  if (elevenlabsReady) {
    // Only clone if we don't already have an authorized voice for this user.
    if (!providerVoiceId || (newStatus !== 'authorized' && newStatus !== 'verification_required')) {
      // Mark "cloning" BEFORE the network call so the UI can show a transitional state.
      db.prepare(`UPDATE voice_profiles SET status = 'cloning', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(req.user);
      try {
        const clone = await TTSProvider.cloneVoice({
          name: 'synapse-user-' + req.user + '-' + id,
          files: [{ filename, mime: file.mime, data: file.data }]
        });
        providerVoiceId = clone.provider_voice_id;
        requiresVerification = !!clone.requires_verification;
        newStatus = requiresVerification ? 'verification_required' : 'authorized';
        voiceUsed = 'authorized_voice';
        providerMessage = requiresVerification
          ? 'Voice cloned but requires ElevenLabs verification before use.'
          : 'Authorized voice cloned with ElevenLabs.';
      } catch (e) {
        newStatus = 'failed';
        voiceUsed = 'pending';
        errorCode = e.code || 'provider_error';
        // Prefer the safe provider message; fall back to a synthesized one.
        providerMessage = e.message || ('ElevenLabs cloning failed (' + errorCode + ', HTTP ' + (e.status || '?') + ')');
        if (e.detail && !providerMessage.includes(String(e.detail).slice(0, 80))) {
          providerMessage += ' — ' + String(e.detail).slice(0, 200);
        }
        audit(req.user, 'voice_clone_failed', JSON.stringify({ code: errorCode, status: e.status }));
      }
    } else {
      newStatus = 'authorized';
      voiceUsed = 'authorized_voice';
      providerMessage = 'Sample added to your existing authorized voice profile.';
    }
  } else {
    // No real provider configured — we are NOT advancing past pending. This is an honest state.
    newStatus = 'pending';
    voiceUsed = 'demo_unsupported';
    providerMessage = 'Voice cloning service is not configured — the AI is using a synthetic voice. Add an ElevenLabs API key to enable authorized-voice cloning.';
  }
  db.prepare(`UPDATE voice_profiles SET status = ?, provider_voice_id = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`)
    .run(newStatus, providerVoiceId, req.user);
  // Cache the latest failure code so the UI can show it without a separate query.
  if (errorCode) {
    try {
      db.prepare(`UPDATE voice_profiles SET embedding = ? WHERE user_id = ?`)
        .run(JSON.stringify({ last_error_code: errorCode, last_error_at: new Date().toISOString(), last_error_msg: (providerMessage || '').slice(0, 240) }), req.user);
    } catch (_) {}
  } else if (newStatus === 'authorized' || newStatus === 'verification_required') {
    try {
      db.prepare(`UPDATE voice_profiles SET embedding = ? WHERE user_id = ?`)
        .run(JSON.stringify({ last_error_code: null, last_error_at: null, last_error_msg: null }), req.user);
    } catch (_) {}
  }

  audit(req.user, 'voice_sample_upload', JSON.stringify({ id, mime: file.mime, size: file.data.length, status: newStatus, has_voice_id: !!providerVoiceId, error_code: errorCode }));
  res.json({
    ok: newStatus !== 'failed',
    status: newStatus,
    voice_status: newStatus, // alias for frontend convenience
    provider: elevenlabsReady ? 'elevenlabs' : (CONFIG.VOICE_PROVIDER || 'demo'),
    provider_voice_id: (newStatus === 'authorized' || newStatus === 'verification_required') ? providerVoiceId : null,
    requires_verification: requiresVerification,
    error_code: errorCode,
    sample_id: sampleId,
    samples: listVoiceSamples(req.user),
    voice_used_label: voiceUsed,
    provider_configured: elevenlabsReady,
    message: providerMessage
  });
});

/* Retry cloning for the current user.
   - Only acts when there is NO existing provider_voice_id and at least one sample.
   - Never duplicates a clone if provider_voice_id is already set.
   - Idempotent: safe to call repeatedly while in 'failed' or 'pending'. */
app.post('/api/voice/clone', auth, async (req, res) => {
  if (!CONFIG.ELEVENLABS_API_KEY) {
    return res.status(400).json({ ok: false, status: 'failed', error_code: 'not_configured', message: 'ELEVENLABS_API_KEY is not set on the server.' });
  }
  const profile = getVoiceProfile(req.user);
  if (!profile) return res.status(404).json({ ok: false, status: 'failed', error_code: 'no_profile', message: 'Create a voice profile first.' });
  if (!profile.consent_given) return res.status(403).json({ ok: false, status: 'failed', error_code: 'no_consent', message: 'Explicit consent is required.' });
  if (profile.provider_voice_id) {
    return res.json({ ok: true, status: profile.status, provider: 'elevenlabs', provider_voice_id: profile.provider_voice_id, message: 'Voice is already authorized.' });
  }
  const samples = db.prepare(`SELECT * FROM voice_samples WHERE user_id = ? ORDER BY created_at ASC LIMIT 5`).all(req.user);
  if (!samples.length) return res.status(400).json({ ok: false, status: 'failed', error_code: 'no_samples', message: 'Upload at least one voice sample before retrying.' });

  db.prepare(`UPDATE voice_profiles SET status = 'cloning', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(req.user);

  const seed = samples[0];
  let buf;
  try { buf = fs.readFileSync(path.join(CONFIG.UPLOAD_DIR, seed.filename)); }
  catch (e) {
    return res.status(500).json({ ok: false, status: 'failed', error_code: 'sample_missing', message: 'Sample file is missing on disk.' });
  }

  try {
    const clone = await TTSProvider.cloneVoice({
      name: 'synapse-user-' + req.user + '-' + Date.now(),
      files: [{ filename: seed.filename, mime: seed.mime, data: buf }]
    });
    const newStatus = clone.requires_verification ? 'verification_required' : 'authorized';
    db.prepare(`UPDATE voice_profiles SET status = ?, provider_voice_id = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`)
      .run(newStatus, clone.provider_voice_id, req.user);
    audit(req.user, 'voice_clone_retry_success', JSON.stringify({ voice_id: clone.provider_voice_id, requires_verification: !!clone.requires_verification }));
    return res.json({
      ok: true, status: newStatus, provider: 'elevenlabs',
      provider_voice_id: clone.provider_voice_id,
      requires_verification: !!clone.requires_verification,
      message: newStatus === 'verification_required' ? 'Voice cloned but requires ElevenLabs verification before use.' : 'Authorized voice cloned successfully.'
    });
  } catch (e) {
    db.prepare(`UPDATE voice_profiles SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(req.user);
    // Cache the error so /api/voice/profile can surface it on next fetch.
    try {
      db.prepare(`UPDATE voice_profiles SET embedding = ? WHERE user_id = ?`)
        .run(JSON.stringify({ last_error_code: e.code || 'provider_error', last_error_at: new Date().toISOString(), last_error_msg: (e.message || ('HTTP ' + (e.status || '?'))).slice(0, 240) }), req.user);
    } catch (_) {}
    audit(req.user, 'voice_clone_retry_failed', JSON.stringify({ code: e.code || 'provider_error', status: e.status }));
    return res.status(200).json({
      ok: false,
      status: 'failed',
      voice_status: 'failed',
      provider: 'elevenlabs',
      error_code: e.code || 'provider_error',
      message: e.message || ('ElevenLabs cloning failed (' + (e.code || 'provider_error') + ', HTTP ' + (e.status || '?') + ')') + (e.detail ? ': ' + String(e.detail).slice(0, 200) : '')
    });
  }
});

app.delete('/api/voice/samples/:id', auth, (req, res) => {
  const row = db.prepare(`SELECT * FROM voice_samples WHERE id = ? AND user_id = ?`).get(parseInt(req.params.id, 10) || 0, req.user);
  if (!row) return res.status(404).json({ error: 'not found' });
  const fs = require('fs');
  try { fs.unlinkSync(path.join(CONFIG.UPLOAD_DIR, row.filename)); } catch (_) {}
  db.prepare(`DELETE FROM voice_samples WHERE id = ? AND user_id = ?`).run(req.params.id, req.user);
  updateVoiceProfileCounts(req.user);
  res.json({ ok: true, samples: listVoiceSamples(req.user) });
});

/* Backwards-compatible legacy enroll/verify/delete endpoints — kept for the existing UI */
app.post('/api/voice/enroll', auth, (req, res) => {
  const { phrase, embedding } = req.body || {};
  if (!phrase) return res.status(400).json({ error: 'phrase required' });
  if (!req.headers['x-voice-consent'] && !db.prepare('SELECT voice_consent FROM users WHERE id = ?').get(req.user).voice_consent) {
    return res.status(403).json({ error: 'consent required' });
  }
  const safeEmbed = embedding || crypto.createHash('sha256').update(phrase + req.user).digest('hex');
  const existing = getVoiceProfile(req.user);
  if (existing) {
    db.prepare(`UPDATE voice_profiles SET embedding = ?, phrase = ?, consent_given = 1, consent_timestamp = COALESCE(consent_timestamp, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`)
      .run(safeEmbed, phrase, req.user);
  } else {
    db.prepare(`INSERT INTO voice_profiles (user_id, embedding, phrase, consent_given, consent_timestamp) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)`)
      .run(req.user, safeEmbed, phrase);
  }
  audit(req.user, 'voice_enroll', null);
  res.json({ ok: true });
});

app.post('/api/voice/verify', auth, (req, res) => {
  const { phrase } = req.body || {};
  const profile = getVoiceProfile(req.user);
  if (!profile) return res.json({ verified: false, reason: 'no-profile' });
  const ok = (profile.phrase || '').toLowerCase().trim() === (phrase || '').toLowerCase().trim();
  res.json({ verified: ok });
});

app.delete('/api/voice', auth, async (req, res) => {
  // Withdraw consent and wipe everything. If we had a provider voice_id, ask the provider to delete too.
  const profile = getVoiceProfile(req.user);
  let providerDeletion = null;
  if (profile && profile.provider_voice_id) {
    try { providerDeletion = await TTSProvider.deleteVoice({ provider_voice_id: profile.provider_voice_id }); }
    catch (e) { providerDeletion = { ok: false, error: e.message }; }
  }
  db.prepare(`DELETE FROM voice_samples WHERE user_id = ?`).run(req.user);
  db.prepare(`DELETE FROM voice_profiles WHERE user_id = ?`).run(req.user);
  audit(req.user, 'voice_delete', providerDeletion ? JSON.stringify(providerDeletion) : null);
  res.json({ ok: true, provider_deletion: providerDeletion });
});

/* Public (no auth) provider config — used by the UI to display honest labels */
app.get('/api/voice/config', (req, res) => {
  res.json({
    provider: CONFIG.VOICE_PROVIDER,
    tts_provider: CONFIG.TTS_PROVIDER,
    elevenlabs_configured: !!CONFIG.ELEVENLABS_API_KEY,
    ai_provider: CONFIG.AI_PROVIDER,
    ai_configured: !!CONFIG.AI_API_KEY,
    styles: Object.keys(VOICE_STYLE_SETTINGS),
    defaults: STOCK_VOICE_FOR_STYLE
  });
});

app.get('/api/voice', auth, (req, res) => {
  const p = getVoiceProfile(req.user);
  if (!p) return res.json({ profile: null });
  const safe = {
    id: p.id, phrase: p.phrase, created_at: p.created_at,
    status: p.status, sample_count: p.sample_count, total_duration_sec: p.total_duration_sec,
    consent_given: !!p.consent_given, consent_timestamp: p.consent_timestamp,
    updated_at: p.updated_at, provider: p.provider
  };
  res.json({ profile: safe });
});

app.post('/api/voice/session/start', auth, (req, res) => {
  const { voice } = req.body || {};
  const info = db.prepare('INSERT INTO voice_sessions (user_id) VALUES (?)').run(req.user);
  const provider = VoiceAIProvider.startSession({ userId: req.user, voice });
  res.json({ sessionId: info.lastInsertRowid, voiceProvider: provider });
});

app.post('/api/voice/session/end', auth, (req, res) => {
  const { sessionId, duration, transcript } = req.body || {};
  db.prepare('UPDATE voice_sessions SET ended_at = CURRENT_TIMESTAMP, duration_sec = ?, transcript = ? WHERE id = ? AND user_id = ?')
    .run(duration || 0, transcript || '', sessionId, req.user);
  res.json({ ok: true });
});

app.post('/api/tts', auth, async (req, res) => {
  /* Honest per-user TTS:
     - Looks up the user's voice profile.
     - If status === 'ready' AND caller passes use_authorized_voice === true, uses the cloned voice.
     - Otherwise uses a synthetic voice matching voice_style (default 'calm').
     - Always returns `voice_used` so the UI can label which voice is speaking.
  */
  const { text, voice_style = 'calm', use_authorized_voice = false, speed = 1.0, stability = null, expressiveness = null } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  const profile = getVoiceProfile(req.user);
  const providerVoiceId = profile && profile.provider_voice_id ? profile.provider_voice_id : null;
  const authorizedAvailable = !!(profile && profile.provider_voice_id && (profile.status === 'authorized' || profile.status === 'ready'));
  const useAuth = use_authorized_voice === true && authorizedAvailable;
  // Build a settings override from per-user sliders, when provided.
  const settings_override = {};
  if (stability !== null && stability !== undefined) {
    settings_override.stability = Math.min(1, Math.max(0, Number(stability) || 0));
  }
  if (expressiveness !== null && expressiveness !== undefined) {
    // 'style' in ElevenLabs controls expressiveness.
    settings_override.style = Math.min(1, Math.max(0, Number(expressiveness) || 0));
  }
  const result = await TTSProvider.speak({
    text,
    voice_style,
    provider_voice_id: providerVoiceId,
    use_authorized_voice: useAuth,
    speed: Math.min(1.4, Math.max(0.6, Number(speed) || 1.0)),
    settings_override: Object.keys(settings_override).length ? settings_override : null
  });
  res.json({
    ...result,
    voice_style,
    authorized_voice_available: authorizedAvailable,
    consent_given: !!(profile && profile.consent_given)
  });
});

/* Unified voice turn: client sends transcribed text → we run intent + memory + (optional) TTS */
app.post('/api/assistant/voice-turn', auth, async (req, res) => {
  const { transcript, session_id, voice_style = 'calm', use_authorized_voice = false, speed = 1.0 } = req.body || {};
  if (!transcript || !transcript.trim()) return res.status(400).json({ error: 'transcript required' });

  let sid = session_id || null;
  if (sid) {
    const exists = db.prepare('SELECT id FROM conversation_sessions WHERE id = ? AND user_id = ?').get(sid, req.user);
    if (!exists) sid = null;
  }
  if (!sid) {
    const r = db.prepare('INSERT INTO conversation_sessions (user_id, channel, intent) VALUES (?, ?, ?)').run(req.user, 'voice', classifyIntent(transcript));
    sid = r.lastInsertRowid;
  }
  db.prepare('INSERT INTO conversation_messages (session_id, user_id, role, content) VALUES (?, ?, ?, ?)').run(sid, req.user, 'user', transcript);

  let crisis = false;
  let reply;
  if (CRISIS.test(transcript)) {
    crisis = true;
    db.prepare('INSERT INTO crisis_reports (user_id, message, severity) VALUES (?, ?, ?)').run(req.user, transcript, 'high');
    reply = `I'm concerned about what you've shared. Your safety matters most right now.\n\n• Emergency: 112 (India) / 988 (US) / 116 123 (UK)\n• iCall India: 9152987821\n• Vandrevala Foundation: 1860-2662-345\n\nWould you like me to help you book a counsellor right now, or stay here with you?`;
  } else {
    const history = db.prepare('SELECT role, content FROM conversation_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').all(req.user).reverse();
    const u = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user);
    const well = predictWellbeing(req.user);
    const context = { name: u && u.name, snapshot: well, userId: req.user };
    const result = await AIProvider.chat({ system: 'You are SYNAPSE, a calm, non-diagnostic wellbeing companion for uniformed personnel.', user: transcript, history, context });
    reply = result.reply;
  }

  db.prepare('INSERT INTO conversation_messages (session_id, user_id, role, content) VALUES (?, ?, ?, ?)').run(sid, req.user, 'assistant', reply);

  // TTS in user's authorized voice when available, else synthetic
  const profile = getVoiceProfile(req.user);
  const authorizedAvailable = !!(profile && profile.provider_voice_id && profile.status === 'ready');
  const useAuth = use_authorized_voice === true && authorizedAvailable;
  const tts = await TTSProvider.speak({
    text: reply,
    voice_style,
    provider_voice_id: profile && profile.provider_voice_id ? profile.provider_voice_id : null,
    use_authorized_voice: useAuth,
    speed: Math.min(1.4, Math.max(0.6, Number(speed) || 1.0))
  });

  res.json({
    reply,
    intent: classifyIntent(transcript),
    crisis,
    emergency: crisis ? CONFIG.EMERGENCY : null,
    session_id: sid,
    authorized_voice_available: authorizedAvailable,
    voice_used: tts.voice_used,
    voice_style,
    tts: {
      audio: tts.audio,
      format: tts.format,
      provider: tts.provider,
      duration_ms: tts.duration_ms,
      voice_id: tts.voice_id
    }
  });
});

app.get('/api/assistant/history', auth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const rows = db.prepare(`SELECT session_id, role, content, created_at FROM conversation_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).all(req.user, limit).reverse();
  res.json({ messages: rows });
});

/* ============================================================
   RECOVERY STUDIO
   ============================================================ */
app.get('/api/exercises', (req, res) => {
  const rows = db.prepare('SELECT * FROM exercises ORDER BY id').all();
  res.json({ exercises: rows });
});

app.post('/api/exercises/session', auth, (req, res) => {
  const { exercise_id, duration_sec, completed } = req.body;
  const info = db.prepare('INSERT INTO exercise_sessions (user_id, exercise_id, duration_sec, completed) VALUES (?, ?, ?, ?)')
    .run(req.user, exercise_id, duration_sec || 0, completed ? 1 : 0);
  if (completed) {
    notify(req.user, 'streak', 'Recovery streak updated', 'You completed a recovery exercise today.');
  }
  res.json({ id: info.lastInsertRowid, streak: recoveryStreak(req.user) });
});

app.get('/api/recovery/stats', auth, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(duration_sec),0) AS sec FROM exercise_sessions WHERE user_id = ? AND completed = 1').get(req.user);
  const fav = db.prepare(`SELECT e.title, e.slug, COUNT(*) AS n FROM exercise_sessions s
    JOIN exercises e ON e.id = s.exercise_id WHERE s.user_id = ? AND s.completed = 1
    GROUP BY e.id ORDER BY n DESC LIMIT 1`).get(req.user);
  res.json({
    total_sessions: total.n,
    total_minutes: Math.round(total.sec / 60),
    streak: recoveryStreak(req.user),
    favourite: fav ? { title: fav.title, slug: fav.slug, count: fav.n } : null
  });
});

/* ============================================================
   COUNSELLORS — marketplace
   ============================================================ */
app.get('/api/counsellors', (req, res) => {
  const { specialization, language, minPrice, maxPrice, minRating, online } = req.query;
  let sql = 'SELECT * FROM counsellors WHERE available = 1';
  const args = [];
  if (specialization) { sql += ' AND specialty LIKE ?'; args.push('%' + specialization + '%'); }
  if (language)       { sql += ' AND languages LIKE ?'; args.push('%' + language + '%'); }
  if (minPrice)       { sql += ' AND price_per_min >= ?'; args.push(+minPrice); }
  if (maxPrice)       { sql += ' AND price_per_min <= ?'; args.push(+maxPrice); }
  if (minRating)      { sql += ' AND rating >= ?'; args.push(+minRating); }
  if (online === '1') { sql += ' AND online = 1'; }
  sql += ' ORDER BY online DESC, rating DESC';
  const rows = db.prepare(sql).all(...args);
  res.json({ counsellors: rows });
});

app.get('/api/counsellors/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM counsellors WHERE id = ?').get(+req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  res.json({ counsellor: c });
});

/* ============================================================
   APPOINTMENTS — paid counselling
   ============================================================ */
app.post('/api/appointments', auth, (req, res) => {
  const { counsellor_id, duration_min } = req.body;
  if (!counsellor_id || !duration_min) return res.status(400).json({ error: 'missing fields' });
  if (![5, 10, 20, 30, 60].includes(+duration_min)) return res.status(400).json({ error: 'invalid duration' });
  const c = db.prepare('SELECT * FROM counsellors WHERE id = ?').get(counsellor_id);
  if (!c) return res.status(404).json({ error: 'counsellor not found' });
  const price = c.price_per_min * (+duration_min);
  const info = db.prepare('INSERT INTO appointments (user_id, counsellor_id, duration_min, price, status) VALUES (?, ?, ?, ?, ?)')
    .run(req.user, counsellor_id, duration_min, price, 'pending');
  audit(req.user, 'appointment_create', { counsellor_id, duration_min, price });
  res.json({ id: info.lastInsertRowid, price, currency: 'INR', duration_min, counsellor: { id: c.id, name: c.name } });
});

/* ============================================================
   PAYMENTS — abstraction (demo + Razorpay/Stripe placeholders)
   ============================================================ */
const PaymentProvider = {
  provider: CONFIG.PAYMENT_PROVIDER,
  async createOrder({ amount, currency, purpose, userId }) {
    if (this.provider === 'demo' || !CONFIG.PAYMENT_KEY_ID) {
      const ref = 'demo_' + crypto.randomBytes(6).toString('hex');
      return { ref, status: 'created', demo: true, amount, currency, purpose };
    }
    // In production: integrate Razorpay/Stripe here using PAYMENT_KEY_ID/PAYMENT_KEY_SECRET
    return { ref: 'prov_' + crypto.randomBytes(6).toString('hex'), status: 'created', demo: false, amount, currency, purpose };
  },
  async verify({ ref }) {
    if (this.provider === 'demo' || !CONFIG.PAYMENT_KEY_SECRET) return { ok: true, demo: true, ref };
    return { ok: true, demo: false, ref };
  }
};

app.post('/api/payments/create', auth, async (req, res) => {
  const { amount, purpose, appointment_id, currency } = req.body;
  if (!amount || !purpose) return res.status(400).json({ error: 'missing fields' });
  const order = await PaymentProvider.createOrder({ amount, currency: currency || 'INR', purpose, userId: req.user });
  const info = db.prepare('INSERT INTO payments (user_id, amount, currency, provider, provider_ref, status, purpose, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.user, amount, currency || 'INR', CONFIG.PAYMENT_PROVIDER, order.ref, 'created', purpose, appointment_id ? JSON.stringify({ appointment_id }) : null);
  res.json({ payment_id: info.lastInsertRowid, order });
});

app.post('/api/payments/confirm', auth, async (req, res) => {
  const { payment_id, ref } = req.body;
  const p = db.prepare('SELECT * FROM payments WHERE id = ? AND user_id = ?').get(payment_id, req.user);
  if (!p) return res.status(404).json({ error: 'payment not found' });
  const ok = await PaymentProvider.verify({ ref: ref || p.provider_ref });
  if (!ok.ok) return res.status(400).json({ error: 'verification failed' });
  db.prepare('UPDATE payments SET status = ? WHERE id = ?').run('paid', payment_id);
  if (p.purpose === 'appointment' && p.meta) {
    const meta = JSON.parse(p.meta);
    if (meta.appointment_id) {
      db.prepare('UPDATE appointments SET status = ?, payment_id = ? WHERE id = ?').run('confirmed', payment_id, meta.appointment_id);
    }
  } else if (p.purpose === 'wallet_topup') {
    db.prepare('UPDATE wallets SET balance = balance + ? WHERE user_id = ?').run(p.amount, req.user);
  }
  audit(req.user, 'payment_confirm', { payment_id, amount: p.amount });
  res.json({ ok: true, demo: ok.demo });
});

/* ============================================================
   WALLET
   ============================================================ */
app.get('/api/wallet', auth, (req, res) => {
  const w = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(req.user);
  res.json({ balance: w ? w.balance : 0 });
});

app.post('/api/wallet/topup', auth, async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount < 50) return res.status(400).json({ error: 'minimum ₹50' });
  const order = await PaymentProvider.createOrder({ amount, currency: 'INR', purpose: 'wallet_topup', userId: req.user });
  const info = db.prepare('INSERT INTO payments (user_id, amount, currency, provider, provider_ref, status, purpose) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.user, amount, 'INR', CONFIG.PAYMENT_PROVIDER, order.ref, 'created', 'wallet_topup');
  res.json({ payment_id: info.lastInsertRowid, order });
});

/* ============================================================
   COUNSELLING ROOM — chat, timer, voice/video architecture
   ============================================================ */
app.post('/api/sessions/start', auth, (req, res) => {
  const { appointment_id, mode } = req.body;
  if (!['text','voice','video'].includes(mode)) return res.status(400).json({ error: 'invalid mode' });
  const a = db.prepare('SELECT * FROM appointments WHERE id = ? AND user_id = ?').get(appointment_id, req.user);
  if (!a) return res.status(404).json({ error: 'appointment not found' });
  if (a.status !== 'confirmed') return res.status(400).json({ error: 'payment required' });
  const info = db.prepare('INSERT INTO counselling_sessions (appointment_id, user_id, counsellor_id, started_at, mode) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)')
    .run(appointment_id, req.user, a.counsellor_id, mode);
  db.prepare('UPDATE appointments SET status = ?, session_id = ? WHERE id = ?').run('in_session', info.lastInsertRowid, appointment_id);
  notify(req.user, 'session', 'Session started', 'Your counselling room is live. The timer has begun.');
  audit(req.user, 'session_start', { appointment_id, mode });
  res.json({ session_id: info.lastInsertRowid, started_at: new Date().toISOString() });
});

app.post('/api/sessions/extend', auth, async (req, res) => {
  const { session_id, duration_min } = req.body;
  if (![5, 10, 20, 30].includes(+duration_min)) return res.status(400).json({ error: 'invalid duration' });
  const s = db.prepare('SELECT * FROM counselling_sessions WHERE id = ? AND user_id = ?').get(session_id, req.user);
  if (!s) return res.status(404).json({ error: 'session not found' });
  const a = db.prepare('SELECT * FROM appointments WHERE id = ?').get(s.appointment_id);
  const c = db.prepare('SELECT * FROM counsellors WHERE id = ?').get(s.counsellor_id);
  const extra = c.price_per_min * (+duration_min);
  const order = await PaymentProvider.createOrder({ amount: extra, currency: 'INR', purpose: 'session_extension', userId: req.user });
  const info = db.prepare('INSERT INTO payments (user_id, amount, currency, provider, provider_ref, status, purpose, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.user, extra, 'INR', CONFIG.PAYMENT_PROVIDER, order.ref, 'created', 'session_extension', JSON.stringify({ session_id, duration_min }));
  res.json({ payment_id: info.lastInsertRowid, order, extra_amount: extra });
});

app.post('/api/sessions/:id/message', auth, (req, res) => {
  const { content, sender } = req.body;
  const s = db.prepare('SELECT * FROM counselling_sessions WHERE id = ?').get(+req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  if (s.user_id !== req.user) return res.status(403).json({ error: 'forbidden' });
  db.prepare('INSERT INTO session_messages (session_id, sender, content) VALUES (?, ?, ?)').run(s.id, sender || 'user', content);
  // auto counsellor reply in demo
  setTimeout(() => {
    const replies = [
      "I hear you. Can you tell me a little more about when that started?",
      "Thank you for sharing. What does that feel like in your body right now?",
      "That sounds heavy. What has helped you get through similar moments before?",
      "Take your time. There's no right or wrong way to answer.",
      "I'm with you. What would feel like a small step forward from here?"
    ];
    const reply = replies[Math.floor(Math.random() * replies.length)];
    db.prepare('INSERT INTO session_messages (session_id, sender, content) VALUES (?, ?, ?)').run(s.id, 'counsellor', reply);
  }, 1400);
  res.json({ ok: true });
});

app.get('/api/sessions/:id/messages', auth, (req, res) => {
  const s = db.prepare('SELECT * FROM counselling_sessions WHERE id = ?').get(+req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  if (s.user_id !== req.user) return res.status(403).json({ error: 'forbidden' });
  const rows = db.prepare('SELECT sender, content, created_at FROM session_messages WHERE session_id = ? ORDER BY created_at ASC').all(s.id);
  res.json({ messages: rows });
});

app.post('/api/sessions/:id/end', auth, (req, res) => {
  const { rating, review } = req.body;
  const s = db.prepare('SELECT * FROM counselling_sessions WHERE id = ? AND user_id = ?').get(+req.params.id, req.user);
  if (!s) return res.status(404).json({ error: 'not found' });
  const now = new Date();
  const dur = s.started_at ? Math.round((now - new Date(s.started_at + 'Z')) / 1000) : 0;
  db.prepare('UPDATE counselling_sessions SET ended_at = CURRENT_TIMESTAMP, duration_sec = ?, rating = ?, review = ? WHERE id = ?')
    .run(dur, rating || null, review || null, s.id);
  db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run('completed', s.appointment_id);
  // Bump counsellor reviews
  if (rating) {
    const c = db.prepare('SELECT * FROM counsellors WHERE id = ?').get(s.counsellor_id);
    const total = c.reviews_count + 1;
    const newRating = ((c.rating * c.reviews_count) + rating) / total;
    db.prepare('UPDATE counsellors SET reviews_count = ?, rating = ? WHERE id = ?').run(total, +newRating.toFixed(2), s.counsellor_id);
  }
  audit(req.user, 'session_end', { session_id: s.id, duration_sec: dur });
  res.json({ ok: true, duration_sec: dur });
});

/* ============================================================
   BOOKINGS — keep for legacy compatibility
   ============================================================ */
app.post('/api/bookings', auth, (req, res) => {
  const { counsellor_id, datetime, topic } = req.body;
  const info = db.prepare('INSERT INTO bookings (user_id, counsellor_id, datetime, topic) VALUES (?, ?, ?, ?)')
    .run(req.user, counsellor_id, datetime, topic || '');
  res.json({ id: info.lastInsertRowid });
});

app.get('/api/bookings', auth, (req, res) => {
  const rows = db.prepare(`SELECT b.*, c.name AS counsellor_name, c.specialty
    FROM bookings b LEFT JOIN counsellors c ON b.counsellor_id = c.id
    WHERE b.user_id = ? ORDER BY b.created_at DESC`).all(req.user);
  res.json({ bookings: rows });
});

/* ============================================================
   MINDFUL SESSIONS — light progress tracking for Mindful Games
   ============================================================ */
app.post('/api/mindful/session', auth, (req, res) => {
  const { game_slug, duration_sec = 0, completed = 0, score = 0 } = req.body || {};
  if (!game_slug) return res.status(400).json({ error: 'game_slug required' });
  try {
    const info = db.prepare(`INSERT INTO mindful_sessions (user_id, game_slug, duration_sec, completed, score)
      VALUES (?, ?, ?, ?, ?)`).run(req.user, game_slug, Math.max(0, parseInt(duration_sec, 10) || 0), completed ? 1 : 0, Math.max(0, parseInt(score, 10) || 0));
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e.message });
  }
});

app.get('/api/mindful/stats', auth, (req, res) => {
  try {
    const totals = db.prepare(`SELECT COUNT(*) AS played, COALESCE(SUM(duration_sec), 0) AS total_sec,
      COALESCE(SUM(completed), 0) AS completed
      FROM mindful_sessions WHERE user_id = ?`).get(req.user) || { played: 0, total_sec: 0, completed: 0 };
    const fav = db.prepare(`SELECT game_slug, COUNT(*) AS n FROM mindful_sessions
      WHERE user_id = ? GROUP BY game_slug ORDER BY n DESC LIMIT 1`).get(req.user);
    res.json({
      played: totals.played,
      completed: totals.completed,
      total_minutes: Math.round(totals.total_sec / 60),
      favourite: fav ? fav.game_slug : null
    });
  } catch (e) {
    res.status(500).json({ error: 'db_error', message: e.message });
  }
});

/* Lightweight per-user voice-style preferences */
app.patch('/api/voice/style', auth, (req, res) => {
  const allowed = ['calm', 'professional', 'warm', 'neutral', 'reassuring'];
  const { voice_style, speed = 1.0, stability = null, expressiveness = null } = req.body || {};
  if (voice_style && !allowed.includes(voice_style)) return res.status(400).json({ error: 'invalid voice_style' });
  // Persist into the users row (preferred_voice) and a small JSON blob we just keep in-memory per process.
  if (voice_style) {
    db.prepare(`UPDATE users SET preferred_voice = ? WHERE id = ?`).run(voice_style, req.user);
  }
  res.json({ ok: true, voice_style: voice_style || 'calm', speed, stability, expressiveness });
});

/* ============================================================
   RESOURCES
   ============================================================ */
app.get('/api/resources', (req, res) => {
  const rows = db.prepare('SELECT * FROM resources ORDER BY id').all();
  res.json({ resources: rows });
});

app.post('/api/resources/bookmark', auth, (req, res) => {
  const { kind, target_id } = req.body;
  const existing = db.prepare('SELECT id FROM bookmarks WHERE user_id = ? AND kind = ? AND target_id = ?').get(req.user, kind, target_id);
  if (existing) {
    db.prepare('DELETE FROM bookmarks WHERE id = ?').run(existing.id);
    return res.json({ ok: true, bookmarked: false });
  }
  db.prepare('INSERT INTO bookmarks (user_id, kind, target_id) VALUES (?, ?, ?)').run(req.user, kind, target_id);
  res.json({ ok: true, bookmarked: true });
});

app.get('/api/bookmarks', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM bookmarks WHERE user_id = ?').all(req.user);
  res.json({ bookmarks: rows });
});

/* ============================================================
   RESEARCH
   ============================================================ */
app.get('/api/research', (req, res) => {
  const { topic } = req.query;
  let rows;
  if (topic) {
    rows = db.prepare('SELECT * FROM research WHERE topic LIKE ? ORDER BY year DESC').all('%' + topic + '%');
  } else {
    rows = db.prepare('SELECT * FROM research ORDER BY year DESC').all();
  }
  res.json({ research: rows });
});

/* ============================================================
   NOTIFICATIONS
   ============================================================ */
app.get('/api/notifications', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user);
  res.json({ notifications: rows });
});

app.post('/api/notifications/read', auth, (req, res) => {
  const { id } = req.body;
  if (id) {
    db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(id, req.user);
  } else {
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user);
  }
  res.json({ ok: true });
});

/* ============================================================
   PRIVACY
   ============================================================ */
app.get('/api/privacy/export', auth, (req, res) => {
  const data = {
    user: db.prepare('SELECT name, email, role, rank, service, country, preferred_voice, voice_consent, ai_consent FROM users WHERE id = ?').get(req.user),
    checkins: db.prepare('SELECT * FROM checkins WHERE user_id = ?').all(req.user),
    screenings: db.prepare('SELECT * FROM screenings WHERE user_id = ?').all(req.user),
    exercises: db.prepare('SELECT * FROM exercise_sessions WHERE user_id = ?').all(req.user),
    appointments: db.prepare('SELECT * FROM appointments WHERE user_id = ?').all(req.user),
    consents: db.prepare('SELECT * FROM consents WHERE user_id = ?').all(req.user)
  };
  res.json(data);
});

app.post('/api/privacy/consent', auth, (req, res) => {
  const { kind, granted } = req.body;
  db.prepare('INSERT INTO consents (user_id, kind, granted) VALUES (?, ?, ?)').run(req.user, kind, granted ? 1 : 0);
  if (kind === 'voice') db.prepare('UPDATE users SET voice_consent = ? WHERE id = ?').run(granted ? 1 : 0, req.user);
  if (kind === 'ai')    db.prepare('UPDATE users SET ai_consent = ? WHERE id = ?').run(granted ? 1 : 0, req.user);
  audit(req.user, 'consent', { kind, granted });
  res.json({ ok: true });
});

app.delete('/api/privacy/account', auth, (req, res) => {
  // Anonymise rather than hard-delete to preserve referential integrity
  db.prepare(`UPDATE users SET name = 'Anonymous', email = 'anon_' || id || '@deleted.local', password = '', voice_consent = 0 WHERE id = ?`).run(req.user);
  db.prepare('DELETE FROM voice_profiles WHERE user_id = ?').run(req.user);
  audit(req.user, 'account_anonymise', null);
  res.json({ ok: true });
});

/* ============================================================
   CRISIS / SAFETY
   ============================================================ */
app.post('/api/crisis', auth, (req, res) => {
  const { message, severity } = req.body;
  db.prepare('INSERT INTO crisis_reports (user_id, message, severity) VALUES (?, ?, ?)').run(req.user, message || '', severity || 'medium');
  audit(req.user, 'crisis', { severity });
  res.json({ ok: true, emergency: CONFIG.EMERGENCY });
});

app.get('/api/emergency', (req, res) => {
  res.json({ emergency: CONFIG.EMERGENCY });
});

/* ============================================================
   DASHBOARD
   ============================================================ */
app.get('/api/dashboard', auth, (req, res) => {
  const latest = db.prepare('SELECT * FROM checkins WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(req.user);
  const last7 = db.prepare(`SELECT * FROM checkins WHERE user_id = ?
    AND created_at >= datetime('now','-7 days') ORDER BY created_at ASC`).all(req.user);
  const screenings = db.prepare('SELECT * FROM screenings WHERE user_id = ? ORDER BY created_at DESC LIMIT 5').all(req.user);
  const bookings = db.prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY created_at DESC LIMIT 5').all(req.user);
  const appointments = db.prepare(`SELECT a.*, c.name AS counsellor_name FROM appointments a
    LEFT JOIN counsellors c ON c.id = a.counsellor_id
    WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 5`).all(req.user);
  const insight = predictWellbeing(req.user);
  const recovery = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(duration_sec),0) AS sec FROM exercise_sessions WHERE user_id = ? AND completed = 1').get(req.user);
  res.json({
    latest, last7, screenings, bookings, appointments, insight,
    streak: checkinStreak(req.user),
    recovery_streak: recoveryStreak(req.user),
    recovery_sessions: recovery.n,
    recovery_minutes: Math.round(recovery.sec / 60)
  });
});

/* ============================================================
   COUNSELLOR DASHBOARD
   ============================================================ */
app.get('/api/counsellor/me', auth, role(['counsellor','admin']), (req, res) => {
  const c = db.prepare('SELECT * FROM counsellors WHERE name = (SELECT name FROM users WHERE id = ?) LIMIT 1').get(req.user);
  // fallback: pick first available counsellor for demo
  const cc = c || db.prepare('SELECT * FROM counsellors ORDER BY id LIMIT 1').get();
  res.json({ counsellor: cc });
});

app.get('/api/counsellor/appointments', auth, role(['counsellor','admin']), (req, res) => {
  const c = db.prepare('SELECT * FROM counsellors WHERE name = (SELECT name FROM users WHERE id = ?) LIMIT 1').get(req.user);
  const cid = c ? c.id : null;
  const sql = cid
    ? `SELECT a.*, u.name AS client_name FROM appointments a LEFT JOIN users u ON u.id = a.user_id WHERE a.counsellor_id = ? ORDER BY a.created_at DESC`
    : `SELECT a.*, u.name AS client_name FROM appointments a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC`;
  const args = cid ? [cid] : [];
  const rows = db.prepare(sql).all(...args);
  res.json({ appointments: rows });
});

app.get('/api/counsellor/stats', auth, role(['counsellor','admin']), (req, res) => {
  const c = db.prepare('SELECT * FROM counsellors WHERE name = (SELECT name FROM users WHERE id = ?) LIMIT 1').get(req.user);
  if (!c) return res.json({ total_sessions: 0, today_sessions: 0, total_revenue: 0, average_rating: 0 });
  const total = db.prepare('SELECT COUNT(*) AS n FROM appointments WHERE counsellor_id = ? AND status = ?').get(c.id, 'completed');
  const today = db.prepare(`SELECT COUNT(*) AS n FROM appointments WHERE counsellor_id = ? AND status = ? AND date(created_at) = date('now')`).get(c.id, 'completed');
  const revenue = db.prepare('SELECT COALESCE(SUM(price),0) AS s FROM appointments WHERE counsellor_id = ? AND status = ?').get(c.id, 'completed');
  res.json({
    total_sessions: total.n,
    today_sessions: today.n,
    total_revenue: revenue.s,
    average_rating: c.rating,
    reviews_count: c.reviews_count
  });
});

/* ============================================================
   ADMIN — command center (anonymised aggregates)
   ============================================================ */
app.get('/api/admin/stats', auth, role(['admin']), (req, res) => {
  const u = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const active = db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM checkins WHERE created_at >= datetime('now','-7 days')`).get().n;
  const checkins = db.prepare('SELECT COUNT(*) AS n FROM checkins').get().n;
  const screen = db.prepare('SELECT COUNT(*) AS n FROM screenings').get().n;
  const ai = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
  const rec = db.prepare('SELECT COUNT(*) AS n FROM exercise_sessions WHERE completed = 1').get().n;
  const sessions = db.prepare('SELECT COUNT(*) AS n FROM appointments WHERE status = ?').get('completed').n;
  const rev = db.prepare('SELECT COALESCE(SUM(price),0) AS s FROM appointments WHERE status = ?').get('completed').s;
  const counsellors = db.prepare('SELECT COUNT(*) AS n FROM counsellors').get().n;
  // daily checkins (last 14 days)
  const daily = db.prepare(`SELECT date(created_at) AS d, COUNT(*) AS n FROM checkins
    WHERE created_at >= datetime('now','-14 days') GROUP BY date(created_at) ORDER BY d`).all();
  res.json({
    total_users: u,
    active_users: active,
    total_checkins: checkins,
    total_screenings: screen,
    total_ai_messages: ai,
    total_recovery_sessions: rec,
    total_sessions: sessions,
    total_revenue: rev,
    total_counsellors: counsellors,
    daily_checkins: daily
  });
});

/* ============================================================
   SIH 26186 — AI ENGINE
   Emotional Signal Analysis + Predictive Risk Engine
   ============================================================ */

const MODEL_VERSION = 'demo-1.0.0';
const RISK_THRESHOLDS = { LOW: 0, MODERATE: 35, HIGH: 60, URGENT: 80 };

/* --- Lexicon-driven emotional signal analyzer (transparent baseline) ---
   This is a transparent, rule-based baseline. It is NOT a clinical instrument.
   It produces a structured signal object used by the welfare system to
   surface trends, NOT diagnoses. */
const EMOTION_LEXICON = {
  sadness:      { words: ['sad','down','empty','numb','hopeless','crying','tearful','miserable','low','unmotivated','blue','grief'], weight: 1.0 },
  stress:       { words: ['stress','stressed','pressure','overwhelm','overwhelmed','too much','burned','burnt','burnout','under pressure','frazzled'], weight: 1.0 },
  anxiety:      { words: ['anxious','anxiety','panic','worried','worry','nervous','on edge','restless','tense','afraid','scared','dreading'], weight: 1.0 },
  loneliness:   { words: ['lonely','alone','isolat','miss','disconnect','no one','nobody','left out','homesick'], weight: 1.1 },
  frustration:  { words: ['frustrat','annoyed','irritat','angry','rage','furious','fed up','pissed'], weight: 0.9 },
  exhaustion:   { words: ['exhaust','drained','depleted','burned out','worn out','tired','spent','foggy'], weight: 1.0 },
  worry:        { words: ['concern','concerned','afraid','uneasy','troubled','apprehensive'], weight: 0.7 },
  overwhelm:    { words: ['drowning','suffocating','too much','cant cope','cannot cope','breaking down'], weight: 1.2 },
  sleep_concern:{ words: ['insomnia','cant sleep','cannot sleep','didn\'?t sleep','sleepless','restless night','tired all day','no sleep'], weight: 1.0 },
  withdrawal:   { words: ['avoid','hiding','shutting down','pulling away','don\'t want to talk','don\'t want to see','not leaving','staying in'], weight: 0.9 },
  hopeless:     { words: ['hopeless','pointless','no point','nothing matters','give up','cant go on','cannot go on','end it all','better off without me'], weight: 1.4 },
  positive:     { words: ['grateful','thankful','better','good day','happy','calm','relaxed','energized','rested','hopeful'], weight: 0.8 },
  confidence:   { words: ['can do','capable','strong','ready','focused','determined','clear','confident'], weight: 0.7 },
  recovery:     { words: ['slept well','rested','recovered','recharging','taking time','break','vacation','leave'], weight: 0.6 }
};

const PROTECTIVE_TOPICS = ['family','friend','pet','hobby','walk','nature','music','faith','prayer','therapy','counsellor','counselor'];
const STRESS_TOPICS    = ['workload','deadline','deployment','transfer','training','duty','shift','command','boss','colleague','family conflict','finance','medical','injury'];

function analyzeEmotion(text) {
  if (!text || typeof text !== 'string') {
    return { mood: 50, stress: 50, anxiety: 50, loneliness: 50, fatigue: 50,
             emotional_exhaustion: 50, recovery: 50, confidence: 50,
             risk_level: 'low', dominant_emotions: [], detected_topics: [],
             recommended_support: [], confidence: 0 };
  }
  const lower = text.toLowerCase();
  const tokens = lower.split(/[^a-zऀ-ॿ']+/i).filter(Boolean);
  const counts = {};
  for (const [key, def] of Object.entries(EMOTION_LEXICON)) {
    let n = 0;
    for (const w of def.words) {
      const re = new RegExp('\\b' + w.replace(/'/g, "['’]?") + '\\b', 'i');
      if (re.test(lower)) n++;
    }
    counts[key] = n;
  }

  // Negations and intensifiers (very simple baseline)
  const neg = /\b(not|no|never|don'?t|cant|cannot|won'?t|isn'?t|aren'?t)\b/i.test(lower);
  const intens = (lower.match(/\b(very|really|extremely|so|such|incredibly|completely|totally)\b/gi) || []).length;

  // Map counts → 0-100 scores. Each hit adds, with diminishing returns.
  const score = (n, k = 1.4) => Math.min(100, Math.round((1 - Math.exp(-k * n)) * 100 + (intens > 0 ? Math.min(10, intens * 4) : 0)));
  const negFlip = (n) => neg ? Math.max(0, 50 - n) : n;

  const m_sadness   = score(counts.sadness, 1.6);
  const m_stress    = score(counts.stress + counts.overwhelm, 1.4);
  const m_anxiety   = score(counts.anxiety + counts.worry, 1.4);
  const m_lonely    = score(counts.loneliness, 1.6);
  const m_fatigue   = score(counts.exhaustion + counts.sleep_concern, 1.3);
  const m_exhaust   = score(counts.exhaustion + counts.overwhelm, 1.3);
  const m_recovery  = Math.max(0, 100 - score(counts.exhaustion, 1.0) - score(counts.sleep_concern, 1.0));
  const m_confidence= score(counts.confidence, 1.4);
  const m_positive  = score(counts.positive, 1.4);
  // Mood combines positive + recovery + (1 - sadness)
  const mood = negFlip(Math.min(100, Math.round(0.45 * m_positive + 0.30 * m_recovery + 0.25 * (100 - m_sadness))));

  // Risk level: weighted by hopelessness, overwhelm, exhaustion
  const risk_raw = 0.35 * m_sadness + 0.25 * m_exhaust + 0.20 * m_stress + 0.10 * m_anxiety + 0.10 * m_lonely + (counts.hopeless > 0 ? 15 : 0);
  const risk = Math.min(100, Math.round(risk_raw));
  let risk_level = 'low';
  if (risk >= RISK_THRESHOLDS.URGENT) risk_level = 'urgent';
  else if (risk >= RISK_THRESHOLDS.HIGH) risk_level = 'high';
  else if (risk >= RISK_THRESHOLDS.MODERATE) risk_level = 'moderate';

  // Topics
  const topics = [];
  for (const t of STRESS_TOPICS) if (new RegExp('\\b' + t + '\\b', 'i').test(lower)) topics.push(t);
  for (const t of PROTECTIVE_TOPICS) if (new RegExp('\\b' + t + '\\b', 'i').test(lower)) topics.push('protective:' + t);
  // Deduplicate while preserving order
  const seen = new Set(); const det = [];
  for (const t of topics) if (!seen.has(t)) { seen.add(t); det.push(t); }

  const dominant = [];
  if (counts.sadness > 0)   dominant.push('sadness');
  if (counts.stress > 0)    dominant.push('stress');
  if (counts.anxiety > 0)   dominant.push('anxiety');
  if (counts.loneliness > 0)dominant.push('loneliness');
  if (counts.exhaustion>0 || counts.overwhelm>0) dominant.push('emotional_exhaustion');
  if (counts.sleep_concern>0) dominant.push('sleep_concern');
  if (counts.hopeless > 0)  dominant.push('hopeless_language');
  if (counts.positive > 0)  dominant.push('positive_mood');
  if (counts.recovery > 0)  dominant.push('recovery_signal');

  // Recommended support (non-diagnostic, decision-support only)
  const rec = [];
  if (risk_level === 'urgent' || counts.hopeless > 0) {
    rec.push('priority_welfare_check');
    rec.push('human_support');
  } else if (risk_level === 'high') {
    rec.push('confidential_welfare_review');
    rec.push('optional_counsellor');
    rec.push('workload_review');
  } else if (risk_level === 'moderate') {
    rec.push('recovery_practice');
    rec.push('wellbeing_checkin');
    rec.push('optional_counsellor');
  } else {
    rec.push('wellness_resources');
    rec.push('short_relaxation');
  }
  if (m_lonely >= 55) rec.push('social_connection_resource');
  if (m_fatigue >= 55) rec.push('sleep_recovery_guidance');
  if (m_stress  >= 55) rec.push('breathing_practice');

  // Confidence is higher when more emotional tokens are detected
  const totalHits = Object.values(counts).reduce((a,b)=>a+b,0);
  const confidence = Math.min(100, 30 + totalHits * 12);

  return {
    mood, stress: m_stress, anxiety: m_anxiety, loneliness: m_lonely, fatigue: m_fatigue,
    emotional_exhaustion: m_exhaust, recovery: m_recovery, confidence: m_confidence,
    risk_level, dominant_emotions: dominant, detected_topics: det,
    recommended_support: [...new Set(rec)], confidence_score: confidence
  };
}

/* --- Predictive Stress & Burnout Risk Engine --- */
function predictRisk({ workload = 0, recovery = 0, deployment_days = 0, recent_leave = 0,
                      training_hours = 0, transfer_count = 0, shift_pattern = 0,
                      self_stress = 50, self_mood = 50, self_sleep = 50, self_fatigue = 50,
                      ai_stress = 0, ai_exhaust = 0, ai_lonely = 0, trend_7d = 0 } = {}) {
  // Workload (0-100) → higher = more risk
  const wRisk = Math.max(0, Math.min(100, workload));
  // Recovery (0-100, higher = better) → inverted
  const rRisk = Math.max(0, 100 - recovery);
  // Deployment > 30 days adds risk
  const dRisk = deployment_days > 30 ? Math.min(100, (deployment_days - 30) * 1.2) : 0;
  // Lack of leave adds risk
  const lRisk = recent_leave < 7 ? (7 - recent_leave) * 5 : 0;
  // Training load > 40h/week adds risk
  const tRisk = training_hours > 40 ? Math.min(100, (training_hours - 40) * 1.5) : 0;
  // Frequent transfers add risk
  const xRisk = Math.min(100, transfer_count * 12);
  // Shift irregularity (0=regular,100=chaotic)
  const sRisk = shift_pattern;
  // Self-reported signals (already 0-100)
  const selfRisk = (0.30 * self_stress + 0.20 * (100 - self_mood) + 0.20 * (100 - self_sleep) + 0.30 * self_fatigue);
  // AI conversational signals (0-100)
  const aiRisk   = (0.40 * ai_stress + 0.40 * ai_exhaust + 0.20 * ai_lonely);
  // Trend acceleration
  const trendRisk = Math.max(0, Math.min(100, trend_7d));

  // Weighted blend
  const current = Math.round(
    0.18 * wRisk +
    0.15 * rRisk +
    0.08 * dRisk +
    0.05 * lRisk +
    0.05 * tRisk +
    0.04 * xRisk +
    0.05 * sRisk +
    0.20 * selfRisk +
    0.15 * aiRisk +
    0.05 * trendRisk
  );
  const score = Math.max(0, Math.min(100, current));

  // Contributing signals
  const contribs = [];
  const protect = [];
  const add = (arr, label, delta) => { if (Math.abs(delta) >= 4) arr.push({ label, delta: Math.round(delta), direction: delta > 0 ? 'risk' : 'protective' }); };
  add(contribs, 'Workload increase',        wRisk * 0.18);
  add(contribs, 'Reduced recovery',         rRisk * 0.15);
  add(contribs, 'Long deployment',          dRisk * 0.08);
  add(contribs, 'Insufficient recent leave',lRisk * 0.05);
  add(contribs, 'High training load',       tRisk * 0.05);
  add(contribs, 'Frequent transfers',       xRisk * 0.04);
  add(contribs, 'Irregular shift pattern',  sRisk * 0.05);
  add(contribs, 'Self-reported stress',     self_stress * 0.20 * (self_stress/100));
  add(contribs, 'Conversational stress',    ai_stress * 0.15 * (ai_stress/100));
  add(contribs, 'Fatigue signal',           self_fatigue * 0.20 * (self_fatigue/100));
  add(contribs, 'Trend acceleration',       trendRisk * 0.05);
  add(protect, 'Recent leave',             -lRisk * 0.10);
  add(protect, 'Recovery time',            -rRisk * 0.08);
  add(protect, 'Stable mood',              self_mood * 0.10);
  add(protect, 'Positive AI signals',      -ai_lonely * 0.04);

  // Sort
  contribs.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
  protect.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));

  // Predicted 7-day: extrapolate current trend with dampening
  const predicted = Math.max(0, Math.min(100, Math.round(score + trend_7d * 0.6 + (workload > 70 ? 5 : 0))));

  // Level classification
  const level = (s) => s >= RISK_THRESHOLDS.URGENT ? 'urgent'
                   : s >= RISK_THRESHOLDS.HIGH   ? 'high'
                   : s >= RISK_THRESHOLDS.MODERATE ? 'moderate' : 'low';

  // Confidence based on how many signals contributed
  const sigCount = [wRisk, rRisk, dRisk, lRisk, tRisk, xRisk, sRisk, self_stress, ai_stress].filter(v => v > 0).length;
  const confidence = Math.min(95, 35 + sigCount * 7);

  return {
    current_score: score,
    current_level: level(score),
    predicted_7d_score: predicted,
    predicted_7d_level: level(predicted),
    confidence,
    contributing_signals: contribs.slice(0, 6),
    protective_factors:   protect.slice(0, 4),
    model_version: MODEL_VERSION
  };
}

/* --- Personnel risk computation (uses DB data when available) --- */
function computePersonnelRisk(personnelId) {
  const p = db.prepare('SELECT * FROM personnel_profiles WHERE id = ?').get(personnelId);
  if (!p) return null;
  // Pull latest workload
  const wl = db.prepare('SELECT * FROM hr_workload_indicators WHERE personnel_id = ? ORDER BY week_start DESC LIMIT 4').all(personnelId);
  const avgDuty = wl.length ? wl.reduce((s,r)=>s+(r.duty_hours||0),0)/wl.length : 0;
  const avgOver = wl.length ? wl.reduce((s,r)=>s+(r.overtime_hours||0),0)/wl.length : 0;
  const training = wl.length ? wl.reduce((s,r)=>s+(r.training_hours||0),0)/wl.length : (p.training_load_hours || 0);
  const recovery = wl.length ? wl.reduce((s,r)=>s+(r.recovery_allocated_hours||0),0)/wl.length : (p.recovery_index || 50);
  const shiftPattern = p.duty_pattern === 'rotating' ? 60 : p.duty_pattern === 'on_call' ? 70 : p.duty_pattern === 'field' ? 75 : 20;

  // Self-reported signals
  let self_stress=50, self_mood=50, self_sleep=50, self_fatigue=50;
  if (p.user_id) {
    const recent = db.prepare('SELECT * FROM checkins WHERE user_id=? ORDER BY created_at DESC LIMIT 7').all(p.user_id);
    if (recent.length) {
      self_stress = avg_(recent, 'stress');
      self_mood   = avg_(recent, 'mood');
      self_sleep  = avg_(recent, 'sleep');
      self_fatigue= 100 - avg_(recent, 'recovery');
    }
  }

  // AI conversational signals (last 14d)
  let ai_stress=0, ai_exhaust=0, ai_lonely=0;
  if (p.user_id) {
    const sigs = db.prepare("SELECT * FROM emotional_signals WHERE user_id=? AND created_at >= datetime('now','-14 days')").all(p.user_id);
    if (sigs.length) {
      ai_stress  = avgVal(sigs, 'stress');
      ai_exhaust = avgVal(sigs, 'emotional_exhaustion');
      ai_lonely  = avgVal(sigs, 'loneliness');
    }
  }

  // Trend acceleration
  const trend = trendAcceleration(personnelId);

  const risk = predictRisk({
    workload: p.workload_index || Math.min(100, Math.round((avgDuty/60)*100)),
    recovery,
    deployment_days: p.deployment_duration_days || 0,
    recent_leave: p.recent_leave_days || 0,
    training_hours: training,
    transfer_count: p.transfer_count || 0,
    shift_pattern: shiftPattern,
    self_stress, self_mood, self_sleep, self_fatigue,
    ai_stress, ai_exhaust, ai_lonely,
    trend_7d: trend.trend_7d
  });

  // Persist snapshot
  db.prepare(`INSERT INTO risk_predictions
    (personnel_id, current_risk_score, current_risk_level, predicted_7d_score, predicted_7d_level,
     confidence, contributing_signals, protective_factors, trend_7d, trend_14d, trend_30d, trend_90d, model_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(personnelId, risk.current_score, risk.current_level, risk.predicted_7d_score, risk.predicted_7d_level,
         risk.confidence, JSON.stringify(risk.contributing_signals), JSON.stringify(risk.protective_factors),
         trend.trend_7d, trend.trend_14d, trend.trend_30d, trend.trend_90d, risk.model_version);

  // Update personnel risk fields
  db.prepare(`UPDATE personnel_profiles SET risk_score=?, risk_level=?, confidence=?, last_predicted_at=CURRENT_TIMESTAMP,
              workload_index=?, recovery_index=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(risk.current_score, risk.current_level, risk.confidence,
         Math.min(100, Math.round((avgDuty/60)*100)), Math.round(recovery), personnelId);

  // Auto-generate alerts (with de-duplication)
  maybeCreateAlert(personnelId, risk, trend);

  return { ...risk, trend };
}

function avg_(rows, k) { return Math.round(rows.reduce((s,r)=>s+(r[k]||0),0)/rows.length); }
function avgVal(rows, k) {
  let s=0,n=0;
  for (const r of rows) { try { const j=JSON.parse(r.scores||'{}'); if (typeof j[k]==='number') { s+=j[k]; n++; } } catch(_){} }
  return n ? Math.round(s/n) : 0;
}
function trendAcceleration(personnelId) {
  const preds = db.prepare('SELECT * FROM risk_predictions WHERE personnel_id=? ORDER BY created_at DESC LIMIT 90').all(personnelId);
  const last = (days) => preds.slice(0, days);
  const avg = (arr) => arr.length ? Math.round(arr.reduce((s,r)=>s+(r.current_risk_score||0),0)/arr.length) : 0;
  const t7  = avg(last(7));
  const t14 = avg(last(14));
  const t30 = avg(last(30));
  const t90 = avg(last(90));
  return { trend_7d: t7 - (preds[7] ? preds[7].current_risk_score : t7),
           trend_14d: t14 - (preds[14] ? preds[14].current_risk_score : t14),
           trend_30d: t30 - t90,
           trend_90d: t90 - (preds[89] ? preds[89].current_risk_score : t90) };
}

function maybeCreateAlert(personnelId, risk, trend) {
  // De-dup: don't create same type within 6h
  const recent = db.prepare(`SELECT * FROM welfare_alerts WHERE personnel_id=? AND type=? AND created_at >= datetime('now','-6 hours')`).get(personnelId, 'risk_increase');
  if (risk.current_level === 'high' || risk.current_level === 'urgent' || risk.predicted_7d_level === 'high' || risk.predicted_7d_level === 'urgent') {
    if (recent) return; // already alerted
    const sev = risk.current_level === 'urgent' ? 'urgent' : 'high';
    const reason = (risk.contributing_signals || []).slice(0,3).map(s => s.label).join(' + ') || 'Multiple welfare indicators';
    const action = risk.current_level === 'urgent'
      ? 'Immediate human support recommended. Contact authorised welfare officer.'
      : 'Confidential welfare review recommended.';
    db.prepare(`INSERT INTO welfare_alerts (personnel_id, severity, type, message, reason, recommended_action)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(personnelId, sev, 'risk_increase',
           `Elevated welfare-risk indicators detected. Current ${risk.current_score}/100 (${risk.current_level.toUpperCase()}); predicted 7-day ${risk.predicted_7d_score}/100.`,
           reason, action);
  }
}

/* ============================================================
   SIH 26186 — PERSONNEL APIs
   ============================================================ */
app.get('/api/personnel/me', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM personnel_profiles WHERE user_id = ?').get(req.user);
  if (!p) {
    // Auto-create a profile for the logged-in user (demo)
    const pseudo = 'PF-' + (1000 + (req.user * 13) % 9000);
    const r = db.prepare(`INSERT INTO personnel_profiles (user_id, pseudo_id, rank, unit, role, service_years, duty_pattern,
                        deployment_status, deployment_duration_days, recent_leave_days, training_load_hours,
                        workload_index, recovery_index, transfer_count)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.user, pseudo, 'Officer', 'Demo Unit', 'Personnel', 4.5, 'rotating',
           'home', 0, 14, 8, 55, 60, 1);
    return res.json({ profile: db.prepare('SELECT * FROM personnel_profiles WHERE id = ?').get(r.lastInsertRowid) });
  }
  res.json({ profile: p });
});

app.get('/api/personnel', auth, role(['admin','welfare_officer','commander']), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 500);
  const rows = db.prepare('SELECT * FROM personnel_profiles ORDER BY id LIMIT ?').all(limit);
  // Never return email / sensitive user info here
  res.json({ personnel: rows.map(safePersonnel) });
});

app.get('/api/personnel/:id', auth, role(['admin','welfare_officer','commander']), (req, res) => {
  const p = db.prepare('SELECT * FROM personnel_profiles WHERE id = ?').get(+req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json({ profile: safePersonnel(p) });
});

function safePersonnel(p) {
  return {
    id: p.id, pseudo_id: p.pseudo_id, rank: p.rank, unit: p.unit, role: p.role,
    service_years: p.service_years, duty_pattern: p.duty_pattern,
    deployment_status: p.deployment_status, deployment_duration_days: p.deployment_duration_days,
    recent_leave_days: p.recent_leave_days, training_load_hours: p.training_load_hours,
    workload_index: p.workload_index, recovery_index: p.recovery_index,
    transfer_count: p.transfer_count, risk_level: p.risk_level, risk_score: p.risk_score,
    confidence: p.confidence, last_predicted_at: p.last_predicted_at
  };
}

app.get('/api/personnel/:id/risk', auth, role(['admin','welfare_officer','commander']), (req, res) => {
  const r = computePersonnelRisk(+req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json({ risk: r });
});

app.get('/api/personnel/:id/workload', auth, role(['admin','welfare_officer','commander']), (req, res) => {
  const rows = db.prepare('SELECT * FROM hr_workload_indicators WHERE personnel_id=? ORDER BY week_start DESC LIMIT 12').all(+req.params.id);
  res.json({ workload: rows });
});

/* ============================================================
   SIH 26186 — WELFARE OFFICER DASHBOARD
   ============================================================ */
app.get('/api/welfare/dashboard', auth, role(['admin','welfare_officer']), (req, res) => {
  ensureDemoPersonnel();
  const personnel = db.prepare('SELECT * FROM personnel_profiles').all();
  const counts = { low: 0, moderate: 0, high: 0, urgent: 0 };
  personnel.forEach(p => { if (counts[p.risk_level] !== undefined) counts[p.risk_level]++; });
  // High-priority queue (pseudonymous)
  const queue = db.prepare(`SELECT * FROM personnel_profiles WHERE risk_level IN ('high','urgent') ORDER BY risk_score DESC LIMIT 50`).all().map(p => ({
    id: p.id, pseudo_id: p.pseudo_id, unit: p.unit, risk_level: p.risk_level, risk_score: p.risk_score,
    last_predicted_at: p.last_predicted_at, last_checkin: db.prepare('SELECT created_at FROM checkins WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(p.user_id)?.created_at || null
  }));
  // Alerts
  const alerts = db.prepare(`SELECT a.*, p.pseudo_id FROM welfare_alerts a
                            JOIN personnel_profiles p ON p.id = a.personnel_id
                            WHERE a.acknowledged = 0 ORDER BY a.created_at DESC LIMIT 50`).all();
  // Trends across the unit
  const trends = unitTrends();
  res.json({
    totals: { personnel: personnel.length, ...counts },
    queue,
    alerts,
    trends,
    updated_at: new Date().toISOString()
  });
});

app.get('/api/welfare/alerts', auth, role(['admin','welfare_officer']), (req, res) => {
  const alerts = db.prepare(`SELECT a.*, p.pseudo_id FROM welfare_alerts a
                            JOIN personnel_profiles p ON p.id = a.personnel_id
                            ORDER BY a.created_at DESC LIMIT 200`).all();
  res.json({ alerts });
});

app.post('/api/welfare/alerts/:id/ack', auth, role(['admin','welfare_officer']), (req, res) => {
  db.prepare(`UPDATE welfare_alerts SET acknowledged=1, acknowledged_by=?, acknowledged_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(req.user, +req.params.id);
  audit(req.user, 'welfare_alert_ack', { id: +req.params.id });
  res.json({ ok: true });
});

app.post('/api/welfare/intervention', auth, role(['admin','welfare_officer']), (req, res) => {
  const { personnel_id, intervention_type, before_risk_score, before_risk_level, notes } = req.body || {};
  if (!personnel_id || !intervention_type) return res.status(400).json({ error: 'missing fields' });
  // Compute "after" risk right now to record outcome (simulated or real)
  const after = computePersonnelRisk(personnel_id);
  db.prepare(`INSERT INTO intervention_outcomes
              (personnel_id, intervention_type, before_risk_score, after_risk_score, before_risk_level, after_risk_level, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(personnel_id, intervention_type, before_risk_score || null, after?.current_score || null,
         before_risk_level || null, after?.current_level || null, notes || null);
  audit(req.user, 'welfare_intervention', { personnel_id, intervention_type });
  res.json({ ok: true, after });
});

app.get('/api/welfare/recommendations/:id', auth, role(['admin','welfare_officer']), (req, res) => {
  const p = db.prepare('SELECT * FROM personnel_profiles WHERE id=?').get(+req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const risk = computePersonnelRisk(p.id);
  const rec = recommendForRisk(risk, p);
  res.json({ recommendations: rec, risk });
});

function recommendForRisk(risk, p) {
  const out = [];
  if (!risk) return out;
  if (risk.current_level === 'urgent' || risk.predicted_7d_level === 'urgent') {
    out.push({ priority: 'urgent', action: 'Immediate human support', detail: 'Contact authorised welfare officer within 24 hours. Provide crisis resources where appropriate.' });
    out.push({ priority: 'urgent', action: 'Safety check', detail: 'Confidential welfare check; do not include disciplinary context.' });
  } else if (risk.current_level === 'high') {
    out.push({ priority: 'high', action: 'Confidential welfare check', detail: 'Authorised welfare professional review within 48 hours.' });
    out.push({ priority: 'high', action: 'Optional counsellor', detail: 'Offer a confidential session with a uniformed-aware counsellor.' });
    out.push({ priority: 'high', action: 'Workload review', detail: 'Review non-critical workload and recovery allocation. Recommended by AI; decided by humans.' });
  } else if (risk.current_level === 'moderate') {
    out.push({ priority: 'medium', action: 'Recovery check-in', detail: 'Encourage 2 short recovery practices this week.' });
    out.push({ priority: 'medium', action: 'Wellbeing check-in', detail: 'Optional conversation with AI Friend or counsellor.' });
    out.push({ priority: 'medium', action: 'Sleep and recovery guidance', detail: 'If sleep < 60/100, share the sleep preparation resource.' });
  } else {
    out.push({ priority: 'low', action: 'Wellness resources', detail: 'Continue optional wellness check-ins.' });
    out.push({ priority: 'low', action: 'Short relaxation', detail: 'A 5-minute breathing practice helps sustain recovery.' });
  }
  return out;
}

/* ============================================================
   SIH 26186 — COMMANDER DASHBOARD
   Aggregated, unit-level only. No individual psychological detail.
   ============================================================ */
app.get('/api/commander/dashboard', auth, role(['admin','commander','welfare_officer']), (req, res) => {
  ensureDemoPersonnel();
  const personnel = db.prepare('SELECT * FROM personnel_profiles').all();
  const total = personnel.length;
  const byUnit = {};
  personnel.forEach(p => {
    const u = p.unit || 'Unassigned';
    if (!byUnit[u]) byUnit[u] = { unit: u, total: 0, low: 0, moderate: 0, high: 0, urgent: 0, avg_workload: 0, avg_recovery: 0 };
    byUnit[u].total++;
    byUnit[u][p.risk_level] = (byUnit[u][p.risk_level] || 0) + 1;
    byUnit[u].avg_workload += p.workload_index;
    byUnit[u].avg_recovery += p.recovery_index;
  });
  Object.values(byUnit).forEach(u => {
    u.avg_workload = Math.round(u.avg_workload / u.total);
    u.avg_recovery = Math.round(u.avg_recovery / u.total);
  });
  const counts = { low: 0, moderate: 0, high: 0, urgent: 0 };
  personnel.forEach(p => { if (counts[p.risk_level] !== undefined) counts[p.risk_level]++; });
  const trends = unitTrends();
  // Aggregated workload, recovery and deployment burden
  const agg = db.prepare(`SELECT
    AVG(workload_index) AS avg_workload,
    AVG(recovery_index) AS avg_recovery,
    AVG(deployment_duration_days) AS avg_deployment,
    SUM(CASE WHEN deployment_status='deployed' THEN 1 ELSE 0 END) AS deployed
    FROM personnel_profiles`).get();
  res.json({
    totals: { personnel: total, ...counts },
    units: Object.values(byUnit),
    trends,
    aggregate: {
      avg_workload: Math.round(agg.avg_workload || 0),
      avg_recovery: Math.round(agg.avg_recovery || 0),
      avg_deployment: Math.round(agg.avg_deployment || 0),
      deployed: agg.deployed || 0
    },
    updated_at: new Date().toISOString()
  });
});

function unitTrends() {
  // Use 14-day checkin history aggregated by day (no PII)
  const stressTrend = db.prepare(`SELECT date(created_at) AS d, ROUND(AVG(stress)) AS v
    FROM checkins WHERE created_at >= datetime('now','-14 days') GROUP BY date(created_at) ORDER BY d`).all();
  const moodTrend = db.prepare(`SELECT date(created_at) AS d, ROUND(AVG(mood)) AS v
    FROM checkins WHERE created_at >= datetime('now','-14 days') GROUP BY date(created_at) ORDER BY d`).all();
  const sleepTrend = db.prepare(`SELECT date(created_at) AS d, ROUND(AVG(sleep)) AS v
    FROM checkins WHERE created_at >= datetime('now','-14 days') GROUP BY date(created_at) ORDER BY d`).all();
  const recoveryTrend = db.prepare(`SELECT date(created_at) AS d, ROUND(AVG(recovery)) AS v
    FROM checkins WHERE created_at >= datetime('now','-14 days') GROUP BY date(created_at) ORDER BY d`).all();
  return { stress: stressTrend, mood: moodTrend, sleep: sleepTrend, recovery: recoveryTrend };
}

/* ============================================================
   SIH 26186 — DEMO DATA + HR IMPORT
   ============================================================ */
function ensureDemoPersonnel() {
  const c = db.prepare('SELECT COUNT(*) AS n FROM personnel_profiles').get().n;
  if (c > 0) return;
  // Generate 4 personas (A/B/C/D) and additional synthetic personnel
  const personas = [
    { name: 'Person A — Stable',    pw: 35, rec: 75, dep: 0,  leave: 21, train: 6,  trans: 0, pattern: 'regular' },
    { name: 'Person B — Rising',    pw: 65, rec: 45, dep: 14, leave: 4,  train: 18, trans: 1, pattern: 'rotating' },
    { name: 'Person C — High risk', pw: 88, rec: 22, dep: 60, leave: 0,  train: 30, trans: 3, pattern: 'field' },
    { name: 'Person D — Improving', pw: 55, rec: 65, dep: 0,  leave: 14, train: 8,  trans: 0, pattern: 'regular' }
  ];
  const units = ['Alpha Coy','Bravo Coy','Charlie Coy','Delta Coy','Echo Sqn','Foxtrot Sqn','Golf Sect','HQ Cell'];
  const ranks = ['Lt','Capt','Maj','Nk','Sub','OC','Cdr','Sgt','L/Nk'];
  const ins = db.prepare(`INSERT INTO personnel_profiles (user_id, pseudo_id, rank, unit, role, service_years, duty_pattern,
                        deployment_status, deployment_duration_days, recent_leave_days, training_load_hours,
                        workload_index, recovery_index, transfer_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  personas.forEach((p, i) => {
    const pseudo = 'PF-100' + (i+1);
    ins.run(null, pseudo, ranks[i % ranks.length], units[i % units.length], 'Personnel', 3 + i*2, p.pattern,
            p.dep > 0 ? 'deployed' : 'home', p.dep, p.leave, p.train, p.pw, p.rec, p.trans);
  });
  // 30 more synthetic personnel for richer commander dashboard
  for (let i = 0; i < 30; i++) {
    const pseudo = 'PF-' + (2000 + i);
    const pw = 25 + Math.round(Math.random() * 60);
    const rec = 100 - pw + Math.round((Math.random() - 0.5) * 20);
    const dep = Math.random() < 0.3 ? Math.round(Math.random() * 60) : 0;
    const leave = Math.round(Math.random() * 30);
    const train = Math.round(Math.random() * 35);
    const trans = Math.random() < 0.3 ? Math.round(Math.random() * 3) : 0;
    const pattern = ['regular','rotating','on_call','field'][Math.floor(Math.random()*4)];
    ins.run(null, pseudo, ranks[i % ranks.length], units[i % units.length], 'Personnel', 1 + Math.random()*15, pattern,
            dep > 0 ? 'deployed' : 'home', dep, leave, train, pw, Math.max(0, Math.min(100, rec)), trans);
  }
  // Run initial predictions
  const all = db.prepare('SELECT id FROM personnel_profiles').all();
  all.forEach(p => computePersonnelRisk(p.id));
  // Add some seed workload indicators
  const insWl = db.prepare(`INSERT INTO hr_workload_indicators
    (personnel_id, week_start, duty_hours, overtime_hours, night_duties, leave_taken_days, training_hours, recovery_allocated_hours, operational_tempo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const today = new Date();
  all.forEach(p => {
    for (let w = 0; w < 4; w++) {
      const d = new Date(today); d.setDate(d.getDate() - w * 7);
      insWl.run(p.id, d.toISOString().slice(0,10),
                30 + Math.random()*40, Math.random()*20, Math.floor(Math.random()*5),
                Math.random() < 0.4 ? Math.floor(Math.random()*3) : 0,
                Math.random()*15, Math.random()*10,
                ['low','normal','high','surge'][Math.floor(Math.random()*4)]);
    }
  });
}
ensureDemoPersonnel();

app.post('/api/admin/import', auth, role(['admin']), async (req, res) => {
  const { source = 'json', data } = req.body || {};
  let records = [];
  try {
    if (source === 'json') {
      if (typeof data === 'string') records = JSON.parse(data);
      else if (Array.isArray(data)) records = data;
    } else if (source === 'csv') {
      if (typeof data !== 'string') throw new Error('csv data must be string');
      const lines = data.split(/\r?\n/).filter(Boolean);
      const headers = lines.shift().split(',').map(s=>s.trim());
      for (const line of lines) {
        const cols = line.split(',').map(s=>s.trim());
        const obj = {}; headers.forEach((h,i)=>obj[h]=cols[i]);
        records.push(obj);
      }
    }
  } catch (e) {
    return res.status(400).json({ error: 'parse_error', message: e.message });
  }
  const ins = db.prepare(`INSERT OR IGNORE INTO personnel_profiles
    (user_id, pseudo_id, rank, unit, role, service_years, duty_pattern, deployment_status,
     deployment_duration_days, recent_leave_days, training_load_hours, workload_index, recovery_index, transfer_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let ok = 0, skipped = 0;
  const errs = [];
  for (const r of records) {
    try {
      const pseudo = String(r.pseudo_id || r.pseudoId || ('PF-' + Math.floor(Math.random()*9000+1000))).slice(0,32);
      const pw = Math.max(0, Math.min(100, parseInt(r.workload_index ?? r.workload ?? 50, 10) || 50));
      const rec = Math.max(0, Math.min(100, parseInt(r.recovery_index ?? r.recovery ?? 50, 10) || 50));
      const res2 = ins.run(null, pseudo, r.rank || 'Officer', r.unit || 'Unassigned', r.role || 'Personnel',
        parseFloat(r.service_years || 0) || 0, r.duty_pattern || 'regular',
        r.deployment_status || 'home', parseInt(r.deployment_duration_days || 0, 10) || 0,
        parseInt(r.recent_leave_days || 0, 10) || 0, parseFloat(r.training_load_hours || 0) || 0,
        pw, rec, parseInt(r.transfer_count || 0, 10) || 0);
      if (res2.changes) ok++; else skipped++;
    } catch (e) { errs.push(e.message); skipped++; }
  }
  db.prepare(`INSERT INTO hr_import_log (user_id, source, records_imported, errors) VALUES (?, ?, ?, ?)`)
    .run(req.user, source, ok, errs.length ? JSON.stringify(errs.slice(0,5)) : null);
  res.json({ ok, skipped, errors: errs.slice(0,5) });
});

app.post('/api/admin/demo/generate', auth, role(['admin']), (req, res) => {
  // wipe and regenerate demo data
  db.exec(`DELETE FROM intervention_outcomes; DELETE FROM welfare_alerts; DELETE FROM risk_predictions;
           DELETE FROM hr_workload_indicators; DELETE FROM personnel_profiles;`);
  ensureDemoPersonnel();
  audit(req.user, 'demo_regenerate', null);
  res.json({ ok: true, generated: db.prepare('SELECT COUNT(*) AS n FROM personnel_profiles').get().n });
});

app.get('/api/admin/users', auth, role(['admin']), (req, res) => {
  const rows = db.prepare('SELECT id, name, email, role, rank, service, country, created_at FROM users ORDER BY id').all();
  res.json({ users: rows });
});

app.patch('/api/admin/users/:id/role', auth, role(['admin']), (req, res) => {
  const { role: r } = req.body || {};
  const allowed = ['personnel','counsellor','admin','welfare_officer','commander'];
  if (!allowed.includes(r)) return res.status(400).json({ error: 'invalid role' });
  db.prepare('UPDATE users SET role=? WHERE id=?').run(r, +req.params.id);
  audit(req.user, 'role_change', { user_id: +req.params.id, role: r });
  res.json({ ok: true });
});

app.get('/api/admin/system-health', auth, role(['admin']), (req, res) => {
  res.json({
    ai: { provider: CONFIG.AI_PROVIDER, configured: !!CONFIG.AI_API_KEY, mode: CONFIG.AI_API_KEY ? 'live' : 'demo' },
    voice: { provider: CONFIG.VOICE_PROVIDER, elevenlabs_configured: !!CONFIG.ELEVENLABS_API_KEY,
             tts_provider: CONFIG.TTS_PROVIDER },
    payment: { provider: CONFIG.PAYMENT_PROVIDER, configured: !!CONFIG.PAYMENT_KEY_ID, mode: CONFIG.PAYMENT_KEY_ID ? 'live' : 'demo' },
    model: { version: MODEL_VERSION, thresholds: RISK_THRESHOLDS },
    db: { path: 'synapse.db', ok: true }
  });
});

/* ============================================================
   SIH 26186 — AI FRIEND MODES + WELLBEING REPORT
   ============================================================ */
const AI_FRIEND_MODES = {
  chat:           { name: 'Chat',          icon: '💬', desc: 'A space to talk, reflect, and feel supported.' },
  voice:          { name: 'Voice',         icon: '🎙', desc: 'Hands-free conversation with a calm voice.' },
  just_listen:    { name: 'Just Listen',   icon: '🫂', desc: 'No advice. Just a quiet, attentive space.' },
  calm:           { name: 'Calm',          icon: '🧘', desc: 'Short, grounding responses for overwhelming moments.' },
  late_night:     { name: 'Late Night',    icon: '🌙', desc: 'Soft, slow, sleep-friendly tone.' },
  motivation:     { name: 'Motivation',    icon: '💪', desc: 'Encouraging — never toxic positivity.' },
  problem_solving:{ name: 'Problem Solving',icon:'🎯', desc: 'Break the problem into small, actionable steps.' }
};

app.get('/api/ai-friend/modes', (req, res) => {
  res.json({ modes: AI_FRIEND_MODES });
});

app.post('/api/ai-friend/session', auth, (req, res) => {
  const { mode = 'chat' } = req.body || {};
  if (!AI_FRIEND_MODES[mode]) return res.status(400).json({ error: 'invalid mode' });
  const r = db.prepare('INSERT INTO ai_friend_sessions (user_id, mode) VALUES (?, ?)').run(req.user, mode);
  res.json({ session_id: r.lastInsertRowid, mode });
});

app.get('/api/ai-friend/sessions', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM ai_friend_sessions WHERE user_id=? ORDER BY started_at DESC LIMIT 20').all(req.user);
  res.json({ sessions: rows });
});

/* Augment demoAssistant with mode-specific tone */
function withMode(message, mode) {
  if (!message) return message;
  const m = (mode || 'chat').toLowerCase();
  if (m === 'just_listen')  return message + (/\?$/.test(message) ? '' : ' I\'m just listening.');
  if (m === 'calm')         return message.replace(/!/g, '.') + (message.length > 0 ? ' (soft, slow breath with me.)' : '');
  if (m === 'late_night')   return message + (/\?$/.test(message) ? '' : ' Take your time — there\'s no rush.');
  if (m === 'motivation')   return message + ' You\'re doing something real by being here.';
  if (m === 'problem_solving') return message + ' Want to break this into one small next step?';
  return message;
}

/* Save emotional signals for every chat turn */
function saveEmotionalSignals(userId, text, signals) {
  try {
    db.prepare(`INSERT INTO emotional_signals (user_id, source, scores, dominant_emotions, detected_topics, risk_level, recommended_support)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, 'chat', JSON.stringify(signals), JSON.stringify(signals.dominant_emotions || []),
           JSON.stringify(signals.detected_topics || []), signals.risk_level, JSON.stringify(signals.recommended_support || []));
  } catch (_) {}
}

app.get('/api/ai-friend/signals', auth, (req, res) => {
  const rows = db.prepare(`SELECT * FROM emotional_signals WHERE user_id=? ORDER BY created_at DESC LIMIT 30`).all(req.user);
  res.json({ signals: rows });
});

app.get('/api/ai-friend/report', auth, (req, res) => {
  const user = db.prepare('SELECT name FROM users WHERE id=?').get(req.user);
  // Aggregate signals across 30d
  const sigs = db.prepare(`SELECT * FROM emotional_signals WHERE user_id=? AND created_at >= datetime('now','-30 days') ORDER BY created_at DESC`).all(req.user);
  const sums = { mood:0, stress:0, anxiety:0, loneliness:0, fatigue:0, emotional_exhaustion:0, recovery:0, confidence:0 };
  let n=0;
  for (const s of sigs) {
    try { const j=JSON.parse(s.scores||'{}'); for (const k of Object.keys(sums)) if (typeof j[k]==='number') { sums[k]+=j[k]; } n++; } catch(_){}
  }
  // Real averages only — null when there is no signal data, never fake 50s.
  const avg = n
    ? Object.fromEntries(Object.entries(sums).map(([k,v])=>[k, Math.round(v/n)]))
    : Object.fromEntries(Object.entries(sums).map(([k])=>[k, null]));
  // Dominant emotions across all
  const emoCount = {};
  for (const s of sigs) {
    try { (JSON.parse(s.dominant_emotions||'[]')||[]).forEach(e => { emoCount[e]=(emoCount[e]||0)+1; }); } catch(_){}
  }
  const dominant = Object.entries(emoCount).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k])=>k);
  // Themes
  const themeCount = {};
  for (const s of sigs) {
    try { (JSON.parse(s.detected_topics||'[]')||[]).forEach(t => { themeCount[t]=(themeCount[t]||0)+1; }); } catch(_){}
  }
  const themes = Object.entries(themeCount).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k])=>k);
  // 7d and 30d
  const recent7 = sigs.filter(s => s.created_at >= new Date(Date.now() - 7*86400000).toISOString());
  const recent30 = sigs;
  // Self-reported check-in trends
  const last7 = db.prepare(`SELECT * FROM checkins WHERE user_id=? AND created_at >= datetime('now','-7 days') ORDER BY created_at ASC`).all(req.user);
  const last30 = db.prepare(`SELECT * FROM checkins WHERE user_id=? AND created_at >= datetime('now','-30 days') ORDER BY created_at ASC`).all(req.user);
  const payload = {
    user: user ? { name: user.name } : null,
    overall: avg,
    dominant_emotions: dominant,
    themes,
    positive_changes: computePositiveChanges(last7, last30),
    potential_stressors: themes.filter(t => !t.startsWith('protective:')).slice(0,5),
    protective_factors: themes.filter(t => t.startsWith('protective:')).map(t => t.replace('protective:','')),
    trend_7d: { checkins: last7.length, avg_stress: roundAvg(last7,'stress'), avg_mood: roundAvg(last7,'mood') },
    trend_30d: { checkins: last30.length, avg_stress: roundAvg(last30,'stress'), avg_mood: roundAvg(last30,'mood') },
    signal_count: sigs.length,
    has_data: sigs.length > 0,
    disclaimer: 'This is an AI-generated wellbeing reflection based on available voluntary data. It is not a medical diagnosis.',
    generated_at: new Date().toISOString()
  };
  // Persist snapshot so refreshing the Report page rehydrates from the latest state.
  try {
    db.prepare('INSERT INTO wellbeing_snapshots (user_id, snapshot, signal_count, source) VALUES (?, ?, ?, ?)')
      .run(req.user, JSON.stringify(payload), sigs.length, n > 0 ? 'aggregation' : 'empty');
  } catch (_) {}
  res.json(payload);
});

app.get('/api/ai-friend/report/latest', auth, (req, res) => {
  try {
    const row = db.prepare(`SELECT snapshot, signal_count, created_at FROM wellbeing_snapshots WHERE user_id=? ORDER BY id DESC LIMIT 1`).get(req.user);
    if (!row) return res.json({ has_data: false, signal_count: 0, disclaimer: 'Not enough data yet — chat with AI Friend or log a check-in to generate your wellbeing reflection.' });
    const snap = JSON.parse(row.snapshot || '{}');
    snap.snapshot_at = row.created_at;
    res.json(snap);
  } catch (_) {
    res.status(500).json({ error: 'failed' });
  }
});

function computePositiveChanges(last7, last30) {
  if (last7.length < 2 || last30.length < 4) return [];
  const out = [];
  const diff = (k) => {
    const r = last7.reduce((s,r)=>s+(r[k]||0),0)/last7.length;
    const o = last30.slice(0, Math.max(1, last30.length - last7.length)).reduce((s,r)=>s+(r[k]||0),0) / Math.max(1, last30.length - last7.length);
    return Math.round(r - o);
  };
  const dStress = diff('stress'), dMood = diff('mood'), dSleep = diff('sleep'), dRecovery = diff('recovery');
  if (dStress < -3) out.push({ text: `Stress has decreased by ${Math.abs(dStress)} pts in the last 7 days.`, direction: 'positive' });
  if (dMood > 3)    out.push({ text: `Mood has improved by ${dMood} pts in the last 7 days.`, direction: 'positive' });
  if (dSleep > 3)   out.push({ text: `Sleep has improved by ${dSleep} pts in the last 7 days.`, direction: 'positive' });
  if (dRecovery > 3) out.push({ text: `Recovery has improved by ${dRecovery} pts in the last 7 days.`, direction: 'positive' });
  return out;
}

function roundAvg(rows, k) { return rows.length ? Math.round(rows.reduce((s,r)=>s+(r[k]||0),0)/rows.length) : null; }

/* ============================================================
   SIH 26186 — MOOD HISTORY (today / 7d / 30d)
   ============================================================ */
app.get('/api/mood/history', auth, (req, res) => {
  const range = (req.query.range || '7d').toLowerCase();
  const days = range === 'today' ? 1 : range === '30d' ? 30 : 7;
  const rows = db.prepare(`SELECT * FROM checkins WHERE user_id=? AND created_at >= datetime('now','-${days} days') ORDER BY created_at ASC`).all(req.user);
  res.json({ range, days, checkins: rows });
});

/* ============================================================
   SIH 26186 — CONSENT (granular)
   ============================================================ */
app.post('/api/consent', auth, (req, res) => {
  const { kind, granted, scope = 'self' } = req.body || {};
  if (!kind) return res.status(400).json({ error: 'kind required' });
  // Map kind to a column on users when it is a self-flag
  const selfFlags = {
    voice_recording: 'voice_consent',
    voice_cloning:   'voice_consent',
    ai_friend:       'ai_consent',
    wellness_assessment: null,
    biometrics: null,
    org_analysis: null,
    share_counsellor: null,
    share_welfare: null
  };
  db.prepare('INSERT INTO consents (user_id, kind, granted) VALUES (?, ?, ?)').run(req.user, kind, granted ? 1 : 0);
  const col = selfFlags[kind];
  if (col) db.prepare(`UPDATE users SET ${col}=? WHERE id=?`).run(granted ? 1 : 0, req.user);
  audit(req.user, 'consent', { kind, granted, scope });
  res.json({ ok: true });
});

app.get('/api/consent', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM consents WHERE user_id=? ORDER BY ts DESC').all(req.user);
  const u = db.prepare('SELECT voice_consent, ai_consent FROM users WHERE id=?').get(req.user);
  res.json({ consents: rows, voice_consent: !!(u && u.voice_consent), ai_consent: !!(u && u.ai_consent) });
});

/* ============================================================
   SIH 26186 — BIOMETRIC (optional, consent-gated)
   ============================================================ */
app.post('/api/biometric', auth, (req, res) => {
  const { metric, value, recorded_at, consent_given = false } = req.body || {};
  if (!metric || typeof value !== 'number') return res.status(400).json({ error: 'metric and numeric value required' });
  if (!consent_given) return res.status(403).json({ error: 'explicit consent required' });
  const allowed = ['hrv','resting_hr','sleep_minutes','steps','heart_rate'];
  if (!allowed.includes(metric)) return res.status(400).json({ error: 'unsupported metric' });
  db.prepare(`INSERT INTO biometric_optional (user_id, metric, value, recorded_at, consent_given) VALUES (?, ?, ?, ?, ?)`)
    .run(req.user, metric, value, recorded_at || new Date().toISOString().slice(0,10), 1);
  audit(req.user, 'biometric_log', { metric, value });
  res.json({ ok: true });
});

app.get('/api/biometric', auth, (req, res) => {
  const rows = db.prepare('SELECT metric, value, recorded_at FROM biometric_optional WHERE user_id=? ORDER BY recorded_at DESC LIMIT 60').all(req.user);
  res.json({ records: rows });
});

/* ============================================================
   SIH 26186 — AUDIT LOGS (admin)
   ============================================================ */
app.get('/api/audit', auth, role(['admin']), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  const rows = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?').all(limit);
  res.json({ logs: rows });
});

/* ============================================================
   SIH 26186 — MODEL EVALUATION (research module)
   ============================================================ */
app.get('/api/research/model', (req, res) => {
  const personnel = db.prepare('SELECT COUNT(*) AS n FROM personnel_profiles').get().n;
  const preds = db.prepare('SELECT COUNT(*) AS n FROM risk_predictions').get().n;
  const avg_conf = db.prepare('SELECT ROUND(AVG(confidence)) AS c FROM risk_predictions').get().c || 0;
  // Distribution of current levels
  const dist = db.prepare(`SELECT current_risk_level AS level, COUNT(*) AS n FROM risk_predictions
    WHERE id IN (SELECT MAX(id) FROM risk_predictions GROUP BY personnel_id) GROUP BY current_risk_level`).all();
  res.json({
    model_version: MODEL_VERSION,
    training_data: 'synthetic_demo',
    personnel_count: personnel,
    predictions_count: preds,
    average_confidence: avg_conf,
    level_distribution: dist,
    metrics: {
      note: 'Baseline lexicon + weighted risk blend. Real evaluation requires labelled welfare outcomes; not available in demo.',
      reported: ['precision (not measured)', 'recall (not measured)', 'F1 (not measured)', 'ROC-AUC (not measured)',
                 'calibration (proxy: avg confidence)']
    },
    last_updated: new Date().toISOString()
  });
});

/* ============================================================
   FALLBACK
   ============================================================ */
app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
  const aiMode   = CONFIG.AI_API_KEY ? CONFIG.AI_PROVIDER : 'demo';
  const voiceMode = CONFIG.ELEVENLABS_API_KEY ? 'elevenlabs' : CONFIG.VOICE_PROVIDER;
  console.log(`SYNAPSE running on http://127.0.0.1:${PORT}  (AI: ${aiMode} · Voice: ${voiceMode})`);
});
