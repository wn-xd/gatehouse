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

### Control center (TUI / GUI)

```bash
gatehouse tui    # terminal control center (zero-dep ANSI)
gatehouse gui    # same, in a browser on 127.0.0.1 (loopback only)
```

Five tabs — Dashboard · Packages · Quarantine · Agents · Reports — over the
same engine. The Packages tab renders npm search results with a live verdict
column, the differentiator no other package browser can show. Both faces
delegate to the identical gate path; neither can bypass it.

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

- **Zero runtime dependencies.** The entire engine is TypeScript against the Node standard library. A supply-chain security tool that ships no supply chain of its own.
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
- [x] **GUI** Optional loopback browser face over the same core

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                      surfaces                        │
│   CLI ─ TUI ─ GUI ─ agent hooks ─ shell shims        │
└───────────────────────┬──────────────────────────────┘
                        │ same gate path, always
┌───────────────────────┴──────────────────────────────┐
│                     core engine                      │
│  parse spec → IOC lookup ─┬─ OSV query ─┐            │
│                           ├─ registry ──┤→ evaluate  │
│  deterministic rules      └─────────────┘  (pure)    │
├──────────────────────────────────────────────────────┤
│  history (encounters · quarantine)  +  WSL2 detonate │
├──────────────────────────────────────────────────────┤
│  local cache (~/.gatehouse) - feeds, TTL, offline    │
└──────────────────────────────────────────────────────┘
```
The core never depends on a surface, and no surface may bypass the gate path.

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
npm run build     # tsc -> dist/
npm test          # unit tests (offline, fixture-based)
npm run smoke     # M0 thesis test (network): blocks real ChainDrop IOC, passes express, <2s overhead
```

## License

MIT — see [LICENSE](LICENSE).
