import { MOTION_JS } from './motion.js';
import { STYLES } from './styles.js';

/**
 * The application document.
 *
 * One self-contained HTML string: no bundler, no framework, no CDN. The UI is
 * built from small render functions over plain DOM, which keeps the whole face
 * auditable — appropriate for a tool whose entire premise is that you should be
 * able to see what your software does.
 *
 * Every surface asks the engine for data over IPC and renders the answer; no
 * view computes a verdict itself, so the app cannot drift from the CLI.
 */
export const PAGE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<title>Gatehouse</title>
<style>${STYLES}</style>
</head>
<body>
<div id="app">
  <aside class="sidebar">
    <div class="titlebar">
      <span class="brand"><span class="brand-mark"></span>Gatehouse</span>
    </div>
    <nav class="nav" id="nav">
      <div class="nav-indicator" id="indicator"></div>
    </nav>
    <div class="sidebar-foot">
      <div class="t-caps" id="feed-state">checking feeds</div>
    </div>
  </aside>

  <main class="content">
    <header class="topbar">
      <span class="t-label" id="crumb"></span>
      <div class="win-controls">
        <button class="win-btn" id="win-min" title="Minimize">&#x2500;</button>
        <button class="win-btn" id="win-max" title="Maximize">&#x25a1;</button>
        <button class="win-btn close" id="win-close" title="Close">&#x2715;</button>
      </div>
    </header>
    <div class="scroll view-host" id="host"></div>
  </main>
</div>

<script>
${MOTION_JS}

// ---- IPC ---------------------------------------------------------------
// Each request carries an id; the host replies on the same id via __resolve.
let nextId = 1;
const pending = new Map();

window.__resolve = (json) => {
  const msg = JSON.parse(json);
  const entry = pending.get(msg.id);
  if (!entry) return;
  pending.delete(msg.id);
  if (msg.ok) entry.resolve(msg.result);
  else entry.reject(new Error(msg.error || 'request failed'));
};

function callHost(route, payload) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    window.ipc.postMessage(JSON.stringify({ id, route, payload: payload || {} }));
    // A hung host must not leave the UI waiting forever with no explanation.
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('the engine did not respond')); }
    }, 30000);
  });
}
const send = (route) => window.ipc.postMessage(JSON.stringify({ id: 0, route }));

// ---- Tiny DOM helper ---------------------------------------------------
function h(tag, attrs, kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const kid of [].concat(kids || [])) {
    if (kid === null || kid === undefined) continue;
    el.append(kid);
  }
  return el;
}
const icon = (d) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'nav-icon');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  svg.append(p);
  return svg;
};

const fmtSpec = (name, version) => (version ? name + '@' + version : name);
const fmtWhen = (iso) => String(iso).replace('T', ' ').slice(0, 19);
const chip = (level) => h('span', { class: 'chip ' + level, text: level });

// ---- Surfaces ----------------------------------------------------------
// Named for their contents, never a vague umbrella like "Home".
const SURFACES = [
  { id: 'overview',   label: 'Overview',   glyph: 'M2 9.5 8 3l6 6.5M4 8.5V13h8V8.5' },
  { id: 'packages',   label: 'Packages',   glyph: 'M7.2 2.4 2.6 4.9v6.2l4.6 2.5 4.6-2.5V4.9zM2.6 4.9l4.6 2.5 4.6-2.5M7.2 7.4v6.2' },
  { id: 'quarantine', label: 'Quarantine', glyph: 'M8 2 3 4v4c0 3 2.2 5.2 5 6 2.8-.8 5-3 5-6V4z' },
  { id: 'agents',     label: 'Agents',     glyph: 'M5.5 3h5M4 6h8v6H4zM6.5 9h3' },
  { id: 'reports',    label: 'Reports',    glyph: 'M4 2.5h5.5L12 5v8.5H4zM9.5 2.5V5H12M6 8h4M6 10.5h4' },
];

let current = 'overview';
let indicatorSpring = null;

function buildNav() {
  const nav = document.getElementById('nav');
  for (const surface of SURFACES) {
    const btn = h('button', {
      class: 'nav-item',
      id: 'nav-' + surface.id,
      onclick: () => navigate(surface.id),
    }, [icon(surface.glyph), h('span', { text: surface.label })]);
    nav.append(btn);
  }
}

/**
 * Move the selection indicator to the active item.
 *
 * One element travels between items rather than a highlight disappearing here
 * and reappearing there — the movement is what tells you the two states are
 * related. It runs on a spring so repeated clicks retarget mid-flight instead
 * of queueing.
 */
function moveIndicator(id) {
  const btn = document.getElementById('nav-' + id);
  const nav = document.getElementById('nav');
  const indicator = document.getElementById('indicator');
  if (!btn) return;
  const target = btn.offsetTop + (btn.offsetHeight - 18) / 2 - nav.offsetTop;

  if (indicatorSpring) { indicatorSpring.to(target); return; }
  indicatorSpring = spring(target, target, SPRING.ui, (y) => {
    indicator.style.transform = 'translateY(' + y + 'px)';
  });
}

/**
 * Switch surfaces.
 *
 * Enter and exit share one axis so the spatial relationship holds: the outgoing
 * view leaves the way the incoming one arrives. The shift is deliberately small
 * — enough to say "this replaced that", not a slide show.
 */
async function navigate(id) {
  if (id === current && document.getElementById('host').childElementCount > 0) return;
  current = id;

  for (const surface of SURFACES) {
    const btn = document.getElementById('nav-' + surface.id);
    if (surface.id === id) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  document.getElementById('crumb').textContent =
    SURFACES.find((s) => s.id === id).label;
  moveIndicator(id);

  const host = document.getElementById('host');
  host.replaceChildren(h('div', { class: 'view t-body faint pulsing', text: 'Loading' }));

  let view;
  try {
    view = await RENDERERS[id]();
  } catch (err) {
    view = h('div', { class: 'empty' }, [
      h('div', { class: 't-title', text: 'Could not load' }),
      h('div', { class: 't-body', text: err.message }),
    ]);
  }
  if (current !== id) return; // a newer navigation already won

  const wrap = h('div', { class: 'view' }, [view]);
  host.replaceChildren(wrap);

  // Arrive along the axis, settling with no overshoot (nothing was thrown).
  spring(10, 0, SPRING.ui, (y, v) => {
    wrap.style.transform = 'translateY(' + y + 'px)';
    wrap.style.opacity = String(Math.max(0, 1 - Math.abs(y) / 14));
  });
}

// ---- Overview ----------------------------------------------------------
async function renderOverview() {
  const data = await callHost('dashboard/load');
  const feedEl = document.getElementById('feed-state');
  feedEl.textContent = data.feed.synced
    ? data.feed.entries + ' IOCs · ' + data.feed.ageHours + 'h ago' + (data.feed.stale ? ' · stale' : '')
    : 'feeds not synced';

  const stat = (label, value, level) => h('div', { class: 'card stat' }, [
    h('div', { class: 't-caps', text: label }),
    h('div', { class: 'stat-row' }, [
      h('div', { class: 'stat-value', text: String(value), style: 'color: var(--' + level + ')' }),
    ]),
  ]);

  return h('div', {}, [
    h('div', { class: 'page-head' }, [
      h('h1', { class: 't-display', text: 'Overview' }),
      h('p', { class: 't-body muted', text: 'Every verdict this machine has recorded.' }),
    ]),
    h('div', { class: 'stat-grid' }, [
      stat('Allowed', data.stats.green, 'green'),
      stat('Needs review', data.stats.yellow, 'yellow'),
      stat('Blocked', data.stats.red, 'red'),
    ]),
    h('div', { style: 'margin-top: var(--s5)' }, [
      h('h2', { class: 't-title', style: 'margin-bottom: var(--s3)', text: 'Recent activity' }),
      data.recent.length === 0
        ? h('div', { class: 'empty' }, [
            h('div', { class: 't-body', text: 'No packages checked yet.' }),
          ])
        : encounterTable(data.recent),
    ]),
  ]);
}

function encounterTable(rows) {
  return h('table', { class: 'table' }, [
    h('thead', {}, h('tr', {}, [
      h('th', { text: 'Verdict' }), h('th', { text: 'Package' }),
      h('th', { text: 'Source' }), h('th', { text: 'When' }),
    ])),
    h('tbody', {}, rows.map((e) => h('tr', {}, [
      h('td', {}, chip(e.level)),
      h('td', { class: 't-mono', text: fmtSpec(e.name, e.version) }),
      h('td', { class: 'num', text: e.source }),
      h('td', { class: 'num', text: fmtWhen(e.at) }),
    ]))),
  ]);
}

// ---- Packages ----------------------------------------------------------
// Search with a live verdict column: the one thing no other package browser
// can show you.
async function renderPackages() {
  const results = h('div', { style: 'margin-top: var(--s4)' });
  const input = h('input', {
    type: 'text', placeholder: 'Search npm', spellcheck: 'false',
    onkeydown: (e) => { if (e.key === 'Enter') run(); },
  });

  async function run() {
    const query = input.value.trim();
    if (query === '') return;
    results.replaceChildren(h('div', { class: 't-body faint pulsing', text: 'Searching' }));
    let hits;
    try {
      hits = (await callHost('packages/search', { query })).hits;
    } catch (err) {
      results.replaceChildren(h('div', { class: 't-body', style: 'color: var(--yellow)', text: err.message }));
      return;
    }
    if (hits.length === 0) {
      results.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 't-body', text: 'No packages matched.' })));
      return;
    }

    const body = h('tbody', {});
    for (const hit of hits) {
      const cell = h('td', {}, chip('pending'));
      cell.firstChild.textContent = 'checking';
      body.append(h('tr', {}, [
        cell,
        h('td', { class: 't-mono', text: hit.name }),
        h('td', { class: 'num', text: hit.version }),
        h('td', { class: 'muted', text: hit.description || '' }),
      ]));
      // Gate every hit through the same engine the CLI uses.
      callHost('packages/check', { spec: hit.name })
        .then((verdict) => cell.replaceChildren(chip(verdict.level)))
        .catch(() => {
          const c = chip('yellow'); c.textContent = 'unknown';
          cell.replaceChildren(c);
        });
    }
    results.replaceChildren(h('table', { class: 'table' }, [
      h('thead', {}, h('tr', {}, [
        h('th', { text: 'Verdict' }), h('th', { text: 'Package' }),
        h('th', { text: 'Version' }), h('th', { text: 'Description' }),
      ])),
      body,
    ]));
  }

  return h('div', {}, [
    h('div', { class: 'page-head' }, [
      h('h1', { class: 't-display', text: 'Packages' }),
      h('p', { class: 't-body muted', text: 'Search the registry. Every result carries its verdict.' }),
    ]),
    h('div', { class: 'field' }, [input, h('button', { class: 'btn primary', text: 'Search', onclick: run })]),
    results,
  ]);
}

// ---- Quarantine --------------------------------------------------------
async function renderQuarantine() {
  const { entries } = await callHost('quarantine/load');
  const head = h('div', { class: 'page-head' }, [
    h('h1', { class: 't-display', text: 'Quarantine' }),
    h('p', { class: 't-body muted', text: 'Packages installed under observation.' }),
  ]);
  if (entries.length === 0) {
    return h('div', {}, [head, h('div', { class: 'empty' }, [
      h('div', { class: 't-title', text: 'Nothing under watch' }),
      h('div', { class: 't-body', text: 'Packages that need review appear here while they are observed.' }),
    ])]);
  }

  const stateChip = (state) => {
    const level = state === 'promoted' ? 'green' : state === 'killed' ? 'red' : 'yellow';
    const c = chip(level); c.textContent = state; return c;
  };
  const act = async (entry, state) => {
    await callHost('quarantine/set', { name: entry.name, version: entry.version, state });
    navigate('quarantine');
  };

  return h('div', {}, [head, h('table', { class: 'table' }, [
    h('thead', {}, h('tr', {}, [
      h('th', { text: 'State' }), h('th', { text: 'Package' }),
      h('th', { text: 'Reasons' }), h('th', { text: 'Since' }), h('th', { text: '' }),
    ])),
    h('tbody', {}, entries.map((e) => h('tr', {}, [
      h('td', {}, stateChip(e.state)),
      h('td', { class: 't-mono', text: fmtSpec(e.name, e.version) }),
      h('td', { class: 'muted', text: (e.reasonCodes || []).join(', ') }),
      h('td', { class: 'num', text: fmtWhen(e.since) }),
      h('td', {}, h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn', text: 'Promote', onclick: () => act(e, 'promoted') }),
        h('button', { class: 'btn danger', text: 'Kill', onclick: () => act(e, 'killed') }),
      ])),
    ]))),
  ])]);
}

// ---- Agents ------------------------------------------------------------
async function renderAgents() {
  let scope = 'user';
  const list = h('div', { class: 'row-gap' });

  async function load() {
    const data = await callHost('agents/load', { scope });
    list.replaceChildren(...data.connectors.map((c) => h('div', {
      class: 'card',
      style: 'display:flex; align-items:center; gap:var(--s3)',
    }, [
      h('div', { style: 'flex:1' }, [
        h('div', { class: 't-title', text: c.label }),
        h('div', { class: 't-label', text: c.connected ? 'Gated' : 'Not gated' }),
      ]),
      h('button', {
        class: c.connected ? 'btn' : 'btn primary',
        text: c.connected ? 'Disconnect' : 'Connect',
        onclick: async (e) => {
          e.target.disabled = true;
          await callHost('agents/toggle', { id: c.id, scope });
          await load();
        },
      }),
    ])));
  }

  const scopeBtn = h('button', { class: 'btn', text: 'Scope: user' });
  scopeBtn.addEventListener('click', async () => {
    scope = scope === 'user' ? 'project' : 'user';
    scopeBtn.textContent = 'Scope: ' + scope;
    await load();
  });

  await load();
  return h('div', {}, [
    h('div', { class: 'page-head' }, [
      h('h1', { class: 't-display', text: 'Agents' }),
      h('p', { class: 't-body muted', text: 'Route an AI agent\u2019s installs through the gate.' }),
    ]),
    h('div', { style: 'margin-bottom: var(--s4)' }, scopeBtn),
    list,
  ]);
}

// ---- Reports -----------------------------------------------------------
async function renderReports() {
  const { encounters } = await callHost('reports/load');
  return h('div', {}, [
    h('div', { class: 'page-head' }, [
      h('h1', { class: 't-display', text: 'Reports' }),
      h('p', { class: 't-body muted', text: encounters.length + ' scans recorded, newest first.' }),
    ]),
    encounters.length === 0
      ? h('div', { class: 'empty' }, h('div', { class: 't-body', text: 'No scans recorded yet.' }))
      : encounterTable(encounters),
  ]);
}

const RENDERERS = {
  overview: renderOverview,
  packages: renderPackages,
  quarantine: renderQuarantine,
  agents: renderAgents,
  reports: renderReports,
};

// ---- Boot --------------------------------------------------------------
document.getElementById('win-min').onclick = () => send('window/minimize');
document.getElementById('win-max').onclick = () => send('window/maximize');
document.getElementById('win-close').onclick = () => send('window/close');

buildNav();
navigate('overview');
</script>
</body>
</html>`;
