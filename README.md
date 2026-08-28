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

npm 12 (August 2026) closes the *default execution* half of that problem: install scripts no longer run unless you allow them. That leaves a new question nobody answers for you:

**"Before I allow this package's script to run — what is it actually going to do?"**

Gatehouse exists to answer exactly that. It is built local-first: verdicts come from transparent rules over public data (OpenSSF/OSV, Wiz Research IOCs, DataDog IOCs, the npm registry). No account, no API key, no phone-home. Everything it knows is cached under one directory and checks work offline against the last sync.

## Install

```bash
npm install -g gatehouse
gatehouse sync          # pull current IOC feeds
gatehouse check react   # GREEN → exit code 0
```

Requires Node.js ≥ 20.

### Gate your terminal automatically

```bash
gatehouse shim install   # writes wrappers for npm/npx/bun/pnpm/yarn
gatehouse shim status    # verify they exist and PATH picks them up
```

`shim install` writes `~/.gatehouse/shims` (sh + `.cmd` variants). Put that
directory first on `PATH` and every `npm install <pkg>` / `npx <pkg>` is
checked before the real command runs; RED exits non-zero and the install
never happens. `gatehouse shim uninstall` removes them.

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

## What this does NOT do (yet)

- It does not detonate packages — behavioral sandbox analysis (WSL2 + fake internet) is on the roadmap below.
- It does not watch already-installed packages over time.
- Shims gate the specs named on the command line, not the full transitive tree a resolver pulls in.

## Roadmap

- [x] **M0** Feed sync + deterministic verdict engine + CLI (this release)
- [x] **M1** PATH shims so terminal installs route through the gate automatically
- [ ] **M2** AI-agent connectors — Claude Code `PreToolUse` hook first, then opencode / Codex / Cursor
- [ ] **TUI** Dashboard · Quarantine · Packages · Agents · Reports tabs
- [ ] **M4** Detonation sandbox v1 (WSL2): lifecycle-script execution with DNS sinkhole, C2 capture, evidence reports
- [ ] **M5** Quarantine watch: monitored installs, auto-promote / rollback
- [ ] **GUI** Optional desktop face over the same core

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                 surfaces (planned)                   │
│        TUI ─ GUI ─ agent hooks ─ shell shims         │
└───────────────────────┬──────────────────────────────┘
                        │ same gate path, always
┌───────────────────────┴──────────────────────────────┐
│                     core engine                      │
│  parse spec → IOC lookup ─┬─ OSV query ─┐            │
│                           ├─ registry ──┤→ evaluate  │
│  deterministic rules      └─────────────┘  (pure)    │
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
