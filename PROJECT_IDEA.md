# GATEHOUSE (working name)

> Local-first security gate, behavior sandbox, and unified control center for npm/npx/bun — with native protection for AI agents that install packages.
>
> **Pitch:** "The anti-Socket. No black box, no phone-home."
> **Analogy:** Playnite for game launchers — a unified face over existing managers, except every package wears its criminal record.

---

## 1. THE PROBLEM (all verified with research, Aug 2026)

- npm supply-chain attacks are escalating: **event-stream (2018) → xz (2024) → Shai-Hulud worm, two waves in 2025 → ChainDrop (Aug 2026)**. ChainDrop alone compromised `keyv`, `cacheable`, `flat-cache` and 450+ packages with ~2 billion combined monthly downloads.
- ChainDrop's flow: `preinstall` hook → drops AES-GCM encrypted payload → steals 300+ credential types (npm tokens, GitHub tokens, cloud keys, AI tool sessions, wallets) → **republishes malware to every package the victim owns** (self-propagating worm via the trust graph).
- It persists by injecting hooks into `.claude/settings.json` (Claude Code SessionStart) and `.vscode/tasks.json` — **attackers already treat AI-agent configs as infrastructure**.
- Existing defenses are static and deaf after install:
  - **Socket** (24.5k★, commercial): scans code at publish time server-side; can't detonate or observe runtime behavior on your machine.
  - **Aikido Safe Chain** (1.7k★, free): shell-shim gate blocking IOC-feed matches + packages <48h old. Good — but black-box feed, no behavior analysis, no agent-native UX, no local evidence trail.
  - Nothing watches what installed packages *do* later. Nothing guards installs executed autonomously by AI agents (Claude Code / Cursor / Codex running `npm install` without a human seeing the package name).

### Why attacks still succeed despite existing tools
1. Attacks abuse **trusted identity + trusted update paths**, not obviously-malicious code.
2. Detection is reactive — early installers ARE the sensor network; CI bots auto-install within minutes.
3. Payloads are obfuscated (Base91 + AES-256-GCM) — static scanners see ciphertext until it detonates somewhere.
4. The payload hides where nobody scans: dev machines, `.npmrc` tokens, AI-tool configs.
5. Adoption gap: even free tools reach <1% of devs (safe-chain ≈208k downloads/week vs billions of npm operations).

---

## 2. WHAT WE'RE BUILDING

Three engine layers + one control surface:

### Layer 1 — GATE (instant, runs on every install)
Shell shims wrap `npm` / `npx` / `bun` on PATH (safe-chain technique). Every install passes deterministic checks:

| Check | Source | Verdict contribution |
|---|---|---|
| name@version on malicious-package feeds | OSSF malicious-packages (OSV), DataDog IOCs, Wiz research lists | RED — hard block |
| Version published <48h ago | registry metadata | YELLOW |
| Lifecycle scripts present (`preinstall`/`postinstall`/`install`) | tarball/package.json | YELLOW (+ show script content) |
| Suspicious diff signals vs previous version | registry diff | YELLOW |

Output: **GREEN / YELLOW / RED** verdict with reasons. GREEN = silent allow. RED = block always, no prompt. YELLOW = human decides (interactive) or quarantine/consolidated-consent (agent mode).

### Layer 2 — DETONATE (deep analysis, only for flagged/suspicious)
Sandboxed execution in **WSL2** (Linux namespaces + seccomp):

- Executes lifecycle scripts + a **probe harness** that actually USES the library (import, enumerate exports, call functions with benign sample inputs) — because most npm packages are libraries you can't just "run".
- **Fake internet inside**: local DNS sinkhole + fake web services. Every outbound connection is logged and answered with garbage — nothing real leaves the machine, but every C2 endpoint the package tries to reach is captured as evidence.
- Records: process tree, files touched (especially persistence surfaces like `.claude/settings.json`, `.vscode/tasks.json`, shell profiles), credentials/env vars read, ports opened (e.g. "requires :8080"), endpoints contacted.
- Output is an **evidence report, not a risk score**: "read ~/.npmrc · POSTed to 185.x.x.x · wrote Claude Code hook". Categories: `malicious-indicators` / `suspicious` / `unremarkable`. Never "safe" — sandboxes prove guilt, never innocence.

### Layer 3 — QUARANTINE WATCH
YELLOW packages can be installed into watch mode: fully functional but monitored for a few days (file/network/persistence monitors). Quiet → promoted automatically. Wakes up misbehaving at 3am → caught, flagged, rolled back.

### The Control Surface — App (TUI first, then GUI — ship both, install what you need)
Playnite model: **the app never replaces the package manager — it's the unified face over it.** Every action (search, install, remove) delegates to real npm through the same gated path the terminal uses. No bypass shortcut ever.

Two faces, one engine: the **TUI ships first** (lives where the work happens). The **GUI follows as an optional, separately-installable component** — users install the face they want (`gatehouse` core + TUI always; `gatehouse-gui` on demand). Same tabs, same verdicts, same reports, same gate path underneath.

Tabs (locked):
```
Dashboard   — recent encounters, feed sync status, live telemetry
Quarantine  — watch-mode packages, promote / kill buttons
Packages    — npm registry search where every result shows its live
              safety verdict inline; one-click install (background queue)
Agents      — connect/disconnect AI agents ("Connect Claude Code" writes/
              cleans .claude/settings.json hooks in one click)
Policy      — gate.config editor (policy-as-code, committable per repo)
Reports     — full evidence browser: every scan, every encounter, details
```

No curated categories, no catalog curation — search + verdicts only. The verdicts column is the differentiator nobody else can render.

---

## 3. AGENT INTEGRATION (the differentiator)

Devs increasingly tell agents "add auth" and the **agent** runs the installs. Nobody reviews those.

- Shell shims already catch agent-driven installs (agents run `npm install` too).
- Native **Claude Code integration** via `PreToolUse` hook on Bash: inspect install commands before execution, run the gate, return structured verdicts. Marketing line: *"ChainDrop persists via .claude/settings.json. So do we — pointed the other way."*
- **Decision policy (locked):**

| Zone | Meaning | Human typing | Agent executing |
|---|---|---|---|
| GREEN | feed-clean, no scripts, established | allow silently | allow silently |
| RED | malicious-feed match | auto-block | auto-block |
| YELLOW | suspicious-unproven | show evidence, user picks | quarantine-by-default OR one consolidated end-of-task consent prompt |

- **The deciding party is ALWAYS the deterministic engine — never an LLM.** In agent mode the adversary may be the agent itself (prompt-injected); the fox never sits on the parole board.
- Verdicts return to the agent as **structured machine-readable flags**, so the agent can adapt intelligently ("package X blocked: known malicious → choose alternative Y"). Agent-native UX: informed colleague, not blocked criminal.
- **Human judgment moves up a level**: users decide *policy* once (gate.config committed to repo: e.g. "no packages younger than 7 days in this project"), the engine enforces it forever. Calm decisions in advance instead of frantic ones mid-task.
- Cursor/Windsurf adapters come later (mechanisms vary); MCP server later still (read-only scan reports TO agents is valid MCP use).

---

## 4. THE AI PART (BYOK — locked design)

- BYOK = bring your own API key (OpenAI / Anthropic / etc.). No hosted service, no subscriptions.
- **AI never decides anything.** Deterministic rules + observed evidence produce verdicts. The LLM's ONLY job: take the compressed evidence summary (~20 lines, pennies per scan) and write a plain-language explanation for flagged packages.
- Strictly opt-in per scan. Minimal snippets only (flagged diff/script — never the dependency tree). Pitch: *"Private by default; cloud only when YOU pull the trigger."*
- Rejected alternatives (with reasons): local LLM judge (too weak for malware analysis, non-deterministic), cloud verdict service (kills the privacy identity), no-AI-at-all (evidence reports need translation for normal humans).

---

## 5. DATA SOURCES (all public, all verified live Aug 2026)

| Feed | Endpoint | Use |
|---|---|---|
| OSSF malicious-packages | OSV format; queryable via `api.osv.dev/v1/query` | confirmed-malicious records |
| DataDog IOCs | `github.com/DataDog/indicators-of-compromise` | Shai-Hulud/ChainDrop indicators |
| Wiz research IOCs | `github.com/wiz-sec-public/wiz-research-iocs` | live ChainDrop package CSV |
| npm registry | `registry.npmjs.org/-/v1/search`, `registry.npmjs.org/<pkg>` | search, versions, publish dates, maintainers |
| npm downloads | api.npmjs.org | popularity context |

Feeds sync locally (periodic), checks work offline against last sync. Everything processed on-device.

---

## 6. PLATFORM STRATEGY

- **Gate mode**: pure cross-platform code (Windows/macOS/Linux). This is 80% of the value and has zero dependencies.
- **Detonate mode**: requires WSL2 on Windows (tool prompts: `wsl --install`); native namespaces on Linux/macOS. Reduced mode without it is acceptable — don't torture ourselves supporting every box on day one.
- Rule: GUI and terminal installs go through the IDENTICAL gate path. Same door, different handles.

---

## 7. INSPIRATIONS & PRIOR ART (what we took from where)

| Inspiration | What we borrow | What we do differently |
|---|---|---|
| Aikido Safe Chain (1.7k★) | shell-shim interception technique | transparent rules vs their Intel black box; behavior analysis; agent-native UX; local evidence |
| Socket (24.5k★) | behavioral alert categories, reachability concept | they classify source server-side; we observe runtime locally; no vendor lock-in |
| Playnite / GOG Galaxy | unified-library-over-launchers pattern; delegate execution to original managers | ours adds the safety-verdict layer they never needed |
| ANY.RUN / Hybrid Analysis | sandbox detonation + fake-internet sinkhole methodology | applied to package ecosystems, integrated into dev workflow |
| Android permission cards | "this package wants: :8080, ~/.npmrc, startup hook" presentation | applied pre/post-install for packages |
| VirusTotal | shared community corpus model | our endgame for behavioral IOCs |
| LavaMoat (1.2k★) | proof that runtime containment matters | we make observation usable without SES complexity |
| npq (1.8k★) | pre-install gate UX precedent | richer signals, memory (watch mode), agent integration |
| OWASP API Top 10 / agentic guidance | threat framing | implementation, not theory |

**Explicitly rejected directions** (researched and killed during ideation):
- Full package-manager replacement (yarn/pnpm/bun graveyard; trust paradox)
- Another generic malicious-package detector (Socket owns it)
- Local LLM as security judge (weak + non-deterministic)
- Curated category catalogs / app-store marketplace (rebuilding npm badly)
- TUI + GUI built simultaneously from day one (scope grenade — still sequential: TUI first, GUI ships after as an optional separate install)
- Agent honeypot idea (already published academically: arXiv "LLM Agent Honeypot")
- Generic AI red-team framework (promptfoo et al., saturated)

---

## 8. THE MOAT (long game)

Every detonation produces behavioral IOCs — domains, endpoints, behaviors. Opt-in sharing builds a **community behavioral corpus: VirusTotal for npm behavior**. Start consuming OSSF/DataDog/Wiz feeds; grow into feeding them. That's how a solo project eventually matches a funded vendor's data advantage. Even solo, publishing detonation reports creates unique public content.

---

## 9. MILESTONES (with kill criteria)

| M | Deliverable | Done when |
|---|---|---|
| M0 | Feed + rules spike (plain script, no packaging) | Blocks a known ChainDrop package, passes `express` untouched, <2s overhead |
| M1 | Shims + one-command setup | Own daily installs route through the gate for a week |
| M2 | Claude Code PreToolUse hook | Asking Claude to install a listed malicious package → denied with reason; verdict flags returned to agent |
| M3 | TUI control center + BYOK explainer | Connect Claude Code from UI; flagged install yields plain-language why |
| M4 | Detonation sandbox v1 (WSL2) | Lifecycle-script malware caught; sinkhole captures C2 attempt as IOC |
| M5 | Quarantine watcher | Suspicious package monitored days; wake-up behavior detected |
| M6 | GUI v0 (optional install), README, demo GIF, release | A stranger installs in one command |

M0 is the thesis test. If it fails (feed latency, shim hell), rethink cheaply — before months are invested.

---

## 10. RESEARCH RECEIPTS (key numbers backing the decisions)

- promptfoo 24.5k★, NVIDIA garak 9k★, PyRIT 4.4k★ — AI red-teaming space saturated (why we didn't build that)
- Aikido safe-chain 1.7k★, ~208k weekly installs — validates shim approach AND shows <1% dev penetration (adoption is the hard problem, hence agent-native angle)
- safe-chain blocks packages <48h old — industry admission that fresh-publish detection is unsolved (our detonation answers exactly this window)
- ChainDrop: 450+ packages, ~2B monthly downloads affected, persists via Claude Code/VS Code configs (Wiz/Elastic/Unit42 analyses, Aug 2026)
- npm sandbox-detonation prior art sweep: only 0–7★ student projects exist. The niche is empty of adults.

---

*Spec converged & locked: 2026-08-25. Working name "Gatehouse" is a placeholder — rename freely.*
