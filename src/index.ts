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
  gatehouse shim [install|uninstall|status]   manage PATH shims for npm/npx/bun/pnpm/yarn
  gatehouse agent [connect|disconnect|status] [--project]
                                              manage the Claude Code PreToolUse gate hook
  gatehouse agent-hook                        run the gate on a PreToolUse event (stdin JSON)
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
  command: 'check' | 'sync' | 'shim' | 'agent' | 'agent-hook' | 'help' | 'version';
  spec?: string;
  json?: boolean;
  shimAction?: 'install' | 'uninstall' | 'status';
  agentAction?: 'connect' | 'disconnect' | 'status';
  scope?: 'user' | 'project';
}

function parseArgs(argv: string[]): CliArgs | null {
  let json = false;
  let scope: 'user' | 'project' = 'user';
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--project') {
      scope = 'project';
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
    case '--help':
    case '-h':
      return { command: 'help' };
    case 'version':
    case '--version':
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
        scope,
      };
    }
    case 'agent-hook':
      return { command: 'agent-hook' };
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
    return runHook(stdin, (line) => console.log(line));
  }

  if (args.command === 'agent') {
    const { connectClaude, disconnectClaude, isConnected } = await import('./agent/claude.js');
    const scope = args.scope ?? 'user';
    if (args.agentAction === 'connect') {
      const file = await connectClaude(scope);
      console.log(`Connected Claude Code (${scope}): PreToolUse gate hook written to ${file}`);
      console.log('Claude Code now routes every Bash install command through the gate.');
      return 0;
    }
    if (args.agentAction === 'disconnect') {
      const file = await disconnectClaude(scope);
      console.log(
        file === null
          ? `No Gatehouse hook found for ${scope}.`
          : `Disconnected Claude Code (${scope}): removed gate hook from ${file}`,
      );
      return 0;
    }
    const on = await isConnected(scope);
    console.log(`Claude Code gate hook (${scope}): ${on ? 'connected' : 'not connected'}`);
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
