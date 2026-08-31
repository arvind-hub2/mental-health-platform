/* SYNAPSE — Mindful Games
   Calm, non-competitive, browser-only stress-reduction exercises.
   No external APIs. Honors prefers-reduced-motion. Keyboard accessible.

   9 games:
   1. Breathing Bubble  · animated orb with 1/3/5 min options
   2. Zen Tap           · tap glowing targets
   3. Color Match       · match the target color (NEW)
   4. Memory Garden     · themed memory match with difficulty (UPGRADED)
   5. Grounding 5-4-3-2-1
   6. Calm Flow         · interactive particles
   7. Target Blast      · arcade target clearing (NEW)
   8. Stress Pop        · bubble popping (NEW)
   9. Focus Dot         · with 1/3/5 min options
*/
(function () {
  'use strict';

  const GAMES = [
    {
      slug: 'breathing-bubble',
      title: 'Breathing Bubble',
      tagline: 'A gentle orb that breathes with you.',
      durationLabel: '1 / 3 / 5 min',
      icon: '🫧',
      accent: 'cyan',
      render: (stage, onComplete, onCancel) => renderBreathingBubble(stage, onComplete, onCancel)
    },
    {
      slug: 'zen-tap',
      title: 'Zen Tap',
      tagline: 'Tap glowing targets as they bloom.',
      durationLabel: '90 sec',
      icon: '✨',
      accent: 'purple',
      render: renderZenTap
    },
    {
      slug: 'color-match',
      title: 'Color Match',
      tagline: 'Find the colour that matches.',
      durationLabel: '1–3 min',
      icon: '🎨',
      accent: 'pink',
      render: renderColorMatch
    },
    {
      slug: 'memory-garden',
      title: 'Memory Garden',
      tagline: 'Train your recall peacefully.',
      durationLabel: '2–5 min',
      icon: '🌸',
      accent: 'green',
      render: renderMemoryGarden
    },
    {
      slug: 'grounding-54321',
      title: 'Grounding 5-4-3-2-1',
      tagline: 'Anchor yourself in what your senses can reach.',
      durationLabel: '3–5 min',
      icon: '🌿',
      accent: 'green',
      render: renderGrounding
    },
    {
      slug: 'calm-flow',
      title: 'Calm Flow',
      tagline: 'Move your attention with the current.',
      durationLabel: '90 sec',
      icon: '🌊',
      accent: 'cyan',
      render: renderCalmFlow
    },
    {
      slug: 'target-blast',
      title: 'Target Blast',
      tagline: 'Clear the clutter. Reset your focus.',
      durationLabel: '30 sec / endless',
      icon: '🎯',
      accent: 'orange',
      render: renderTargetBlast
    },
    {
      slug: 'stress-pop',
      title: 'Stress Pop',
      tagline: 'Pop bubbles. Release tension.',
      durationLabel: '30 sec / relax',
      icon: '🫧',
      accent: 'pink',
      render: renderStressPop
    },
    {
      slug: 'focus-dot',
      title: 'Focus Dot',
      tagline: 'A slow rhythm for tired eyes.',
      durationLabel: '1 / 3 / 5 min',
      icon: '🟣',
      accent: 'purple',
      render: (stage, onComplete, onCancel) => renderFocusDot(stage, onComplete, onCancel)
    }
  ];

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const k of Object.keys(attrs)) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'style') e.setAttribute('style', attrs[k]);
      else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      e.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return e;
  }

  /* ---------- Stats ---------- */
  const LS_KEY = 'synapse_mindful_stats';
  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; }
    catch (_) { return {}; }
  }
  function lsWrite(stats) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(stats)); } catch (_) {}
  }
  async function trackSession(slug, durationSec, completed, score) {
    const s = lsRead();
    s[slug] = s[slug] || { played: 0, completed: 0, total_sec: 0, best_score: 0 };
    s[slug].played += 1;
    s[slug].total_sec += durationSec;
    if (completed) s[slug].completed += 1;
    if ((score || 0) > (s[slug].best_score || 0)) s[slug].best_score = score || 0;
    lsWrite(s);
    try {
      const tok = localStorage.getItem('synapse_token');
      if (tok) {
        await fetch('/api/mindful/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': tok },
          body: JSON.stringify({ game_slug: slug, duration_sec: durationSec, completed: !!completed, score: score || 0 })
        });
      }
    } catch (_) {}
  }

  /* ---------- Difficulty selector helper ---------- */
  function difficultyRow(options, onChange, current) {
    const row = el('div', { class: 'g-diff-row', role: 'radiogroup', 'aria-label': 'Difficulty' });
    options.forEach((o) => {
      const b = el('button', {
        class: 'g-diff-pill' + (o.value === current ? ' active' : ''),
        'aria-pressed': o.value === current ? 'true' : 'false',
        onclick: () => {
          row.querySelectorAll('.g-diff-pill').forEach(p => { p.classList.remove('active'); p.setAttribute('aria-pressed', 'false'); });
          b.classList.add('active');
          b.setAttribute('aria-pressed', 'true');
          onChange(o.value);
        }
      }, o.label);
      row.appendChild(b);
    });
    return row;
  }

  function durationRow(options, onChange, current) {
    const row = el('div', { class: 'g-diff-row', role: 'radiogroup', 'aria-label': 'Duration' });
    options.forEach((o) => {
      const b = el('button', {
        class: 'g-diff-pill' + (o.value === current ? ' active' : ''),
        'aria-pressed': o.value === current ? 'true' : 'false',
        onclick: () => {
          row.querySelectorAll('.g-diff-pill').forEach(p => { p.classList.remove('active'); p.setAttribute('aria-pressed', 'false'); });
          b.classList.add('active');
          b.setAttribute('aria-pressed', 'true');
          onChange(o.value);
        }
      }, o.label);
      row.appendChild(b);
    });
    return row;
  }

  /* ---------- Card grid ---------- */
  function card(g, onPlay) {
    return el('button', {
      class: 'game-card accent-' + (g.accent || 'cyan'),
      onclick: onPlay,
      'aria-label': 'Play ' + g.title
    },
      el('div', { class: 'game-thumb' },
        el('div', { class: 'game-icon' }, g.icon),
        el('div', { class: 'game-thumb-glow' })
      ),
      el('div', { class: 'game-meta' },
        el('h4', {}, g.title),
        el('p', { class: 'muted small' }, g.tagline),
        el('div', { class: 'game-meta-foot' },
          el('span', { class: 'game-dur' }, g.durationLabel || '')
        )
      ),
      el('span', { class: 'game-play-cta' }, 'Play →')
    );
  }

  function renderGrid() {
    const grid = document.getElementById('game-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (const g of GAMES) {
      const c = card(g, () => openGame(g));
      grid.appendChild(c);
    }
    renderStats();
  }

  function renderStats() {
    const elStats = document.getElementById('mindful-stats');
    if (!elStats) return;
    const s = lsRead();
    const played = Object.values(s).reduce((a, b) => a + (b.played || 0), 0);
    const completed = Object.values(s).reduce((a, b) => a + (b.completed || 0), 0);
    const totalMin = Math.round(Object.values(s).reduce((a, b) => a + (b.total_sec || 0), 0) / 60);
    let fav = null; let best = 0;
    for (const k of Object.keys(s)) {
      if ((s[k].played || 0) > best) { best = s[k].played; fav = k; }
    }
    const favTitle = (fav && GAMES.find(g => g.slug === fav)?.title) || '—';
    elStats.innerHTML = `
      <div class="rs-cell"><div class="rs-num">${played}</div><div class="rs-lbl">Sessions played</div></div>
      <div class="rs-cell"><div class="rs-num">${completed}</div><div class="rs-lbl">Completed</div></div>
      <div class="rs-cell"><div class="rs-num">${totalMin}</div><div class="rs-lbl">Calm minutes</div></div>
      <div class="rs-cell"><div class="rs-num">${favTitle}</div><div class="rs-lbl">Favourite</div></div>
    `;
  }

  /* ---------- Player ---------- */
  let playerTimer = null;
  let playerStart = 0;
  let playerScore = 0;
  let playerActiveGame = null;

  function openGame(g) {
    const player = document.getElementById('game-player');
    const stage = document.getElementById('game-stage');
    const sub = document.getElementById('game-player-sub');
    const title = document.getElementById('game-player-title');
    if (!player || !stage) return;
    title.textContent = g.title;
    if (sub) sub.textContent = g.tagline;
    stage.innerHTML = '';
    player.classList.remove('hidden');
    player.scrollIntoView({ behavior: 'smooth', block: 'start' });
    playerStart = Date.now();
    playerScore = 0;
    playerActiveGame = g;
    if (playerTimer) clearInterval(playerTimer);
    playerTimer = setInterval(() => {
      const t = document.getElementById('game-player-timer');
      if (t) t.textContent = fmt(Date.now() - playerStart);
    }, 500);
    try { g.render(stage, (score) => finishGame(g.slug, true, score), () => finishGame(g.slug, false, 0)); }
    catch (e) { console.error('game render failed', e); stage.innerHTML = '<p class="muted small">This game could not start.</p>'; }
  }

  async function finishGame(slug, completed, score) {
    if (playerTimer) { clearInterval(playerTimer); playerTimer = null; }
    const dur = Math.round((Date.now() - playerStart) / 1000);
    await trackSession(slug, dur, completed, score || 0);
    const stage = document.getElementById('game-stage');
    if (stage) {
      stage.innerHTML = `
        <div class="game-complete">
          <div class="game-complete-orb"></div>
          <h4>${completed ? 'Nicely done.' : 'Take a breath.'}</h4>
          <p class="muted small">${dur}s of calm practice${score ? ' · score ' + score : ''}. Step away when you feel ready.</p>
          <button class="btn ghost" id="game-close">Close</button>
        </div>
      `;
      const c = document.getElementById('game-close');
      if (c) c.onclick = closeGame;
    }
    renderStats();
  }

  function closeGame() {
    const p = document.getElementById('game-player');
    if (p) p.classList.add('hidden');
    if (playerTimer) { clearInterval(playerTimer); playerTimer = null; }
  }

  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  }

  /* ============================================================
     1. Breathing Bubble — with 1/3/5 min duration
     ============================================================ */
  function renderBreathingBubble(stage, onComplete, onCancel) {
    const box = el('div', { class: 'bubble-stage' });
    const orb = el('div', { class: 'breath-orb large', tabindex: '0', 'aria-label': 'Breathing orb' });
    const txt = el('div', { class: 'breath-text' }, 'READY');
    const len = el('div', { class: 'muted small' }, '4s in · 4s hold · 6s out');
    const stop = el('button', { class: 'btn ghost small', style: 'margin-top:16px' }, 'End session');
    const ctl = el('div', { class: 'g-controls' });
    const dur = durationRow([
      { value: 60, label: '1 min' },
      { value: 180, label: '3 min' },
      { value: 300, label: '5 min' }
    ], () => {
      const sec = parseInt(ctl.dataset.seconds || '60', 10);
      // Restart cycle with new total time.
      stopped = true;
      setTimeout(() => renderBreathingBubble(stage, onComplete, onCancel), 0);
      ctl.dataset.seconds = String(sec);
    }, 60);
    ctl.appendChild(dur);
    ctl.dataset.seconds = '60';
    box.appendChild(orb); box.appendChild(txt); box.appendChild(len); box.appendChild(ctl); box.appendChild(stop);
    stage.appendChild(box);

    const cycle = [{ n: 'INHALE', d: 4000 }, { n: 'HOLD', d: 4000 }, { n: 'EXHALE', d: 6000 }];
    let i = 0, cycles = 0, totalSec = 60;
    let stopped = false;
    let startedAt = Date.now();

    function step() {
      if (stopped) return;
      const elapsed = (Date.now() - startedAt) / 1000;
      if (elapsed >= totalSec) {
        stopped = true;
        txt.textContent = 'COMPLETE';
        orb.className = 'breath-orb large complete';
        return onComplete && onComplete(0);
      }
      const c = cycle[i];
      txt.textContent = c.n;
      orb.className = 'breath-orb large ' + c.n.toLowerCase();
      i = (i + 1) % cycle.length;
      if (i === 0) cycles += 1;
      setTimeout(step, c.d);
    }
    setTimeout(step, 600);
    stop.onclick = () => { stopped = true; onCancel && onCancel(); };
  }

  /* ============================================================
     2. Zen Tap
     ============================================================ */
  function renderZenTap(stage, onComplete) {
    const box = el('div', { class: 'zen-stage' });
    const score = el('div', { class: 'muted small zen-score' }, 'Calm taps: 0');
    const ctl = el('div', { class: 'g-controls' });
    const mode = durationRow([
      { value: 'classic', label: 'Classic' },
      { value: 'relax', label: 'Relax (no score)' }
    ], () => {}, 'classic');
    ctl.appendChild(mode);
    box.appendChild(score); box.appendChild(ctl);
    stage.appendChild(box);
    let taps = 0; let spawned = 0; const total = 8;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function spawn() {
      if (spawned >= total) return;
      const target = el('button', { class: 'zen-target', 'aria-label': 'Calm target' });
      const x = 10 + Math.random() * 80;
      const y = 10 + Math.random() * 80;
      target.style.left = x + '%';
      target.style.top = y + '%';
      target.style.background = `radial-gradient(circle at 30% 30%, rgba(217,164,65,.95), rgba(98,216,232,.4))`;
      if (!reduce) target.style.transition = 'transform 800ms ease, opacity 800ms ease';
      target.onclick = () => {
        taps += 1; spawned += 1;
        if (mode.dataset.mode !== 'relax') score.textContent = 'Calm taps: ' + taps;
        target.remove();
        if (spawned >= total) {
          setTimeout(() => onComplete && onComplete(taps), 400);
        } else {
          setTimeout(spawn, 700 + Math.random() * 700);
        }
      };
      box.appendChild(target);
      requestAnimationFrame(() => { target.style.opacity = '1'; target.style.transform = 'scale(1)'; });
    }
    mode.dataset.mode = 'classic';
    setTimeout(spawn, 200);
    if (!reduce) setTimeout(spawn, 800);
  }

  /* ============================================================
     3. Color Match (NEW)
     ============================================================ */
  function renderColorMatch(stage, onComplete) {
    const box = el('div', { class: 'cm-stage' });
    stage.appendChild(box);

    const palette = [
      { name: 'Sky',     hex: '#62d8e8' },
      { name: 'Coral',   hex: '#ff8a7a' },
      { name: 'Mint',    hex: '#7ee0b8' },
      { name: 'Sun',     hex: '#ffd166' },
      { name: 'Lilac',   hex: '#c8a4ff' },
      { name: 'Rose',    hex: '#ff7eb6' },
      { name: 'Sea',     hex: '#5aa9ff' },
      { name: 'Lime',    hex: '#b3f36b' }
    ];

    let streak = 0; let best = 0; let score = 0; let round = 0; const maxRounds = 10;
    let difficulty = 'medium';

    const target = el('div', { class: 'cm-target' });
    const name = el('div', { class: 'cm-target-name' });
    const big = el('div', { class: 'cm-target-swatch', 'aria-label': 'Target colour' });
    target.appendChild(big); target.appendChild(name);

    const status = el('div', { class: 'cm-status muted small' }, 'Pick the matching colour.');

    const choices = el('div', { class: 'cm-choices' });

    const ctl = el('div', { class: 'g-controls' });
    const diff = difficultyRow([
      { value: 'easy', label: 'Easy' },
      { value: 'medium', label: 'Medium' },
      { value: 'hard', label: 'Hard' }
    ], () => {
      difficulty = ctl.querySelector('.g-diff-pill.active')?.textContent?.toLowerCase() || 'medium';
      nextRound();
    }, 'medium');
    ctl.appendChild(diff);

    box.appendChild(target);
    box.appendChild(status);
    box.appendChild(choices);
    box.appendChild(ctl);

    function nextRound() {
      if (round >= maxRounds) return finish();
      round += 1;
      const n = difficulty === 'easy' ? 3 : difficulty === 'hard' ? 6 : 4;
      const pool = palette.slice().sort(() => Math.random() - 0.5).slice(0, n);
      const correctIdx = Math.floor(Math.random() * pool.length);
      const correct = pool[correctIdx];
      big.style.background = correct.hex;
      name.textContent = correct.name;
      status.textContent = `Round ${round}/${maxRounds} · streak ${streak}`;
      choices.innerHTML = '';
      pool.forEach((c) => {
        const b = el('button', {
          class: 'cm-choice',
          'aria-label': 'Pick ' + c.name,
          style: 'background:' + c.hex
        });
        b.onclick = () => onPick(b, c, correct);
        choices.appendChild(b);
      });
    }
    function onPick(btn, picked, correct) {
      const ok = picked.hex === correct.hex;
      if (ok) {
        score += (difficulty === 'hard' ? 3 : difficulty === 'easy' ? 1 : 2);
        streak += 1;
        if (streak > best) best = streak;
        btn.classList.add('cm-correct');
      } else {
        streak = 0;
        btn.classList.add('cm-wrong');
      }
      setTimeout(nextRound, ok ? 380 : 700);
    }
    function finish() {
      status.textContent = 'Done. Score ' + score + ' · best streak ' + best;
      return onComplete && onComplete(score);
    }
    nextRound();
  }

  /* ============================================================
     4. Memory Garden (UPGRADED Memory Match)
     Themes: nature / planets / abstract / peaceful
     Difficulty: easy / medium / hard
     ============================================================ */
  function renderMemoryGarden(stage, onComplete) {
    const themes = {
      nature:   ['🌿','🌸','🍃','🌼','🌻','🍂','🌷','🌳','🌾','🌰','🍀','🌺'],
      planets:  ['☿','♀','⊕','♂','♃','♄','♅','♆','🌑','🌒','🌓','🌔'],
      abstract: ['◐','◑','◒','◓','◆','◇','▲','▼','✦','✧','✪','✺'],
      peaceful: ['◯','◇','△','□','☆','✦','☾','☼','♢','♤','♡','♧']
    };
    let difficulty = 'medium';
    let theme = 'peaceful';

    const box = el('div', { class: 'mg-stage' });
    const status = el('div', { class: 'muted small mg-status' }, 'Find the pairs.');
    const grid = el('div', { class: 'memory-grid' });

    const ctl = el('div', { class: 'g-controls' });
    const diff = difficultyRow([
      { value: 'easy', label: 'Easy (8)' },
      { value: 'medium', label: 'Medium (12)' },
      { value: 'hard', label: 'Hard (16)' }
    ], () => {
      difficulty = ctl.querySelector('.g-diff-pill.active')?.dataset.value || 'medium';
      restart();
    }, 'medium');
    diff.querySelectorAll('.g-diff-pill').forEach(p => p.setAttribute('data-value', p.textContent.split(' ')[0].toLowerCase()));
    const themeRow = durationRow([
      { value: 'peaceful', label: '🌙 Peaceful' },
      { value: 'nature', label: '🌿 Nature' },
      { value: 'planets', label: '🪐 Planets' },
      { value: 'abstract', label: '◆ Abstract' }
    ], () => {
      theme = ctl.querySelectorAll('.g-diff-row')[1].querySelector('.g-diff-pill.active')?.dataset.value || 'peaceful';
      restart();
    }, 'peaceful');
    themeRow.querySelectorAll('.g-diff-pill').forEach(p => p.setAttribute('data-value', p.textContent.split(' ').slice(1).join(' ').toLowerCase()));
    ctl.appendChild(diff);
    ctl.appendChild(themeRow);
    box.appendChild(status); box.appendChild(grid); box.appendChild(ctl);
    stage.appendChild(box);

    let flipped = []; let matched = 0; let locked = false; let moves = 0;

    function restart() {
      flipped = []; matched = 0; locked = false; moves = 0;
      const pairs = difficulty === 'easy' ? 4 : difficulty === 'hard' ? 8 : 6;
      const set = themes[theme] || themes.peaceful;
      const chosen = set.slice(0, pairs);
      const cards = chosen.concat(chosen).slice(0, pairs * 2).sort(() => Math.random() - 0.5);
      grid.innerHTML = '';
      grid.style.gridTemplateColumns = `repeat(${pairs <= 4 ? 4 : pairs <= 6 ? 4 : 4}, 1fr)`;
      cards.forEach((s, i) => {
        const c = el('button', { class: 'memory-card', 'aria-label': 'Card ' + (i+1) });
        const front = el('div', { class: 'memory-front' }, s);
        const back  = el('div', { class: 'memory-back' }, '·');
        c.appendChild(back); c.appendChild(front);
        c.onclick = () => {
          if (locked || c.classList.contains('flipped') || c.classList.contains('matched')) return;
          c.classList.add('flipped');
          flipped.push({ c, s });
          if (flipped.length === 2) {
            moves += 1;
            if (flipped[0].s === flipped[1].s) {
              flipped.forEach(o => o.c.classList.add('matched'));
              matched += 1;
              flipped = [];
              if (matched === pairs) {
                status.textContent = `All pairs found · ${moves} moves.`;
                setTimeout(() => onComplete && onComplete(Math.max(0, 100 - moves)), 800);
              }
            } else {
              locked = true;
              setTimeout(() => {
                flipped.forEach(o => o.c.classList.remove('flipped'));
                flipped = [];
                locked = false;
              }, 900);
            }
          }
        };
        grid.appendChild(c);
      });
    }
    restart();
  }

  /* ============================================================
     5. Grounding 5-4-3-2-1
     ============================================================ */
  function renderGrounding(stage, onComplete) {
    const steps = [
      { n: 5, label: 'things you can SEE', placeholder: 'name one…' },
      { n: 4, label: 'things you can FEEL', placeholder: 'a texture, a sensation…' },
      { n: 3, label: 'things you can HEAR', placeholder: 'a sound…' },
      { n: 2, label: 'things you can SMELL', placeholder: 'a scent…' },
      { n: 1, label: 'thing you can TASTE', placeholder: 'a flavour…' }
    ];
    const wrap = el('div', { class: 'grounding-stage' });
    const progress = el('div', { class: 'grounding-progress' });
    const heading = el('h4', {}, 'Take your time.');
    const note = el('p', { class: 'muted small' }, 'Name each one. There is no rush.');
    const input = el('input', { type: 'text', placeholder: 'start here…', 'aria-label': 'Grounding response' });
    const list = el('ul', { class: 'grounding-list' });
    const next = el('button', { class: 'btn primary small' }, 'Next');
    wrap.appendChild(progress); wrap.appendChild(heading); wrap.appendChild(note);
    wrap.appendChild(input); wrap.appendChild(list); wrap.appendChild(next);
    stage.appendChild(wrap);

    let stepIdx = 0; let count = 0;
    function refresh() {
      const s = steps[stepIdx];
      heading.textContent = `Name ${s.n} ${s.label}.`;
      note.textContent = `${count}/${s.n}`;
      progress.innerHTML = steps.map((_, i) => `<span class="g-dot ${i < stepIdx ? 'done' : (i === stepIdx ? 'cur' : '')}"></span>`).join('');
    }
    function addItem() {
      const v = input.value.trim();
      if (!v) return;
      list.appendChild(el('li', {}, v));
      input.value = '';
      count += 1;
      const s = steps[stepIdx];
      if (count >= s.n) {
        stepIdx += 1; count = 0; list.innerHTML = '';
        if (stepIdx >= steps.length) {
          heading.textContent = 'Grounding complete';
          note.textContent = 'Notice how the room feels now.';
          input.style.display = 'none';
          next.textContent = 'Finish';
        } else {
          refresh();
        }
      } else {
        refresh();
      }
    }
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
    next.onclick = () => {
      if (stepIdx >= steps.length) return onComplete && onComplete(0);
      addItem();
    };
    refresh();
  }

  /* ============================================================
     6. Calm Flow
     ============================================================ */
  function renderCalmFlow(stage, onComplete) {
    const box = el('div', { class: 'flow-stage' });
    const hint = el('div', { class: 'muted small flow-hint' }, 'Follow a single orb with your eyes. Move your cursor to disturb the field.');
    const canvas = document.createElement('canvas');
    canvas.className = 'flow-canvas';
    canvas.setAttribute('aria-label', 'Calm flow particles');
    box.appendChild(canvas); box.appendChild(hint);
    stage.appendChild(box);

    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, mx = 0.5, my = 0.5;
    function fit() {
      const r = box.getBoundingClientRect();
      w = canvas.width = r.width; h = canvas.height = Math.min(360, r.height || 360);
    }
    fit();
    window.addEventListener('resize', fit);
    box.addEventListener('mousemove', (e) => {
      const r = box.getBoundingClientRect();
      mx = (e.clientX - r.left) / r.width;
      my = (e.clientY - r.top) / r.height;
    });
    box.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches[0]) {
        const r = box.getBoundingClientRect();
        mx = (e.touches[0].clientX - r.left) / r.width;
        my = (e.touches[0].clientY - r.top) / r.height;
      }
    });
    const dots = Array.from({ length: 32 }, () => ({
      x: Math.random(), y: Math.random(),
      r: 1 + Math.random() * 2.5,
      a: 0.15 + Math.random() * 0.4,
      vx: (Math.random() - 0.5) * 0.0008,
      vy: (Math.random() - 0.5) * 0.0008
    }));
    let t = 0;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf;
    function tick() {
      ctx.clearRect(0, 0, w, h);
      const cx = w * mx;
      const cy = h * my;
      for (const d of dots) {
        d.x += d.vx; d.y += d.vy;
        if (d.x < 0) d.x = 1; if (d.x > 1) d.x = 0;
        if (d.y < 0) d.y = 1; if (d.y > 1) d.y = 0;
        const dx = (d.x * w) - cx; const dy = (d.y * h) - cy;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const a = Math.max(0.04, d.a - dist / 1200);
        ctx.beginPath();
        ctx.fillStyle = `rgba(98,216,232,${a})`;
        ctx.arc(d.x * w, d.y * h, d.r * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.fillStyle = 'rgba(255,209,102,0.85)';
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = 'rgba(255,209,102,0.6)';
      ctx.shadowBlur = 16;
      ctx.fill();
      ctx.shadowBlur = 0;
      t += 16;
      raf = requestAnimationFrame(tick);
    }
    if (!reduce) tick();
    else { tick(); cancelAnimationFrame(raf); }
    setTimeout(() => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
      onComplete && onComplete(0);
    }, 90000);
  }

  /* ============================================================
     7. Target Blast (NEW) — abstract arcade target clearing
     No violence. Glowing orbs only. 30s / endless modes.
     ============================================================ */
  function renderTargetBlast(stage, onComplete) {
    const box = el('div', { class: 'tb-stage' });
    const hud = el('div', { class: 'tb-hud' });
    const score = el('span', { class: 'tb-score' }, 'Score 0');
    const combo = el('span', { class: 'tb-combo' }, 'Combo ×0');
    const timer = el('span', { class: 'tb-timer' }, '');
    hud.appendChild(score); hud.appendChild(combo); hud.appendChild(timer);
    const field = el('div', { class: 'tb-field' });
    const ctl = el('div', { class: 'g-controls' });
    const mode = durationRow([
      { value: 'thirty', label: '30 sec' },
      { value: 'endless', label: 'Endless relax' }
    ], () => {}, 'thirty');
    ctl.appendChild(mode);
    box.appendChild(hud); box.appendChild(field); box.appendChild(ctl);
    stage.appendChild(box);

    let s = 0, c = 1, lastHit = 0, active = true;
    let timeLeft = 30;
    const targets = [];
    const colors = ['#62d8e8', '#ff8a7a', '#ffd166', '#c8a4ff', '#7ee0b8', '#ff7eb6'];

    function spawnTarget() {
      if (!active) return;
      const t = el('button', { class: 'tb-target', 'aria-label': 'Clear target' });
      const size = 28 + Math.random() * 36;
      const x = 4 + Math.random() * 90;
      const y = 6 + Math.random() * 80;
      t.style.width = size + 'px';
      t.style.height = size + 'px';
      t.style.left = x + '%';
      t.style.top = y + '%';
      t.style.background = `radial-gradient(circle at 30% 30%, ${colors[Math.floor(Math.random() * colors.length)]}, rgba(7,17,31,0.0))`;
      t.style.animation = `tbFloat ${3000 + Math.random() * 3000}ms ease-in-out infinite`;
      const onHit = () => {
        if (!active || t.classList.contains('hit')) return;
        t.classList.add('hit');
        s += 10;
        const now = Date.now();
        if (now - lastHit < 1100) c += 1; else c = 1;
        lastHit = now;
        score.textContent = 'Score ' + s;
        combo.textContent = 'Combo ×' + c;
        burst(field, t);
        setTimeout(() => { t.remove(); spawnTarget(); }, 250);
      };
      t.onclick = onHit;
      t.ontouchstart = (e) => { e.preventDefault(); onHit(); };
      field.appendChild(t);
      targets.push(t);
    }

    function tick() {
      if (!active) return;
      timeLeft -= 0.1;
      timer.textContent = mode.dataset.mode === 'endless' ? '∞' : Math.max(0, timeLeft).toFixed(1) + 's';
      if (mode.dataset.mode !== 'endless' && timeLeft <= 0) {
        active = false;
        targets.forEach(t => t.remove());
        return onComplete && onComplete(s);
      }
      setTimeout(tick, 100);
    }

    // spawn 5 targets over 1.5s
    for (let i = 0; i < 6; i++) setTimeout(() => spawnTarget(), i * 220);
    tick();
    mode.dataset.mode = 'thirty';
  }

  function burst(parent, target) {
    const rect = target.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    const cx = rect.left - pr.left + rect.width / 2;
    const cy = rect.top - pr.top + rect.height / 2;
    for (let i = 0; i < 14; i++) {
      const p = document.createElement('span');
      p.className = 'particle';
      const ang = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * 60;
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      p.style.background = ['#62d8e8', '#ffd166', '#ff8a7a', '#c8a4ff'][Math.floor(Math.random() * 4)];
      parent.appendChild(p);
      setTimeout(() => p.remove(), 700);
    }
  }

  /* ============================================================
     8. Stress Pop (NEW)
     ============================================================ */
  function renderStressPop(stage, onComplete) {
    const box = el('div', { class: 'sp-stage' });
    const hud = el('div', { class: 'tb-hud' });
    const score = el('span', { class: 'tb-score' }, 'Score 0');
    const combo = el('span', { class: 'tb-combo' }, 'Combo ×0');
    const timer = el('span', { class: 'tb-timer' }, '');
    hud.appendChild(score); hud.appendChild(combo); hud.appendChild(timer);
    const field = el('div', { class: 'sp-field' });
    const ctl = el('div', { class: 'g-controls' });
    const mode = durationRow([
      { value: 'thirty', label: '30 sec' },
      { value: 'relax', label: 'Relax (no time)' }
    ], () => {}, 'thirty');
    ctl.appendChild(mode);
    box.appendChild(hud); box.appendChild(field); box.appendChild(ctl);
    stage.appendChild(box);

    let s = 0, c = 1, lastHit = 0, active = true;
    let timeLeft = 30;
    const palette = ['#ff8a7a', '#62d8e8', '#ffd166', '#c8a4ff', '#7ee0b8', '#ff7eb6'];

    function spawn() {
      if (!active) return;
      const b = el('button', { class: 'sp-bubble', 'aria-label': 'Pop' });
      const size = 24 + Math.random() * 40;
      b.style.width = size + 'px';
      b.style.height = size + 'px';
      b.style.left = Math.random() * 90 + '%';
      b.style.background = `radial-gradient(circle at 30% 30%, ${palette[Math.floor(Math.random() * palette.length)]}, rgba(7,17,31,0.0))`;
      b.style.animation = `spFloat ${3500 + Math.random() * 2500}ms ease-in-out infinite`;
      b.onclick = (e) => {
        e.preventDefault();
        if (!active || b.classList.contains('popped')) return;
        b.classList.add('popped');
        s += 5;
        const now = Date.now();
        if (now - lastHit < 1200) c += 1; else c = 1;
        lastHit = now;
        score.textContent = 'Score ' + s;
        combo.textContent = 'Combo ×' + c;
        burst(field, b);
        setTimeout(() => b.remove(), 220);
        setTimeout(spawn, 220 + Math.random() * 380);
      };
      field.appendChild(b);
    }

    setTimeout(spawn, 200);
    setTimeout(spawn, 500);
    setTimeout(spawn, 800);
    setTimeout(spawn, 1100);

    function tick() {
      if (!active) return;
      timeLeft -= 0.1;
      timer.textContent = mode.dataset.mode === 'relax' ? '∞' : Math.max(0, timeLeft).toFixed(1) + 's';
      if (mode.dataset.mode !== 'relax' && timeLeft <= 0) {
        active = false;
        field.querySelectorAll('.sp-bubble').forEach(b => b.remove());
        return onComplete && onComplete(s);
      }
      setTimeout(tick, 100);
    }
    tick();
    mode.dataset.mode = 'thirty';
  }

  /* ============================================================
     9. Focus Dot — with 1/3/5 min duration
     ============================================================ */
  function renderFocusDot(stage, onComplete, onCancel) {
    const box = el('div', { class: 'focus-stage' });
    const dot = el('div', { class: 'focus-dot' });
    const txt = el('div', { class: 'muted small' }, 'Soft gaze on the dot. Breathe naturally.');
    const ctl = el('div', { class: 'g-controls' });
    const dur = durationRow([
      { value: 60, label: '1 min' },
      { value: 180, label: '3 min' },
      { value: 300, label: '5 min' }
    ], () => {
      stopped = true;
      setTimeout(() => renderFocusDot(stage, onComplete, onCancel), 0);
    }, 60);
    ctl.appendChild(dur);
    const stop = el('button', { class: 'btn ghost small', style: 'margin-top:12px' }, 'End');
    box.appendChild(dot); box.appendChild(txt); box.appendChild(ctl); box.appendChild(stop);
    stage.appendChild(box);
    let phase = 0;
    const seq = [{ n: 'FOCUS', d: 4000 }, { n: 'BREATHE', d: 2000 }, { n: 'RESET', d: 4000 }, { n: 'BREATHE', d: 2000 }];
    let total = 0; const target = 4;
    let totalSec = 60; let stopped = false; let startedAt = Date.now();
    function step() {
      if (stopped) return;
      const elapsed = (Date.now() - startedAt) / 1000;
      if (elapsed >= totalSec) {
        stopped = true;
        return onComplete && onComplete(0);
      }
      const c = seq[phase];
      txt.textContent = c.n;
      dot.className = 'focus-dot ' + c.n.toLowerCase();
      phase = (phase + 1) % seq.length;
      if (phase === 0) total += 1;
      setTimeout(step, c.d);
    }
    setTimeout(step, 300);
    stop.onclick = () => { stopped = true; onCancel && onCancel(); };
  }

  /* ============================================================
     Bind to UI
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    renderGrid();
    const close = document.getElementById('game-player-close');
    if (close) close.onclick = closeGame;
  });
})();
