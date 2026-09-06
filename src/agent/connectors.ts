import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { GATEHOUSE_BIN } from '../shim.js';
import { connectClaude, disconnectClaude, isConnected as isClaudeConnected } from './claude.js';

/** Scope a connector writes to: per-user (global) or per-project. */
export type ConnectorScope = 'user' | 'project';

/**
 * One AI-agent host Gatehouse can gate. Every connector installs the same
 * deterministic gate (`agent-hook`) into that host's pre-execution hook, so a
 * package the agent tries to install is judged by the engine before it runs —
 * whatever the host's config format or wire dialect.
 */
export interface Connector {
  id: string;
  label: string;
  /** Install the gate hook for `scope`; returns the file written. */
  connect: (scope: ConnectorScope) => Promise<string>;
  /** Remove it; returns the file touched, or null when nothing was present. */
  disconnect: (scope: ConnectorScope) => Promise<string | null>;
  /** Whether the gate hook is currently installed for `scope`. */
  isConnected: (scope: ConnectorScope) => Promise<boolean>;
}

const HOOK_MARKER = 'gatehouse-agent-hook';

/** Read a JSON config file, returning {} when absent. */
async function readJson(file: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

// --- Cursor: ~/.cursor/hooks.json, beforeShellExecution --------------------

interface CursorHook {
  command: string;
  matcher?: string;
  timeout?: number;
  failClosed?: boolean;
  _source?: string;
}

function cursorPath(scope: ConnectorScope): string {
  const base = scope === 'project' ? process.cwd() : os.homedir();
  return path.join(base, '.cursor', 'hooks.json');
}

const cursorConnector: Connector = {
  id: 'cursor',
  label: 'Cursor',
  connect: async (scope) => {
    const file = cursorPath(scope);
    const cfg = await readJson(file);
    cfg['version'] = (cfg['version'] as number) ?? 1;
    const hooks = (cfg['hooks'] as Record<string, CursorHook[]>) ?? {};
    const list = (hooks['beforeShellExecution'] ?? []).filter(
      (h) => h._source !== HOOK_MARKER,
    );
    list.push({
      command: `node "${GATEHOUSE_BIN}" agent-hook --cursor`,
      matcher: 'npm|npx|pnpm|yarn|bun',
      timeout: 30,
      failClosed: true,
      _source: HOOK_MARKER,
    });
    hooks['beforeShellExecution'] = list;
    cfg['hooks'] = hooks;
    await writeJson(file, cfg);
    return file;
  },
  disconnect: async (scope) => {
    const file = cursorPath(scope);
    const cfg = await readJson(file);
    const hooks = cfg['hooks'] as Record<string, CursorHook[]> | undefined;
    const list = hooks?.['beforeShellExecution'];
    if (list === undefined) return null;
    const kept = list.filter((h) => h._source !== HOOK_MARKER);
    if (kept.length === list.length) return null;
    if (kept.length > 0) hooks!['beforeShellExecution'] = kept;
    else delete hooks!['beforeShellExecution'];
    await writeJson(file, cfg);
    return file;
  },
  isConnected: async (scope) => {
    const cfg = await readJson(cursorPath(scope));
    const hooks = cfg['hooks'] as Record<string, CursorHook[]> | undefined;
    return (hooks?.['beforeShellExecution'] ?? []).some((h) => h._source === HOOK_MARKER);
  },
};

// --- Codex: ~/.codex/hooks.json, Claude-compatible PreToolUse --------------

interface CodexHandler {
  type: string;
  command?: string;
  args?: string[];
  timeout?: number;
  _source?: string;
}
interface CodexGroup {
  matcher?: string;
  hooks?: CodexHandler[];
}

function codexPath(scope: ConnectorScope): string {
  const base = scope === 'project' ? process.cwd() : os.homedir();
  return path.join(base, '.codex', 'hooks.json');
}

function isCodexOurs(h: CodexHandler): boolean {
  return h._source === HOOK_MARKER || (Array.isArray(h.args) && h.args.includes('agent-hook'));
}

const codexConnector: Connector = {
  id: 'codex',
  label: 'Codex',
  connect: async (scope) => {
    const file = codexPath(scope);
    const cfg = await readJson(file);
    const hooks = (cfg['hooks'] as Record<string, CodexGroup[]>) ?? {};
    const pre = (hooks['PreToolUse'] ?? []).map((g) => ({
      ...g,
      hooks: (g.hooks ?? []).filter((h) => !isCodexOurs(h)),
    }));
    const handler: CodexHandler = {
      type: 'command',
      command: 'node',
      args: [GATEHOUSE_BIN, 'agent-hook'],
      timeout: 30,
      _source: HOOK_MARKER,
    };
    const bashGroup = pre.find((g) => g.matcher === 'Bash');
    if (bashGroup) bashGroup.hooks = [...(bashGroup.hooks ?? []), handler];
    else pre.push({ matcher: 'Bash', hooks: [handler] });
    hooks['PreToolUse'] = pre.filter((g) => (g.hooks ?? []).length > 0);
    cfg['hooks'] = hooks;
    await writeJson(file, cfg);
    return file;
  },
  disconnect: async (scope) => {
    const file = codexPath(scope);
    const cfg = await readJson(file);
    const hooks = cfg['hooks'] as Record<string, CodexGroup[]> | undefined;
    const pre = hooks?.['PreToolUse'];
    if (pre === undefined) return null;
    const before = JSON.stringify(pre);
    const cleaned = pre
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isCodexOurs(h)) }))
      .filter((g) => (g.hooks ?? []).length > 0);
    if (JSON.stringify(cleaned) === before) return null;
    if (cleaned.length > 0) hooks!['PreToolUse'] = cleaned;
    else delete hooks!['PreToolUse'];
    await writeJson(file, cfg);
    return file;
  },
  isConnected: async (scope) => {
    const cfg = await readJson(codexPath(scope));
    const hooks = cfg['hooks'] as Record<string, CodexGroup[]> | undefined;
    return (hooks?.['PreToolUse'] ?? []).some((g) => (g.hooks ?? []).some(isCodexOurs));
  },
};

// --- opencode: plugin file that shells to the gate -------------------------

function opencodePluginDir(scope: ConnectorScope): string {
  return scope === 'project'
    ? path.join(process.cwd(), '.opencode', 'plugin')
    : path.join(os.homedir(), '.config', 'opencode', 'plugin');
}

function opencodePluginFile(scope: ConnectorScope): string {
  return path.join(opencodePluginDir(scope), 'gatehouse.js');
}

/**
 * opencode exposes no external-command hook — only a JS/TS plugin. So the
 * connector writes a small plugin that, before every bash tool call, shells
 * to `agent-hook`, feeds it a Claude-shaped event, and throws to abort when
 * the gate denies. The gate logic stays in one place; this file is just glue.
 */
function opencodePluginSource(): string {
  return `// Managed by gatehouse. Do not edit.
// Gates every bash install opencode runs through the Gatehouse engine.
import { spawnSync } from "node:child_process";

const GATEHOUSE_BIN = ${JSON.stringify(GATEHOUSE_BIN)};

export default async function gatehouse() {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return;
      const command = output?.args?.command;
      if (typeof command !== "string" || command.trim() === "") return;
      const event = JSON.stringify({ tool_name: "Bash", tool_input: { command } });
      const res = spawnSync("node", [GATEHOUSE_BIN, "agent-hook"], {
        input: event,
        encoding: "utf8",
      });
      const line = (res.stdout || "").trim();
      if (line === "") return; // no decision → allow
      let decision;
      try {
        decision = JSON.parse(line).hookSpecificOutput;
      } catch {
        return;
      }
      if (decision && decision.permissionDecision === "deny") {
        throw new Error(decision.permissionDecisionReason || "gatehouse: blocked");
      }
    },
  };
}
`;
}

const opencodeConnector: Connector = {
  id: 'opencode',
  label: 'opencode',
  connect: async (scope) => {
    const file = opencodePluginFile(scope);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, opencodePluginSource(), 'utf8');
    return file;
  },
  disconnect: async (scope) => {
    const file = opencodePluginFile(scope);
    try {
      await fs.rm(file);
      return file;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  },
  isConnected: async (scope) => {
    try {
      await fs.access(opencodePluginFile(scope));
      return true;
    } catch {
      return false;
    }
  },
};

// --- Claude: wraps the existing dedicated settings writer ------------------

const claudeConnector: Connector = {
  id: 'claude',
  label: 'Claude Code',
  connect: (scope) => connectClaude(scope),
  disconnect: (scope) => disconnectClaude(scope),
  isConnected: (scope) => isClaudeConnected(scope),
};

/** Every connector, keyed by id. */
export const CONNECTORS: Record<string, Connector> = {
  claude: claudeConnector,
  cursor: cursorConnector,
  codex: codexConnector,
  opencode: opencodeConnector,
};

/** Ordered list for UIs. */
export const CONNECTOR_LIST: Connector[] = [
  claudeConnector,
  cursorConnector,
  codexConnector,
  opencodeConnector,
];
