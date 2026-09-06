/**
 * The app's visual language, as one stylesheet.
 *
 * Structure follows Apple's design foundations rather than a generic web page:
 * type is a scale with size-specific tracking and leading; spacing is a single
 * 4pt rhythm so no gap is arbitrary; surfaces are translucent materials layered
 * over a base rather than opaque boxes; and colour saturation is reserved for
 * verdicts, where it carries meaning. Motion lives in `motion.ts` — CSS here
 * only describes rest states and the few non-gestural transitions.
 */
export const STYLES = String.raw`
:root {
  /* ---- Palette -------------------------------------------------------- */
  /* A narrow tonal band reads as depth; each step is a deliberate lift. */
  --base:        #0b0e13;
  --raised:      rgba(255, 255, 255, 0.038);
  --raised-2:    rgba(255, 255, 255, 0.058);
  --overlay:     rgba(28, 33, 42, 0.72);
  --hairline:    rgba(255, 255, 255, 0.085);
  /* A brighter top edge reads as light catching a raised material. */
  --edge-lit:    rgba(255, 255, 255, 0.14);

  /* Three weights of one neutral, not many hues. */
  --text:        #f2f5f9;
  --text-muted:  #9aa4b2;
  --text-faint:  #626c7a;

  --accent:      #2f9bff;
  --accent-dim:  rgba(47, 155, 255, 0.16);

  /* Verdict colours: the only place saturation is spent freely. */
  --green:       #34c759;
  --yellow:      #ffb020;
  --red:         #ff453a;
  --green-dim:   rgba(52, 199, 89, 0.14);
  --yellow-dim:  rgba(255, 176, 32, 0.14);
  --red-dim:     rgba(255, 69, 58, 0.14);

  /* ---- Spacing: one 4pt rhythm, in rem so it scales with text -------- */
  --s1: 0.25rem; --s2: 0.5rem;  --s3: 0.75rem; --s4: 1rem;
  --s5: 1.5rem;  --s6: 2rem;    --s7: 3rem;

  --radius-sm: 6px;
  --radius:    10px;
  --radius-lg: 14px;

  /* Bigger surfaces read as thicker: deeper shadow, stronger blur. */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow:    0 8px 24px rgba(0, 0, 0, 0.36);
  --shadow-lg: 0 20px 48px rgba(0, 0, 0, 0.46);
}

* { box-sizing: border-box; margin: 0; padding: 0; }

/* The system font already ships optical sizing and tracking tables. */
html {
  font: 100%/1.5 -apple-system, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

body {
  background: var(--base);
  color: var(--text);
  height: 100vh;
  overflow: hidden;
  /* The document is chrome: nothing here should feel like a web page. */
  user-select: none;
  cursor: default;
}

/* ---- Type scale ------------------------------------------------------ */
/* Tracking is size-specific: tight as type grows, near zero for body,
   slightly open for small caps-y labels. Never one value for all sizes. */
.t-display { font-size: 1.75rem; line-height: 1.15; letter-spacing: -0.021em; font-weight: 640; }
.t-title   { font-size: 1.0625rem; line-height: 1.3; letter-spacing: -0.011em; font-weight: 600; }
.t-body    { font-size: 0.875rem; line-height: 1.5; letter-spacing: 0; }
.t-label   { font-size: 0.75rem; line-height: 1.4; letter-spacing: 0.014em; font-weight: 550;
             color: var(--text-muted); }
.t-caps    { font-size: 0.6875rem; line-height: 1.3; letter-spacing: 0.06em; font-weight: 600;
             text-transform: uppercase; color: var(--text-faint); }
.t-mono    { font-family: ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace;
             font-size: 0.8125rem; letter-spacing: -0.005em; }

.muted { color: var(--text-muted); }
.faint { color: var(--text-faint); }

/* ---- App shell ------------------------------------------------------- */
#app { display: grid; grid-template-columns: 232px 1fr; height: 100vh; }

/* Sidebar is the heaviest material: it separates a structural region. */
.sidebar {
  background: rgba(255, 255, 255, 0.022);
  border-right: 1px solid var(--hairline);
  display: flex; flex-direction: column;
  padding: var(--s3);
  gap: var(--s1);
}

/* Custom title bar. Undecorated window means we own the drag region. */
.titlebar {
  height: 38px; display: flex; align-items: center; gap: var(--s2);
  padding: 0 var(--s2) 0 var(--s1);
  -webkit-app-region: drag; app-region: drag;
}
.brand {
  display: flex; align-items: center; gap: var(--s2);
  font-size: 0.8125rem; font-weight: 620; letter-spacing: -0.005em;
}
.brand-mark {
  width: 18px; height: 18px; border-radius: 5px;
  background: linear-gradient(160deg, var(--accent), #1b6fd0);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), var(--shadow-sm);
}

/* Window controls: ours, so they can match the rest of the interface. */
.win-controls { display: flex; gap: var(--s1); margin-left: auto;
                -webkit-app-region: no-drag; app-region: no-drag; }
.win-btn {
  width: 26px; height: 22px; border: 0; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-faint);
  display: grid; place-items: center; font-size: 11px;
  transition: background 120ms ease-out, color 120ms ease-out;
}
.win-btn:hover { background: var(--raised-2); color: var(--text); }
.win-btn.close:hover { background: var(--red); color: #fff; }

/* ---- Navigation ------------------------------------------------------ */
/* Items are named for their contents, never a vague umbrella. */
.nav { display: flex; flex-direction: column; gap: 2px; margin-top: var(--s2); }
.nav-item {
  position: relative;
  display: flex; align-items: center; gap: var(--s3);
  padding: var(--s2) var(--s3);
  border: 0; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-muted);
  font: inherit; font-size: 0.8125rem; font-weight: 500;
  text-align: left; width: 100%;
  /* Press feedback is instant; see §1 Response. */
  transition: background 120ms ease-out, color 120ms ease-out;
}
.nav-item:hover { background: var(--raised); color: var(--text); }
.nav-item[aria-current="page"] { background: var(--raised-2); color: var(--text); font-weight: 560; }
.nav-item:active { transform: scale(0.985); }
.nav-icon { width: 15px; height: 15px; opacity: 0.85; flex: none; }

/* The selection indicator is one element that moves between items, so the
   highlight travels rather than blinking out and in somewhere else. */
.nav-indicator {
  position: absolute; left: 0; width: 2.5px; height: 18px;
  border-radius: 0 2px 2px 0; background: var(--accent);
  will-change: transform;
}

.sidebar-foot { margin-top: auto; padding: var(--s2) var(--s3); }

/* ---- Content --------------------------------------------------------- */
.content { display: flex; flex-direction: column; min-width: 0; }

/* Floating translucent header; content scrolls underneath it. */
.topbar {
  height: 38px; flex: none;
  display: flex; align-items: center; gap: var(--s3);
  padding: 0 var(--s5);
  -webkit-app-region: drag; app-region: drag;
  background: rgba(11, 14, 19, 0.6);
  backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid transparent;
}

.scroll {
  flex: 1; overflow-y: auto; overscroll-behavior: contain;
  padding: var(--s5) var(--s5) var(--s7);
  /* Scroll edge effect: content fades where it meets floating chrome,
     instead of a hard 1px divider. */
  mask-image: linear-gradient(to bottom, transparent 0, #000 10px);
}
.scroll::-webkit-scrollbar { width: 10px; }
.scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.13); border-radius: 5px;
  border: 3px solid transparent; background-clip: content-box;
}
.scroll::-webkit-scrollbar-thumb:hover { background-clip: content-box;
  background-color: rgba(255, 255, 255, 0.22); }

.page-head { margin-bottom: var(--s5); }
.page-head p { margin-top: var(--s1); }

/* ---- Cards & panels -------------------------------------------------- */
.card {
  background: var(--raised);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  /* A bright top edge sells the material as raised, not drawn. */
  box-shadow: inset 0 1px 0 var(--edge-lit), var(--shadow-sm);
  padding: var(--s4);
}
.row-gap { display: grid; gap: var(--s3); }
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s3); }

.stat { display: flex; flex-direction: column; gap: var(--s1); }
.stat-value { font-size: 1.875rem; line-height: 1; font-weight: 630; letter-spacing: -0.028em; }
.stat-row { display: flex; align-items: center; gap: var(--s2); }

/* Verdict chips: colour plus a dot, so the state never relies on hue alone. */
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 9px 3px 7px; border-radius: 999px;
  font-size: 0.6875rem; font-weight: 620; letter-spacing: 0.03em;
  text-transform: uppercase;
}
.chip::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.chip.green  { color: var(--green);  background: var(--green-dim); }
.chip.yellow { color: var(--yellow); background: var(--yellow-dim); }
.chip.red    { color: var(--red);    background: var(--red-dim); }
.chip.pending { color: var(--text-faint); background: var(--raised-2); }

/* ---- Table ----------------------------------------------------------- */
.table { width: 100%; border-collapse: collapse; }
.table th {
  text-align: left; padding: var(--s2) var(--s3);
  font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--text-faint);
  border-bottom: 1px solid var(--hairline);
  position: sticky; top: 0; background: var(--base); z-index: 1;
}
.table td {
  padding: var(--s3); font-size: 0.8125rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.045);
}
.table tbody tr { transition: background 90ms ease-out; }
.table tbody tr:hover { background: var(--raised); }
.table td.num { font-variant-numeric: tabular-nums; color: var(--text-muted); }

/* ---- Controls -------------------------------------------------------- */
.field {
  display: flex; align-items: center; gap: var(--s2);
  background: var(--raised); border: 1px solid var(--hairline);
  border-radius: var(--radius); padding: 0 var(--s3);
  transition: border-color 140ms ease-out, box-shadow 140ms ease-out;
}
.field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3.5px var(--accent-dim); }
.field input {
  flex: 1; background: none; border: 0; outline: 0; color: var(--text);
  font: inherit; font-size: 0.875rem; padding: var(--s3) 0;
  user-select: text;
}
.field input::placeholder { color: var(--text-faint); }

.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 7px var(--s3); border-radius: var(--radius-sm);
  border: 1px solid var(--hairline); background: var(--raised-2);
  color: var(--text); font: inherit; font-size: 0.8125rem; font-weight: 540;
  transition: background 120ms ease-out, border-color 120ms ease-out;
}
.btn:hover { background: rgba(255, 255, 255, 0.09); border-color: var(--edge-lit); }
.btn:active { transform: scale(0.97); }
.btn.primary { background: var(--accent); border-color: transparent; color: #fff; }
.btn.primary:hover { background: #4aa8ff; }
.btn.danger:hover { background: var(--red-dim); border-color: var(--red); color: var(--red); }
.btn-row { display: flex; gap: var(--s2); }

/* ---- Empty state ----------------------------------------------------- */
.empty {
  display: grid; place-items: center; gap: var(--s2);
  padding: var(--s7) var(--s5); text-align: center;
  border: 1px dashed var(--hairline); border-radius: var(--radius);
  color: var(--text-faint);
}

/* ---- Views ----------------------------------------------------------- */
/* Views stack so an outgoing view can still be on screen while the next
   arrives; motion.ts drives the transform. */
.view-host { position: relative; }
.view { will-change: transform, opacity; }

/* Indeterminate work: a calm pulse, never a spinner that implies progress. */
@keyframes pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.85; } }
.pulsing { animation: pulse 1.4s ease-in-out infinite; }

/* ---- Accessibility --------------------------------------------------- */
/* Reduced motion keeps comprehension cues, drops vestibular movement. */
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
      transition-duration: 120ms !important; }
  .view { transform: none !important; }
}
/* Frostier, not transparent, when translucency is unwelcome. */
@media (prefers-reduced-transparency: reduce) {
  .topbar { background: #10141b; backdrop-filter: none; }
  .sidebar { background: #0e1218; }
}
/* Near-solid surfaces with defined borders at higher contrast. */
@media (prefers-contrast: more) {
  :root { --hairline: rgba(255, 255, 255, 0.3); --text-muted: #c2cad6; --text-faint: #9aa4b2; }
  .card { background: rgba(255, 255, 255, 0.07); }
}
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
`;
