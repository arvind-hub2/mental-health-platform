/* ============================================================
   SYNAPSE — Theme Customization + AI Cat Companion controller
   - Lightweight, vanilla, no dependencies.
   - Persists user choices in localStorage under "synapse_theme".
   - Controls the Cat state via data-cat-host attributes.
   - Exposes window.SynapseCat.setState(host, state) so existing
     app code can drive the cat from real application state.
   ============================================================ */
(function () {
  'use strict';

  const STORE_KEY = 'synapse_theme';

  /* ---------- Premium fluffy kitten SVG (reused 3×) ----------
     Single source of truth. Layered for depth: body silhouette,
     belly/chest fluff, face plate, ears with pink inner, eyes with
     specular highlight, pink nose, mouth, whiskers, fluffy tail. */
  const CAT_SVG = `
<svg class="cat-svg" viewBox="0 0 140 140" aria-hidden="true">
  <defs>
    <radialGradient id="fur-shade" cx="50%" cy="40%" r="65%">
      <stop offset="0%"  stop-color="#C9CFDA"/>
      <stop offset="55%" stop-color="#8C95A6"/>
      <stop offset="100%" stop-color="#4D5466"/>
    </radialGradient>
    <radialGradient id="fur-light" cx="50%" cy="35%" r="60%">
      <stop offset="0%"  stop-color="#FBFCFE"/>
      <stop offset="100%" stop-color="#E2E7EE"/>
    </radialGradient>
    <radialGradient id="eye-gloss" cx="50%" cy="50%" r="50%">
      <stop offset="0%"  stop-color="#3A4254"/>
      <stop offset="55%" stop-color="#1A2030"/>
      <stop offset="100%" stop-color="#0A0E18"/>
    </radialGradient>
    <radialGradient id="nose-pink" cx="50%" cy="40%" r="60%">
      <stop offset="0%"  stop-color="#FFB4C4"/>
      <stop offset="100%" stop-color="#E07590"/>
    </radialGradient>
    <linearGradient id="tail-fur" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#D6DBE4"/>
      <stop offset="100%" stop-color="#9AA3B2"/>
    </linearGradient>
    <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="0.6"/>
    </filter>
  </defs>

  <!-- Tail (fluffy, behind body) -->
  <g class="cat-tail">
    <path d="M104 108 Q126 96 118 72 Q116 64 110 68 Q116 86 100 96 Z"
          fill="url(#tail-fur)" stroke="#6B7384" stroke-width="0.6" opacity=".95"/>
    <path d="M104 108 Q126 96 118 72 Q116 64 110 68 Q116 86 100 96 Z"
          fill="#FBFCFE" opacity=".35"/>
  </g>

  <!-- Body (sitting kitten silhouette) -->
  <g class="cat-body">
    <ellipse cx="70" cy="116" rx="40" ry="18" fill="#6B7384" opacity=".35"/>
    <path d="M30 110 Q30 78 70 74 Q110 78 110 110 Q110 122 70 124 Q30 122 30 110 Z"
          fill="url(#fur-shade)"/>
    <!-- chest/belly fluff (white) -->
    <path d="M48 102 Q70 96 92 102 Q88 118 70 122 Q52 118 48 102 Z"
          fill="url(#fur-light)"/>
    <!-- subtle fur strokes for fluff -->
    <g stroke="#FBFCFE" stroke-width="0.6" opacity=".35" fill="none" stroke-linecap="round">
      <path d="M36 96 q4 -3 8 0"/><path d="M44 92 q4 -3 8 0"/>
      <path d="M88 92 q4 -3 8 0"/><path d="M96 96 q4 -3 8 0"/>
    </g>
  </g>

  <!-- Ears (grey outer, pink inner, fluffy tufts) -->
  <g class="cat-ear-l">
    <path d="M28 52 L18 18 Q22 14 30 22 L48 44 Z"
          fill="url(#fur-shade)" stroke="#5A6273" stroke-width="0.8" stroke-linejoin="round"/>
    <path d="M32 48 L26 24 Q28 22 34 28 L44 42 Z"
          fill="url(#nose-pink)" opacity=".9"/>
    <path d="M22 22 q3 -3 6 0" stroke="#FBFCFE" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".7"/>
  </g>
  <g class="cat-ear-r">
    <path d="M112 52 L122 18 Q118 14 110 22 L92 44 Z"
          fill="url(#fur-shade)" stroke="#5A6273" stroke-width="0.8" stroke-linejoin="round"/>
    <path d="M108 48 L114 24 Q112 22 106 28 L96 42 Z"
          fill="url(#nose-pink)" opacity=".9"/>
    <path d="M118 22 q-3 -3 -6 0" stroke="#FBFCFE" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".7"/>
  </g>

  <!-- Head -->
  <g class="cat-head">
    <circle cx="70" cy="58" r="32" fill="url(#fur-shade)"/>
    <!-- white muzzle/cheeks fluff -->
    <ellipse cx="70" cy="72" rx="22" ry="14" fill="url(#fur-light)"/>
    <!-- forehead tuft -->
    <path d="M64 30 q3 -6 6 -2 q3 -4 6 2" stroke="#5A6273" stroke-width="0.8" fill="none" opacity=".55"/>
  </g>

  <!-- Eyes -->
  <g class="cat-eye-l">
    <ellipse cx="56" cy="58" rx="5.2" ry="7" fill="url(#eye-gloss)"/>
    <ellipse cx="55.2" cy="55.5" rx="2" ry="2.6" fill="#FBFCFE" opacity=".95"/>
    <ellipse cx="57.8" cy="61" rx="1" ry="1.2" fill="#FBFCFE" opacity=".7"/>
  </g>
  <g class="cat-eye-r">
    <ellipse cx="84" cy="58" rx="5.2" ry="7" fill="url(#eye-gloss)"/>
    <ellipse cx="83.2" cy="55.5" rx="2" ry="2.6" fill="#FBFCFE" opacity=".95"/>
    <ellipse cx="85.8" cy="61" rx="1" ry="1.2" fill="#FBFCFE" opacity=".7"/>
  </g>

  <!-- Nose -->
  <path class="cat-nose" d="M67 68 Q70 65 73 68 Q72 72 70 72 Q68 72 67 68 Z"
        fill="url(#nose-pink)" stroke="#B25C77" stroke-width="0.5"/>

  <!-- Mouth (smiles shift slightly with state) -->
  <g class="cat-mouth">
    <path class="cat-mouth-base" d="M70 72 L70 76" stroke="#5A6273" stroke-width="1" stroke-linecap="round"/>
    <path class="cat-mouth-smile" d="M62 78 Q70 82 78 78" stroke="#5A6273" stroke-width="1.1" fill="none" stroke-linecap="round" opacity="0"/>
    <path class="cat-mouth-open" d="M65 75 Q70 82 75 75 Q72 80 68 80 Z" fill="#3A2030" opacity="0"/>
  </g>

  <!-- Whiskers -->
  <g class="cat-whiskers" stroke="#FBFCFE" stroke-width="0.8" stroke-linecap="round" opacity=".85">
    <line x1="34" y1="70" x2="52" y2="70"/>
    <line x1="34" y1="74" x2="52" y2="73"/>
    <line x1="106" y1="70" x2="88" y2="70"/>
    <line x1="106" y1="74" x2="88" y2="73"/>
  </g>

  <!-- Paws (white) -->
  <ellipse cx="48" cy="120" rx="8" ry="4" fill="url(#fur-light)" stroke="#C9CFDA" stroke-width="0.6"/>
  <ellipse cx="92" cy="120" rx="8" ry="4" fill="url(#fur-light)" stroke="#C9CFDA" stroke-width="0.6"/>
</svg>`;

  function injectCatSVG () {
    document.querySelectorAll('.synapse-cat').forEach(host => {
      if (host.querySelector('svg.cat-svg')) return;
      host.insertAdjacentHTML('beforeend', CAT_SVG);
      // Make sure the glow + listening ring exist
      if (!host.querySelector('.cat-glow')) {
        const g = document.createElement('div'); g.className = 'cat-glow';
        host.insertBefore(g, host.firstChild);
      }
      if (!host.querySelector('.cat-listening-ring')) {
        const r = document.createElement('span'); r.className = 'cat-listening-ring';
        host.appendChild(r);
      }
    });
  }

  /* ---------- Theme application ---------- */
  const DEFAULTS = {
    mode: 'dark',
    accent: 'cyan',
    accentRgb: '98,216,232',
    glass: 22,
    anim: 1,
    glassStrong: false,
    compact: false
  };
  const ACCENT_PRESETS = {
    cyan:   { rgb: '98,216,232', name: 'Cyan' },
    blue:   { rgb: '92,169,255', name: 'Blue' },
    violet: { rgb: '123,95,255', name: 'Violet' },
    mint:   { rgb: '98,216,170', name: 'Mint' },
    rose:   { rgb: '255,122,168', name: 'Rose' },
    amber:  { rgb: '217,164,65', name: 'Amber' }
  };

  function loadTheme () {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return Object.assign({}, DEFAULTS);
      return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (_) { return Object.assign({}, DEFAULTS); }
  }
  function saveTheme (t) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(t)); } catch (_) {}
  }
  function systemPrefersLight () {
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches; }
    catch (_) { return false; }
  }
  function effectiveMode (mode) {
    return mode === 'system' ? (systemPrefersLight() ? 'light' : 'dark') : mode;
  }
  function applyTheme (t) {
    const root = document.documentElement;
    const mode = effectiveMode(t.mode);
    root.setAttribute('data-theme', mode);
    root.setAttribute('data-accent', t.accent);
    root.setAttribute('data-anim', String(t.anim));
    root.style.setProperty('--synapse-accent-rgb', t.accentRgb || '98,216,232');
    root.style.setProperty('--synapse-glass-blur', t.glass + 'px');
    root.style.setProperty('--synapse-vintage-intensity', (t.glass - 6) / 30);
    root.style.setProperty('--synapse-anim-scale', t.anim === 0 ? '0.35' : (t.anim === 2 ? '1.6' : '1'));
    root.style.setProperty('--synapse-glass-alpha', t.glassStrong ? '.78' : '.55');
    root.classList.toggle('synapse-compact', !!t.compact);
  }

  /* ---------- Theme panel UI wiring ---------- */
  function wirePanel () {
    const trigger  = document.getElementById('theme-trigger');
    const panel    = document.getElementById('theme-panel');
    const backdrop = document.getElementById('theme-backdrop');
    const closeBtn = document.getElementById('theme-panel-close');
    if (!trigger || !panel) return;

    const modeSeg = document.getElementById('theme-mode-seg');
    const animSeg = document.getElementById('theme-anim-seg');
    const swatches = document.getElementById('theme-swatches');
    const glass = document.getElementById('theme-glass');
    const glassVal = document.getElementById('theme-glass-val');
    const animVal = document.getElementById('theme-anim-val');
    const accentName = document.getElementById('theme-accent-name');
    const strong = document.getElementById('theme-glass-strong');
    const compact = document.getElementById('theme-compact');
    const reset = document.getElementById('theme-reset');

    const t = loadTheme();
    applyTheme(t);
    reflect(t);

    function reflect (tt) {
      modeSeg && modeSeg.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === tt.mode);
      });
      animSeg && animSeg.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', String(b.dataset.anim) === String(tt.anim));
      });
      swatches && swatches.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.dataset.accent === tt.accent);
      });
      if (glass) glass.value = tt.glass;
      if (glassVal) glassVal.textContent = tt.glass + 'px';
      if (animVal) animVal.textContent = ['Low','Medium','High'][+tt.anim] || 'Medium';
      if (accentName) accentName.textContent = (ACCENT_PRESETS[tt.accent] || {}).name || tt.accent;
      if (strong) strong.checked = !!tt.glassStrong;
      if (compact) compact.checked = !!tt.compact;
    }

    function open (show) {
      const willOpen = typeof show === 'boolean' ? show : !panel.classList.contains('open');
      panel.classList.toggle('open', willOpen);
      if (backdrop) backdrop.classList.toggle('open', willOpen);
      trigger.setAttribute('aria-expanded', String(willOpen));
    }
    trigger.addEventListener('click', (e) => { e.preventDefault(); open(); });
    if (closeBtn) closeBtn.addEventListener('click', () => open(false));
    if (backdrop) backdrop.addEventListener('click', () => open(false));
    modeSeg && modeSeg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-mode]'); if (!b) return;
      const tt = loadTheme(); tt.mode = b.dataset.mode; saveTheme(tt); applyTheme(tt); reflect(tt);
    });
    animSeg && animSeg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-anim]'); if (!b) return;
      const tt = loadTheme(); tt.anim = +b.dataset.anim; saveTheme(tt); applyTheme(tt); reflect(tt);
    });
    swatches && swatches.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-accent]'); if (!b) return;
      const tt = loadTheme();
      tt.accent = b.dataset.accent;
      const preset = ACCENT_PRESETS[tt.accent];
      if (preset) tt.accentRgb = preset.rgb;
      saveTheme(tt); applyTheme(tt); reflect(tt);
    });
    glass && glass.addEventListener('input', () => {
      const tt = loadTheme(); tt.glass = +glass.value; saveTheme(tt); applyTheme(tt); reflect(tt);
    });
    strong && strong.addEventListener('change', () => {
      const tt = loadTheme(); tt.glassStrong = !!strong.checked; saveTheme(tt); applyTheme(tt);
    });
    compact && compact.addEventListener('change', () => {
      const tt = loadTheme(); tt.compact = !!compact.checked; saveTheme(tt); applyTheme(tt);
    });
    reset && reset.addEventListener('click', () => {
      saveTheme(Object.assign({}, DEFAULTS));
      const tt = loadTheme(); applyTheme(tt); reflect(tt);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('open')) open(false);
    });
  }

  /* ---------- AI Cat companion controller ---------- */
  const STATE_CLASSES = [
    'is-listening',
    'is-user-speaking',
    'is-thinking',
    'is-speaking',
    'is-happy',
    'is-error'
  ];

  const CAPTIONS = {
    idle: 'SYNAPSE · IDLE',
    listening: 'SYNAPSE · LISTENING…',
    'user-speaking': 'SYNAPSE · HEARING YOU',
    thinking: 'SYNAPSE · THINKING',
    speaking: 'SYNAPSE · SPEAKING',
    happy: 'SYNAPSE · GLAD TO HELP',
    error: 'SYNAPSE · OFFLINE',
    friend: 'SYNAPSE · HERE FOR YOU',
    'friend-listening': 'SYNAPSE · LISTENING',
    'friend-thinking': 'SYNAPSE · REFLECTING',
    'friend-speaking': 'SYNAPSE · SUPPORTING YOU',
    'friend-happy': 'SYNAPSE · GLAD TO HELP'
  };

  function setCatState (host, state) {
    const el = document.querySelector('[data-cat-host="' + host + '"]');
    if (!el) return;
    STATE_CLASSES.forEach(c => el.classList.remove(c));
    if (state && state !== 'idle') el.classList.add('is-' + state);
    const cap = document.getElementById(host + '-cat-caption')
             || (el.parentElement && el.parentElement.querySelector('.cat-caption'));
    if (cap) cap.textContent = CAPTIONS[state] || CAPTIONS.idle;
    // Brief happy pulse after speaking transitions
    if (state === 'speaking') {
      clearTimeout(el._happyT);
      el._happyT = setTimeout(() => setCatState(host, 'happy'), 1800);
    }
    if (state === 'idle' || state === 'friend') {
      clearTimeout(el._happyT);
    }
  }

  // Public API so app.js (and any other code) can drive the cat from real state.
  window.SynapseCat = {
    setState: setCatState,
    reset (host) { setCatState(host, 'idle'); },
    hosts () { return Array.from(document.querySelectorAll('.synapse-cat')).map(el => el.dataset.catHost); }
  };

  /* Hook into existing Voice AI orb states. */
  function watchVoice () {
    const orb = document.getElementById('voice-orb');
    if (!orb) return;
    const sync = () => {
      const cls = orb.className || '';
      if (cls.indexOf('listening') > -1)             setCatState('voice', 'listening');
      else if (cls.indexOf('thinking') > -1)        setCatState('voice', 'thinking');
      else if (cls.indexOf('speaking') > -1)        setCatState('voice', 'speaking');
      else if (cls.indexOf('recording_sample') > -1) setCatState('voice', 'user-speaking');
      else                                          setCatState('voice', 'idle');
    };
    sync();
    setInterval(sync, 250);
  }

  function watchFriend () {
    const form = document.getElementById('ai-friend-form');
    const conv = document.getElementById('ai-friend-conv');

    function onUserSend () {
      setCatState('friend', 'user-speaking');
      setTimeout(() => setCatState('friend', 'thinking'), 800);
    }
    function onAssistantReply () {
      setCatState('friend', 'speaking');
      // 'speaking' transitions to 'happy' automatically after a short pause
    }

    if (form) form.addEventListener('submit', () => onUserSend(), true);
    if (conv) {
      const mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const n of m.addedNodes) {
            if (!(n instanceof HTMLElement)) continue;
            if (n.classList.contains('ai-msg') && n.classList.contains('assistant')) {
              onAssistantReply();
            }
          }
        }
      });
      mo.observe(conv, { childList: true });
    }
    setCatState('friend', 'idle');
  }

  function watchPanel () {
    const form = document.getElementById('ai-friend-panel-form');
    const typing = document.getElementById('ai-friend-panel-typing');
    const conv = document.getElementById('ai-friend-panel-conv');
    if (!form) return;

    const onUserSend = () => {
      setCatState('panel', 'listening');
      setTimeout(() => setCatState('panel', 'thinking'), 600);
    };
    const onAssistantReply = () => {
      setCatState('panel', 'speaking');
    };
    form.addEventListener('submit', () => onUserSend(), true);
    if (typing) {
      const mo = new MutationObserver(() => {
        if (!typing.classList.contains('hidden')) setCatState('panel', 'thinking');
      });
      mo.observe(typing, { attributes: true, attributeFilter: ['class'] });
    }
    if (conv) {
      const mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const n of m.addedNodes) {
            if (!(n instanceof HTMLElement)) continue;
            if (n.classList.contains('ai-msg') && n.classList.contains('assistant')) {
              onAssistantReply();
            }
          }
        }
      });
      mo.observe(conv, { childList: true });
    }
    setCatState('panel', 'idle');
  }

  /* ---------- Init ---------- */
  function ready (fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  ready(() => {
    injectCatSVG();
    wirePanel();
    watchVoice();
    watchFriend();
    watchPanel();
    // Initial states
    setCatState('voice', 'idle');
    setCatState('friend', 'friend');
    setCatState('panel', 'idle');
  });
})();
