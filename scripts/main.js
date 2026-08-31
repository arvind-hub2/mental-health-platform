/* SYNAPSE — cinematic MedTech site (enhanced) */
(function(){
'use strict';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = window.innerWidth < 768;
const isTablet = window.innerWidth < 1024;
const isLowPerf = isMobile || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);

/* ---------- LOADER ---------- */
let loaderHidden = false;
const hideLoader = () => {
  if (loaderHidden) return;
  loaderHidden = true;
  setTimeout(() => {
    const l = document.getElementById('loader');
    if (l) l.classList.add('hidden');
  }, 700);
};

// Absolute fail-safe: force hide loader after 3 seconds if nothing else worked
setTimeout(hideLoader, 3000);

if (document.readyState === 'complete') {
  hideLoader();
} else {
  // Trigger on DOMContentLoaded (faster) instead of load (waits for all assets)
  window.addEventListener('DOMContentLoaded', hideLoader);
  window.addEventListener('load', hideLoader);
}

/* ---------- AI FRIEND FLOAT — always-on wireup (additive, idempotent) ----------
   Runs immediately on script load so the floating button works on the
   landing page too (before any login / before app.js binds its own
   handlers). Coexists with app.js's `bindAIFriendFloat`. */
(function wireAIFriendFloat(){
  const wire = () => {
    const btn = document.getElementById('ai-friend-float');
    const panel = document.getElementById('ai-friend-panel');
    const closeBtn = document.getElementById('ai-friend-panel-close');
    const form = document.getElementById('ai-friend-panel-form');
    const input = document.getElementById('ai-friend-panel-input');
    if (!btn || !panel || btn.__aiAlwaysBound) return;
    btn.__aiAlwaysBound = true;

    const setOpen = (open) => {
      panel.classList.toggle('open', open);
      panel.classList.toggle('hidden', !open);
      btn.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
      if (open) setTimeout(() => input && input.focus({ preventScroll: true }), 180);
    };

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen(!panel.classList.contains('open'));
    });
    if (closeBtn) closeBtn.addEventListener('click', (e) => { e.preventDefault(); setOpen(false); });

    if (form && !form.__aiAlwaysBound) {
      form.__aiAlwaysBound = true;
      // If app.js already bound the form (after login), don't double-bind the submit handler.
      if (!form.__appBound) {
      form.setAttribute('novalidate', 'true');
      form.addEventListener('submit', (e) => e.preventDefault(), true);
      form.addEventListener('submit', async (e) => {
        if (!input) return;
        const text = (input.value || '').trim();
        if (!text) return;
        const conv = document.getElementById('ai-friend-panel-conv');
        // Greet once
        if (conv && !conv.children.length) {
          const greet = document.createElement('div');
          greet.className = 'ai-msg assistant';
          greet.textContent = "Hi — I'm SYNAPSE AI Friend. What's on your mind today?";
          conv.appendChild(greet);
        }
        // Echo user message locally for instant feedback
        if (conv) {
          const userMsg = document.createElement('div');
          userMsg.className = 'ai-msg user';
          userMsg.textContent = text;
          conv.appendChild(userMsg);
          conv.scrollTop = conv.scrollHeight;
        }
        input.value = '';
        // Real backend call — uses window.api if app.js exposed one, otherwise falls back to fetch.
        const typing = document.getElementById('ai-friend-panel-typing');
        const token = (() => { try { return localStorage.getItem('synapse_token') || ''; } catch(_) { return ''; } })();
        if (!token) {
          if (conv) {
            const note = document.createElement('div');
            note.className = 'ai-msg assistant';
            note.textContent = "Please sign in to start a real AI Friend session — your conversation stays private.";
            conv.appendChild(note);
          }
          return;
        }
        if (typing) typing.classList.remove('hidden');
        try {
          const r = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({ content: text })
          });
          const data = await r.json().catch(() => ({}));
          if (typing) typing.classList.add('hidden');
          if (conv) {
            const a = document.createElement('div');
            a.className = 'ai-msg assistant' + (data.crisis ? ' crisis' : '');
            a.textContent = data.reply || 'I am here. Tell me a little more.';
            conv.appendChild(a);
            conv.scrollTop = conv.scrollHeight;
          }
        } catch (_) {
          if (typing) typing.classList.add('hidden');
          if (conv) {
            const a = document.createElement('div');
            a.className = 'ai-msg assistant';
            a.textContent = "I'm having trouble connecting right now. Please try again in a moment.";
            conv.appendChild(a);
          }
        }
      });
      }
    }
    if (input && !input.__aiAlwaysBound) {
      input.__aiAlwaysBound = true;
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
      }, true);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }
})();

/* ---------- THREE.JS NEURAL BACKGROUND ---------- */
let scene, camera, renderer, brainGroup, particles, neuralLines;
let synapsePulses = [], coreGroup, dustGroup, haloSprite;
let mouseX = 0, mouseY = 0;
let scrollProgress = 0;
let clock;

function initThree(){
  if(typeof THREE === 'undefined') return;
  const canvas = document.getElementById('bg');
  if(!canvas) return;
  clock = new THREE.Clock();

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050B16, 0.0032);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 2000);
  camera.position.set(30, -10, 140); // extreme close-up start (matches scroll-choreography 0.05)

  renderer = new THREE.WebGLRenderer({canvas, antialias:!isLowPerf, alpha:true, powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isLowPerf ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x050B16, 1);

  /* BRAIN — node clusters forming a brain-like volume */
  brainGroup = new THREE.Group();
  scene.add(brainGroup);

  // brain node positions (ellipsoid with hemispheric split)
  const nodes = [];
  const NODE_COUNT = isLowPerf ? 500 : 1100;
  for(let i=0;i<NODE_COUNT;i++){
    const u = Math.random();
    const v = Math.random();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2*v - 1);
    const r = 100 + Math.random()*8;
    const x = r * Math.sin(phi) * Math.cos(theta) * 0.95;
    const y = r * Math.sin(phi) * Math.sin(theta) * 0.78;
    const z = r * Math.cos(phi) * 1.15;
    const cleft = Math.abs(x) < 4 ? 0.92 : 1;
    nodes.push(new THREE.Vector3(x*cleft, y, z));
  }

  // Nodes as point cloud
  const nodeGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(nodes.length * 3);
  const colors = new Float32Array(nodes.length * 3);
  const sizes = new Float32Array(nodes.length);
  for(let i=0;i<nodes.length;i++){
    const n = nodes[i];
    positions[i*3]   = n.x;
    positions[i*3+1] = n.y;
    positions[i*3+2] = n.z;
    const isGold = Math.random() < 0.06;
    if(isGold){
      colors[i*3]   = 0.85;
      colors[i*3+1] = 0.64;
      colors[i*3+2] = 0.25;
    } else {
      const t = (n.z + 120) / 240;
      colors[i*3]   = 0.36 + t*0.3;
      colors[i*3+1] = 0.66 + t*0.2;
      colors[i*3+2] = 0.85;
    }
    sizes[i] = isGold ? Math.random()*1.5 + 1.5 : Math.random()*1.2 + 0.4;
  }
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  nodeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  nodeGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const nodeMat = new THREE.PointsMaterial({
    size: 1.3, vertexColors:true, transparent:true, opacity:0.78,
    sizeAttenuation:true, blending:THREE.AdditiveBlending, depthWrite:false
  });
  particles = new THREE.Points(nodeGeo, nodeMat);
  brainGroup.add(particles);

  /* SYNAPTIC CONNECTIONS (store endpoints for traveling pulses) */
  const linePositions = [];
  const lineColors = [];
  const cGold = new THREE.Color(0xD9A441);
  const cBlue = new THREE.Color(0x5CA9FF);
  const cCyan = new THREE.Color(0x62D8E8);
  const synapses = []; // {from: Vec3, to: Vec3, color: Color}
  for(let i=0;i<nodes.length;i++){
    const a = nodes[i];
    const neighbors = Math.floor(Math.random()*3) + 1;
    for(let k=0;k<neighbors;k++){
      const j = (i + 1 + Math.floor(Math.random()*40)) % nodes.length;
      const b = nodes[j];
      const dist = a.distanceTo(b);
      if(dist > 28) continue;
      linePositions.push(a.x,a.y,a.z, b.x,b.y,b.z);
      const c = Math.random() < 0.05 ? cGold : (Math.random() < 0.5 ? cCyan : cBlue);
      lineColors.push(c.r,c.g,c.b, c.r,c.g,c.b);
      if(Math.random() < 0.18){
        synapses.push({from:a.clone(), to:b.clone(), color:c});
      }
    }
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
  const lineMat = new THREE.LineBasicMaterial({
    vertexColors:true, transparent:true, opacity:0.16,
    blending:THREE.AdditiveBlending, depthWrite:false
  });
  neuralLines = new THREE.LineSegments(lineGeo, lineMat);
  brainGroup.add(neuralLines);

  /* TRAVELING SYNAPSE PULSES — electrical impulses along a sample of synapses */
  if(synapses.length){
    const pulseCount = Math.min(synapses.length, isLowPerf ? 30 : 70);
    const pulseGeo = new THREE.BufferGeometry();
    const pulsePos = new Float32Array(pulseCount * 3);
    const pulseCol = new Float32Array(pulseCount * 3);
    const pulseSize = new Float32Array(pulseCount);
    synapsePulses = [];
    for(let i=0;i<pulseCount;i++){
      const s = synapses[Math.floor(Math.random()*synapses.length)];
      synapsePulses.push({
        from:s.from.clone(),
        to:s.to.clone(),
        color:s.color.clone(),
        t:Math.random(),
        speed:0.12 + Math.random()*0.32
      });
      pulsePos[i*3] = s.from.x;
      pulsePos[i*3+1] = s.from.y;
      pulsePos[i*3+2] = s.from.z;
      pulseCol[i*3] = s.color.r;
      pulseCol[i*3+1] = s.color.g;
      pulseCol[i*3+2] = s.color.b;
      pulseSize[i] = 2.4;
    }
    pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePos, 3));
    pulseGeo.setAttribute('color', new THREE.BufferAttribute(pulseCol, 3));
    pulseGeo.setAttribute('size', new THREE.BufferAttribute(pulseSize, 1));
    const pulseMat = new THREE.PointsMaterial({
      size:2.3, vertexColors:true, transparent:true, opacity:0.9,
      sizeAttenuation:true, blending:THREE.AdditiveBlending, depthWrite:false
    });
    brainGroup.add(new THREE.Points(pulseGeo, pulseMat));
    // store reference via global so animate() can update positions
    brainGroup.userData.pulseGeo = pulseGeo;
  }

  /* INNER CORE — denser central cluster */
  coreGroup = new THREE.Group();
  const coreCount = isLowPerf ? 130 : 260;
  const coreGeo = new THREE.BufferGeometry();
  const corePos = new Float32Array(coreCount*3);
  const coreCol = new Float32Array(coreCount*3);
  for(let i=0;i<coreCount;i++){
    const r = 18 + Math.random()*22;
    const th = Math.random()*Math.PI*2;
    const ph = Math.acos(2*Math.random()-1);
    corePos[i*3]   = r*Math.sin(ph)*Math.cos(th);
    corePos[i*3+1] = r*Math.sin(ph)*Math.sin(th)*0.85;
    corePos[i*3+2] = r*Math.cos(ph)*1.05;
    const t = Math.random();
    coreCol[i*3]   = 0.55 + t*0.2;
    coreCol[i*3+1] = 0.80 + t*0.15;
    coreCol[i*3+2] = 0.95;
  }
  coreGeo.setAttribute('position', new THREE.BufferAttribute(corePos, 3));
  coreGeo.setAttribute('color', new THREE.BufferAttribute(coreCol, 3));
  const coreMat = new THREE.PointsMaterial({
    size:1.0, vertexColors:true, transparent:true, opacity:0.75,
    sizeAttenuation:true, blending:THREE.AdditiveBlending, depthWrite:false
  });
  coreGroup.add(new THREE.Points(coreGeo, coreMat));
  brainGroup.add(coreGroup);

  /* ATMOSPHERIC DUST with parallax layers */
  dustGroup = new THREE.Group();
  const dustCount = isLowPerf ? 260 : 700;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(dustCount*3);
  const dustSize = new Float32Array(dustCount);
  for(let i=0;i<dustCount;i++){
    dustPos[i*3]   = (Math.random()-0.5)*1200;
    dustPos[i*3+1] = (Math.random()-0.5)*700;
    dustPos[i*3+2] = (Math.random()-0.5)*1200;
    dustSize[i] = 0.3 + Math.random()*0.7;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    size:0.6, color:0x9FC4FF, transparent:true, opacity:0.35,
    blending:THREE.AdditiveBlending, depthWrite:false,
    sizeAttenuation:true
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dustGroup.add(dust);
  scene.add(dustGroup);

  /* RIM HALO around the brain */
  const haloGeo = new THREE.SphereGeometry(115, 32, 32);
  const haloMat = new THREE.ShaderMaterial({
    transparent:true,
    blending:THREE.AdditiveBlending,
    depthWrite:false,
    uniforms:{
      uColor:{value:new THREE.Color(0x5CA9FF)},
      uTime:{value:0}
    },
    vertexShader:`
      varying vec3 vNormal;
      varying vec3 vPos;
      void main(){
        vNormal = normalize(normalMatrix * normal);
        vPos = (modelViewMatrix * vec4(position,1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader:`
      varying vec3 vNormal;
      varying vec3 vPos;
      uniform vec3 uColor;
      uniform float uTime;
      void main(){
        vec3 viewDir = normalize(-vPos);
        float rim = 1.0 - max(dot(viewDir, vNormal), 0.0);
        rim = pow(rim, 2.5);
        float pulse = 0.85 + 0.15*sin(uTime*0.8);
        gl_FragColor = vec4(uColor * rim * pulse, rim * 0.6);
      }
    `
  });
  haloSprite = new THREE.Mesh(haloGeo, haloMat);
  brainGroup.add(haloSprite);

  /* LIGHTS — three-point with gold accent */
  scene.add(new THREE.AmbientLight(0x223344, 0.55));
  const p1 = new THREE.PointLight(0x5CA9FF, 1.6, 600);
  p1.position.set(160, 90, 130);
  scene.add(p1);
  const p2 = new THREE.PointLight(0x62D8E8, 0.8, 500);
  p2.position.set(-120, -80, 60);
  scene.add(p2);
  const p3 = new THREE.PointLight(0xD9A441, 0.7, 400); // restrained gold accent
  p3.position.set(0, 100, -120);
  scene.add(p3);
  const rim = new THREE.DirectionalLight(0x88BFFF, 0.4);
  rim.position.set(-200, 50, -100);
  scene.add(rim);

  window.addEventListener('mousemove', e => {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

/* ---------- SCROLL CAMERA RIG — close-up to brain reveal ---------- */
function updateScrollProgress(){
  const docH = document.documentElement.scrollHeight - window.innerHeight;
  scrollProgress = Math.min(1, Math.max(0, window.scrollY / Math.max(docH, 1)));
}
window.addEventListener('scroll', updateScrollProgress);

function getCameraTargets(p){
  if(p < 0.04){
    // extreme close-up of neural connections
    return {x: 30, y: -8, z: 90, rx:0.25, ry:-0.4, brainRot:0};
  } else if(p < 0.10){
    // pulling back through network
    return {x: 20, y: -5, z: 90 + (p-0.04)*2200, rx:0.18, ry:-0.3 + p*2, brainRot:p*2};
  } else if(p < 0.18){
    // brain fully revealed
    return {x: 0, y: 0, z: 280, rx:0, ry:p*1.5, brainRot:p*3};
  } else if(p < 0.4){
    // orbit around brain
    return {x: 60*Math.sin(p*4), y: -20*Math.cos(p*3), z: 360, rx:-0.1, ry:p*1.5, brainRot:p*3};
  } else if(p < 0.7){
    // drift through mid-sections
    return {x: 100*Math.sin(p*4), y: -30*Math.cos(p*3), z: 320, rx:-0.1, ry:p*2, brainRot:p*4};
  } else if(p < 0.9){
    // approach the brain again
    return {x: -120, y: 40, z: 260 - (p-0.7)*600, rx:0.2, ry:p*3, brainRot:p*5};
  } else {
    // final — close-up again, closing the loop
    return {x: 0, y: 0, z: 180 + Math.sin((p-0.9)*30)*40, rx:0, ry:p*4, brainRot:p*6};
  }
}

/* ---------- ANIMATE ---------- */
function animate(){
  requestAnimationFrame(animate);
  if(!renderer || !scene || !camera) return;

  const t = clock ? clock.getElapsedTime() : performance.now()*0.001;
  const dt = clock ? clock.getDelta() : 0.016;
  const targets = getCameraTargets(scrollProgress);

  // smooth follow
  camera.position.x += (targets.x + mouseX*12 - camera.position.x) * 0.05;
  camera.position.y += (targets.y + mouseY*8 - camera.position.y) * 0.05;
  camera.position.z += (targets.z - camera.position.z) * 0.05;
  camera.rotation.x += (targets.rx - camera.rotation.x) * 0.05;
  camera.rotation.y += (targets.ry - camera.rotation.y) * 0.05;

  if(brainGroup){
    brainGroup.rotation.y = targets.brainRot + t*0.03;
    brainGroup.rotation.x = Math.sin(t*0.25)*0.07;
  }
  if(coreGroup){
    coreGroup.rotation.y = -t*0.14;
    coreGroup.rotation.x = Math.sin(t*0.16)*0.1;
  }
  if(haloSprite){
    haloSprite.material.uniforms.uTime.value = t;
    haloSprite.rotation.y = -t*0.04;
  }
  if(dustGroup){
    // gentle parallax drift on dust, plus subtle mouse parallax
    dustGroup.rotation.y = t*0.004 + mouseX*0.035;
    dustGroup.rotation.x = mouseY*0.018;
  }

  // pulse opacity on lines based on time
  if(neuralLines){
    neuralLines.material.opacity = 0.12 + Math.sin(t*1.3)*0.04;
  }

  // Traveling synapse pulses — electrical impulses along neural connections
  const pulseGeo = brainGroup && brainGroup.userData.pulseGeo;
  if(pulseGeo && synapsePulses.length){
    const arr = pulseGeo.attributes.position.array;
    const stepDt = Math.min(dt, 0.05);
    for(let i=0;i<synapsePulses.length;i++){
      const p = synapsePulses[i];
      p.t += p.speed * stepDt;
      if(p.t >= 1){
        p.t = 0;
        // occasionally pick a new synapse for variety
        if(Math.random() < 0.3){
          // keep current one; just reset t
        }
      }
      const x = p.from.x + (p.to.x - p.from.x) * p.t;
      const y = p.from.y + (p.to.y - p.from.y) * p.t;
      const z = p.from.z + (p.to.z - p.from.z) * p.t;
      arr[i*3]   = x;
      arr[i*3+1] = y;
      arr[i*3+2] = z;
    }
    pulseGeo.attributes.position.needsUpdate = true;
  }

  renderer.render(scene, camera);
}

/* ---------- NAV SCROLL STATE ---------- */
const nav = document.getElementById('nav');
function updateNav(){
  if(window.scrollY > 60) nav.classList.add('scrolled');
  else nav.classList.remove('scrolled');
}
window.addEventListener('scroll', updateNav);

/* ---------- REVEAL ON SCROLL ---------- */
const revealEls = document.querySelectorAll('.reveal, .reveal-text');
const ro = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if(e.isIntersecting){
      e.target.classList.add('in');
      ro.unobserve(e.target);
    }
  });
}, {threshold: 0.12, rootMargin: '0px 0px -60px 0px'});
revealEls.forEach(el => ro.observe(el));

/* ---------- DASHBOARD RING FILL ---------- */
const rings = document.querySelectorAll('.ring');
const ringObserver = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if(e.isIntersecting){
      e.target.classList.add('in');
      ringObserver.unobserve(e.target);
    }
  });
}, {threshold: 0.4});
rings.forEach(r => ringObserver.observe(r));
rings.forEach(r => r.style.setProperty('--p', r.dataset.p));

/* ---------- IMPACT COUNTERS ---------- */
const counters = document.querySelectorAll('[data-target]');
const counterObserver = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if(!e.isIntersecting) return;
    const el = e.target;
    const key = el.dataset.target;
    const map = {
      earlier: 'EARLIER',
      awareness: 'HIGHER',
      engagement: 'STRONGER',
      connected: 'UNIFIED'
    };
    el.textContent = map[key] || '—';
    counterObserver.unobserve(el);
  });
}, {threshold: 0.4});
counters.forEach(c => counterObserver.observe(c));

/* ---------- MAGNETIC BUTTONS ---------- */
document.querySelectorAll('.magnetic').forEach(btn => {
  btn.addEventListener('mousemove', e => {
    if(reduceMotion) return;
    const r = btn.getBoundingClientRect();
    const x = e.clientX - r.left - r.width/2;
    const y = e.clientY - r.top - r.height/2;
    btn.style.transform = `translate(${x*0.2}px, ${y*0.2}px)`;
  });
  btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
});

/* ---------- STEP LINE ANIMATION ---------- */
const steps = document.querySelectorAll('.step');
const stepsContainer = document.querySelector('.steps');
steps.forEach((s, i) => {
  s.style.setProperty('--step-delay', (i * 0.12) + 's');
});
const stepObserver = new IntersectionObserver(entries => {
  entries.forEach((e, idx) => {
    if(e.isIntersecting){
      setTimeout(() => e.target.classList.add('in'), idx*120);
      stepObserver.unobserve(e.target);
    }
  });
}, {threshold: 0.3});
steps.forEach(s => stepObserver.observe(s));

/* ---------- INTELLIGENCE LOOP — additive scroll choreography ----------
   Soft cyan glow on the most-centered step; light decorative particles.
   No layout shift, no scroll hijacking, all GPU-friendly properties.
   Respects prefers-reduced-motion (handled in CSS via media query). */
(function enhanceIntelligenceLoop(){
  if (!stepsContainer || !steps.length) return;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Reveal the rail + connection path once the section is on-screen.
  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        stepsContainer.classList.add('is-visible');
        sectionObserver.unobserve(en.target);
      }
    });
  }, { threshold: 0.15 });
  sectionObserver.observe(stepsContainer);

  // Active-step glow: highlight the step closest to the viewport centre.
  if (!reduceMotion) {
    let raf = null;
    const updateActive = () => {
      raf = null;
      const mid = window.innerHeight * 0.5;
      let best = null, bestDist = Infinity;
      steps.forEach(s => {
        const r = s.getBoundingClientRect();
        const c = r.top + r.height * 0.5;
        const d = Math.abs(c - mid);
        if (r.bottom > 0 && r.top < window.innerHeight && d < bestDist) {
          bestDist = d;
          best = s;
        }
      });
      steps.forEach(s => s.classList.toggle('is-active', s === best));
    };
    const onScroll = () => { if (raf == null) raf = requestAnimationFrame(updateActive); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    updateActive();
  }

  // Decorative ambient particles — pure CSS classes, no DOM event listeners.
  if (!reduceMotion) {
    const section = stepsContainer.closest('.how') || stepsContainer.parentElement;
    if (section && !section.querySelector('.loop-particle')) {
      for (let i = 1; i <= 6; i++) {
        const dot = document.createElement('span');
        dot.className = 'loop-particle p' + i;
        dot.setAttribute('aria-hidden', 'true');
        section.appendChild(dot);
      }
    }
  }
})();

/* ---------- SMOOTH SCROLL FOR NAV ---------- */
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const href = a.getAttribute('href');
    if(href === '#' || href.length < 2) return;
    const target = document.querySelector(href);
    if(target){
      e.preventDefault();
      target.scrollIntoView({behavior:'smooth', block:'start'});
    }
  });
});

/* ---------- SUBTLE CURSOR FOLLOWER (desktop only) ---------- */
if(!isMobile && !reduceMotion){
  const cursor = document.createElement('div');
  cursor.className = 'cursor-follower';
  cursor.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cursor);
  let cx = window.innerWidth/2, cy = window.innerHeight/2;
  let tx = cx, ty = cy;
  window.addEventListener('mousemove', e => {
    tx = e.clientX; ty = e.clientY;
    cursor.classList.add('active');
  });
  window.addEventListener('mouseleave', () => cursor.classList.remove('active'));
  function cursorLoop(){
    cx += (tx - cx) * 0.15;
    cy += (ty - cy) * 0.15;
    cursor.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
    requestAnimationFrame(cursorLoop);
  }
  cursorLoop();

  // expand cursor on interactive elements
  document.querySelectorAll('a, button, .magnetic, .feature, .stat-card, .priv-card, .r-card, .eco-node, .impact-cell, .step').forEach(el => {
    el.addEventListener('mouseenter', () => cursor.classList.add('hover'));
    el.addEventListener('mouseleave', () => cursor.classList.remove('hover'));
  });
}

/* ---------- CARD TILT (subtle) ---------- */
if(!isMobile && !reduceMotion){
  document.querySelectorAll('.feature, .priv-card, .r-card, .stat-card, .impact-cell').forEach(card => {
    card.addEventListener('mousemove', e => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `translateY(-4px) perspective(800px) rotateX(${-py*3}deg) rotateY(${px*3}deg)`;
    });
    card.addEventListener('mouseleave', () => { card.style.transform = ''; });
  });
}

/* ---------- INIT ---------- */
if(!reduceMotion){
  initThree();
  animate();
} else {
  const canvas = document.getElementById('bg');
  if(canvas) canvas.style.background = 'radial-gradient(ellipse at center, #071525 0%, #050B16 100%)';
}

/* ---------- CLICK RIPPLE (additive micro-interaction) ---------- */
(function bindRipple(){
  if (reduceMotion) return;
  const hosts = document.querySelectorAll('.btn, .ai-friend-float, .dcard, .report-card, .ai-mode');
  hosts.forEach(el => {
    if (el.__rippleBound) return;
    el.__rippleBound = true;
    el.classList.add('ripple-host');
    el.addEventListener('click', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left);
      const y = (e.clientY - r.top);
      const dot = document.createElement('span');
      dot.className = 'ripple-dot';
      dot.style.width = '12px';
      dot.style.height = '12px';
      dot.style.left = x + 'px';
      dot.style.top  = y + 'px';
      el.appendChild(dot);
      setTimeout(() => dot.remove(), 850);
    });
  });
})();

/* ---------- REVEAL-UP (additive entrance helper for newly inserted nodes) ---------- */
(function bindRevealUp(){
  if (reduceMotion) return;
  const targets = document.querySelectorAll('[data-reveal]');
  if (!targets.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        en.target.classList.add('reveal-up');
        io.unobserve(en.target);
      }
    });
  }, { threshold: 0.1 });
  targets.forEach(t => io.observe(t));
})();

/* ---------- WELLBEING REPORT — cinematic reveal ----------
   Animate cards + list items on first viewport entry. No replay.
   Empty state when no real data exists. No fake data. */
(function bindReportReveal(){
  const section = document.getElementById('report');
  if (!section) return;
  const grid = section.querySelector('[data-report-grid]');
  const empty = section.querySelector('#report-empty');
  const cards = grid ? Array.from(grid.querySelectorAll('[data-report-card]')) : [];
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // staggered card delays
  cards.forEach((c, i) => c.style.setProperty('--rc-delay', (i * 0.10) + 's'));

  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    if (reduce) {
      cards.forEach(c => c.classList.add('in'));
      // still let items animate (no blur) but without motion
      section.querySelectorAll('.report-list .item').forEach(it => it.classList.add('in'));
      return;
    }
    cards.forEach((c, i) => {
      setTimeout(() => c.classList.add('in'), i * 110);
    });
    // list items reveal after their parent card lands
    section.querySelectorAll('.report-list').forEach(list => {
      const items = list.querySelectorAll('.item');
      items.forEach((it, i) => {
        it.style.setProperty('--item-delay', (i * 0.06) + 's');
        setTimeout(() => it.classList.add('in'), 380 + i * 60);
      });
    });
  };

  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        reveal();
        io.disconnect();
      }
    });
  }, { threshold: 0.12 });
  io.observe(section);
})();

/* ---------- WELLBEING REPORT — empty state + value tween ----------
   Watches /rep-* element changes. If all real-data lists are empty, shows #report-empty.
   Animates report-overall-cell-val from 0 → real value when data appears. */
(function bindReportEmptyAndTween(){
  const section = document.getElementById('report');
  if (!section) return;
  const empty = section.querySelector('#report-empty');
  const grid = section.querySelector('[data-report-grid]');
  const disclaimer = section.querySelector('#report-disclaimer');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // list selectors that we treat as "real data" presence
  const dataSelectors = ['#rep-emotions', '#rep-themes', '#rep-positive', '#rep-stressors', '#rep-protective'];
  const overallHasNumber = () => {
    const cells = section.querySelectorAll('.report-overall-cell-val');
    for (const c of cells) {
      const t = (c.textContent || '').trim();
      if (t && t !== '—' && t !== '-' && !/^null$/i.test(t)) return true;
    }
    return false;
  };
  const listHasItems = () => {
    return dataSelectors.some(sel => {
      const el = section.querySelector(sel);
      if (!el) return false;
      // ignore single placeholder .item.muted nodes
      const items = el.querySelectorAll('.item');
      const real = Array.from(items).filter(it => !it.classList.contains('muted'));
      return real.length > 0;
    });
  };

  const applyState = () => {
    const hasData = overallHasNumber() || listHasItems();
    if (empty) empty.classList.toggle('hidden', hasData);
    if (grid) grid.style.display = hasData ? '' : 'none';
    if (disclaimer) disclaimer.style.display = hasData ? '' : 'none';
  };

  // initial + observe
  applyState();
  const mo = new MutationObserver(() => applyState());
  dataSelectors.forEach(sel => {
    const el = section.querySelector(sel);
    if (el) mo.observe(el, { childList: true, subtree: true, characterData: true });
  });
  section.querySelectorAll('.report-overall').forEach(el => mo.observe(el, { childList: true, subtree: true, characterData: true }));

  // Value tween: animate report-overall-cell-val from 0 → real when it first appears
  const tweenCell = (cell) => {
    if (reduce) return;
    if (cell.dataset.tweened === '1') return;
    const raw = (cell.textContent || '').trim();
    const n = parseFloat(raw);
    if (!isFinite(n)) return;
    cell.dataset.tweened = '1';
    const start = performance.now();
    const dur = 900;
    const from = 0, to = n;
    cell.classList.add('report-tween');
    cell.textContent = '0';
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      cell.textContent = String(Math.round(from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(step);
      else cell.textContent = String(to);
    };
    requestAnimationFrame(step);
  };
  // tween after a small delay (let cards reveal first)
  const tweenObserver = new MutationObserver(() => {
    setTimeout(() => {
      section.querySelectorAll('.report-overall-cell-val').forEach(tweenCell);
    }, 500);
  });
  section.querySelectorAll('.report-overall').forEach(el => tweenObserver.observe(el, { childList: true, subtree: true }));
})();

/* ---------- PARALLAX — gentle background depth on scroll ----------
   Decorative elements (orb, decorative dots) drift slower than content
   to create the cinematic depth of the reference video.
   Uses CSS transform + rAF — no layout shift, no scroll hijack. */
(function bindParallax(){
  if (reduceMotion) return;
  const targets = [
    { el: document.querySelector('.hero-orb-wrap'),  speed: 0.12, axis: 'y' },
    { el: document.querySelector('.dash-hero-planet'), speed: 0.08, axis: 'y' },
    { el: document.querySelector('.dash-hero-glass'),  speed: -0.06, axis: 'y' },
  ].filter(t => t.el);
  if (!targets.length) return;

  let ticking = false;
  const update = () => {
    ticking = false;
    const y = window.scrollY;
    targets.forEach(t => {
      const rect = t.el.getBoundingClientRect();
      // only animate when in viewport
      if (rect.bottom < -200 || rect.top > window.innerHeight + 200) return;
      const offset = (y - (y + rect.top - window.innerHeight/2)) * t.speed;
      t.el.style.setProperty('--parallax-y', `${offset.toFixed(2)}px`);
      t.el.style.transform = t.axis === 'y' ? `translate3d(0, var(--parallax-y, 0), 0)` : '';
    });
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
})();

/* ---------- RECOVERY CARDS — cinematic staggered reveal ---------- */
(function bindRecoveryReveal(){
  if (reduceMotion) return;
  const grid = document.getElementById('exercise-grid') || document.getElementById('game-grid');
  if (!grid) return;
  // Observe when the grid gets cards rendered into it
  const mo = new MutationObserver(() => {
    const cards = grid.querySelectorAll('.ex-card, .game-card, .recovery-card, [data-recovery-card]');
    if (!cards.length) return;
    cards.forEach((c, i) => {
      if (c.dataset.revBound) return;
      c.dataset.revBound = '1';
      c.style.setProperty('--rc-delay', (i * 0.07) + 's');
      c.style.opacity = '0';
      c.style.transform = 'translateY(20px) scale(.985)';
      c.style.filter = 'blur(6px)';
      c.style.transition = 'opacity .8s cubic-bezier(.2,.7,.2,1), transform .8s cubic-bezier(.2,.7,.2,1), filter .8s cubic-bezier(.2,.7,.2,1), box-shadow .35s ease, border-color .35s ease';
      c.style.transitionDelay = `var(--rc-delay, 0s)`;
    });
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          const c = en.target;
          c.style.opacity = '1';
          c.style.transform = 'translateY(0) scale(1)';
          c.style.filter = 'blur(0)';
          io.unobserve(c);
        }
      });
    }, { threshold: 0.15 });
    cards.forEach(c => io.observe(c));
  });
  mo.observe(grid, { childList: true });
})();

/* ---------- SCREENING — one question at a time + progress ---------- */
(function bindScreeningFlow(){
  const card = document.getElementById('screening-card');
  if (!card) return;
  const wrap = card.querySelector('#screening-qs');
  const submitBtn = card.querySelector('#screening-submit');
  const prevBtn = card.querySelector('#screening-prev');
  const fill = card.querySelector('#screening-progress-fill');
  const text = card.querySelector('#screening-progress-text');
  if (!wrap) return;

  // The screening renderer uses `.sq` for each question — accept both for safety.
  const questionSel = '.sq, .screening-q';

  const updateProgress = () => {
    const all = wrap.querySelectorAll(questionSel);
    const answered = wrap.querySelectorAll(questionSel + ' input[type="radio"]:checked');
    const total = all.length || 0;
    const done = answered.length || 0;
    if (fill) fill.style.setProperty('--progress', total ? (done / total) * 100 + '%' : '0%');
    if (text) text.textContent = total ? (done + ' / ' + total) : '0 / 0';
  };

  const showOneAtATime = () => {
    const all = Array.from(wrap.querySelectorAll(questionSel));
    if (!all.length) return;
    let firstUnanswered = all.findIndex(q => !q.querySelector('input[type="radio"]:checked'));
    if (firstUnanswered === -1) firstUnanswered = all.length - 1;
    all.forEach((q, i) => {
      const isActive = i <= firstUnanswered;
      q.classList.toggle('hidden-q', !isActive);
      if (isActive) {
        q.style.setProperty('--q-delay', (i * 0.04) + 's');
        if (!q.classList.contains('in') && !q.classList.contains('q-shown')) {
          q.classList.add('in');
          q.classList.add('q-shown');
        }
      }
    });
    if (prevBtn) prevBtn.hidden = firstUnanswered <= 0;
  };

  const onChange = (e) => {
    if (e.target && e.target.matches('input[type="radio"]')) {
      showOneAtATime();
      updateProgress();
    }
  };
  wrap.addEventListener('change', onChange);

  const mo = new MutationObserver(() => {
    wrap.querySelectorAll(questionSel).forEach(q => q.classList.remove('q-shown'));
    showOneAtATime();
    updateProgress();
  });
  mo.observe(wrap, { childList: true });

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      const all = Array.from(wrap.querySelectorAll(questionSel));
      const firstUnanswered = all.findIndex(q => !q.querySelector('input[type="radio"]:checked'));
      if (firstUnanswered > 0) {
        const prevQ = all[firstUnanswered - 1];
        prevQ.querySelectorAll('input[type="radio"]:checked').forEach(r => r.checked = false);
        showOneAtATime();
        updateProgress();
      }
    });
  }

  showOneAtATime();
  updateProgress();
})();

/* ---------- SCROLL HINT DISMISS (hero hand cue) ---------- */
(function bindScrollHint(){
  if (reduceMotion) {
    const hint = document.getElementById('scroll-hint');
    if (hint) hint.classList.add('dismissed');
    return;
  }
  const hint = document.getElementById('scroll-hint');
  if (!hint) return;
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    hint.classList.add('dismissed');
    try { sessionStorage.setItem('synapse_scroll_hint_dismissed', '1'); } catch(_) {}
  };
  // Hide immediately if already dismissed this session
  try {
    if (sessionStorage.getItem('synapse_scroll_hint_dismissed') === '1') {
      hint.classList.add('dismissed');
      return;
    }
  } catch(_) {}
  // Manual scroll/touch dismisses the cue
  let scrollAccum = 0;
  const onScroll = () => {
    scrollAccum += Math.abs(window.scrollY || 0);
    if (scrollAccum > 60) dismiss();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  // After ~10s if user hasn't moved, gently hide
  setTimeout(() => dismiss(), 10000);
  // First wheel/touch also dismisses
  window.addEventListener('wheel', dismiss, { passive: true, once: true });
  window.addEventListener('touchmove', dismiss, { passive: true, once: true });
})();

/* ---------- AI FRIEND ONBOARDING HAND TAP (one-time cue) ---------- */
(function bindAIFriendOnboard(){
  if (reduceMotion) return;
  const btn = document.getElementById('ai-friend-float');
  if (!btn) return;
  let alreadyOnboarded = false;
  try { alreadyOnboarded = sessionStorage.getItem('synapse_ai_onboard') === '1'; } catch(_) {}
  if (alreadyOnboarded) return;

  const cue = document.createElement('div');
  cue.className = 'ai-friend-onboard';
  cue.setAttribute('aria-hidden', 'true');
  cue.innerHTML = `
    <svg class="ai-friend-hand" viewBox="0 0 32 48" width="28" height="42" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16 6c0-2 3-2 3 0v18"/>
      <path d="M11 12c0-2 3-2 3 0v14"/>
      <path d="M21 10c0-2 3-2 3 0v18"/>
      <path d="M6 18c0-2 3-2 3 0v10"/>
      <path d="M11 30c0 8 5 14 11 14s8-6 8-12V18"/>
      <path d="M11 30c-2 0-4-2-4-4"/>
    </svg>
    <span class="ai-friend-onboard-label">Tap to talk</span>
  `;
  document.body.appendChild(cue);
  // Position relative to the floating button
  const position = () => {
    const r = btn.getBoundingClientRect();
    cue.style.left = (r.left - 64) + 'px';
    cue.style.top = (r.top + r.height / 2 - 24) + 'px';
  };
  position();
  window.addEventListener('resize', position, { passive: true });
  window.addEventListener('scroll', position, { passive: true });

  // Animation cycle: approach → tap (ripple) → retreat, every 6s, repeat 2 times
  let cycles = 0;
  const maxCycles = 2;
  const runCycle = () => {
    if (cycles >= maxCycles) {
      cue.classList.add('fading');
      setTimeout(() => { cue.remove(); }, 800);
      try { sessionStorage.setItem('synapse_ai_onboard', '1'); } catch(_) {}
      return;
    }
    cycles++;
    setTimeout(() => {
      btn.classList.add('ai-friend-ripple-onboard');
      setTimeout(() => btn.classList.remove('ai-friend-ripple-onboard'), 900);
      runCycle();
    }, 3000);
  };
  setTimeout(runCycle, 1200);

  // Dismiss immediately on real interaction with the button
  const dismiss = () => {
    cue.classList.add('fading');
    setTimeout(() => cue.remove(), 400);
    try { sessionStorage.setItem('synapse_ai_onboard', '1'); } catch(_) {}
    btn.removeEventListener('click', dismiss);
  };
  btn.addEventListener('click', dismiss, { once: true });
  // Also dismiss after 18s in case user doesn't tap
  setTimeout(() => {
    if (cue.parentNode) {
      cue.classList.add('fading');
      setTimeout(() => cue.remove(), 400);
      try { sessionStorage.setItem('synapse_ai_onboard', '1'); } catch(_) {}
    }
  }, 18000);
})();

/* ---------- SCREENING SUBMIT HAND CUE (subtle, non-auto-submit) ---------- */
(function bindScreeningSubmitCue(){
  if (reduceMotion) return;
  const screening = document.getElementById('screening');
  if (!screening) return;
  let alreadyShown = false;
  try { alreadyShown = sessionStorage.getItem('synapse_submit_cue') === '1'; } catch(_) {}
  if (alreadyShown) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      io.disconnect();
      const submitBtn = document.getElementById('screening-submit') || screening.querySelector('button[type="submit"], #screening-submit, .screening-submit');
      if (!submitBtn) return;
      // Only show if not yet submitted (no .submitted marker)
      if (submitBtn.disabled || submitBtn.classList.contains('submitted')) return;
      const cue = document.createElement('div');
      cue.className = 'screening-submit-cue';
      cue.setAttribute('aria-hidden', 'true');
      cue.innerHTML = `
        <svg class="screening-hand" viewBox="0 0 32 48" width="22" height="34" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 6c0-2 3-2 3 0v18"/>
          <path d="M11 12c0-2 3-2 3 0v14"/>
          <path d="M21 10c0-2 3-2 3 0v18"/>
          <path d="M6 18c0-2 3-2 3 0v10"/>
          <path d="M11 30c0 8 5 14 11 14s8-6 8-12V18"/>
          <path d="M11 30c-2 0-4-2-4-4"/>
        </svg>
      `;
      document.body.appendChild(cue);
      const position = () => {
        const r = submitBtn.getBoundingClientRect();
        cue.style.left = (r.left + r.width / 2 - 14) + 'px';
        cue.style.top = (r.bottom + 12) + 'px';
      };
      position();
      window.addEventListener('resize', position, { passive: true });
      window.addEventListener('scroll', position, { passive: true });

      setTimeout(() => cue.classList.add('fading'), 6500);
      setTimeout(() => { if (cue.parentNode) cue.remove(); }, 7400);
      try { sessionStorage.setItem('synapse_submit_cue', '1'); } catch(_) {}
    });
  }, { threshold: 0.4 });
  io.observe(screening);
})();

})();
