# Gatehouse

> Local-first security gate for npm installs. Transparent rules, public data sources, zero runtime dependencies.

Gatehouse sits in front of `npm install` and gives every package a deterministic verdict before its code ever runs on your machine:

```
$ gatehouse check @cacheable/memory@2.2.1
gatehouse · @cacheable/memory@2.2.1
VERDICT: RED — BLOCK
 • ioc-feed-match: @cacheable/memory is listed as malicious (2.2.1)
sources: wiz-keyv@2026-08-06, datadog-shai-hulud-2@2026-04-13, osv@live, registry@live
checked in 812ms
```

## Why

npm supply-chain worms are now routine: event-stream (2018), xz (2024), Shai-Hulud (2025, two waves), ChainDrop (August 2026) — the last one hitting 450+ packages with ~2 billion combined monthly downloads, stealing npm/GitHub/cloud credentials through lifecycle scripts and republishing itself to victims' own packages.

npm 12 (July 8, 2026) closes the *default execution* half of that problem: dependency install scripts no longer run unless you allow them. That leaves a new question nobody answers for you:

**"Before I allow this package's script to run — what is it actually going to do?"**

Gatehouse exists to answer exactly that. It is built local-first: verdicts come from transparent rules over public data (OpenSSF/OSV, Wiz Research IOCs, DataDog IOCs, the npm registry). No account, no API key, no phone-home. Everything it knows is cached under one directory and checks work offline against the last sync.

## Install

```bash
npm install -g gatehouse
gatehouse sync          # pull current IOC feeds
gatehouse check react   # GREEN → exit code 0
```

Requires Node.js ≥ 20. Detonation additionally requires WSL2 on Windows (optional — every other mode works without it).

### Gate your terminal automatically

```bash
gatehouse shim install   # writes wrappers for npm/npx/bun/pnpm/yarn
gatehouse shim status    # verify they exist and PATH picks them up
```

`shim install` writes `~/.gatehouse/shims` (sh + `.cmd` variants). Put that
directory first on `PATH` and every `npm install <pkg>` / `npx <pkg>` is
checked before the real command runs; RED exits non-zero and the install
never happens. `gatehouse shim uninstall` removes them.

### Gate your AI agent (Claude Code · Cursor · Codex · opencode)

```bash
gatehouse agent connect claude      # PreToolUse hook → ~/.claude/settings.json
gatehouse agent connect cursor      # beforeShellExecution → ~/.cursor/hooks.json
gatehouse agent connect codex       # PreToolUse hook → ~/.codex/hooks.json
gatehouse agent connect opencode    # plugin → ~/.config/opencode/plugin/gatehouse.js
gatehouse agent connect <host> --project   # per-repo instead of per-user
gatehouse agent status              # report every connector at a glance
gatehouse agent disconnect <host>   # remove it
```

Each connector installs the same gate into that host's pre-execution hook, so
every shell command the agent runs is inspected before execution: Gatehouse
extracts each package an `npm`/`npx`/`bun`/`pnpm`/`yarn` install would fetch
and runs the same deterministic gate the CLI uses.

- **RED** → deny. The install is auto-blocked, no prompt.
- **YELLOW** → ask. The human confirms.
- **GREEN** → allow. Silent.

The verdict flags ride back to the agent as structured context, so a blocked
agent can read *why* and pick a safe alternative. The deciding party is always
the deterministic engine — never the agent, which in this threat model may
itself be the adversary. ChainDrop persists via `.claude/settings.json`; this
points the same mechanism the other way.

### Control center (TUI and desktop app)

```bash
gatehouse tui    # terminal control center
gatehouse gui    # desktop app (installed separately, see below)
```

Five surfaces — Dashboard · Packages · Quarantine · Agents · Reports — over the
same engine. The Packages surface lists registry search results with a live
verdict column, the thing no other package browser can show you. Both faces
delegate to the identical gate path; neither can bypass it.

The **TUI** is zero-dependency: raw ANSI against the Node standard library, with
a diffing double buffer so only changed cells are written and frames present
atomically (DEC 2026 synchronized output). Moving a selection costs ~49 bytes
rather than a full repaint, which is why it does not flicker.

The **desktop app** is a real native window — Tao/Wry over the WebView2 runtime
that ships with Windows, about 4 MB rather than the ~100 MB an Electron build
would cost. It has no HTTP server and opens no socket: the document is served
over a custom `app://` scheme and the UI talks to the engine over the webview's
IPC channel, in-process.

#### Installing the desktop app

```bash
npm run bundle -w gatehouse-gui                    # build the application
powershell -ExecutionPolicy Bypass -File gui/release/install.ps1
```

Installs per-user into `%LOCALAPPDATA%\Programs\Gatehouse` — no administrator
rights, nothing written outside your profile. It adds a Start Menu entry and
puts `gatehouse` on your PATH, so **installing the app gives you the CLI and
TUI too**. The reverse is deliberately untrue: `npm install -g gatehouse` never
pulls in the desktop app or its native dependency, and the core package keeps
zero runtime dependencies.

Remove it with `install.ps1 -Uninstall`, which leaves your cached feeds and
history in `~/.gatehouse` alone.

### Quarantine watch & detonation

```bash
gatehouse watch <pkg>      # observe a YELLOW install; RED refused, GREEN needs none
gatehouse watch sweep      # kill any watched pkg that touched a persistence surface; promote the quiet
gatehouse detonate <pkg>   # run the install in a WSL2 sandbox, report captured behavior
```

## Verdicts

Three levels, decided by a deterministic engine — never an LLM, never a black-box score:

| Level | Meaning | Exit code |
|---|---|---|
| **GREEN** | feed-clean, established package | `0` |
| **YELLOW** | suspicious signals — human decides | `1` |
| **RED** | malware evidence — block | `2` |

The rules are short enough to memorize:

| Signal | Source | Verdict |
|---|---|---|
| name@version on a malicious-package list | Wiz Research / DataDog IOC repos | **RED** |
| OSV record classified as malware (`MAL-*` id or CWE-506) | api.osv.dev | **RED** |
| other versions of the same name listed as malicious | IOC feeds | YELLOW |
| version published < 48h ago | npm registry metadata | YELLOW |
| declares `preinstall` / `install` / `postinstall` | package.json | YELLOW (+ shows you the script body) |
| registry unreachable | — | YELLOW (**fails safe — never silently passes**) |

Anything not on that table does not affect the verdict. There is no hidden scoring.

## Design principles

- **Zero runtime dependencies.** The engine, CLI and TUI are TypeScript against the Node standard library. A supply-chain security tool that ships no supply chain of its own. The desktop app is a separate package precisely so its one native dependency stays out of the tool everyone installs — including its animation: the springs are ~40 lines of hand-written physics rather than a motion library.
- **Deterministic engine, structured output.** Same input → same verdict. `--json` emits machine-readable results; exit codes are a stable contract for shell wrappers, CI jobs and AI-agent hooks.
- **Evidence, not vibes.** Every verdict lists its reasons with codes (`ioc-feed-match`, `recent-publish`, ...) and the exact sources consulted.
- **Fail safe.** If Gatehouse cannot verify (registry down, feeds stale), the verdict degrades to YELLOW with the reason stated. It will never tell you "fine" when it doesn't know.
- **Sandboxes prove guilt, never innocence.** GREEN means "no known evidence of malice", nothing more.

## Limitations

- Shims and agent hooks gate the specs named on the command line, not the full transitive tree a resolver pulls in.
- Detonation requires WSL2 on Windows (`wsl --install`); native namespaces on Linux. Without it, every other mode still works — the gate, shims, agent hooks, watch, TUI and GUI need no sandbox.
- The verdict engine reads public IOC feeds + registry metadata; it is not a full static/behavioral analysis of source. Detonation adds the behavioral half on demand.

## Roadmap

- [x] **M0** Feed sync + deterministic verdict engine + CLI
- [x] **M1** PATH shims so terminal installs route through the gate automatically
- [x] **M2** AI-agent connectors — Claude Code · Cursor · Codex · opencode pre-execution hooks; gate every agent-run install, return structured verdict flags
- [x] **TUI** Dashboard · Packages · Quarantine · Agents · Reports (zero-dep ANSI)
- [x] **M4** Detonation sandbox (WSL2): lifecycle-script execution under network-namespace isolation with DNS sinkhole + C2 capture, categorized evidence reports
- [x] **M5** Quarantine watch: observed installs, auto-promote / kill on persistence-surface tampering
- [x] **GUI** Standalone desktop app (separate install) over the same core

## Architecture

```
  gatehouse (zero deps)              gatehouse-gui (separate install)
┌────────────────────────────┐     ┌────────────────────────────────┐
│  CLI · TUI · agent hooks   │     │  native window (WebView2)      │
│  shell shims               │     │  no socket, IPC in-process     │
└─────────────┬──────────────┘     └───────────────┬────────────────┘
              │                                    │
              └───────────────┬────────────────────┘
                              │ same gate path, always
┌─────────────────────────────┴──────────────────────────────────────┐
│                            core engine                             │
│   parse spec → IOC lookup ─┬─ OSV query ─┐                         │
│                            ├─ registry ──┤→ evaluate (pure)        │
│   deterministic rules      └─────────────┘                         │
├────────────────────────────────────────────────────────────────────┤
│   history (encounters · quarantine)      +   WSL2 detonation       │
├────────────────────────────────────────────────────────────────────┤
│   local cache (~/.gatehouse) — feeds, TTL, offline                 │
└────────────────────────────────────────────────────────────────────┘
```

The core never depends on a surface, and no surface may bypass the gate path.
The dependency between the two packages runs one way only: the app reaches the
core through its published `exports`, and the core knows nothing about the app.

## Data sources

All public, all fetched to your machine:

| Source | Used for |
|---|---|
| [Wiz research IOCs](https://github.com/wiz-sec-public/wiz-research-iocs) | ChainDrop-family malicious packages |
| [DataDog indicators-of-compromise](https://github.com/DataDog/indicators-of-compromise) | Shai-Hulud wave 2 |
| [OSV / OpenSSF malicious-packages](https://api.osv.dev) | confirmed malware records |
| npm registry | publish dates, lifecycle scripts, maintainers |

Feed refresh defaults to every 12h; `gatehouse sync` forces it.

## Development

```bash
git clone <this repo>
cd gatehouse
npm install
npm run build                    # core: tsc -> dist/
npm run build:gui                # core + desktop app
npm run bundle -w gatehouse-gui  # build the installable application
npm test                         # unit tests (offline, fixture-based)
npm run smoke                    # M0 thesis test (network): blocks a real ChainDrop IOC,
                                 # passes express, <2s overhead
```

The repo is an npm workspace: the root package is the zero-dependency core, and
`gui/` is the desktop app. Building the app needs Node ≥ 24 (its native addon)
and the C# compiler that ships with Windows, used to produce the GUI-subsystem
launcher so no console window appears. Nothing else is required — no Rust, no
Visual Studio, no bundler.

## License

MIT — see [LICENSE](LICENSE).
