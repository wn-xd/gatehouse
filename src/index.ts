#!/usr/bin/env node
/**
 * Gatehouse CLI - local-first supply-chain gate.
 *
 * Exit codes (stable contract for shims, hooks and CI):
 *   0 = GREEN (clean)
 *   1 = YELLOW (suspicious, human decides)
 *   2 = RED (malware evidence - block)
 *   64 = usage error
 */
import { check } from './core/engine/check.js';
import { recordEncounter } from './core/history/encounters.js';
import { syncIocStore } from './core/feeds/store.js';
import type { VerdictLevel } from './core/types.js';

const VERSION = '0.1.0';

const HELP = `gatehouse ${VERSION} - local-first security gate for npm installs

USAGE
  gatehouse check <name[@version]> [--json]   verdict for one package
  gatehouse sync                              refresh IOC feeds now
  gatehouse watch <pkg> | sweep | list        quarantine watch: observe YELLOW installs
  gatehouse detonate <pkg> [--json]           WSL2 sandbox: run install, capture behavior
  gatehouse tui                               launch the control center (TUI)
  gatehouse gui                               launch the control center in a browser (loopback)
  gatehouse shim [install|uninstall|status]   manage PATH shims for npm/npx/bun/pnpm/yarn
  gatehouse agent [connect|disconnect|status] [host] [--project]
                                              gate an AI agent; host: claude|cursor|codex|opencode
                                              (status with no host reports all)
  gatehouse agent-hook [--cursor]             run the gate on a hook event (stdin JSON)
  gatehouse --help | --version

EXIT CODES
  0  green  - clean, allow
  1  yellow - suspicious signals, human decides
  2  red    - malware evidence, block
  64        usage error

RULES (transparent by design)
  RED    name@version on a malicious-package IOC list / OSV malware record
  YELLOW published <48h · lifecycle scripts present · registry unreachable
         (fail safe: if we cannot verify, we do not silently pass)`;

interface CliArgs {
  command: 'check' | 'sync' | 'shim' | 'agent' | 'agent-hook' | 'tui' | 'gui' | 'watch' | 'detonate' | 'help' | 'version';
  spec?: string;
  json?: boolean;
  shimAction?: 'install' | 'uninstall' | 'status';
  agentAction?: 'connect' | 'disconnect' | 'status';
  agentHost?: string;
  scope?: 'user' | 'project';
  dialect?: 'claude' | 'cursor';
  watchArg?: string;
}

function parseArgs(argv: string[]): CliArgs | null {
  let json = false;
  let scope: 'user' | 'project' = 'user';
  let dialect: 'claude' | 'cursor' = 'claude';
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { command: 'help' };
    if (arg === '--version' || arg === '-v') return { command: 'version' };
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--project') {
      scope = 'project';
      continue;
    }
    if (arg === '--cursor') {
      dialect = 'cursor';
      continue;
    }
    if (arg.startsWith('--')) continue; // unknown flags ignored in v1
    positional.push(arg);
  }
  const [head] = positional;
  switch (head) {
    case undefined:
      return { command: 'help' };
    case 'help':
      return { command: 'help' };
    case 'version':
      return { command: 'version' };
    case 'sync':
      return { command: 'sync', json };
    case 'shim': {
      const action = positional[1] ?? 'status';
      if (!['install', 'uninstall', 'status'].includes(action)) return null;
      return { command: 'shim', json, shimAction: action as 'install' | 'uninstall' | 'status' };
    }
    case 'agent': {
      const action = positional[1] ?? 'status';
      if (!['connect', 'disconnect', 'status'].includes(action)) return null;
      return {
        command: 'agent',
        agentAction: action as 'connect' | 'disconnect' | 'status',
        agentHost: positional[2],
        scope,
      };
    }
    case 'agent-hook':
      return { command: 'agent-hook', dialect };
    case 'tui':
      return { command: 'tui' };
    case 'gui':
      return { command: 'gui' };
    case 'watch':
      return { command: 'watch', watchArg: positional[1], json };
    case 'detonate': {
      const spec = positional[1];
      if (spec === undefined) return null;
      return { command: 'detonate', spec, json };
    }
    case 'check': {
      const spec = positional[1];
      if (spec === undefined) return null;
      return { command: 'check', spec, json };
    }
    default:
      // bare "gatehouse react" == "gatehouse check react"
      return { command: 'check', spec: head, json };
  }
}

const COLORS = {
  red: '\x1b[1;31m',
  yellow: '\x1b[1;33m',
  green: '\x1b[1;32m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

function useColor(): boolean {
  return process.stdout.isTTY === true && !('NO_COLOR' in process.env);
}

function paint(text: string, code: string): string {
  return useColor() ? `${code}${text}${COLORS.reset}` : text;
}

function levelColor(level: VerdictLevel): string {
  if (level === 'red') return COLORS.red;
  if (level === 'yellow') return COLORS.yellow;
  return COLORS.green;
}

function printHuman(
  name: string,
  version: string | null,
  level: VerdictLevel,
  reasons: { code: string; detail: string }[],
  sources: string[],
  durationMs: number,
  feedStale: boolean,
): void {
  const label =
    level === 'red'
      ? 'RED — BLOCK'
      : level === 'yellow'
        ? 'YELLOW — REVIEW'
        : 'GREEN — ALLOW';

  console.log(`gatehouse · ${name}${version !== null ? `@${version}` : ''}`);
  console.log(paint(`VERDICT: ${label}`, levelColor(level)));

  if (reasons.length === 0) {
    console.log(' no signals - feed-clean, established package');
  }
  for (const reason of reasons) {
    console.log(` • ${reason.code}: ${reason.detail}`);
  }

  const suffix = feedStale ? ' (STALE CACHE - offline fallback)' : '';
  console.log(
    paint(`sources: ${sources.join(', ')}${suffix}`, COLORS.dim),
  );
  console.log(paint(`checked in ${durationMs}ms`, COLORS.dim));
}

/** Read all of stdin as UTF-8. Returns '' when nothing is piped. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Default watch window before a quiet package is auto-promoted: 3 days. */
const WATCH_PROMOTE_MS = 72 * 60 * 60 * 1000;

/**
 * `watch <pkg>`  → gate the package; if YELLOW, enter watch mode with a
 *                  persistence-surface baseline. RED is refused (block, don't
 *                  watch); GREEN needs no watching.
 * `watch sweep`  → inspect every watched package: kill any that touched a
 *                  persistence surface, promote any quiet past the window.
 * `watch list`   → show current watch entries.
 */
async function runWatch(arg: string | undefined, json: boolean): Promise<number> {
  const { beginWatch, sweepWatched, promoteQuiet } = await import(
    './core/quarantine/watch.js'
  );
  const { listQuarantine } = await import('./core/history/quarantine.js');

  if (arg === undefined || arg === 'list') {
    const entries = await listQuarantine();
    if (json) {
      console.log(JSON.stringify(entries, null, 2));
    } else if (entries.length === 0) {
      console.log('No packages under watch.');
    } else {
      for (const e of entries) {
        const spec = e.version === null ? e.name : `${e.name}@${e.version}`;
        console.log(`${e.state.padEnd(9)} ${spec}  (since ${e.since})`);
      }
    }
    return 0;
  }

  if (arg === 'sweep') {
    const swept = await sweepWatched();
    const promoted = await promoteQuiet(WATCH_PROMOTE_MS);
    const killed = swept.filter((s) => s.action === 'killed');
    for (const s of killed) {
      const spec =
        s.finding.version === null ? s.finding.name : `${s.finding.name}@${s.finding.version}`;
      console.log(
        paint(`KILLED ${spec}`, COLORS.red) +
          ` — touched ${s.finding.changes.map((c) => c.surface).join(', ')}`,
      );
    }
    for (const p of promoted) {
      const spec = p.version === null ? p.name : `${p.name}@${p.version}`;
      console.log(paint(`PROMOTED ${spec}`, COLORS.green) + ` — ${p.note ?? 'quiet'}`);
    }
    console.log(
      paint(
        `swept ${swept.length} watched · ${killed.length} killed · ${promoted.length} promoted`,
        COLORS.dim,
      ),
    );
    return 0;
  }

  // watch <pkg>: gate first, then enter watch mode only for YELLOW.
  const outcome = await check(arg);
  if (!outcome.ok) {
    console.error(`error: ${outcome.error}`);
    return 2;
  }
  const { verdict } = outcome.value;
  if (verdict.level === 'red') {
    console.error(paint(`RED — ${arg} is malicious, refusing to watch. Blocked.`, COLORS.red));
    return 2;
  }
  if (verdict.level === 'green') {
    console.log(paint(`GREEN — ${arg} is clean, no watch needed.`, COLORS.green));
    return 0;
  }
  const entry = await beginWatch(
    verdict.name,
    verdict.version,
    verdict.reasons.map((r) => r.code),
  );
  console.log(
    paint(`YELLOW — ${arg} entered watch mode.`, COLORS.yellow) +
      `\nInstall it normally; run \`gatehouse watch sweep\` over the next days.` +
      `\nQuiet for 3 days → auto-promoted. Touches a persistence surface → killed.` +
      `\nwatching since ${entry.since}`,
  );
  return 1;
}

/** Category → color for the detonation report headline. */
const DETONATION_COLOR: Record<string, string> = {
  'malicious-indicators': COLORS.red,
  suspicious: COLORS.yellow,
  unremarkable: COLORS.green,
};

/**
 * `detonate <pkg>` — run the WSL2 sandbox and print the evidence report.
 * Requires WSL; degrades with a clear message when it is unavailable rather
 * than pretending to have observed anything.
 */
async function runDetonate(spec: string, json: boolean): Promise<number> {
  const { detonate, wslAvailable } = await import('./core/detonate/runner.js');
  if (!(await wslAvailable())) {
    console.error(
      'detonation requires WSL2 (run `wsl --install`). ' +
        'The gate and watch modes work without it; detonation does not.',
    );
    return 64;
  }

  console.error(paint(`detonating ${spec} in WSL2 sandbox (isolated)…`, COLORS.dim));
  const report = await detonate(spec);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.error !== null) {
    console.error(`detonation error: ${report.error}`);
    return 2;
  } else {
    const color = DETONATION_COLOR[report.category] ?? COLORS.dim;
    console.log(`gatehouse detonation · ${report.spec}`);
    console.log(paint(`CATEGORY: ${report.category.toUpperCase()}`, color));
    if (report.findings.length === 0) {
      console.log(' no notable behavior observed during install');
    }
    for (const f of report.findings) {
      console.log(` • ${f}`);
    }
    console.log(
      paint('sandboxes prove guilt, never innocence — unremarkable ≠ safe', COLORS.dim),
    );
  }

  // Exit code mirrors verdict severity for scripting.
  if (report.category === 'malicious-indicators') return 2;
  if (report.category === 'suspicious') return 1;
  return 0;
}

/**
 * `gui` — start the loopback control-center server and open a browser at it.
 * The server is the same core behind a JSON API; it runs until Ctrl-C. Opening
 * the browser is best-effort: the URL is always printed so the user can open
 * it manually if the platform launcher is unavailable.
 */
async function runGui(): Promise<number> {
  const { startGuiServer } = await import('./gui/server.js');
  const { port, url, close } = await startGuiServer();
  console.log(`gatehouse GUI on ${url} (loopback only — Ctrl-C to stop)`);
  void port;

  // Best-effort browser open per platform; ignore failures.
  const opener =
    process.platform === 'win32'
      ? { cmd: 'cmd', args: ['/c', 'start', '', url] }
      : process.platform === 'darwin'
        ? { cmd: 'open', args: [url] }
        : { cmd: 'xdg-open', args: [url] };
  try {
    const { spawn } = await import('node:child_process');
    spawn(opener.cmd, opener.args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
  } catch {
    // no launcher — the printed URL is the fallback
  }

  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      void close().then(resolve);
    });
  });
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error(HELP);
    return 64;
  }

  if (args.command === 'help') {
    console.log(HELP);
    return 0;
  }
  if (args.command === 'version') {
    console.log(VERSION);
    return 0;
  }

  if (args.command === 'sync') {
    const result = await syncIocStore();
    if (!result.ok) {
      console.error(`sync failed: ${result.error}`);
      return 2;
    }
    const at = Object.values(result.value.fetchedAt).join(', ');
    console.log(`synced ${result.value.entries.length} IOC entries (${at})`);
    return 0;
  }

  if (args.command === 'shim') {
    const { shim } = await import('./shim.js');
    return shim(args.shimAction ?? 'status');
  }

  if (args.command === 'agent-hook') {
    const { runHook } = await import('./agent/hook.js');
    const stdin = await readStdin();
    return runHook(stdin, (line) => console.log(line), args.dialect ?? 'claude');
  }

  if (args.command === 'tui') {
    const { runTui } = await import('./tui/index.js');
    return runTui();
  }

  if (args.command === 'gui') {
    return runGui();
  }

  if (args.command === 'watch') {
    return runWatch(args.watchArg, args.json === true);
  }

  if (args.command === 'detonate') {
    return runDetonate(args.spec ?? '', args.json === true);
  }

  if (args.command === 'agent') {
    const { CONNECTORS, CONNECTOR_LIST } = await import('./agent/connectors.js');
    const scope = args.scope ?? 'user';

    // status with no host → report every connector at a glance.
    if (args.agentAction === 'status' && args.agentHost === undefined) {
      for (const c of CONNECTOR_LIST) {
        const on = await c.isConnected(scope);
        console.log(`${c.label.padEnd(14)} (${scope}): ${on ? 'connected' : 'not connected'}`);
      }
      return 0;
    }

    const host = args.agentHost ?? 'claude';
    const connector = CONNECTORS[host];
    if (connector === undefined) {
      console.error(
        `unknown agent host: ${host}. Known: ${CONNECTOR_LIST.map((c) => c.id).join(', ')}`,
      );
      return 64;
    }

    if (args.agentAction === 'connect') {
      const file = await connector.connect(scope);
      console.log(`Connected ${connector.label} (${scope}): gate hook written to ${file}`);
      console.log(`${connector.label} now routes install commands through the gate.`);
      return 0;
    }
    if (args.agentAction === 'disconnect') {
      const file = await connector.disconnect(scope);
      console.log(
        file === null
          ? `No Gatehouse hook found for ${connector.label} (${scope}).`
          : `Disconnected ${connector.label} (${scope}): removed gate hook from ${file}`,
      );
      return 0;
    }
    const on = await connector.isConnected(scope);
    console.log(`${connector.label} gate hook (${scope}): ${on ? 'connected' : 'not connected'}`);
    return 0;
  }

  // args.command === 'check'
  const outcome = await check(args.spec ?? '');
  if (!outcome.ok) {
    console.error(`error: ${outcome.error}`);
    return 2;
  }

  const { verdict, durationMs, feedStale } = outcome.value;

  await recordEncounter({
    at: verdict.checkedAt,
    name: verdict.name,
    version: verdict.version,
    level: verdict.level,
    reasonCodes: verdict.reasons.map((r) => r.code),
    source: 'cli',
    durationMs,
  });

  if (args.json === true) {
    console.log(
      JSON.stringify({ ...verdict, durationMs, feedStale }, null, 2),
    );
  } else {
    printHuman(
      verdict.name,
      verdict.version,
      verdict.level,
      verdict.reasons,
      verdict.sources,
      durationMs,
      feedStale,
    );
  }

  if (verdict.level === 'red') return 2;
  if (verdict.level === 'yellow') return 1;
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(
      `fatal: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 70;
  });
