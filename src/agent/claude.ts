import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { GATEHOUSE_BIN } from '../shim.js';

/** Where the PreToolUse hook is written. */
export type ClaudeScope = 'user' | 'project';

/**
 * Marker embedded in every hook handler Gatehouse writes, so disconnect
 * removes only OUR entries and never touches a user's other hooks.
 */
const HOOK_MARKER = 'gatehouse-agent-hook';

/** Matcher covering both shell tools Claude Code exposes. */
const SHELL_MATCHER = 'Bash|PowerShell';

interface HookHandler {
  type: string;
  command?: string;
  args?: string[];
  [k: string]: unknown;
}

interface MatcherGroup {
  matcher?: string;
  hooks?: HookHandler[];
  [k: string]: unknown;
}

interface ClaudeSettings {
  hooks?: { PreToolUse?: MatcherGroup[]; [event: string]: MatcherGroup[] | undefined };
  [k: string]: unknown;
}

/** Absolute path to the settings file for `scope`. */
export function settingsPath(scope: ClaudeScope): string {
  if (scope === 'project') {
    return path.join(process.cwd(), '.claude', 'settings.json');
  }
  return path.join(os.homedir(), '.claude', 'settings.json');
}

/** Load settings, returning an empty object when the file is absent. */
async function loadSettings(file: string): Promise<ClaudeSettings> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as ClaudeSettings;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

/** The hook handler that invokes the Gatehouse gate. */
function gatehouseHandler(): HookHandler {
  // Exec form: node is a real binary on every platform, and passing the
  // script path as an arg avoids all quoting concerns on Windows paths.
  return {
    type: 'command',
    command: 'node',
    args: [GATEHOUSE_BIN, 'agent-hook'],
    _source: HOOK_MARKER,
  };
}

/** True when this handler is one Gatehouse wrote. */
function isGatehouseHandler(h: HookHandler): boolean {
  if (h._source === HOOK_MARKER) return true;
  return (
    h.command === 'node' &&
    Array.isArray(h.args) &&
    h.args.includes('agent-hook') &&
    h.args.some((a) => a.endsWith('index.js'))
  );
}

/** Drop every Gatehouse handler from a matcher group; keep the rest. */
function stripGatehouse(groups: MatcherGroup[]): MatcherGroup[] {
  const out: MatcherGroup[] = [];
  for (const group of groups) {
    const kept = (group.hooks ?? []).filter((h) => !isGatehouseHandler(h));
    if (kept.length > 0) out.push({ ...group, hooks: kept });
    else if ((group.hooks ?? []).length === 0) out.push(group); // preserve empty user group
  }
  return out;
}

/**
 * Install the PreToolUse gate hook into Claude Code settings for `scope`.
 *
 * Idempotent: existing Gatehouse handlers are stripped first, so repeated
 * connects never stack duplicates. Other hooks in the file are preserved.
 * Returns the file path written.
 */
export async function connectClaude(scope: ClaudeScope): Promise<string> {
  const file = settingsPath(scope);
  const settings = await loadSettings(file);

  const hooks = settings.hooks ?? {};
  const pre = stripGatehouse(hooks.PreToolUse ?? []);

  const existing = pre.find((g) => g.matcher === SHELL_MATCHER);
  if (existing) {
    existing.hooks = [...(existing.hooks ?? []), gatehouseHandler()];
  } else {
    pre.push({ matcher: SHELL_MATCHER, hooks: [gatehouseHandler()] });
  }

  settings.hooks = { ...hooks, PreToolUse: pre };

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return file;
}

/**
 * Remove the Gatehouse gate hook from Claude Code settings for `scope`.
 * Returns the file path, or null when nothing was present to remove.
 */
export async function disconnectClaude(scope: ClaudeScope): Promise<string | null> {
  const file = settingsPath(scope);
  const settings = await loadSettings(file);
  const pre = settings.hooks?.PreToolUse;
  if (pre === undefined) return null;

  const before = JSON.stringify(pre);
  const cleaned = stripGatehouse(pre).filter(
    (g) => (g.hooks ?? []).length > 0 || g.matcher !== SHELL_MATCHER,
  );
  if (JSON.stringify(cleaned) === before) return null; // no change

  const hooks = { ...settings.hooks };
  if (cleaned.length > 0) hooks.PreToolUse = cleaned;
  else delete hooks.PreToolUse;
  settings.hooks = hooks;

  await fs.writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return file;
}

/** True when a Gatehouse hook is currently installed for `scope`. */
export async function isConnected(scope: ClaudeScope): Promise<boolean> {
  const settings = await loadSettings(settingsPath(scope));
  const pre = settings.hooks?.PreToolUse ?? [];
  return pre.some((g) => (g.hooks ?? []).some(isGatehouseHandler));
}
