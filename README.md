# Synapse — Digital Mental Health & Psychological Support System

A premium, cinematic, evidence-informed website for a digital mental health and
psychological support platform designed for Uniformed Forces Personnel (Soldiers, police, paramilitary & defence personnel).

> **Project**: *AI-Based Predictive Personnel Stress and Welfare Monitoring System for Uniformed Forces*

---

## Visual Identity

- **Background**: Deep navy / near-black (`#050B16`, `#07111F`, `#0B1728`)
- **Accents**: Neural cyan `#62D8E8`, scientific blue `#5CA9FF`,
  premium medical gold `#D9A441` (used sparingly)
- **Typography**: Inter (sans) + Instrument Serif (italic accents)
- **3D**: Persistent WebGL brain built with Three.js (point cloud + neural
  line connections + traveling synapse pulses + rim halo + inner core +
  atmospheric dust with parallax)

## Tech Stack

- **HTML5** (single page, semantic, ARIA-labelled)
- **CSS3** (custom properties, no preprocessor, responsive at 1024 / 768)
- **Vanilla JavaScript** (no build step, no framework)
- **Three.js r128** via CDN (only external runtime dependency)

No bundler, no npm install — open `index.html` and the site runs.

## How to Run

### Option A — Direct file open
Open `index.html` in any modern browser. Works offline once Three.js CDN
is cached.

### Option B — Local server (recommended for development)
```bash
# any one of these works:
python3 -m http.server 8765
# or
npx http-server -p 8765
# then visit http://127.0.0.1:8765
```

## File Structure

```
mental-health-platform/
├── index.html              # All 12+ narrative sections
├── styles/
│   └── main.css            # Design tokens + every component style
├── scripts/
│   └── main.js             # Three.js brain + scroll camera + interactions
├── assets/                 # (empty — visuals are procedural)
├── validate.js             # Local syntax/structure validator (dev only)
└── README.md
```

## Sections (narrative arc)

1. **Hero** — cinematic 3D brain + headline
2. **The Uniformed Mind** — six operational pressures
3. **The Problem** — four barriers (stigma, access, awareness, continuity)
4. **The Solution** — six-component ecosystem
5. **How It Works** — 5-step neural process (Check In → Understand →
   Personalize → Connect → Track)
6. **Platform Features** — six feature cards
7. **Live Interface** — medical-grade dashboard
8. **AI Wellbeing Assistant** — conversation UI with mood context,
   suggestions, and clear non-diagnostic disclaimer
9. **Hybrid Care** — AI + Human split (technology supports, professionals
   lead)
10. **Privacy & Trust** — six principles, no exaggerated claims
11. **For Command & Welfare Teams** — three-layer ecosystem (Personnel → Counselling →
    Command)
12. **Impact** — five measured goals, clearly labelled as projected outcomes
13. **Research & Science** — six research pillars + scientific data viz
14. **Final CTA** — return to the brain

## Design Decisions

- **No fabricated statistics.** The impact section uses descriptive labels
  (EARLIER, HIGHER, STRONGER, UNIFIED) rather than invented numbers.
- **AI is bounded.** The AI Wellbeing Assistant section explicitly states
  it supports and guides rather than diagnoses. Crisis disclaimer is
  visible.
- **Privacy claims are calibrated.** "Privacy-first architecture" rather
  than "100% secure."
- **Reduced-motion supported.** `prefers-reduced-motion` falls back to a
  static radial gradient; animations are disabled.
- **Mobile-first performance.** Particle count is reduced on devices with
  ≤ 4 cores or narrow viewports.

## Accessibility

- Skip-link to main content
- ARIA labels on canvas, loader, AI conversation, nav
- `aria-live="polite"` on AI conversation stream
- `:focus-visible` outline rings in cyan
- Semantic landmarks: `<nav>`, `<main>`, `<footer>`, 14 `<section>`s
- Reduced-motion media query disables animations

## Validation

```bash
node validate.js
```

Reports file sizes, brace balance for JS and CSS, HTML section tag balance,
and confirms every new selector / section is present.

## License

Built for the project described above. Three.js is MIT-licensed; Google
Fonts (Inter + Instrument Serif) are licensed under the SIL Open Font
License.
