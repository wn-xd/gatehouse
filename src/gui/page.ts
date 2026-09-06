/**
 * The entire GUI as one self-contained HTML document: vanilla JS, inline CSS,
 * no build step, no framework, no CDN — served verbatim. Same five tabs and
 * same verdicts as the TUI, over the same core via the loopback JSON API. A
 * template literal keeps it a single shippable string with zero supply chain.
 */
export const GUI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>gatehouse</title>
<style>
  :root {
    --bg: #0d1117; --panel: #161b22; --line: #30363d; --fg: #c9d1d9;
    --dim: #8b949e; --green: #3fb950; --yellow: #d29922; --red: #f85149; --cyan: #39c5cf;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
    font: 14px/1.5 ui-monospace, "Cascadia Code", Menlo, Consolas, monospace; }
  header { display: flex; align-items: center; gap: 16px; padding: 10px 16px;
    border-bottom: 1px solid var(--line); background: var(--panel); }
  header .brand { color: var(--cyan); font-weight: 700; }
  nav { display: flex; gap: 4px; }
  nav button { background: none; border: 1px solid transparent; color: var(--dim);
    padding: 6px 12px; cursor: pointer; border-radius: 6px; font: inherit; }
  nav button.active { color: var(--fg); background: var(--bg); border-color: var(--line); }
  main { padding: 16px; }
  h2 { font-size: 15px; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); }
  th { color: var(--dim); font-weight: 600; }
  .lvl { font-weight: 700; }
  .green { color: var(--green); } .yellow { color: var(--yellow); } .red { color: var(--red); }
  .dim { color: var(--dim); }
  input[type=text] { background: var(--bg); border: 1px solid var(--line); color: var(--fg);
    padding: 8px 10px; border-radius: 6px; font: inherit; width: 360px; }
  button.act { background: var(--bg); border: 1px solid var(--line); color: var(--fg);
    padding: 5px 10px; border-radius: 6px; cursor: pointer; font: inherit; }
  button.act:hover { border-color: var(--cyan); }
  .stat { display: inline-block; margin-right: 20px; font-size: 18px; }
  .pill { padding: 1px 8px; border-radius: 10px; border: 1px solid var(--line); font-size: 12px; }
  .row-actions { display: flex; gap: 6px; }
  .note { color: var(--dim); font-size: 12px; margin-top: 10px; }
</style>
</head>
<body>
<header>
  <span class="brand">gatehouse</span>
  <nav id="tabs"></nav>
  <span id="feed" class="dim" style="margin-left:auto"></span>
</header>
<main id="view"></main>
<script>
const TABS = ["Dashboard", "Packages", "Quarantine", "Agents", "Reports"];
let active = "Dashboard";

const el = (t, a = {}, kids = []) => {
  const n = document.createElement(t);
  for (const [k, v] of Object.entries(a)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) n.append(kid);
  return n;
};
const api = async (path, opts) => (await fetch(path, opts)).json();
const lvlClass = (l) => l === "red" ? "red" : l === "yellow" ? "yellow" : "green";

function renderTabs() {
  const nav = document.getElementById("tabs");
  nav.replaceChildren(...TABS.map((t) =>
    el("button", { class: t === active ? "active" : "", onclick: () => { active = t; render(); } }, t)));
}

async function render() {
  renderTabs();
  const view = document.getElementById("view");
  view.replaceChildren(el("div", { class: "dim" }, "loading…"));
  if (active === "Dashboard") return renderDashboard(view);
  if (active === "Packages") return renderPackages(view);
  if (active === "Quarantine") return renderQuarantine(view);
  if (active === "Agents") return renderAgents(view);
  if (active === "Reports") return renderReports(view);
}

async function renderDashboard(view) {
  const d = await api("/api/dashboard");
  const feed = document.getElementById("feed");
  feed.textContent = d.feed.synced
    ? d.feed.entries + " IOCs · " + d.feed.ageHours + "h ago" + (d.feed.stale ? " (stale)" : "")
    : "feeds not synced";
  const stats = el("div", {}, [
    el("span", { class: "stat green" }, "GREEN " + d.stats.green),
    el("span", { class: "stat yellow" }, "YELLOW " + d.stats.yellow),
    el("span", { class: "stat red" }, "RED " + d.stats.red),
  ]);
  view.replaceChildren(el("h2", {}, "Dashboard"), stats,
    el("h2", { style: "margin-top:20px" }, "Recent encounters"), encTable(d.recent));
}

function encTable(rows) {
  if (!rows.length) return el("div", { class: "dim" }, "no encounters yet");
  const head = el("tr", {}, ["WHEN", "LEVEL", "PACKAGE", "SOURCE"].map((h) => el("th", {}, h)));
  const body = rows.map((e) => el("tr", {}, [
    el("td", { class: "dim" }, e.at.replace("T", " ").slice(0, 19)),
    el("td", { class: "lvl " + lvlClass(e.level) }, e.level.toUpperCase()),
    el("td", {}, e.version ? e.name + "@" + e.version : e.name),
    el("td", { class: "dim" }, e.source),
  ]));
  return el("table", {}, [head, ...body]);
}

async function renderPackages(view) {
  const box = el("input", { type: "text", placeholder: "search npm — verdicts render inline" });
  const results = el("div", {});
  const search = async () => {
    if (!box.value.trim()) return;
    results.replaceChildren(el("div", { class: "dim" }, "searching…"));
    const { hits, error } = await api("/api/search?q=" + encodeURIComponent(box.value.trim()));
    if (error) return results.replaceChildren(el("div", { class: "yellow" }, error));
    const head = el("tr", {}, ["VERDICT", "PACKAGE", "VERSION", "DESCRIPTION"].map((h) => el("th", {}, h)));
    const rowEls = hits.map((h) => {
      const vc = el("td", { class: "lvl dim" }, "·····");
      const tr = el("tr", {}, [vc, el("td", {}, h.name),
        el("td", { class: "dim" }, h.version), el("td", { class: "dim" }, h.description || "")]);
      api("/api/check?spec=" + encodeURIComponent(h.name)).then((v) => {
        if (v && v.level) { vc.textContent = v.level.toUpperCase(); vc.className = "lvl " + lvlClass(v.level); }
      });
      return tr;
    });
    results.replaceChildren(el("table", {}, [head, ...rowEls]));
  };
  box.addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
  view.replaceChildren(el("h2", {}, "Packages"),
    el("div", {}, [box, " ", el("button", { class: "act", onclick: search }, "Search")]),
    el("div", { style: "margin-top:12px" }, results));
}

async function renderQuarantine(view) {
  const { entries } = await api("/api/quarantine");
  view.replaceChildren(el("h2", {}, "Quarantine"));
  if (!entries.length) return view.append(el("div", { class: "dim" }, "no packages under watch"));
  const head = el("tr", {}, ["STATE", "PACKAGE", "SINCE", "REASONS", ""].map((h) => el("th", {}, h)));
  const body = entries.map((e) => {
    const act = async (state) => { await api("/api/quarantine", { method: "POST",
      body: JSON.stringify({ name: e.name, version: e.version, state }) }); render(); };
    return el("tr", {}, [
      el("td", { class: "lvl " + (e.state === "promoted" ? "green" : e.state === "killed" ? "red" : "yellow") }, e.state),
      el("td", {}, e.version ? e.name + "@" + e.version : e.name),
      el("td", { class: "dim" }, e.since.replace("T", " ").slice(0, 19)),
      el("td", { class: "dim" }, (e.reasonCodes || []).join(", ")),
      el("td", {}, el("div", { class: "row-actions" }, [
        el("button", { class: "act", onclick: () => act("promoted") }, "promote"),
        el("button", { class: "act", onclick: () => act("killed") }, "kill"),
      ])),
    ]);
  });
  view.append(el("table", {}, [head, ...body]));
}

async function renderAgents(view) {
  const { scope, connectors } = await api("/api/agents");
  view.replaceChildren(el("h2", {}, "Agents — scope: " + scope));
  const head = el("tr", {}, ["STATUS", "AGENT", ""].map((h) => el("th", {}, h)));
  const body = connectors.map((c) => {
    const toggle = async () => { await api("/api/agents", { method: "POST",
      body: JSON.stringify({ id: c.id, scope, action: c.connected ? "disconnect" : "connect" }) }); render(); };
    return el("tr", {}, [
      el("td", { class: c.connected ? "green" : "dim" }, c.connected ? "connected" : "not connected"),
      el("td", {}, c.label),
      el("td", {}, el("button", { class: "act", onclick: toggle }, c.connected ? "disconnect" : "connect")),
    ]);
  });
  view.append(el("table", {}, [head, ...body]),
    el("div", { class: "note" }, "connect writes the same PreToolUse gate hook the CLI does"));
}

async function renderReports(view) {
  const { encounters } = await api("/api/reports");
  view.replaceChildren(el("h2", {}, encounters.length + " scans (newest first)"), encTable(encounters));
}

render();
</script>
</body>
</html>`;
