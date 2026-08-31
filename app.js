/* SYNAPSE — Frontend App Logic
   AI-Based Predictive Personnel Stress & Welfare Monitoring
*/
const App = (() => {
  'use strict';

  let token = localStorage.getItem('synapse_token');
  let user  = JSON.parse(localStorage.getItem('synapse_user') || 'null');
  let soldierMode = localStorage.getItem('synapse_soldier_mode') === 'true';

  /* ============================================================
     Core helpers
     ============================================================ */
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const api = async (path, opts={}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = token;
    const r = await fetch('/api' + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
    const data = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(data.error || 'request failed');
    return data;
  };
  const setMsg = (el, msg, ok=true) => {
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? 'var(--cyan)' : '#ff7a7a';
    if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 5000);
  };

  const toggleSoldierMode = () => {
    soldierMode = !soldierMode;
    localStorage.setItem('synapse_soldier_mode', soldierMode);
    updateSoldierModeUI();
    showToast(soldierMode ? 'Soldier Mode Activated' : 'Standard Mode Activated');

    if (soldierMode) {
      showSoldierInstructor();
    }
  };

  const showSoldierInstructor = (force = false) => {
    const inst = $('#soldier-instructor');
    if (!inst) return;

    // Persistence: Don't show automatically if they've finished onboarding
    if (!force && localStorage.getItem('synapse_soldier_onboarded') === 'true') return;

    inst.classList.remove('hidden');

    let currentStep = 0;
    const slides = $$('.inst-slide');
    const nextBtn = $('#inst-next');
    const prevBtn = $('#inst-prev');
    const skipBtn = $('#inst-skip');

    const updateStep = () => {
      slides.forEach((s, i) => s.classList.toggle('hidden', i !== currentStep));
      prevBtn.classList.toggle('hidden', currentStep === 0);
      nextBtn.textContent = currentStep === slides.length - 1 ? 'Finish' : 'Next';
    };

    nextBtn.onclick = () => {
      if (currentStep < slides.length - 1) {
        currentStep++;
        updateStep();
      } else {
        inst.classList.add('hidden');
        localStorage.setItem('synapse_soldier_onboarded', 'true');
      }
    };

    prevBtn.onclick = () => {
      if (currentStep > 0) {
        currentStep--;
        updateStep();
      }
    };

    skipBtn.onclick = () => {
      inst.classList.add('hidden');
      localStorage.setItem('synapse_soldier_onboarded', 'true');
    };

    // "Go to Feature" buttons
    $$('.inst-go').forEach(btn => {
      btn.onclick = () => {
        const target = btn.dataset.target;
        const el = document.querySelector(target);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Brief highlight effect
          el.style.outline = '3px solid var(--gold)';
          el.style.outlineOffset = '4px';
          setTimeout(() => { el.style.outline = 'none'; }, 2000);
        }
        inst.classList.add('hidden');
      };
    });

    updateStep();
  };

  const updateSoldierModeUI = () => {
    $$('.soldier-only').forEach(el => {
      el.classList.toggle('hidden', !soldierMode);
    });
    const dashboardTitle = $('#dash-greet');
    if (dashboardTitle && soldierMode) {
      dashboardTitle.innerHTML = `Welcome, ${user ? user.name.split(' ')[0] : 'Personnel'} <em style="color:var(--gold)">(Soldier Mode)</em>`;
    }
    const debriefSec = $('#duty-debrief');
    if (debriefSec) {
      debriefSec.classList.toggle('hidden', !soldierMode);
    }
    const standardOrb = $('#standard-hero-orb');
    if (standardOrb) {
      standardOrb.classList.toggle('hidden', soldierMode);
    }
  };
  const fmt = (n) => String(n).padStart(2, '0');
  const fmtTime = (sec) => `${fmt(Math.floor(sec/60))}:${fmt(sec%60)}`;
  const fmtDate = (s) => s ? new Date(s).toLocaleString([], { dateStyle:'medium', timeStyle:'short'}) : '';
  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ============================================================
     Auth UI
     ============================================================ */
  const renderAuth = () => {
    const bar = $('#auth-bar');
    if (!bar) return;
    if (user) {
      bar.innerHTML = `<span class="auth-user">${user.name.split(' ')[0]}</span><button class="auth-btn nav-login" id="auth-out" type="button"><span>Sign out</span></button>`;
      $('#auth-out').onclick = async () => {
        try { await api('/logout', { method: 'POST' }); } catch(e){}
        token = null; user = null;
        localStorage.removeItem('synapse_token'); localStorage.removeItem('synapse_user');
        renderAuth(); refreshAll();
        showToast('Signed out.');
      };
    } else {
      bar.innerHTML = `<button class="auth-btn nav-login" id="auth-open" type="button"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg><span>Login</span></button>`;
      bindAuthOpen();
    }
  };
  const bindAuthOpen = () => {
    const b = $('#auth-open');
    if (b) b.onclick = () => $('#auth-modal').classList.remove('hidden');
  };
  const bindAuthModal = () => {
    $('#auth-close').onclick = () => $('#auth-modal').classList.add('hidden');
    $$('#auth-modal .tab').forEach(t => {
      t.onclick = () => {
        $$('#auth-modal .tab').forEach(x => x.classList.remove('active'));
        $$('#auth-modal .form').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        $('#' + t.dataset.tab + '-form').classList.add('active');
      };
    });
    $('#login-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      try {
        const r = await api('/login', { method:'POST', body: JSON.stringify(fd) });
        token = r.token; user = r.user;
        localStorage.setItem('synapse_token', token);
        localStorage.setItem('synapse_user', JSON.stringify(user));
        $('#auth-modal').classList.add('hidden');
        renderAuth(); refreshAll();
        showToast('Welcome back, ' + user.name.split(' ')[0]);
      } catch (err) { setMsg($('#login-form .form-msg'), err.message, false); }
    };
    $('#register-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      try {
        const r = await api('/register', { method:'POST', body: JSON.stringify(fd) });
        token = r.token; user = r.user;
        localStorage.setItem('synapse_token', token);
        localStorage.setItem('synapse_user', JSON.stringify(user));
        $('#auth-modal').classList.add('hidden');
        renderAuth(); refreshAll();
        showToast('Account created. Welcome, ' + user.name.split(' ')[0]);
      } catch (err) { setMsg($('#register-form .form-msg'), err.message, false); }
    };
  };

  /* ============================================================
     Toast
     ============================================================ */
  function showToast(text, durMs) {
    let t = document.getElementById('syn-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'syn-toast';
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:12px 20px;background:rgba(7,17,31,.95);border:1px solid var(--cyan);color:var(--text);border-radius:8px;z-index:200;font:500 12px Inter;backdrop-filter:blur(10px);opacity:0;transition:opacity .3s;max-width:90vw;text-align:center;';
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.style.opacity = '1';
    setTimeout(() => t.style.opacity = '0', durMs || 3200);
  }

  /* ============================================================
     Check-in / Dashboard
     ============================================================ */
  const bindPressureCheck = () => {
    const form = $('#pressure-form');
    if (!form) return;
    $$('#pressure-form input[type=range]').forEach(r => {
      r.oninput = () => r.nextElementSibling.textContent = r.value;
    });
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!user) { $('#auth-modal').classList.remove('hidden'); return; }
      const fd = Object.fromEntries(new FormData(form));
      try {
        await api('/pressure-checks', { method:'POST', body: JSON.stringify({
          operational_pressure: +fd.operational_pressure,
          workload_pressure: +fd.workload_pressure,
          sleep_disruption: +fd.sleep_disruption,
          emotional_load: +fd.emotional_load,
          note: fd.note
        })});
        setMsg($('#pressure-form .form-msg'), '✓ Pressure check saved. Your load signals are recorded.');
        refreshDashboard();
      } catch (err) { setMsg($('#pressure-form .form-msg'), err.message, false); }
    };
  };

  const bindCheckin = () => {
    const form = $('#checkin-form');
    if (!form) return;
    $$('#checkin-form input[type=range]').forEach(r => {
      r.oninput = () => r.nextElementSibling.textContent = r.value;
    });
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!user) { $('#auth-modal').classList.remove('hidden'); return; }
      const fd = Object.fromEntries(new FormData(form));
      try {
        await api('/checkins', { method:'POST', body: JSON.stringify({
          mood:+fd.mood, stress:+fd.stress, sleep:+fd.sleep, energy:+fd.energy, focus:+fd.focus, recovery:+fd.recovery, workload:+fd.workload, note:fd.note
        })});
        setMsg($('#checkin-form .form-msg'), '✓ Check-in saved. Your signals are updated.');
        refreshDashboard();
      } catch (err) { setMsg($('#checkin-form .form-msg'), err.message, false); }
    };
  };

  /* Quick Reset dashboard tiles — open the games section and auto-launch the chosen game. */
  const bindQuickReset = () => {
    const row = document.getElementById('quick-reset-row');
    if (!row) return;
    row.querySelectorAll('[data-quick]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        const which = btn.getAttribute('data-quick');
        const slug = which === 'breathing' ? 'breathing-bubble'
          : which === 'stress-pop' ? 'stress-pop'
          : which === 'focus-dot' ? 'focus-dot' : null;
        if (!slug) return;
        // Scroll to the games section and open the chosen game.
        const games = document.getElementById('games');
        if (games) games.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => {
          const ev = new CustomEvent('synapse:open-game', { detail: { slug } });
          window.dispatchEvent(ev);
        }, 350);
      };
    });
  };

  /* Mindful Activity widget on the dashboard — reads server stats + localStorage mirror. */
  const refreshMindfulActivity = async () => {
    const wrap = document.getElementById('mindful-activity');
    if (!wrap) return;
    // 1) Try server stats first (works when signed in).
    let s = null;
    if (user) {
      try {
        const r = await api('/mindful/stats');
        s = r.stats || null;
      } catch (_) {}
    }
    // 2) Fall back to localStorage mirror.
    let ls = {};
    try { ls = JSON.parse(localStorage.getItem('synapse_mindful_stats') || '{}') || {}; } catch (_) {}
    const played   = (s && s.played)   || Object.values(ls).reduce((a, b) => a + (b.played || 0), 0);
    const completed = (s && s.completed) || Object.values(ls).reduce((a, b) => a + (b.completed || 0), 0);
    const totalMin  = (s && s.total_minutes) || Math.round(Object.values(ls).reduce((a, b) => a + (b.total_sec || 0), 0) / 60);
    let fav = null; let best = 0;
    for (const k of Object.keys(ls)) {
      if ((ls[k].played || 0) > best) { best = ls[k].played; fav = k; }
    }
    const favName = fav ? (fav.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())) : '—';
    const set = (key, val) => {
      const node = wrap.querySelector('[data-ma="' + key + '"]');
      if (node) node.textContent = String(val);
    };
    set('played', played);
    set('completed', completed);
    set('minutes', totalMin);
    set('fav', favName);
  };

  const renderRings = (vals) => {
    const cells = $$('#dash-grid .dash-cell');
    const labels = ['mood','stress','sleep','energy','focus','recovery'];
    cells.forEach((c, i) => {
      const v = vals[labels[i]];
      const prog = c.querySelector('.prog');
      const num  = c.querySelector('span');
      if (typeof v === 'number') {
        prog.style.setProperty('--p', v);
        prog.style.strokeDasharray = `${(v/100)*264} 264`;
        num.innerHTML = `${v}<small>%</small>`;
      } else {
        num.textContent = '—';
      }
    });
  };
  const renderChart = (rows) => {
    if (!rows || !rows.length) return;
    const moods = rows.slice(-14).map(r => r.mood);
    const w = 400, h = 120;
    const step = w / Math.max(1, moods.length - 1);
    let line = `M0,${h - (moods[0]/100)*h}`;
    moods.forEach((v,i) => {
      const x = i * step, y = h - (v/100)*h;
      line += ` L${x},${y}`;
    });
    $('#chart-line').setAttribute('d', line);
    const area = line + ` L${w},${h} L0,${h} Z`;
    $('#chart-area').setAttribute('d', area);
  };

  const renderAIContext = (latest) => {
    if (!latest) {
      $('#ai-context-sub').textContent = 'Sign in to see your latest signals.';
      $$('.ai-mood .m-bar i').forEach(i => i.style.width = '0%');
      $$('.ai-mood .m-val').forEach(v => v.textContent = '—');
      return;
    }
    const set = (k, idx) => {
      const v = latest[k];
      const i = $$('.ai-mood .m-bar i')[idx];
      const val = $$('.ai-mood .m-val')[idx];
      if (i) i.style.width = (v ?? 0) + '%';
      if (val) val.textContent = (v ?? 0) + '%';
    };
    set('mood', 0); set('stress', 1); set('sleep', 2);
  };

  const renderIntel = (insight) => {
    const valEl = $('#intel-status-value');
    const subEl = $('#intel-status-sub');
    const listEl = $('#intel-signals-list');
    if (!insight || insight.status === 'NO_DATA') {
      valEl.textContent = '—'; subEl.textContent = 'Log a check-in to see your state.';
      listEl.innerHTML = '<li class="muted small">No signals yet.</li>';
      return;
    }
    valEl.textContent = insight.status;
    subEl.textContent = insight.message;
    if (!insight.signals.length) {
      listEl.innerHTML = '<li class="muted small">Your recent signals look balanced.</li>';
    } else {
      listEl.innerHTML = insight.signals.map(s => `<li><span class="sgn">${s.icon}</span> ${s.text}</li>`).join('');
    }

    // Update Early Warning Banner (Soldier Mode Only)
    if (soldierMode) {
      const banner = $('#early-warning-banner');
      if (banner) {
        const isRisk = insight.status === 'ELEVATED' || insight.status === 'MODERATE';
        banner.classList.toggle('hidden', !isRisk);
        if (isRisk) {
          $('#warning-text').textContent = insight.message;
        }
      }
    }
  };

  const renderTimeline = async () => {
    const chart = $('#timeline-chart');
    if (!chart) return;
    try {
      const r = await api('/checkins');
      const data = r.checkins || [];
      if (!data.length) {
        chart.innerHTML = '<div class="muted small" style="width:100%; text-align:center; padding:20px;">No historical data available.</div>';
        return;
      }
      chart.innerHTML = '';
      const recent = data.slice(0, 14).reverse();

      const width = chart.clientWidth || 600;
      const height = 120;
      const padding = 20;

      const points = recent.map((d, i) => {
        const x = (i / (recent.length - 1 || 1)) * (width - 2 * padding) + padding;
        const y = height - padding - (d.stress / 100) * (height - 2 * padding);
        return { x, y, val: d.stress, date: fmtDate(d.created_at) };
      });

      const polyline = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      const area = `${polyline} L ${points[points.length-1].x} ${height-padding} L ${points[0].x} ${height-padding} Z`;

      chart.innerHTML = `
        <svg width="${width}" height="${height}" style="overflow:visible">
          <defs>
            <linearGradient id="timeline-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--cyan)" stop-opacity="0.5" />
              <stop offset="100%" stop-color="var(--cyan)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path d="${area}" fill="url(#timeline-grad)" stroke="none" />
          <path d="${polyline}" fill="none" stroke="var(--cyan)" stroke-width="2" stroke-linejoin="round" />
          ${points.map(p => `
            <circle cx="${p.x}" cy="${p.y}" r="3" fill="var(--navy)" stroke="var(--cyan)" stroke-width="1">
              <title>${p.date}: Stress ${p.val}%</title>
            </circle>
          `).join('')}
        </svg>
        <div class="timeline-labels" style="display:flex; justify-content:space-between; margin-top:10px; font-size:10px; color:var(--muted);">
          ${points.filter((_, i) => i % Math.ceil(points.length/5) === 0).map(p => `<span>${p.date}</span>`).join('')}
        </div>
      `;
    } catch (e) {
      chart.innerHTML = '<div class="muted small" style="width:100%; text-align:center; padding:20px;">Unable to load trends.</div>';
    }
  };

  const renderCommandOverview = async () => {
    const riskVal = $('#unit-risk-val');
    const riskSub = $('#unit-risk-sub');
    const distEl = $('#unit-distribution');
    if (!riskVal || !distEl) return;

    try {
      const data = await api('/command-stats');
      riskVal.textContent = data.risk;
      riskSub.textContent = data.sub;
      distEl.innerHTML = Object.entries(data.dist).map(([lvl, val]) => `
        <div style="display:grid; grid-template-columns:60px 1fr 40px; gap:8px; align-items:center; font-size:11px;">
          <span class="muted">${lvl.toUpperCase()}</span>
          <div style="height:6px; background:rgba(255,255,255,.05); border-radius:3px; overflow:hidden;">
            <div style="width:${val}%; height:100%; background:var(--cyan);"></div>
          </div>
          <span class="m-val">${val}%</span>
        </div>
      `).join('');
    } catch (e) {
      riskVal.textContent = 'ERROR';
      riskSub.textContent = 'Unable to load unit aggregated data.';
    }
  };

  const refreshDashboard = async () => {
    if (!user) {
      $('#dash-greet').textContent = 'Welcome, guest.';
      $('#dash-sub').textContent = 'Sign in to see your wellbeing snapshot.';
      renderRings({});
      renderAIContext(null);
      renderIntel({ status:'NO_DATA' });
      return;
    }
    try {
      const d = await api('/dashboard');
      const hr = new Date().getHours();
      const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';

      const greetText = soldierMode
        ? `${greet}, <em style="color:var(--gold)">${user.name.split(' ')[0]} (Soldier Mode)</em>.`
        : `${greet}, <em>${user.name.split(' ')[0]}</em>.`;

      $('#dash-greet').innerHTML = greetText;
      $('#dash-sub').textContent = d.latest
        ? `Snapshot · ${fmtDate(d.latest.created_at)} · ${d.streak}-day streak`
        : 'No check-ins yet — log your first one below.';
      renderRings(d.latest || {});
      renderAIContext(d.latest);
      renderIntel(d.insight);
      renderChart(d.last7);
      if (soldierMode) renderTimeline();
      if (user && ['commander','welfare_officer','admin'].includes(user.role)) renderCommandOverview();
      // Hero meta — streak (real)
      const streakEl = document.getElementById('dash-meta-streak');
      if (streakEl) streakEl.textContent = (d.streak || 0) + (d.streak === 1 ? ' day' : ' days');
      const insight = $('#dash-insight');
      const signals = d.insight && d.insight.status !== 'NO_DATA' ? d.insight.status : '—';
      insight.innerHTML = `<span class="ins-tag">WELLBEING</span> State: <strong>${signals}</strong> · Streak <strong>${d.streak}</strong> day${d.streak===1?'':'s'} · Recovery streak <strong>${d.recovery_streak}</strong>.`;
    } catch (e) {
      if ((e.message+'').includes('token')) { token=null; user=null; renderAuth(); }
    }
  };

  /* ============================================================
     AI chat
     ============================================================ */
  const renderMessages = (messages) => {
    const conv = $('#ai-conv');
    conv.innerHTML = '';
    messages.forEach(m => {
      const div = document.createElement('div');
      div.className = 'msg ' + (m.role === 'user' ? 'user' : 'bot');
      div.innerHTML = `<p>${m.content.replace(/\n/g,'<br>')}</p>`;
      conv.appendChild(div);
    });
    conv.scrollTop = conv.scrollHeight;
  };
  const addBot  = (t) => { const c = $('#ai-conv'); const d = document.createElement('div'); d.className='msg bot';  d.innerHTML = `<p>${t.replace(/\n/g,'<br>')}</p>`; c.appendChild(d); c.scrollTop = c.scrollHeight; };
  const addUser = (t) => { const c = $('#ai-conv'); const d = document.createElement('div'); d.className='msg user'; d.innerHTML = `<p>${t}</p>`; c.appendChild(d); c.scrollTop = c.scrollHeight; };

  const bindChat = () => {
    const form = $('#ai-form');
    if (!form) return;
    // Always prevent the browser's default form submission so Enter never navigates.
    form.setAttribute('novalidate', 'true');
    form.addEventListener('submit', (e) => e.preventDefault(), true);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const input = $('#ai-input');
      const text = input.value.trim();
      if (!text) return;
      if (!user) { $('#auth-modal').classList.remove('hidden'); return; }
      addUser(text);
      input.value = '';
      try {
        const r = await api('/chat', { method:'POST', body: JSON.stringify({ content: text }) });
        addBot(r.reply);
        if (r.crisis) showCrisis();
      } catch (err) { addBot('Sorry, I had trouble responding. Please try again.'); }
    };
    // Block any parent <a> or button from grabbing Enter inside the chat.
    const input = $('#ai-input');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.stopPropagation();
        }
      });
    }
    $$('.sug').forEach(s => {
      s.onclick = () => {
        $('#ai-input').value = s.dataset.prompt;
        form.dispatchEvent(new Event('submit', { cancelable: true }));
      };
    });
  };
  const refreshChat = async () => {
    if (!user) return;
    try {
      const r = await api('/chat');
      if (r.messages.length) renderMessages(r.messages);
    } catch(e){}
  };
  const showCrisis = async () => {
    const c = $('#ai-conv');
    const div = document.createElement('div');
    div.className = 'msg bot crisis';
    div.innerHTML = `<p><strong>Immediate Support</strong><br>If you are in danger, contact emergency services now. A counsellor is available right now if you'd like to talk.</p>`;
    c.appendChild(div);
    c.scrollTop = c.scrollHeight;
    setTimeout(() => openCrisisModal(), 600);
  };

  /* ============================================================
     Screening
     ============================================================ */
  const QUESTIONS_PHQ = [
    'Little interest or pleasure in doing things',
    'Feeling down, depressed, or hopeless',
    'Trouble falling/staying asleep, or sleeping too much',
    'Feeling tired or having little energy',
    'Poor appetite or overeating',
    'Feeling bad about yourself',
    'Trouble concentrating',
    'Moving or speaking slowly / being fidgety',
    'Thoughts that you would be better off dead'
  ];
  const QUESTIONS_GAD = [
    'Feeling nervous, anxious, or on edge',
    'Not being able to stop worrying',
    'Worrying too much about different things',
    'Trouble relaxing',
    'Being so restless it is hard to sit still',
    'Becoming easily annoyed or irritable',
    'Feeling afraid as if something awful might happen'
  ];
  const SCALE = ['Not at all','Several days','More than half','Nearly every day'];

  const renderScreening = () => {
    const wrap = $('#screening-qs');
    const instr = () => document.querySelector('input[name=instrument]:checked').value;
    const draw = () => {
      const qs = instr() === 'PHQ' ? QUESTIONS_PHQ : QUESTIONS_GAD;
      wrap.innerHTML = qs.map((q,i) => `
        <div class="sq">
          <div class="sq-q">${i+1}. ${q}</div>
          <div class="sq-opts">
            ${SCALE.map((s,si) => `<label><input type="radio" name="q${i}" value="${si}" required><span>${s}</span></label>`).join('')}
          </div>
        </div>`).join('');
    };
    $$('input[name=instrument]').forEach(r => r.onchange = draw);
    draw();
  };
  const bindScreening = () => {
    const form = $('#screening-form');
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!user) { $('#auth-modal').classList.remove('hidden'); return; }
      const instr = document.querySelector('input[name=instrument]:checked').value;
      const qs = instr === 'PHQ' ? QUESTIONS_PHQ : QUESTIONS_GAD;
      const answers = qs.map((_,i) => +form[`q${i}`].value);
      try {
        const r = await api('/screenings', { method:'POST', body: JSON.stringify({ instrument: instr, answers }) });
        const res = $('#screening-result');
        res.classList.remove('hidden');
        res.innerHTML = `
          <h3>${instr} result · ${r.severity}</h3>
          <p>Score <strong>${r.score}</strong> · ${r.severity} range.</p>
          <p>${r.severity==='minimal'?'Your responses suggest minimal concerns. Keep up your wellbeing practices.':
              r.severity==='mild'?'Mild symptoms — try a guided resource and re-check in a week.':
              r.severity==='moderate'?'Moderate symptoms — consider booking a counsellor to talk it through.':
              'Severe symptoms — please reach out to a counsellor promptly.'}</p>
          <p class="muted small">This is a screening, not a clinical diagnosis. A qualified professional can help you understand what this means for you.</p>
          <button class="btn primary" onclick="document.getElementById('counsellors').scrollIntoView({behavior:'smooth'})">Book a counsellor</button>
        `;
        setMsg($('#screening-form .form-msg'), '✓ Saved');
        loadScreeningHistory();
        refreshDashboard();
      } catch (err) { setMsg($('#screening-form .form-msg'), err.message, false); }
    };
  };
  const loadScreeningHistory = async () => {
    if (!user) return;
    try {
      const r = await api('/screenings');
      const el = $('#screening-history');
      if (!r.screenings.length) { el.innerHTML = ''; return; }
      el.innerHTML = '<h4 class="mt-2">History</h4>' + r.screenings.map(s =>
        `<div class="sh-row"><span><strong>${s.instrument}</strong> · ${s.severity}</span><span class="muted">${fmtDate(s.created_at)}</span></div>`
      ).join('');
    } catch(e){}
  };

  /* ============================================================
     Voice Companion
     ============================================================ */
  const voice = {
    state: 'idle',       // idle | listening | thinking | speaking | recording_sample
    recognizer: null,
    synth: window.speechSynthesis,
    stream: null,
    recorder: null,
    recorderChunks: [],
    sessionId: null,
    seconds: 0,
    timerInt: null,
    transcript: [],
    lastVoiceUsed: 'synthetic_calm',
    authorizedAvailable: false,
    voiceProfile: null
  };
  const setOrbState = (s) => {
    voice.state = s;
    const orb = $('#voice-orb');
    orb.className = 'voice-orb ' + s;
    const labels = { idle: 'IDLE', listening: 'LISTENING', thinking: 'THINKING', speaking: 'SPEAKING', recording_sample: 'RECORDING SAMPLE' };
    $('#orb-state').textContent = labels[s] || s.toUpperCase();
    // Drive the AI cat from real voice state (no-op if theme.js hasn't loaded yet).
    try {
      const catMap = {
        idle: 'idle',
        listening: 'listening',
        thinking: 'thinking',
        speaking: 'speaking',
        recording_sample: 'user-speaking'
      };
      const catState = catMap[s] || 'idle';
      if (window.SynapseCat && window.SynapseCat.setState) window.SynapseCat.setState('voice', catState);
    } catch (_) {}
  };
  const tickVoiceTimer = () => {
    voice.seconds++;
    $('#voice-timer').textContent = fmtTime(voice.seconds);
  };
  const startVoiceTimer = () => {
    voice.seconds = 0; $('#voice-timer').textContent = '00:00';
    voice.timerInt = setInterval(tickVoiceTimer, 1000);
  };
  const stopVoiceTimer = () => { if (voice.timerInt) clearInterval(voice.timerInt); voice.timerInt = null; };

  const buildWave = () => {
    const wf = $('#voice-waveform');
    wf.innerHTML = '';
    for (let i=0;i<48;i++) wf.appendChild(document.createElement('span'));
    return wf;
  };
  let waveInt = null;
  const animateWave = () => {
    const wf = $('#voice-waveform');
    wf.classList.add('active');
    if (waveInt) clearInterval(waveInt);
    waveInt = setInterval(() => {
      $$('#voice-waveform span').forEach(s => {
        s.style.height = (4 + Math.random() * (voice.state==='speaking'?40:voice.state==='listening'?28:voice.state==='recording_sample'?32:8)) + 'px';
      });
    }, 110);
  };
  const stopWave = () => {
    const wf = $('#voice-waveform');
    if (!wf) return;
    wf.classList.remove('active');
    if (waveInt) clearInterval(waveInt);
    $$('#voice-waveform span').forEach(s => s.style.height = '6px');
  };

  /* --- TTS playback. Server gives us { audio, voice_used, voice_style, ... }.
     audio is null in demo mode; in that case we fall back to SpeechSynthesis with the *style* matching the server's honest label. */
  let currentAudio = null;
  const speak = async (text, ttsInfo) => {
    const vol = +($('#vc-volume')?.value || 80) / 100;
    // Try real audio first
    if (ttsInfo && ttsInfo.audio) {
      try {
        const mime = ttsInfo.format || 'audio/mpeg';
        const bin = atob(ttsInfo.audio);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const blob = new Blob([buf], { type: mime });
        const url = URL.createObjectURL(blob);
        return new Promise((resolve) => {
          const a = new Audio(url);
          currentAudio = a;
          a.volume = vol;
          a.onended = () => { URL.revokeObjectURL(url); currentAudio = null; resolve(); };
          a.onerror = () => { URL.revokeObjectURL(url); currentAudio = null; resolve(); };
          a.play().catch(() => resolve());
        });
      } catch (_) { /* fall through to SpeechSynthesis */ }
    }
    // Demo fallback: SpeechSynthesis with a synthesized voice matching the style
    return new Promise((resolve) => {
      if (!voice.synth) { resolve(); return; }
      const u = new SpeechSynthesisUtterance(text);
      const style = (ttsInfo && ttsInfo.voice_style) || $('#voice-style')?.value || 'calm';
      const voiceMap = { calm: 0.9, professional: 1.0, warm: 0.95, neutral: 1.0, reassuring: 0.85 };
      u.rate = voiceMap[style] || 0.95;
      u.pitch = style === 'reassuring' ? 0.95 : style === 'warm' ? 1.05 : 1.0;
      u.volume = vol;
      u.onend = () => resolve();
      try { voice.synth.speak(u); } catch(e) { resolve(); }
    });
  };

  /* --- Voice turn (full server pipeline: intent + memory + tts). --- */
  const sendVoiceTurn = async (text) => {
    const style = $('#voice-style')?.value || 'calm';
    const useAuth = !!$('#vc-use-auth')?.checked;
    return await api('/assistant/voice-turn', {
      method: 'POST',
      body: JSON.stringify({
        transcript: text,
        voice_style: style,
        use_authorized_voice: useAuth
      })
    });
  };

  const startVoice = async () => {
    if (!user) { $('#auth-modal').classList.remove('hidden'); return; }
    buildWave();
    try {
      const r = await api('/voice/session/start', { method:'POST', body: JSON.stringify({ voice: $('#voice-style')?.value || 'calm' }) });
      voice.sessionId = r.sessionId;
    } catch(e) {}
    startVoiceTimer();
    animateWave();
    setOrbState('listening');
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        voice.recognizer = new SR();
        voice.recognizer.continuous = true;
        voice.recognizer.interimResults = true;
        voice.recognizer.lang = 'en-US';
        let final = '';
        voice.recognizer.onresult = (e) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) final += t + ' ';
            else interim += t;
          }
          const tr = $('#voice-transcript');
          tr.innerHTML = `<div class="t-user">${escapeHtml(final)}</div>${interim ? `<div class="muted small">${escapeHtml(interim)}</div>`:''}`;
          window._voiceLastFinal = final;
        };
        voice.recognizer.onerror = () => { setOrbState('idle'); };
        voice.recognizer.onend = async () => {
          const text = (window._voiceLastFinal || '').trim();
          if (!text) { setOrbState('idle'); return; }
          voice.transcript.push({ role:'user', content:text });
          setOrbState('thinking');
          try {
            const r = await sendVoiceTurn(text);
            voice.transcript.push({ role:'assistant', content:r.reply });
            voice.lastVoiceUsed = r.voice_used || 'synthetic_calm';
            voice.authorizedAvailable = !!r.authorized_voice_available;
            renderVoiceUsedLabel();
            const tr = $('#voice-transcript');
            tr.innerHTML = `<div class="t-user">${escapeHtml(text)}</div><div class="t-ai">${escapeHtml(r.reply).replace(/\n/g,'<br>')}</div><div class="voice-meta-line muted small">Voice used: <b>${r.voice_used}</b></div>`;
            if (r.crisis) { openCrisisModal(); setOrbState('idle'); return; }
            setOrbState('speaking');
            await speak(r.reply, r.tts);
            if (voice.recognizer && voice.sessionId) {
              setOrbState('listening');
              try { voice.recognizer.start(); } catch(e) {}
            } else setOrbState('idle');
          } catch(e) {
            setOrbState('idle');
            showToast('Voice turn failed: ' + (e && e.message || 'network'));
          }
        };
        voice.recognizer.start();
      } else {
        // No browser SR — demo mode: prompt for typed input
        setOrbState('listening');
        const text = prompt('Voice transcription is not supported in this browser. Type what you would say:');
        if (text) {
          voice.transcript.push({ role:'user', content:text });
          setOrbState('thinking');
          const r = await sendVoiceTurn(text);
          voice.transcript.push({ role:'assistant', content:r.reply });
          voice.lastVoiceUsed = r.voice_used || 'synthetic_calm';
          voice.authorizedAvailable = !!r.authorized_voice_available;
          renderVoiceUsedLabel();
          const tr = $('#voice-transcript');
          tr.innerHTML = `<div class="t-user">${escapeHtml(text)}</div><div class="t-ai">${escapeHtml(r.reply).replace(/\n/g,'<br>')}</div><div class="voice-meta-line muted small">Voice used: <b>${r.voice_used}</b></div>`;
          if (r.crisis) openCrisisModal();
          setOrbState('speaking'); await speak(r.reply, r.tts); setOrbState('idle');
        } else setOrbState('idle');
      }
    } catch (e) {
      setOrbState('idle');
    }
  };

  const endVoice = async () => {
    try { if (voice.recognizer) voice.recognizer.stop(); } catch(e) {}
    if (voice.synth) try { voice.synth.cancel(); } catch(e) {}
    if (currentAudio) try { currentAudio.pause(); } catch(e) {}
    if (voice.sessionId) {
      try { await api('/voice/session/end', { method:'POST', body: JSON.stringify({ sessionId: voice.sessionId, duration: voice.seconds, transcript: voice.transcript.map(t=>`${t.role}: ${t.content}`).join('\n') }) }); } catch(e){}
    }
    voice.sessionId = null;
    stopVoiceTimer();
    stopWave();
    setOrbState('idle');
    showToast('Voice session ended · ' + fmtTime(voice.seconds));
  };

  /* --- Sample recording & upload (MediaRecorder) --- */
  const startSampleRecord = async () => {
    if (!user) { $('#auth-modal').classList.remove('hidden'); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      showToast('Audio recording is not supported in this browser.');
      return;
    }
    try {
      voice.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      showToast('Microphone permission denied.');
      return;
    }
    voice.recorderChunks = [];
    try {
      voice.recorder = new MediaRecorder(voice.stream);
    } catch (e) {
      showToast('MediaRecorder not supported.');
      return;
    }
    voice.recorder.ondataavailable = (e) => { if (e.data && e.data.size) voice.recorderChunks.push(e.data); };
    voice.recorder.onstop = async () => {
      const blob = new Blob(voice.recorderChunks, { type: voice.recorder.mimeType || 'audio/webm' });
      // stop tracks
      try { voice.stream.getTracks().forEach(t => t.stop()); } catch (_) {}
      voice.stream = null;
      const seconds = voice.seconds;
      stopVoiceTimer();
      stopWave();
      setOrbState('idle');
      await uploadSample(blob, seconds);
    };
    voice.recorder.start();
    buildWave();
    animateWave();
    startVoiceTimer();
    setOrbState('recording_sample');
  };

  const stopSampleRecord = () => {
    if (voice.recorder && voice.recorder.state !== 'inactive') {
      try { voice.recorder.stop(); } catch (_) {}
    } else {
      // nothing was recording
      stopVoiceTimer();
      stopWave();
      setOrbState('idle');
    }
  };

  const uploadSample = async (blob, durationSec) => {
    // Always pull the freshest token from the closure (in sync with localStorage)
    // and from user object — both must agree; pick whichever is non-empty.
    const authToken = (typeof token === 'string' && token) ? token : (user && user.token) || '';
    if (!authToken) {
      showToast('Sign in first to upload a voice sample.');
      $('#auth-modal').classList.remove('hidden');
      return;
    }
    const ext = (blob.type.split('/')[1] || 'webm').replace(/[^a-z0-9]/g, '');
    const filename = `sample-${Date.now()}.${ext}`;
    const file = new File([blob], filename, { type: blob.type });
    const fd = new FormData();
    fd.append('audio', file);
    fd.append('duration_sec', String(durationSec || 0));
    let r, data;
    try {
      // Step 1: Uploading
      setVoiceUploadUI('uploading');
      r = await fetch('/api/voice/samples', {
        method: 'POST',
        headers: { 'Authorization': authToken },
        body: fd
      });
      data = await r.json().catch(() => ({}));
    } catch (e) {
      setVoiceUploadUI('idle');
      showToast('Upload error: ' + (e.message || 'network'));
      return;
    }
    if (!r.ok) {
      setVoiceUploadUI('idle');
      // 401/403 → token invalid; sign user out so the UI prompts re-login.
      if (r.status === 401 || r.status === 403) {
        token = null; user = null;
        try { localStorage.removeItem('synapse_token'); localStorage.removeItem('synapse_user'); } catch (_) {}
        renderAuth();
        $('#auth-modal').classList.remove('hidden');
        showToast('Session expired — please sign in again.');
        return;
      }
      const msg = data.message || data.error || r.statusText || 'upload failed';
      showToast('Upload failed: ' + msg);
      return;
    }
    // Step 2: Preparing voice (server received the sample, parsing + storing)
    setVoiceUploadUI('preparing');

    // Step 3: Cloning (or verification_required) — reflect server state
    const serverStatus = data.voice_status || data.status || 'pending';
    if (serverStatus === 'cloning') setVoiceUploadUI('cloning');

    // Step 4: refresh actual server state (always trust the server)
    await refreshVoiceProfile();
    const finalStatus = (voice.voiceProfile && voice.voiceProfile.profile && voice.voiceProfile.profile.status)
      || serverStatus;
    if (finalStatus === 'authorized' || finalStatus === 'ready') {
      voice.authorizedAvailable = !!voice.voiceProfile.profile.provider_voice_id;
      setVoiceUploadUI('authorized');
      showToast('✓ Voice authorized · ' + (data.message || 'cloned successfully.'));
    } else if (finalStatus === 'verification_required') {
      voice.authorizedAvailable = false;
      setVoiceUploadUI('verification_required');
      showToast('Voice cloned — verification required before use.');
    } else if (finalStatus === 'failed') {
      voice.authorizedAvailable = false;
      setVoiceUploadUI('failed');
      const errMsg = (data.message || '').slice(0, 240) || 'Voice cloning failed.';
      showVoiceFailure(errMsg, data.error_code);
    } else {
      setVoiceUploadUI('idle');
      showToast(data.message || 'Sample uploaded.');
    }
    renderVoiceLibrary();
    renderVoiceUsedLabel();
    // Step 5: limited polling — if cloning is asynchronous, fetch server state up to 3 more times.
    if (finalStatus === 'cloning') pollVoiceProfileUpTo(3, 1500);
  };

  /* Step-status UI: idle | uploading | preparing | cloning | authorized | verification_required | failed */
  const setVoiceUploadUI = (phase) => {
    const status = $('#vc-profile-status');
    const retry  = $('#vc-retry');
    const samples = (voice.voiceProfile && voice.voiceProfile.samples || []).length;
    if (!status) return;
    if (phase === 'uploading') {
      status.innerHTML = `⏳ <b>Uploading sample…</b>`;
      if (retry) retry.classList.add('hidden');
    } else if (phase === 'preparing') {
      status.innerHTML = `🛠 <b>Preparing voice…</b> · validating audio`;
      if (retry) retry.classList.add('hidden');
    } else if (phase === 'cloning') {
      status.innerHTML = `🧬 <b>Cloning voice…</b> · ElevenLabs is processing your sample`;
      if (retry) retry.classList.add('hidden');
    } else if (phase === 'authorized') {
      const p = voice.voiceProfile && voice.voiceProfile.profile;
      const id = p && p.provider_voice_id ? p.provider_voice_id.slice(0, 8) + '…' : '';
      status.innerHTML = `✓ <b>Voice authorized</b> · id: ${id} · ${samples} sample(s)`;
      if (retry) retry.classList.add('hidden');
    } else if (phase === 'verification_required') {
      const p = voice.voiceProfile && voice.voiceProfile.profile;
      const id = p && p.provider_voice_id ? p.provider_voice_id.slice(0, 8) + '…' : '';
      status.innerHTML = `⚠ <b>Verification required</b> · ElevenLabs needs to verify your voice sample. Id: ${id} · ${samples} sample(s)`;
      if (retry) retry.classList.add('hidden');
    } else if (phase === 'failed') {
      const p = voice.voiceProfile && voice.voiceProfile.profile;
      const msg = (p && p.last_error_msg) || 'Voice cloning failed.';
      const code = p && p.last_error_code;
      status.innerHTML = `✕ <b>Voice authorization failed</b><br><span class="muted small">${escapeHtml(msg.slice(0, 280))}${code ? ' · <code>' + escapeHtml(code) + '</code>' : ''}</span><br><span class="muted small">Click Retry after fixing the cause.</span>`;
      if (retry) retry.classList.remove('hidden');
    } else {
      // idle: fall through to renderProfileStatus to render whatever the server says
      try { renderProfileStatus(); } catch (_) {}
    }
  };

  /* Show a long-form voice failure reason in a toast. */
  const showVoiceFailure = (msg, code) => {
    if (!msg) return;
    const full = code ? (msg + ' (' + code + ')') : msg;
    showToast(full, 8000);
  };

  /* Polling helper: refresh profile up to N times at delayMs intervals.
     Stops early on terminal status (authorized/ready/verification_required/failed). */
  let _voicePollHandle = null;
  const pollVoiceProfileUpTo = (n, delayMs) => {
    if (_voicePollHandle) { clearTimeout(_voicePollHandle); _voicePollHandle = null; }
    let i = 0;
    const tick = async () => {
      i += 1;
      await refreshVoiceProfile();
      const st = voice.voiceProfile && voice.voiceProfile.profile && voice.voiceProfile.profile.status;
      const terminal = st === 'authorized' || st === 'ready' || st === 'verification_required' || st === 'failed';
      if (terminal || i >= n) {
        if (terminal) {
          if (st === 'authorized' || st === 'ready') {
            setVoiceUploadUI('authorized');
          } else if (st === 'verification_required') {
            setVoiceUploadUI('verification_required');
          } else if (st === 'failed') {
            const p = voice.voiceProfile && voice.voiceProfile.profile;
            setVoiceUploadUI('failed');
          }
        }
        _voicePollHandle = null;
        return;
      }
      _voicePollHandle = setTimeout(tick, delayMs);
    };
    _voicePollHandle = setTimeout(tick, delayMs);
  };

  /* Voice library + honest labels */
  const renderVoiceUsedLabel = () => {
    const el = $('#vc-voice-used');
    if (!el) return;
    // Prefer the last TTS call's voice_used; if absent, fall back to the live backend state
    // so the label always matches reality (no stale "Synthetic voice" when authorized).
    let used = voice.lastVoiceUsed;
    if (!used) {
      const p = voice.voiceProfile && voice.voiceProfile.profile;
      const isAuth = !!(p && (p.status === 'authorized' || p.status === 'ready') && p.provider_voice_id);
      const useAuth = !!$('#vc-use-auth')?.checked;
      used = (isAuth && useAuth) ? 'authorized_voice' : `synthetic_${$('#voice-style')?.value || 'calm'}`;
    }
    const isAuth = used === 'authorized_voice';
    el.innerHTML = isAuth
      ? `<span class="voice-tag auth">● Authorized voice</span>`
      : `<span class="voice-tag synth">○ Synthetic voice (${(used.split('_')[1] || used)})</span>`;
    el.classList.toggle('auth', isAuth);
  };

  const renderVoiceProviderLabel = () => {
    const el = $('#vc-provider');
    const sub = $('#vc-provider-sub');
    if (el) el.textContent = voice.provider || 'demo';
    if (sub) {
      if (voice.provider === 'elevenlabs' && voice.elevenlabsConfigured) {
        sub.textContent = 'ElevenLabs is configured. The AI will speak in your cloned voice when authorised.';
      } else {
        sub.textContent = 'ElevenLabs API key not detected — running in honest demo mode (synthetic voice via browser SpeechSynthesis). Add ELEVENLABS_API_KEY to .env to enable real TTS and voice cloning.';
      }
    }
  };

  const refreshVoiceConfig = async () => {
    try {
      const r = await api('/voice/config');
      voice.provider = r.provider || 'demo';
      voice.ttsProvider = r.tts_provider || 'demo';
      voice.elevenlabsConfigured = !!r.elevenlabs_configured;
      voice.aiProvider = r.ai_provider || 'demo';
      voice.aiConfigured = !!r.ai_configured;
      renderVoiceProviderLabel();
    } catch (_) { /* keep defaults */ }
  };

  const renderVoiceLibrary = () => {
    const list = $('#vc-samples-list');
    if (!list) return;
    const samples = (voice.voiceProfile && voice.voiceProfile.samples) || [];
    if (!samples.length) {
      list.innerHTML = `<div class="muted small">No voice samples uploaded yet. Record or upload an audio file to build your voice library.</div>`;
      return;
    }
    list.innerHTML = samples.map(s => `
      <div class="vc-sample-row">
        <div>
          <div><b>${escapeHtml(s.mime || 'audio')}</b> · ${(s.size_bytes/1024).toFixed(1)} KB</div>
          <div class="muted small">${fmtDate(s.created_at)} · ${Math.round(s.duration_sec||0)}s</div>
        </div>
        <button class="btn small danger" data-del-sample="${s.id}">Delete</button>
      </div>
    `).join('');
    list.querySelectorAll('[data-del-sample]').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-del-sample');
        try {
          const r = await fetch('/api/voice/samples/' + id, { method: 'DELETE', headers: { 'Authorization': token || (user && user.token) || '' } });
          const d = await r.json();
          voice.voiceProfile.samples = d.samples || [];
          renderVoiceLibrary();
        } catch (_) {}
      };
    });
  };

  const refreshVoiceProfile = async () => {
    if (!user) return;
    try {
      const r = await api('/voice/profile');
      voice.voiceProfile = r;
      const st = r.profile && r.profile.status;
      voice.authorizedAvailable = !!(r.profile && (st === 'authorized' || st === 'ready') && r.profile.provider_voice_id);
      renderVoiceLibrary();
      renderVoiceUsedLabel();
      renderProfileStatus();
    } catch (_) {}
  };

  const renderProfileStatus = () => {
    const status = $('#vc-profile-status');
    const retry  = $('#vc-retry');
    if (!status) return;
    const r = voice.voiceProfile;
    if (!r || !r.profile) {
      status.textContent = 'No voice profile yet.';
      if (retry) retry.classList.add('hidden');
      return;
    }
    const p = r.profile;
    const samples = (r.samples || []).length;
    const errorCode = p.last_error_code;
    const errorMsg  = p.last_error_msg;
    if ((p.status === 'authorized' || p.status === 'ready') && p.provider_voice_id) {
      status.innerHTML = `✓ <b>Voice authorized</b> · id: ${p.provider_voice_id.slice(0, 8)}… · ${samples} sample(s)`;
      if (retry) retry.classList.add('hidden');
    } else if (p.status === 'verification_required') {
      status.innerHTML = `⚠ <b>Verification required</b> · ElevenLabs needs to verify your voice sample. Id: ${p.provider_voice_id.slice(0, 8)}… · ${samples} sample(s)`;
      if (retry) retry.classList.add('hidden');
    } else if (p.status === 'cloning') {
      status.innerHTML = `🧬 <b>Cloning voice…</b> · ElevenLabs is processing your sample (this can take a few seconds).`;
      if (retry) retry.classList.add('hidden');
      // Bounded polling — only fires while cloning. Stops on terminal status or after 3 ticks.
      if (samples > 0) pollVoiceProfileUpTo(3, 2000);
    } else if (p.status === 'failed') {
      const safeMsg = (errorMsg || 'Voice cloning failed.').slice(0, 280);
      status.innerHTML = `✕ <b>Voice authorization failed</b><br><span class="muted small">${escapeHtml(safeMsg)}${errorCode ? ' · <code>' + escapeHtml(errorCode) + '</code>' : ''}</span><br><span class="muted small">Click <b>Retry</b> after fixing the cause.</span>`;
      if (retry) retry.classList.remove('hidden');
    } else if (p.status === 'pending') {
      status.innerHTML = `⏳ <b>Awaiting voice sample</b> · Upload a 5–30 second voice clip to authorize your voice.${samples > 0 ? ' · ' + samples + ' sample(s) on file, pending provider.' : ''}`;
      if (retry) retry.classList.add('hidden');
    } else {
      status.innerHTML = `Voice profile exists · ${samples} sample(s) · status: ${p.status}`;
      if (retry) retry.classList.add('hidden');
    }
  };

  const retryVoiceClone = async () => {
    if (!user) { $('#auth-modal').classList.remove('hidden'); return; }
    setVoiceUploadUI('cloning');
    try {
      const r = await api('/voice/clone', { method: 'POST', body: '{}' });
      await refreshVoiceProfile();
      const st = (voice.voiceProfile && voice.voiceProfile.profile && voice.voiceProfile.profile.status)
        || r.status || r.voice_status;
      if (r.ok && (st === 'authorized' || st === 'ready')) {
        setVoiceUploadUI('authorized');
        showToast('✓ Voice authorized · ' + (r.message || 'cloned successfully.'));
      } else if (r.ok && st === 'verification_required') {
        setVoiceUploadUI('verification_required');
        showToast('Voice cloned — verification required before use.');
      } else {
        setVoiceUploadUI('failed');
        const code = r.error_code || (voice.voiceProfile && voice.voiceProfile.profile && voice.voiceProfile.profile.last_error_code);
        const msg  = r.message || (voice.voiceProfile && voice.voiceProfile.profile && voice.voiceProfile.profile.last_error_msg) || 'Voice cloning failed.';
        showVoiceFailure(msg, code);
      }
    } catch (e) {
      setVoiceUploadUI('failed');
      showVoiceFailure(e.message || 'Network error during retry.', 'network_error');
    }
  };

  const bindVoice = () => {
    buildWave();
    $('#vc-mic').onclick = startVoice;
    $('#vc-end').onclick = endVoice;
    $('#vc-mute').onclick = () => {
      if (voice.synth) voice.synth.cancel();
      try { if (voice.recognizer) voice.recognizer.stop(); } catch(e) {}
      setOrbState('idle');
    };
    $('#vc-preview').onclick = async () => {
      const v = $('#voice-style').value;
      const samples = {
        calm: "Take a slow breath in. Hold. And release.",
        professional: "I'm here to support you. Tell me what's on your mind.",
        warm: "Hi — I'm glad you're here. We can take this at your pace.",
        neutral: "Voice preview. How does this tone feel?",
        reassuring: "Whatever you're carrying right now, you don't have to carry it alone."
      };
      const speed = +($('#vc-speed')?.value || 100) / 100;
      const useAuth = !!$('#vc-use-auth')?.checked;
      const stability = +($('#vc-stability')?.value || 70) / 100;
      const expressiveness = +($('#vc-expressiveness')?.value || 25) / 100;
      const tts = await api('/tts', { method:'POST', body: JSON.stringify({
        text: samples[v] || samples.calm,
        voice_style: v,
        speed,
        use_authorized_voice: useAuth,
        stability,
        expressiveness
      }) });
      voice.lastVoiceUsed = tts.voice_used || 'synthetic_' + v;
      voice.authorizedAvailable = !!tts.authorized_voice_available;
      renderVoiceUsedLabel();
      await speak(samples[v] || samples.calm, tts);
    };
    /* Voice tuning (sliders) — persisted to localStorage, sent on every TTS request */
    const tune = (k, def) => {
      try { const v = localStorage.getItem('synapse_vc_' + k); return v == null ? def : +v; } catch(_) { return def; }
    };
    const tuneSet = (k, v) => { try { localStorage.setItem('synapse_vc_' + k, String(v)); } catch(_) {} };
    const speedEl = $('#vc-speed'); if (speedEl) { speedEl.value = tune('speed', 100); speedEl.oninput = () => tuneSet('speed', speedEl.value); }
    const stabEl  = $('#vc-stability'); if (stabEl) { stabEl.value = tune('stability', 70); stabEl.oninput = () => tuneSet('stability', stabEl.value); }
    const exprEl  = $('#vc-expressiveness'); if (exprEl) { exprEl.value = tune('expressiveness', 25); exprEl.oninput = () => tuneSet('expressiveness', exprEl.value); }
    const resetBtn = $('#vc-tune-reset');
    if (resetBtn) resetBtn.onclick = () => {
      if (speedEl) { speedEl.value = 100; tuneSet('speed', 100); }
      if (stabEl)  { stabEl.value = 70;  tuneSet('stability', 70); }
      if (exprEl)  { exprEl.value = 25;  tuneSet('expressiveness', 25); }
    };
    $('#vc-enroll').onclick = async () => {
      if (!user) { $('#auth-modal').classList.remove('hidden'); return; }
      const phrase = $('#enroll-phrase').value.trim();
      if (!phrase) return;
      try {
        await api('/privacy/consent', { method:'POST', body: JSON.stringify({ kind:'voice', granted:true }) });
        await api('/voice/profile', { method:'POST', body: JSON.stringify({ phrase, consent_given: true }) });
        showToast('Voice profile created.');
        await refreshVoiceProfile();
      } catch(e) {
        $('#vc-enroll-status').textContent = '✗ ' + e.message;
      }
    };
    $('#vc-delete').onclick = async () => {
      if (!user) { $('#auth-modal').classList.remove('hidden'); return; }
      if (!confirm('Delete your voice profile and all samples? This cannot be undone.')) return;
      try {
        await api('/voice', { method:'DELETE' });
        showToast('Voice profile deleted.');
        await refreshVoiceProfile();
      } catch (e) { showToast('Delete failed.'); }
    };
    /* Sample recording (record button) */
    const recBtn = $('#vc-record');
    if (recBtn) recBtn.onclick = () => {
      if (voice.state === 'recording_sample') stopSampleRecord();
      else startSampleRecord();
      recBtn.textContent = voice.state === 'recording_sample' ? 'Stop recording' : 'Record sample';
    };
    /* File upload */
    const fileInput = $('#vc-upload-file');
    if (fileInput) {
      fileInput.onchange = async () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        await uploadSample(f, 0);
        fileInput.value = '';
      };
    }
    /* Use authorized voice toggle */
    const useAuth = $('#vc-use-auth');
    if (useAuth) useAuth.onchange = () => { renderVoiceUsedLabel(); };
    const retryBtn = $('#vc-retry');
    if (retryBtn) retryBtn.onclick = retryVoiceClone;
    renderVoiceUsedLabel();
    refreshVoiceProfile();
    refreshVoiceConfig();
  };

  /* ============================================================
     Recovery Studio
     ============================================================ */
  let breath = null;
  const loadExercises = async () => {
    try {
      const r = await api('/exercises');
      const grid = $('#exercise-grid');
      grid.innerHTML = r.exercises.map(e => `
        <div class="ex-card" data-id="${e.id}" data-slug="${e.slug}">
          <div class="ex-cat">${(e.category || '').toUpperCase()}</div>
          <div class="ex-title">${e.title}</div>
          <div class="ex-desc">${e.description}</div>
          <div class="ex-foot">
            <span class="ex-dur">${Math.round(e.duration_sec/60)} min</span>
            <button class="btn primary small" data-start="${e.id}">Start</button>
          </div>
        </div>
      `).join('');
      $$('#exercise-grid [data-start]').forEach(b => b.onclick = () => {
        const ex = r.exercises.find(x => x.id == b.dataset.start);
        openExercise(ex);
      });
    } catch(e){}
  };
  const openExercise = (ex) => {
    $('#recovery-player').classList.remove('hidden');
    $('#rp-title').textContent = ex.title;
    $('#rp-sub').textContent = ex.description;

    if (ex.slug === 'grounding') {
      breath = { ex };
      startGrounding();
      return;
    }

    if (ex.slug === 'sleep') {
      breath = { ex };
      startSleepRecovery();
      return;
    }

    let pattern = null;
    try { pattern = ex.pattern ? JSON.parse(ex.pattern) : null; } catch(e){}
    if (!pattern) {
      pattern = { inhale:4, hold:4, exhale:4, hold:4, cycles:6 };
    }
    breath = {
      ex, pattern,
      running: false, phaseIdx: 0, phaseT: 0, cyclesDone: 0,
      phases: [
        { name:'INHALE',  dur: pattern.inhale,  cls:'inhale'  },
        { name:'HOLD',    dur: pattern.hold,    cls:'hold'    },
        { name:'EXHALE',  dur: pattern.exhale,  cls:'exhale'  },
        { name:'HOLD',    dur: pattern.hold,    cls:'hold'    }
      ]
    };
    const totalCycles = pattern.cycles || 6;
    $('#rp-counter').textContent = `0 / ${totalCycles} cycles`;
    $('#breath-text').textContent = 'READY';
    $('#breath-orb').className = 'breath-orb';
    $('#rp-toggle').textContent = 'Start';
    $('#recovery-player').scrollIntoView({ behavior:'smooth', block:'start' });
  };
  let breathInt = null;
  const startBreath = () => {
    if (!breath) return;
    breath.running = true;
    $('#rp-toggle').textContent = 'Pause';
    breath.phaseT = 0;
    breath.cyclesDone = 0;
    breathInt = setInterval(() => {
      const cur = breath.phases[breath.phaseIdx];
      breath.phaseT += 0.1;
      $('#breath-text').textContent = cur.name;

      let scale = 1.0;
      const progress = breath.phaseT / cur.dur;
      if (cur.cls === 'inhale') scale = 1.0 + (0.35 * progress);
      else if (cur.cls === 'exhale') scale = 1.35 - (0.5 * progress);
      else if (cur.cls === 'hold') scale = (breath.phaseIdx === 1) ? 1.35 : 0.85;

      $('#breath-orb').style.setProperty('--breath-scale', scale);
      $('#breath-orb').className = 'breath-orb ' + cur.cls;

      if (breath.phaseT >= cur.dur) {
        breath.phaseT = 0;
        breath.phaseIdx = (breath.phaseIdx + 1) % breath.phases.length;
        if (breath.phaseIdx === 0) {
          breath.cyclesDone++;
          $('#rp-counter').textContent = `${breath.cyclesDone} / ${breath.pattern.cycles} cycles`;
          if (breath.cyclesDone >= breath.pattern.cycles) {
            stopBreath();
            completeExercise();
            return;
          }
        }
      }
    }, 100);
  };
  const stopBreath = () => {
    breath.running = false;
    if (breathInt) clearInterval(breathInt);
    breathInt = null;
    $('#rp-toggle').textContent = breath && breath.cyclesDone >= breath.pattern.cycles ? 'Restart' : 'Resume';
    $('#breath-orb').className = 'breath-orb';
    $('#breath-text').textContent = breath && breath.cyclesDone >= breath.pattern.cycles ? 'COMPLETE' : 'PAUSED';
  };
  const startGrounding = () => {
    const steps = [
      { n: 5, q: 'things you can see' },
      { n: 4, q: 'things you can touch' },
      { n: 3, q: 'things you can hear' },
      { n: 2, q: 'things you can smell' },
      { n: 1, q: 'thing you can taste' }
    ];
    let stepIdx = 0;
    $('#rp-toggle').textContent = 'Next';
    $('#rp-counter').textContent = `Step ${stepIdx + 1} / 5`;

    const updateStep = () => {
      const s = steps[stepIdx];
      $('#breath-text').innerHTML = `<div style="font-size:18px; margin-bottom:10px;">GROUNDING</div><div style="font-size:20px; font-weight:bold;">Name ${s.n} ${s.q}</div>`;
      $('#breath-orb').className = 'breath-orb hold';
      $('#breath-orb').style.setProperty('--breath-scale', 1.0);
    };

    updateStep();

    $('#rp-toggle').onclick = () => {
      stepIdx++;
      if (stepIdx < steps.length) {
        $('#rp-counter').textContent = `Step ${stepIdx + 1} / 5`;
        updateStep();
      } else {
        $('#breath-text').textContent = 'GROUNDED';
        $('#rp-toggle').textContent = 'Complete';
        $('#rp-toggle').onclick = completeExercise;
        $('#rp-counter').textContent = '5 / 5';
      }
    };
  };

  const startSleepRecovery = () => {
    let t = 0;
    $('#rp-toggle').textContent = 'Stop';
    $('#rp-counter').textContent = 'Deep Relaxation';

    const sleepInt = setInterval(() => {
      t += 0.02;
      const scale = 1.0 + 0.15 * Math.sin(t);
      $('#breath-orb').style.setProperty('--breath-scale', scale);
      $('#breath-orb').className = 'breath-orb hold';
      $('#breath-text').textContent = 'REST';
    }, 100);

    $('#rp-toggle').onclick = () => {
      clearInterval(sleepInt);
      $('#rp-toggle').textContent = 'Restart';
      $('#rp-toggle').onclick = startSleepRecovery;
      $('#breath-text').textContent = 'PAUSED';
    };
  };

  const completeExercise = async () => {
    if (!breath || !user) { showToast('Sign in to track completed exercises.'); return; }
    try {
      const r = await api('/exercises/session', { method:'POST', body: JSON.stringify({ exercise_id: breath.ex.id, duration_sec: breath.ex.duration_sec, completed: 1 }) });
      showToast(`Exercise complete · Streak: ${r.streak} days`);
      refreshRecoveryStats();
    } catch(e) {}
  };

  const bindDebrief = () => {
    const form = $('#debrief-form');
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = {
        duty_context: fd.get('duty_context'),
        duration: +fd.get('duration'),
        night_duty: +fd.get('night_duty'),
        stress: +fd.get('stress'),
        fatigue: +fd.get('stress'),
        experience: fd.get('experience'),
        support_needed: fd.get('support_needed'),
      };

      try {
        const r = await api('/debrief', { method: 'POST', body: JSON.stringify(body) });
        showToast('Duty debrief logged successfully.');
        form.reset();
      } catch (e) {
        showToast(e.message || 'Error saving debrief. Please try again.');
      }
    };
  };
  const refreshRecoveryStats = async () => {
    if (!user) return;
    try {
      const r = await api('/recovery/stats');
      $('#rs-sessions').textContent = r.total_sessions;
      $('#rs-minutes').textContent = r.total_minutes;
      $('#rs-streak').textContent = r.streak;
      $('#rs-fav').textContent = r.favourite ? r.favourite.title.split(' ')[0] : '—';
    } catch(e){}
  };
  const bindRecovery = () => {
    $('#rp-close').onclick = () => {
      if (breathInt) clearInterval(breathInt);
      breath = null;
      $('#recovery-player').classList.add('hidden');
    };
    $('#rp-toggle').onclick = () => {
      if (!breath) return;
      if (breath.running) stopBreath(); else startBreath();
    };
    $('#rp-complete').onclick = completeExercise;
  };

  /* ============================================================
     Counsellors
     ============================================================ */
  let counsellorsCache = [];
  const loadCounsellors = async () => {
    const q = $('#filter-q')?.value || '';
    const spec = $('#filter-spec')?.value || '';
    const lang = $('#filter-lang')?.value || '';
    const av   = $('#filter-availability')?.value || '';
    const rate = $('#filter-rating')?.value || '';
    const params = new URLSearchParams();
    if (q)   params.set('specialization', q);
    if (spec) params.set('specialization', spec);
    if (lang) params.set('language', lang);
    if (av)   params.set('online', av);
    if (rate) params.set('minRating', rate);
    try {
      const r = await api('/counsellors?' + params.toString());
      counsellorsCache = r.counsellors;
      renderCounsellors(r.counsellors);
    } catch(e){}
  };
  const renderCounsellors = (list) => {
    const grid = $('#counsellor-grid');
    if (!list.length) { grid.innerHTML = '<div class="muted small">No counsellors match your filters.</div>'; return; }
    grid.innerHTML = list.map(c => `
      <article class="counsellor-card" data-id="${c.id}">
        <div class="c-head">
          <div class="c-avatar">${c.avatar || c.name.split(' ').map(p=>p[0]).join('').slice(0,2)}</div>
          <div>
            <div class="c-name">${c.name}${c.online ? '<span class="c-online" title="Online now"></span>' : '<span class="c-offline" title="Offline"></span>'}</div>
            <div class="c-qual">${c.qualification} · ${c.experience_years} yrs</div>
          </div>
        </div>
        <div class="c-spec">${c.specialty}</div>
        <p class="muted small" style="margin:0">${(c.bio || '').slice(0, 140)}${(c.bio||'').length>140?'…':''}</p>
        <div class="c-meta">
          <span class="c-rating">★ ${(+c.rating).toFixed(1)} (${c.reviews_count})</span>
          <span>${c.languages || ''}</span>
        </div>
        <div class="c-foot">
          <div class="c-price">₹${c.price_per_min}<small>/min</small></div>
          <button class="btn primary small" data-view="${c.id}">View &amp; Book</button>
        </div>
      </article>
    `).join('');
    $$('#counsellor-grid [data-view]').forEach(b => b.onclick = () => openCounsellor(+b.dataset.view));
  };
  const bindCounsellorFilters = () => {
    ['filter-q','filter-spec','filter-lang','filter-availability','filter-rating'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.oninput = debounce(loadCounsellors, 250);
      if (el && el.tagName === 'SELECT') el.onchange = loadCounsellors;
    });
  };
  function debounce(fn, t) { let to; return (...a) => { clearTimeout(to); to = setTimeout(()=>fn(...a), t); }; }

  const openCounsellor = (id) => {
    const c = counsellorsCache.find(x => x.id === id);
    if (!c) return;
    const body = $('#cm-body');
    body.innerHTML = `
      <div class="cm-head">
        <div class="cm-avatar">${c.avatar || c.name.split(' ').map(p=>p[0]).join('').slice(0,2)}</div>
        <div>
          <div class="cm-name">${c.name}${c.online ? '<span class="c-online"></span>' : '<span class="c-offline"></span>'}</div>
          <div class="cm-qual">${c.qualification} · ${c.experience_years} years experience</div>
          <div class="c-rating">★ ${(+c.rating).toFixed(1)} (${c.reviews_count} reviews) · ${c.languages}</div>
        </div>
      </div>
      <div class="c-spec" style="margin-top:6px">${c.specialty}</div>
      <div class="cm-bio">${c.bio}</div>
      <div>
        <div class="eyebrow" style="margin-bottom:10px"><span class="dot"></span>SELECT DURATION</div>
        <div class="dur-picker" id="dur-picker">
          ${[5,10,20,30,60].map(d => `<button class="dur-btn" data-d="${d}"><span class="dur-min">${d} min</span><span class="dur-price">₹${c.price_per_min * d}</span></button>`).join('')}
        </div>
      </div>
      <div id="dur-actions"></div>
    `;
    let chosen = null;
    $$('#dur-picker .dur-btn').forEach(b => b.onclick = () => {
      $$('#dur-picker .dur-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      chosen = +b.dataset.d;
      const total = c.price_per_min * chosen;
      $('#dur-actions').innerHTML = `
        <div class="pm-summary">
          <div class="pm-row"><span>${c.name} · ${chosen} min</span><span>₹${c.price_per_min} × ${chosen}</span></div>
          <div class="pm-row"><span>Platform fee</span><span>₹0</span></div>
          <div class="pm-row total"><span>Total</span><span>₹${total}</span></div>
        </div>
        <button class="btn primary" id="confirm-book">Proceed to payment</button>
      `;
      $('#confirm-book').onclick = () => initiatePayment(c, chosen);
    });
    $('#counsellor-modal').classList.remove('hidden');
  };

  /* ============================================================
     Payment + Appointment + Session
     ============================================================ */
  const initiatePayment = async (counsellor, duration) => {
    if (!user) { $('#auth-modal').classList.remove('hidden'); return; }
    try {
      const ap = await api('/appointments', { method:'POST', body: JSON.stringify({ counsellor_id: counsellor.id, duration_min: duration }) });
      const order = await api('/payments/create', { method:'POST', body: JSON.stringify({ amount: ap.price, purpose:'appointment', appointment_id: ap.id, currency:'INR' }) });
      const body = $('#payment-body');
      body.innerHTML = `
        <div class="pm-summary">
          <div class="pm-row"><span>${counsellor.name}</span><span>${duration} min</span></div>
          <div class="pm-row"><span>Rate</span><span>₹${counsellor.price_per_min}/min</span></div>
          <div class="pm-row total"><span>Total</span><span>₹${ap.price}</span></div>
        </div>
        <div class="eyebrow" style="margin:8px 0"><span class="dot"></span>PAYMENT METHOD</div>
        <div class="pm-methods">
          <div class="pm-method active">UPI</div>
          <div class="pm-method">Card</div>
          <div class="pm-method">Netbanking</div>
        </div>
        <div class="pm-demo">Demo mode — clicking "Pay" simulates a successful payment. No real money is processed.</div>
        <div style="margin-top:14px;display:flex;gap:8px">
          <button class="btn primary" id="pay-now">Pay ₹${ap.price}</button>
          <button class="btn ghost" data-close>Cancel</button>
        </div>
      `;
      $('#counsellor-modal').classList.add('hidden');
      $('#payment-modal').classList.remove('hidden');
      $('#pay-now').onclick = async () => {
        try {
          await api('/payments/confirm', { method:'POST', body: JSON.stringify({ payment_id: order.payment_id, ref: order.order.ref }) });
          $('#payment-modal').classList.add('hidden');
          showToast('✓ Payment successful · Session confirmed.');
          // start session
          await startSession(ap.id, counsellor);
        } catch(e) { showToast('Payment failed: ' + e.message); }
      };
    } catch(e) { showToast(e.message); }
  };

  const startSession = async (appointmentId, counsellor) => {
    if (!user) return;
    try {
      const r = await api('/sessions/start', { method:'POST', body: JSON.stringify({ appointment_id: appointmentId, mode:'text' }) });
      openRoom(counsellor, r.session_id);
    } catch(e) { showToast(e.message); }
  };

  /* --- Counselling Room --- */
  const room = { sessionId: null, counsellor: null, mode: 'text', timer:null, seconds:0, msgInt:null };
  const openRoom = (counsellor, sessionId) => {
    room.counsellor = counsellor;
    room.sessionId = sessionId;
    room.seconds = 0;
    room.mode = 'text';
    $('#room-name').textContent = counsellor.name;
    $('#room-spec').textContent = counsellor.specialty;
    $('#room-avatar').textContent = (counsellor.avatar || counsellor.name.split(' ').map(p=>p[0]).join('').slice(0,2));
    $('#rt-clock').textContent = '00:00';
    $('#room-modal').classList.remove('hidden');
    setRoomMode('text');
    startRoomTimer();
    loadRoomMessages();
    if (room.msgInt) clearInterval(room.msgInt);
    room.msgInt = setInterval(loadRoomMessages, 2500);
  };
  const startRoomTimer = () => {
    if (room.timer) clearInterval(room.timer);
    room.timer = setInterval(() => { room.seconds++; $('#rt-clock').textContent = fmtTime(room.seconds); }, 1000);
  };
  const stopRoomTimer = () => { if (room.timer) clearInterval(room.timer); room.timer = null; };
  const setRoomMode = (m) => {
    room.mode = m;
    $$('.rt-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === m));
    $('#room-messages').classList.toggle('hidden', m !== 'text');
    $('#room-voice-stage').classList.toggle('hidden', m !== 'voice');
    $('#room-video-stage').classList.toggle('hidden', m !== 'video');
    if (m === 'video' && room.counsellor) {
      $('#video-avatar').textContent = (room.counsellor.avatar || room.counsellor.name.split(' ').map(p=>p[0]).join('').slice(0,2));
    }
  };
  const loadRoomMessages = async () => {
    if (!room.sessionId) return;
    try {
      const r = await api(`/sessions/${room.sessionId}/messages`);
      const el = $('#room-messages');
      el.innerHTML = r.messages.map(m => `<div class="rm ${m.sender}">${m.content.replace(/\n/g,'<br>')}</div>`).join('');
      el.scrollTop = el.scrollHeight;
    } catch(e){}
  };
  const bindRoom = () => {
    $$('.rt-tab').forEach(t => t.onclick = () => setRoomMode(t.dataset.mode));
    $('#room-form').onsubmit = async (e) => {
      e.preventDefault();
      const v = $('#room-input').value.trim();
      if (!v) return;
      $('#room-input').value = '';
      try { await api(`/sessions/${room.sessionId}/message`, { method:'POST', body: JSON.stringify({ content: v, sender:'user' }) }); loadRoomMessages(); }
      catch(err) {}
    };
    $('#room-end').onclick = async () => {
      try { await api(`/sessions/${room.sessionId}/end`, { method:'POST', body: JSON.stringify({}) }); }
      catch(e) {}
      stopRoomTimer();
      if (room.msgInt) clearInterval(room.msgInt);
      $('#room-modal').classList.add('hidden');
      showRatingModal();
    };
    $('#room-extend').onclick = async () => {
      try {
        const r = await api(`/sessions/extend`, { method:'POST', body: JSON.stringify({ session_id: room.sessionId, duration_min: 10 }) });
        await api('/payments/confirm', { method:'POST', body: JSON.stringify({ payment_id: r.payment_id, ref: r.order.ref }) });
        showToast('Session extended by 10 minutes.');
      } catch(e) { showToast(e.message); }
    };
    $('#room-report').onclick = () => {
      const reason = prompt('Describe the issue:');
      if (reason) { api('/crisis', { method:'POST', body: JSON.stringify({ message:'[session report] ' + reason, severity:'low' }) }); showToast('Issue reported. We will follow up.'); }
    };
  };
  const showRatingModal = () => {
    $('#rating-modal').classList.remove('hidden');
    let rating = 0;
    $$('#rating-stars span').forEach(s => s.onclick = () => {
      rating = +s.dataset.r;
      $$('#rating-stars span').forEach(x => x.classList.toggle('on', +x.dataset.r <= rating));
    });
    $('#rating-submit').onclick = async () => {
      try { await api(`/sessions/${room.sessionId}/end`, { method:'POST', body: JSON.stringify({ rating, review:$('#rating-text').value }) }); } catch(e){}
      $('#rating-modal').classList.add('hidden');
      showToast('Thank you for your feedback.');
      refreshDashboard();
    };
  };

  /* ============================================================
     Crisis / Safety
     ============================================================ */
  const openCrisisModal = async () => {
    try {
      const r = await api('/emergency');
      const e = r.emergency;
      const inl = (e.IN_HELPLINES || []).map(h => `<div class="crisis-num"><span>${h.name}</span><strong>${h.number}</strong></div>`).join('');
      $('#crisis-numbers').innerHTML = `
        <div class="crisis-num"><span>${e.IN.name}</span><strong>${e.IN.numbers.join(' / ')}</strong></div>
        <div class="crisis-num"><span>${e.US.name}</span><strong>${e.US.numbers.join(' / ')}</strong></div>
        <div class="crisis-num"><span>${e.UK.name}</span><strong>${e.UK.numbers.join(' / ')}</strong></div>
        ${inl}
      `;
    } catch(e){}
    $('#crisis-modal').classList.remove('hidden');
  };

  /* ============================================================
     Resources
     ============================================================ */
  let resourcesCache = [];
  const loadResources = async () => {
    try {
      const r = await api('/resources');
      resourcesCache = r.resources;
      renderResources();
    } catch(e){}
  };
  const renderResources = () => {
    const q = ($('#lib-search')?.value || '').toLowerCase();
    const cat = $('#lib-cat')?.value || '';
    let list = resourcesCache.filter(x =>
      (!q || (x.title + ' ' + x.description).toLowerCase().includes(q)) &&
      (!cat || x.kind === cat || x.title.toLowerCase().includes(cat.toLowerCase()) || x.description.toLowerCase().includes(cat.toLowerCase()))
    );
    const el = $('#resource-list');
    if (!list.length) { el.innerHTML = '<div class="muted small">No resources match.</div>'; return; }
    el.innerHTML = list.map(x => `
      <article class="res-card">
        <div class="res-kind">${x.kind}</div>
        <h4>${x.title}</h4>
        <p>${x.description}</p>
        <div class="res-foot"><span>${x.duration}</span><button class="btn ghost small" data-res="${x.id}">Open</button></div>
      </article>
    `).join('');
    $$('#resource-list [data-res]').forEach(b => b.onclick = () => {
      const res = resourcesCache.find(x => x.id == b.dataset.res);
      if (!res) return;
      // Open in recovery studio if it's a breathing exercise
      if (['breathing','exercise','audio'].includes(res.kind)) {
        const slug = (res.url || '').replace('#','');
        api('/exercises').then(r => {
          const ex = r.exercises.find(e => e.slug === slug);
          if (ex) {
            document.getElementById('recovery').scrollIntoView({behavior:'smooth'});
            openExercise(ex);
            return;
          }
          alert(`${res.title}\n\n${res.description}\n\n(${res.duration})`);
        });
      } else {
        alert(`${res.title}\n\n${res.description}\n\n(${res.duration})`);
      }
    });
  };
  const bindResourceFilters = () => {
    ['lib-search','lib-cat'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.oninput = renderResources;
      if (el && el.tagName === 'SELECT') el.onchange = renderResources;
    });
  };

  /* ============================================================
     Research
     ============================================================ */
  const loadResearch = async () => {
    try {
      const topic = $('#research-topic')?.value || '';
      const q = ($('#research-search')?.value || '').toLowerCase();
      const r = await api('/research' + (topic ? '?topic=' + encodeURIComponent(topic) : ''));
      let list = r.research;
      if (q) list = list.filter(x => (x.title + ' ' + x.summary + ' ' + (x.authors||'')).toLowerCase().includes(q));
      const el = $('#research-list');
      if (!list.length) { el.innerHTML = '<div class="muted small">No research found.</div>'; return; }
      el.innerHTML = list.map(p => `
        <div class="research-card">
          <div>
            <div class="research-tag">${(p.topic || '').toUpperCase()}</div>
            <div class="research-title">${p.title}</div>
            <div class="research-meta">${p.authors || ''} · ${p.year || ''} · ${p.journal || ''}</div>
            <div class="research-summary">${p.summary || ''}</div>
          </div>
          <div class="muted small">${(p.url || '').startsWith('#') ? 'Reference configured by administrator' : `<a href="${p.url}" target="_blank" rel="noopener" style="color:var(--cyan)">View source →</a>`}</div>
        </div>
      `).join('');
    } catch(e){}
  };
  const bindResearchFilters = () => {
    ['research-search','research-topic'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.oninput = debounce(loadResearch, 250);
      if (el && el.tagName === 'SELECT') el.onchange = loadResearch;
    });
  };

  /* ============================================================
     Privacy
     ============================================================ */
  const bindPrivacy = () => {
    const load = async () => {
      if (!user) return;
      try {
        const r = await api('/me');
        const u = r.user;
        $('#consent-ai').checked = !!u.ai_consent;
        $('#consent-voice').checked = !!u.voice_consent;
        $('#consent-counselling').checked = true;
      } catch(e){}
    };
    load();
    const onChange = async (id, kind) => {
      if (!user) { $('#auth-modal').classList.remove('hidden'); return; }
      const granted = document.getElementById(id).checked;
      try { await api('/privacy/consent', { method:'POST', body: JSON.stringify({ kind, granted }) }); showToast(`Consent ${granted?'granted':'revoked'}.`); }
      catch(e) {}
    };
    $('#consent-ai').onchange = () => onChange('consent-ai','ai');
    $('#consent-voice').onchange = () => onChange('consent-voice','voice');
    $('#priv-export').onclick = async () => {
      if (!user) { $('#auth-modal').classList.remove('hidden'); return; }
      try {
        const data = await api('/privacy/export');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'synapse-export.json'; a.click();
        URL.revokeObjectURL(url);
        showToast('Data exported.');
      } catch(e){}
    };
    $('#priv-delete-voice').onclick = async () => {
      if (!user) { $('#auth-modal').classList.remove('hidden'); return; }
      if (!confirm('Delete your voice profile?')) return;
      try { await api('/voice', { method:'DELETE' }); showToast('Voice profile deleted.'); }
      catch(e){}
    };
    $('#priv-delete-account').onclick = async () => {
      if (!user) { $('#auth-modal').classList.remove('hidden'); return; }
      if (!confirm('Delete your account? This anonymises your data.')) return;
      try {
        await api('/privacy/account', { method:'DELETE' });
        token = null; user = null;
        localStorage.removeItem('synapse_token'); localStorage.removeItem('synapse_user');
        renderAuth(); refreshAll();
        showToast('Account deleted.');
      } catch(e){}
    };
  };

  /* ============================================================
     Notifications
     ============================================================ */
  const loadNotifications = async () => {
    if (!user) { $('#notif-list').innerHTML = '<div class="muted small">Sign in to see notifications.</div>'; $('#notif-dot')?.classList.add('hidden'); return; }
    try {
      const r = await api('/notifications');
      const el = $('#notif-list');
      if (!r.notifications.length) { el.innerHTML = '<div class="muted small">No notifications yet.</div>'; $('#notif-dot')?.classList.add('hidden'); return; }
      el.innerHTML = r.notifications.map(n => {
        const icon = n.kind==='session'?'◉':n.kind==='checkin'?'◐':n.kind==='screening'?'◇':n.kind==='streak'?'✦':'·';
        return `<div class="notif-item ${n.read?'':'unread'}">
          <div class="notif-icon">${icon}</div>
          <div>
            <div class="notif-body-title">${n.title}</div>
            <div class="notif-body-text">${n.body}</div>
            <div class="notif-time">${fmtDate(n.created_at)}</div>
          </div>
        </div>`;
      }).join('');
      const unread = r.notifications.some(n => !n.read);
      $('#notif-dot')?.classList.toggle('hidden', !unread);
    } catch(e){}
  };
  const bindNotifications = () => {
    let notifTaps = 0;
    let lastNotifTap = 0;

    $('#notif-btn').onclick = (e) => {
      e.stopPropagation();

      // Triple-tap detection for Soldier Mode
      const now = Date.now();
      if (now - lastNotifTap < 500) {
        notifTaps++;
      } else {
        notifTaps = 1;
      }
      lastNotifTap = now;

      if (notifTaps === 3) {
        notifTaps = 0;
        $('#soldier-mode-modal').classList.remove('hidden');
        return;
      }

      const p = $('#notif-panel');
      p.classList.toggle('hidden');
      if (!p.classList.contains('hidden')) loadNotifications();
    };

    $('#notif-clear').onclick = async () => {
      try { await api('/notifications/read', { method:'POST', body: JSON.stringify({}) }); loadNotifications(); }
      catch(e){}
    };

    document.addEventListener('click', (e) => {
      const p = $('#notif-panel');
      if (!p || p.classList.contains('hidden')) return;
      if (!p.contains(e.target) && e.target.id !== 'notif-btn' && !e.target.closest('#notif-btn')) {
        p.classList.add('hidden');
      }
    });
  };

  /* ============================================================
     Admin / Counsellor Dashboards
     ============================================================ */
  const renderAdminLink = () => {
    if (user && (user.role === 'admin' || user.role === 'counsellor')) {
      $('#admin-link-mobile')?.classList.remove('hidden');
    } else {
      $('#admin-link-mobile')?.classList.add('hidden');
    }
  };
  const bindRoleDashboards = async () => {
    if (!user) {
      $('#admin').classList.add('hidden');
      $('#counsellor-dash').classList.add('hidden');
      return;
    }
    if (user.role === 'admin') {
      $('#admin').classList.remove('hidden');
      try {
        const r = await api('/admin/stats');
        const stats = [
          ['Total personnel', r.total_users],
          ['Active (7d)', r.active_users],
          ['Daily check-ins', r.total_checkins],
          ['Screenings', r.total_screenings],
          ['AI messages', r.total_ai_messages],
          ['Recovery sessions', r.total_recovery_sessions],
          ['Counselling sessions', r.total_sessions],
          ['Counselling revenue', '₹' + r.total_revenue],
          ['Counsellors', r.total_counsellors]
        ];
        $('#admin-stats').innerHTML = stats.map(([k,v]) => `<div class="rs-cell"><div class="rs-num">${v}</div><div class="rs-lbl">${k}</div></div>`).join('');
        // chart
        const days = r.daily_checkins || [];
        const max = Math.max(1, ...days.map(d => d.n));
        $('#admin-chart').innerHTML = (days.length ? days : Array.from({length:14},(_,i)=>({d:'',n:0}))).map(d =>
          `<div class="bar" style="height:${Math.max(2, (d.n/max)*160)}px" data-d="${(d.d||'').slice(5)}" title="${d.n} check-ins"></div>`
        ).join('');
      } catch(e){}
    } else {
      $('#admin').classList.add('hidden');
    }
    if (user.role === 'counsellor' || user.role === 'admin') {
      $('#counsellor-dash').classList.remove('hidden');
      try {
        const r = await api('/counsellor/stats');
        $('#cdash-stats').innerHTML = `
          <div class="rs-cell"><div class="rs-num">${r.total_sessions}</div><div class="rs-lbl">Total sessions</div></div>
          <div class="rs-cell"><div class="rs-num">${r.today_sessions}</div><div class="rs-lbl">Today</div></div>
          <div class="rs-cell"><div class="rs-num">₹${r.total_revenue}</div><div class="rs-lbl">Revenue</div></div>
          <div class="rs-cell"><div class="rs-num">${(+r.average_rating).toFixed(1)}</div><div class="rs-lbl">Avg rating (${r.reviews_count})</div></div>
        `;
        const ap = await api('/counsellor/appointments');
        $('#cdash-list').innerHTML = (ap.appointments || []).map(a => `
          <div class="cdash-row">
            <div>
              <strong>${a.client_name || 'Client #' + a.user_id}</strong>
              <div class="muted small">${a.duration_min} min · ₹${a.price} · ${fmtDate(a.created_at)}</div>
            </div>
            <span class="status ${a.status}">${a.status}</span>
          </div>
        `).join('') || '<div class="muted small">No appointments yet.</div>';
      } catch(e){}
    } else {
      $('#counsellor-dash').classList.add('hidden');
    }
  };

  /* ============================================================
     Modal close handlers
     ============================================================ */
  const bindModals = () => {
    $$('[data-close]').forEach(b => b.onclick = () => {
      b.closest('.modal').classList.add('hidden');
    });
    $$('.modal').forEach(m => m.addEventListener('click', (e) => {
      if (e.target === m) m.classList.add('hidden');
    }));
  };

  const bindSoldierModal = () => {
    const m = $('#soldier-mode-modal');
    if (!m) return;
    $('#sm-cancel').onclick = () => m.classList.add('hidden');
    $('#sm-switch').onclick = () => {
      toggleSoldierMode();
      m.classList.add('hidden');
    };
  };
  const openModal = (innerHtml) => {
    let m = document.getElementById('syn-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'syn-modal';
      m.className = 'modal';
      m.setAttribute('role','dialog');
      m.setAttribute('aria-modal','true');
      document.body.appendChild(m);
    }
    m.innerHTML = innerHtml;
    m.classList.remove('hidden');
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); }, { once: true });
    m.querySelectorAll('[data-modal-close]').forEach(b => b.onclick = () => m.classList.add('hidden'));
  };

  /* ============================================================
     Nav: hamburger, smooth scroll, mobile menu
     ============================================================ */
  const bindNav = () => {
    const ham = $('#hamburger');
    if (ham) ham.onclick = () => $('#mobile-menu').classList.toggle('hidden');
    $$('a[href^="#"]').forEach(a => a.addEventListener('click', () => {
      $('#mobile-menu')?.classList.add('hidden');
    }));
  };

  /* ============================================================
     Init
     ============================================================ */
  const refreshAll = () => {
    renderAdminLink();
    if (user) {
      refreshDashboard();
      refreshChat();
      loadScreeningHistory();
      refreshRecoveryStats();
      loadNotifications();
      refreshForecast();
      refreshAIGlassStats();
      refreshWellbeingReport();
      refreshMoodHistory();
      refreshWelfareDashboard();
      refreshCommanderDashboard();
      revealRoleNav();
    } else {
      refreshDashboard();
      renderIntel({ status:'NO_DATA' });
    }
    bindRoleDashboards();
    bindAIFriend();
    bindAIFriendFloat();
    refreshMindfulActivity();
  };

  /* ============================================================
     SIH 26186 — Role-based nav reveal
     ============================================================ */
  const revealRoleNav = () => {
    const role = user && user.role;
    const allow = (el) => {
      const list = (el.dataset.roleLink || '').split(',').map(s=>s.trim());
      if (!role) return false;
      return list.includes(role);
    };
    $$('[data-role-link]').forEach(el => { el.classList.toggle('hidden', !allow(el)); });
  };

  /* ============================================================
     SIH 26186 — AI Friend page
     ============================================================ */
  let _aiMode = 'chat';
  const AI_MODES = {
    chat:            'A space to talk, reflect, and feel supported.',
    just_listen:     'No advice. Just a quiet, attentive space.',
    calm:            'Short, grounding responses for overwhelming moments.',
    late_night:      'Soft, slow, sleep-friendly tone.',
    motivation:      'Encouraging — never toxic positivity.',
    problem_solving: 'Break the problem into small, actionable steps.'
  };
  const bindAIFriend = () => {
    const modes = $$('#ai-modes .ai-mode');
    if (!modes.length) return;
    modes.forEach(m => {
      m.onclick = () => {
        modes.forEach(x => x.classList.remove('active'));
        m.classList.add('active');
        _aiMode = m.dataset.mode;
        const d = $('#ai-mode-desc'); if (d) d.textContent = AI_MODES[_aiMode] || '';
      };
    });
    const form = $('#ai-friend-form');
    if (form && !form.dataset.bound) {
      form.dataset.bound = '1';
      form.setAttribute('novalidate', 'true');
      // Always prevent browser default submission so Enter never navigates away.
      form.addEventListener('submit', (e) => e.preventDefault(), true);
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (!user) { $('#auth-modal').classList.remove('hidden'); return; }
        const inp = $('#ai-friend-input');
        const text = inp.value.trim();
        if (!text) return;
        appendAIMessage('user', text);
        inp.value = '';
        try {
          const r = await api('/chat', { method:'POST', body: JSON.stringify({ content: text, mode: _aiMode }) });
          appendAIMessage('assistant', r.reply, r.crisis);
          // Refresh glass stats and forecast
          refreshAIGlassStats();
          refreshForecast();
        } catch (err) {
          appendAIMessage('assistant', 'Sorry, I could not respond right now. Please try again.');
        }
      };
      const inp = $('#ai-friend-input');
      if (inp) {
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.stopPropagation();
          }
        });
      }
    }
    const clr = $('#ai-clear');
    if (clr && !clr.dataset.bound) {
      clr.dataset.bound = '1';
      clr.onclick = async () => {
        try { await api('/chat', { method:'DELETE' }); } catch(_){}
        const conv = $('#ai-friend-conv'); if (conv) conv.innerHTML = '';
        showToast('Conversation cleared.');
      };
    }
  };
  const appendAIMessage = (role, text, isCrisis) => {
    const conv = $('#ai-friend-conv'); if (!conv) return;
    const div = document.createElement('div');
    div.className = 'ai-msg ' + role + (isCrisis ? ' crisis' : '');
    div.textContent = text;
    conv.appendChild(div);
    conv.scrollTop = conv.scrollHeight;
    // Drive AI cat from real friend state.
    try {
      if (window.SynapseCat && window.SynapseCat.setState) {
        if (role === 'user') window.SynapseCat.setState('friend', 'thinking');
        else if (role === 'assistant') window.SynapseCat.setState('friend', 'speaking');
      }
    } catch (_) {}
  };

  /* ============================================================
     SIH 26186 — AI Friend Glass Card stats (dashboard)
     ============================================================ */
  const refreshAIGlassStats = async () => {
    if (!user) return;
    try {
      const r = await api('/insight');
      const s = (r.insight && r.insight.snapshot) || {};
      const set = (k, v) => { const el = document.querySelector(`[data-glass="${k}"]`); if (el) el.textContent = (typeof v === 'number') ? v : '—'; };
      set('mood', s.mood); set('stress', s.stress); set('recovery', s.recovery);
    } catch(_){}
  };

  /* ============================================================
     SIH 26186 — 7-day Welfare Forecast (dashboard)
     Uses the latest risk for the current user from welfare/predict (admin)
     OR a self-targeted version using self-reported signals.
     ============================================================ */
  const refreshForecast = async () => {
    if (!user) return;
    // Pull user's own risk via /api/personnel/me + the latest prediction.
    try {
      const me = await api('/personnel/me');
      const pid = me.profile && me.profile.id;
      if (!pid) return;
      const r = await api('/personnel/' + pid + '/risk');
      const risk = r.risk;
      if (!risk) return;
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('fc-current', risk.current_score);
      const lvl = risk.current_level;
      set('fc-current-level', lvl.toUpperCase()).then && null;
      const lvlEl = document.getElementById('fc-current-level');
      if (lvlEl) { lvlEl.textContent = lvl.toUpperCase(); lvlEl.className = 'forecast-cell-level fc-' + lvl; }
      set('fc-predicted', risk.predicted_7d_score);
      const pEl = document.getElementById('fc-predicted-level');
      if (pEl) { pEl.textContent = risk.predicted_7d_level.toUpperCase(); pEl.className = 'forecast-cell-level fc-' + risk.predicted_7d_level; }
      set('fc-confidence', (risk.confidence || 0) + '%');
      const ul = document.getElementById('fc-signals');
      if (ul) {
        ul.innerHTML = '';
        const sigs = (risk.contributing_signals || []).slice(0, 5);
        if (!sigs.length) {
          ul.innerHTML = '<li class="muted small">No strong risk signals detected.</li>';
        } else {
          for (const s of sigs) {
            const li = document.createElement('li');
            li.className = s.direction === 'risk' ? 'risk' : 'protective';
            li.textContent = (s.direction === 'risk' ? '↑ ' : '↓ ') + s.label + (s.delta ? ' (' + s.delta + ')' : '');
            ul.appendChild(li);
          }
        }
      }
    } catch(_){}
  };

  /* ============================================================
     SIH 26186 — Wellbeing Report
     ============================================================ */
  const refreshWellbeingReport = async () => {
    if (!user) return;
    try {
      // Live aggregation first (always refreshes from current signals).
      let r = await api('/ai-friend/report');
      // If no live data but a persisted snapshot exists from a prior session,
      // rehydrate the Report page from /latest so refresh never shows a blank.
      if (!r || !r.has_data) {
        try {
          const latest = await api('/ai-friend/report/latest');
          if (latest && latest.has_data) r = latest;
        } catch (_) {}
      }
      const o = r.overall || {};
      const noData = !r.has_data;
      const overallEls = document.querySelectorAll('#rep-overall');
      if (overallEls.length) {
        const fields = ['mood','stress','anxiety','loneliness','fatigue','emotional_exhaustion','recovery','confidence'];
        const html = fields.map(f => {
          const v = o[f];
          const display = (v == null) ? '—' : v;
          const cls = (v == null) ? ' report-overall-cell-val muted' : ' report-overall-cell-val';
          return '<div class="report-overall-cell"><div class="report-overall-cell-label">' + f.replace('_',' ').toUpperCase() + '</div><div class="' + cls.trim() + '">' + display + '</div></div>';
        }).join('');
        overallEls.forEach(el => { el.innerHTML = html; });
      }
      // --- Dashboard prioritization: primary (mood/stress/anxiety/recovery)
      //     vs secondary (loneliness/fatigue/emotional_exhaustion/confidence).
      //     The legacy rep-overall grid is still filled above for backwards compat.
      const primaryFields = ['mood','stress','anxiety','recovery'];
      const secondaryFields = ['loneliness','fatigue','emotional_exhaustion','confidence'];
      const renderCell = (f) => {
        const v = o[f];
        const display = (v == null) ? '—' : v;
        const cls = (v == null) ? ' report-overall-cell-val muted' : ' report-overall-cell-val';
        return '<div class="report-overall-cell"><div class="report-overall-cell-label">' + f.replace('_',' ').toUpperCase() + '</div><div class="' + cls.trim() + '">' + display + '</div></div>';
      };
      const primaryEls = document.querySelectorAll('#rep-overall-primary');
      if (primaryEls.length) {
        primaryEls.forEach(el => { el.innerHTML = primaryFields.map(renderCell).join(''); });
      }
      const secondaryEls = document.querySelectorAll('#rep-overall-secondary');
      if (secondaryEls.length) {
        secondaryEls.forEach(el => {
          el.innerHTML = '<div class="secondary-label">More signals</div>' + secondaryFields.map(renderCell).join('');
        });
      }
      const fillAll = (selector, items, formatter) => {
        const els = document.querySelectorAll(selector);
        if (!els.length) return;
        const empty = '<div class="item muted">' + (noData ? 'Not enough data yet' : 'No data yet.') + '</div>';
        els.forEach(el => {
          if (!items || !items.length) { el.innerHTML = empty; return; }
          el.innerHTML = items.map(x => '<div class="item">' + escapeHtml(formatter ? formatter(x) : x) + '</div>').join('');
        });
      };
      fillAll('#rep-emotions', r.dominant_emotions, x => x.replace(/_/g,' '));
      fillAll('#rep-themes', (r.themes || []).map(t => t.replace('protective:','')));
      fillAll('#rep-positive', (r.positive_changes || []).map(p => p.text));
      fillAll('#rep-stressors', r.potential_stressors, x => x.replace(/_/g,' '));
      fillAll('#rep-protective', r.protective_factors);

      // Chip variants for emotions / themes (redesigned dashboard)
      const emEls = document.querySelectorAll('#rep-emotions');
      emEls.forEach(emEl => {
        if (r.dominant_emotions && r.dominant_emotions.length) {
          emEl.innerHTML = r.dominant_emotions.map(x => '<span class="chip">' + escapeHtml(x.replace(/_/g,' ')) + '</span>').join('');
        } else {
          emEl.innerHTML = '<div class="item muted">' + (noData ? 'Not enough data yet' : 'No dominant emotions detected.') + '</div>';
        }
      });
      const thEls = document.querySelectorAll('#rep-themes');
      thEls.forEach(thEl => {
        const themes = (r.themes || []).map(t => t.replace('protective:',''));
        if (themes.length) {
          thEl.innerHTML = themes.map(x => '<span class="chip">' + escapeHtml(x) + '</span>').join('');
        } else {
          thEl.innerHTML = '<div class="item muted">' + (noData ? 'Not enough data yet' : 'No themes detected.') + '</div>';
        }
      });

      // Hero meta — live signals count + status line
      const sigEl = document.getElementById('dash-meta-signals');
      if (sigEl) sigEl.textContent = (r.signal_count != null ? r.signal_count : '0');
      const snapEl = document.getElementById('dash-meta-snapshot');
      if (snapEl) {
        if ((r.trend_7d && r.trend_7d.checkins > 0) || (r.trend_30d && r.trend_30d.checkins > 0)) {
          snapEl.textContent = 'Active · ' + (r.trend_7d.checkins || 0) + ' check-ins · 7d';
        } else if ((r.signal_count || 0) > 0) {
          snapEl.textContent = 'Active · ' + r.signal_count + ' signals';
        } else {
          snapEl.textContent = 'Awaiting first signal';
        }
      }

      // Overall card tag — best-effort risk label from the trend
      const tagEl = document.getElementById('overall-tag');
      if (tagEl && r.trend_7d && typeof r.trend_7d.avg_stress === 'number') {
        const s = r.trend_7d.avg_stress;
        let tag = 'BALANCED';
        if (s >= 70) tag = 'ELEVATED';
        else if (s >= 50) tag = 'WATCH';
        else if (s < 35) tag = 'STABLE';
        tagEl.textContent = tag;
      } else if (tagEl) {
        tagEl.textContent = '—';
      }
    } catch(_){}
  };

  /* ============================================================
     AI Friend float button — opens a glassmorphic chat panel
     anchored near the floating button. Does NOT navigate.
     ============================================================ */
  const _aiFriendConv = []; // in-session history for the floating panel
  const _renderPanelMsg = (role, text, isCrisis) => {
    const conv = document.getElementById('ai-friend-panel-conv');
    if (!conv) return;
    const div = document.createElement('div');
    div.className = 'ai-msg ' + role + (isCrisis ? ' crisis' : '');
    div.textContent = text;
    conv.appendChild(div);
    conv.scrollTop = conv.scrollHeight;
    // Drive panel cat from real chat state.
    try {
      if (window.SynapseCat && window.SynapseCat.setState) {
        if (role === 'user') window.SynapseCat.setState('panel', 'thinking');
        else if (role === 'assistant') window.SynapseCat.setState('panel', 'speaking');
      }
    } catch (_) {}
  };
  const _setPanelTyping = (on) => {
    const t = document.getElementById('ai-friend-panel-typing');
    if (!t) return;
    t.classList.toggle('hidden', !on);
  };
  const bindAIFriendPanel = () => {
    const panel = document.getElementById('ai-friend-panel');
    const form  = document.getElementById('ai-friend-panel-form');
    if (!panel || !form || form.dataset.bound) return;
    form.dataset.bound = '1';
    // Mark the form so main.js's pre-login fallback wireup won't double-bind.
    form.__appBound = true;
    form.setAttribute('novalidate', 'true');
    // Always block default form submission so Enter never navigates.
    form.addEventListener('submit', (e) => e.preventDefault(), true);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const inp = document.getElementById('ai-friend-panel-input');
      const text = inp.value.trim();
      if (!text) return;
      if (!user) {
        $('#auth-modal').classList.remove('hidden');
        return;
      }
      _aiFriendConv.push({ role: 'user', content: text });
      _renderPanelMsg('user', text);
      inp.value = '';
      _setPanelTyping(true);
      try {
        const r = await api('/chat', { method: 'POST', body: JSON.stringify({ content: text }) });
        _aiFriendConv.push({ role: 'assistant', content: r.reply });
        _renderPanelMsg('assistant', r.reply, r.crisis);
      } catch (_) {
        _renderPanelMsg('assistant', 'Sorry, I had trouble responding. Please try again.');
      } finally {
        _setPanelTyping(false);
      }
    };
    const inp = document.getElementById('ai-friend-panel-input');
    if (inp) {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.stopPropagation();
          e.preventDefault();
          form.dispatchEvent(new Event('submit', { cancelable: true }));
        }
      });
    }
    const closeBtn = document.getElementById('ai-friend-panel-close');
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.dataset.bound = '1';
      closeBtn.addEventListener('click', () => toggleAIFriendPanel(false));
    }
  };
  const toggleAIFriendPanel = (force) => {
    const btn = document.getElementById('ai-friend-float');
    const panel = document.getElementById('ai-friend-panel');
    if (!btn || !panel) return;
    const willOpen = typeof force === 'boolean' ? force : !panel.classList.contains('open');
    panel.classList.toggle('open', willOpen);
    panel.classList.toggle('hidden', !willOpen);
    btn.classList.toggle('is-open', willOpen);
    btn.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
      const inp = document.getElementById('ai-friend-panel-input');
      if (inp) setTimeout(() => inp.focus({ preventScroll: true }), 200);
      // Hydrate panel with a friendly greeting on first open.
      const conv = document.getElementById('ai-friend-panel-conv');
      if (conv && conv.children.length === 0) {
        _renderPanelMsg('assistant', "Hi — I'm SYNAPSE AI Friend. What's on your mind today?");
      }
    }
  };
  const bindAIFriendFloat = () => {
    const btn = document.getElementById('ai-friend-float');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    bindAIFriendPanel();
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleAIFriendPanel();
    });
  };

  /* ============================================================
     SIH 26186 — Mood History
     ============================================================ */
  const refreshMoodHistory = async (range) => {
    if (!user) return;
    range = range || '7d';
    try {
      const r = await api('/mood/history?range=' + range);
      $$('.mood-tab').forEach(t => t.classList.toggle('active', t.dataset.range === range));
      const grid = document.getElementById('mood-grid');
      if (!grid) return;
      const checks = r.checkins || [];
      if (!checks.length) { grid.innerHTML = '<div class="mood-cell"><div class="mood-cell-title">NO DATA</div><div class="muted small">Log a check-in to start your trend.</div></div>'; return; }
      const dims = [
        { key:'mood', label:'MOOD', color:'#62D8E8' },
        { key:'stress', label:'STRESS', color:'#E07A5F' },
        { key:'anxiety', label:'ANXIETY', color:'#D9A441' },
        { key:'fatigue', label:'FATIGUE', color:'#7B5FFF' },
        { key:'loneliness', label:'LONELINESS', color:'#5CA9FF' },
        { key:'recovery', label:'RECOVERY', color:'#62D88A' }
      ];
      grid.innerHTML = dims.map(d => {
        const vals = checks.map(c => c[d.key] || 0);
        const path = sparkline(vals, d.color);
        return '<div class="mood-cell"><div class="mood-cell-title">' + d.label + '</div>' + path + '</div>';
      }).join('');
    } catch(_){}
  };
  const sparkline = (vals, color) => {
    if (!vals.length) return '<div class="muted small">No data.</div>';
    const w = 280, h = 80, n = vals.length;
    const step = w / Math.max(1, n - 1);
    let pts = vals.map((v, i) => `${(i*step).toFixed(1)},${(h - (v/100)*h).toFixed(1)}`);
    const path = 'M' + pts.join(' L');
    const fill = path + ` L${w},${h} L0,${h} Z`;
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="g-${color.slice(1)}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".4"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${fill}" fill="url(#g-${color.slice(1)})"/><path d="${path}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
  };

  /* ============================================================
     SIH 26186 — Welfare Command Center
     ============================================================ */
  const refreshWelfareDashboard = async () => {
    if (!user || (user.role !== 'welfare_officer' && user.role !== 'admin')) return;
    try {
      const r = await api('/welfare/dashboard');
      const stats = document.getElementById('welfare-stats');
      if (stats) {
        const t = r.totals || {};
        stats.innerHTML = `
          <div class="welfare-stat"><div class="welfare-stat-num">${t.personnel||0}</div><div class="welfare-stat-lbl">PERSONNEL</div></div>
          <div class="welfare-stat low"><div class="welfare-stat-num">${t.low||0}</div><div class="welfare-stat-lbl">LOW RISK</div></div>
          <div class="welfare-stat moderate"><div class="welfare-stat-num">${t.moderate||0}</div><div class="welfare-stat-lbl">MODERATE</div></div>
          <div class="welfare-stat high"><div class="welfare-stat-num">${t.high||0}</div><div class="welfare-stat-lbl">HIGH</div></div>
          <div class="welfare-stat urgent"><div class="welfare-stat-num">${t.urgent||0}</div><div class="welfare-stat-lbl">URGENT</div></div>`;
      }
      // Render mini trend
      const tr = (r.trends && r.trends.stress) || [];
      const drawTrend = (id, data, color) => {
        const el = document.getElementById(id); if (!el) return;
        if (!data.length) { el.textContent = '—'; return; }
        const w = 280, h = 60, n = data.length;
        const step = w / Math.max(1, n - 1);
        const pts = data.map((d, i) => `${(i*step).toFixed(1)},${(h - ((d.v||0)/100)*h).toFixed(1)}`);
        const path = 'M' + pts.join(' L');
        el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
      };
      drawTrend('wf-trend-stress', tr, '#E07A5F');
      drawTrend('wf-trend-fatigue', (r.trends && r.trends.mood) || [], '#7B5FFF');
      drawTrend('wf-trend-recovery', (r.trends && r.trends.recovery) || [], '#62D88A');
      const dd = document.getElementById('wf-deploy-dist');
      if (dd) dd.innerHTML = '<div class="muted small">DEMO DATA · See <code>/api/personnel</code> for full distribution</div>';

      // Queue
      const q = document.getElementById('wf-queue');
      if (q) {
        if (!r.queue || !r.queue.length) q.innerHTML = '<div class="muted small">No high-priority personnel right now.</div>';
        else q.innerHTML = r.queue.map(p => `<div class="wf-row">
          <div class="wf-pid">${escapeHtml(p.pseudo_id)}</div>
          <div>${escapeHtml(p.unit||'')}</div>
          <div>${escapeHtml(p.last_checkin ? 'Last check-in: ' + new Date(p.last_checkin).toLocaleDateString() : 'No check-in')}</div>
          <div class="wf-risk ${p.risk_level}">${p.risk_score} · ${p.risk_level.toUpperCase()}</div>
          <div class="wf-actions"><button data-pid="${p.id}">Open</button></div>
        </div>`).join('');
        q.querySelectorAll('button[data-pid]').forEach(b => b.onclick = () => openPersonnelModal(+b.dataset.pid));
      }
      // Alerts
      const a = document.getElementById('wf-alerts');
      if (a) {
        if (!r.alerts || !r.alerts.length) a.innerHTML = '<div class="muted small">No active alerts.</div>';
        else a.innerHTML = r.alerts.map(al => `<div class="wf-row" style="grid-template-columns: 100px 1fr 100px;">
          <div class="wf-risk ${al.severity}">${al.severity.toUpperCase()}</div>
          <div><strong>${escapeHtml(al.pseudo_id)}</strong> · ${escapeHtml(al.message)}<div class="muted small">${escapeHtml(al.reason||'')}</div></div>
          <div class="wf-actions"><button data-ack="${al.id}">Acknowledge</button></div>
        </div>`).join('');
        a.querySelectorAll('button[data-ack]').forEach(b => b.onclick = async () => {
          try { await api('/welfare/alerts/' + b.dataset.ack + '/ack', { method:'POST' }); refreshWelfareDashboard(); showToast('Alert acknowledged.'); } catch(_){}
        });
      }
    } catch(_){}
  };
  const openPersonnelModal = async (id) => {
    try {
      const r1 = await api('/personnel/' + id);
      const r2 = await api('/personnel/' + id + '/risk');
      const r3 = await api('/welfare/recommendations/' + id);
      const p = r1.profile, risk = r2.risk, recs = r3.recommendations || [];
      const html = `<div class="modal-card">
        <button class="modal-close" data-modal-close>×</button>
        <h3>${escapeHtml(p.pseudo_id)} · ${escapeHtml(p.rank||'')} · ${escapeHtml(p.unit||'')}</h3>
        <div class="muted small">${escapeHtml(p.role||'')} · ${p.service_years} years · ${p.duty_pattern||''}</div>
        <div style="margin-top:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
          <div class="welfare-stat"><div class="welfare-stat-num">${risk.current_score}</div><div class="welfare-stat-lbl">CURRENT</div></div>
          <div class="welfare-stat"><div class="welfare-stat-num">${risk.predicted_7d_score}</div><div class="welfare-stat-lbl">PREDICTED 7D</div></div>
          <div class="welfare-stat"><div class="welfare-stat-num">${risk.confidence}%</div><div class="welfare-stat-lbl">CONFIDENCE</div></div>
        </div>
        <div style="margin-top:14px;"><strong>Contributing signals</strong>
          <ul class="forecast-signals-list" style="margin-top:6px;">${(risk.contributing_signals||[]).map(s=>`<li class="${s.direction==='risk'?'risk':'protective'}">${s.direction==='risk'?'↑ ':'↓ '}${escapeHtml(s.label)} (${s.delta})</li>`).join('') || '<li class="muted small">None</li>'}</ul>
        </div>
        <div style="margin-top:14px;"><strong>Recommended welfare actions</strong>
          <ul style="margin-top:6px;padding-left:20px;">${recs.map(rc=>`<li><strong>${rc.priority.toUpperCase()}:</strong> ${escapeHtml(rc.action)} — <span class="muted small">${escapeHtml(rc.detail)}</span></li>`).join('') || '<li class="muted small">No recommendations.</li>'}</ul>
        </div>
      </div>`;
      openModal(html);
    } catch(_){}
  };

  /* ============================================================
     SIH 26186 — Commander Dashboard
     ============================================================ */
  const refreshCommanderDashboard = async () => {
    if (!user || !['commander','admin','welfare_officer'].includes(user.role)) return;
    try {
      const r = await api('/commander/dashboard');
      const stats = document.getElementById('cmd-stats');
      if (stats) {
        const t = r.totals || {};
        stats.innerHTML = `
          <div class="welfare-stat"><div class="welfare-stat-num">${t.personnel||0}</div><div class="welfare-stat-lbl">PERSONNEL</div></div>
          <div class="welfare-stat low"><div class="welfare-stat-num">${t.low||0}</div><div class="welfare-stat-lbl">LOW</div></div>
          <div class="welfare-stat moderate"><div class="welfare-stat-num">${t.moderate||0}</div><div class="welfare-stat-lbl">MODERATE</div></div>
          <div class="welfare-stat high"><div class="welfare-stat-num">${t.high||0}</div><div class="welfare-stat-lbl">HIGH</div></div>
          <div class="welfare-stat urgent"><div class="welfare-stat-num">${t.urgent||0}</div><div class="welfare-stat-lbl">URGENT</div></div>`;
      }
      const units = document.getElementById('cmd-units');
      if (units) {
        const list = r.units || [];
        units.innerHTML = list.map(u => `<div class="welfare-unit-row">
          <span>${escapeHtml(u.unit)}</span>
          <span>WL ${u.avg_workload} · REC ${u.avg_recovery}</span>
          <span>L${u.low||0} M${u.moderate||0} H${u.high||0} U${u.urgent||0}</span>
        </div>`).join('') || '<div class="muted small">No units</div>';
      }
      const drawTrend = (id, data, color) => {
        const el = document.getElementById(id); if (!el) return;
        if (!data || !data.length) { el.textContent = '—'; return; }
        const w = 280, h = 60, n = data.length;
        const step = w / Math.max(1, n - 1);
        const pts = data.map((d, i) => `${(i*step).toFixed(1)},${(h - ((d.v||0)/100)*h).toFixed(1)}`);
        const path = 'M' + pts.join(' L');
        el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
      };
      drawTrend('cmd-trend-mood', (r.trends && r.trends.mood) || [], '#62D8E8');
      drawTrend('cmd-trend-sleep', (r.trends && r.trends.sleep) || [], '#7B5FFF');
    } catch(_){}
  };

  /* ============================================================
     SIH 26186 — Mood tabs + chat wiring
     ============================================================ */
  $$ && $$('#mood-tabs .mood-tab') && $$('#mood-tabs .mood-tab').forEach && null; // noop guard
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('.mood-tab');
    if (t) refreshMoodHistory(t.dataset.range);
  });

  const init = () => {
    bindAuthOpen();
    bindAuthModal();
    renderAuth();
    bindCheckin();
    bindChat();
    renderScreening();
    bindScreening();
    bindVoice();
    bindRecovery();
    bindDebrief();
    bindCounsellorFilters();
    bindResourceFilters();
    bindResearchFilters();
    bindPrivacy();
    bindNotifications();
    bindRoom();
    bindModals();
    bindSoldierModal();
    bindNav();
    bindQuickReset();
    updateSoldierModeUI();

    // Soldier Instructor Manual Trigger
    const instBtn = $('#soldier-inst-btn');
    if (instBtn) instBtn.onclick = () => {
      // Manual trigger ignores the onboarding completion check
      const inst = $('#soldier-instructor');
      if (inst) {
        inst.classList.remove('hidden');
        // Reset to first slide when manually opening
        const slides = $$('.inst-slide');
        slides.forEach((s, i) => s.classList.toggle('hidden', i !== 0));
        $('#inst-prev').classList.add('hidden');
        $('#inst-next').textContent = slides.length > 1 ? 'Next' : 'Finish';

        // Since we modified showSoldierInstructor to handle the logic,
        // we need to make sure the buttons are wired.
        // But the wiring in showSoldierInstructor is only done when called.
        // Better to move the wiring to a separate function or just call showSoldierInstructor
        // and modify it to accept a 'force' parameter.
        showSoldierInstructor(true);
      }
    };

    // Wire up the synapse:open-game event for Quick Reset dashboard tiles.
    window.addEventListener('synapse:open-game', (e) => {
      const slug = e.detail && e.detail.slug;
      if (!slug) return;
      try {
        const grid = document.getElementById('game-grid');
        if (!grid) return;
        const titles = {
          'breathing-bubble': 'Breathing Bubble',
          'zen-tap': 'Zen Tap',
          'color-match': 'Color Match',
          'memory-garden': 'Memory Garden',
          'grounding-54321': 'Grounding 5-4-3-2-1',
          'calm-flow': 'Calm Flow',
          'target-blast': 'Target Blast',
          'stress-pop': 'Stress Pop',
          'focus-dot': 'Focus Dot'
        };
        const wanted = titles[slug];
        if (!wanted) return;
        const cards = grid.querySelectorAll('.game-card');
        for (const c of cards) {
          if ((c.querySelector('h4') || {}).textContent === wanted) {
            c.click();
            return;
          }
        }
      } catch (_) {}
    });
    loadCounsellors();
    loadResources();
    loadExercises();
    loadResearch();
    refreshAll();
    // Refresh notifications periodically
    setInterval(() => { if (user) loadNotifications(); }, 30000);
  };

  return { init };
})();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', App.init);
  } else {
    App.init();
  }
