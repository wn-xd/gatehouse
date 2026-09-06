import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONNECTORS } from '../src/agent/connectors.js';

let tmp: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'gatehouse-conn-'));
  process.chdir(tmp);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmp, { recursive: true, force: true });
});

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
}

describe('cursor connector', () => {
  it('writes a beforeShellExecution hook and round-trips', async () => {
    const c = CONNECTORS['cursor']!;
    expect(await c.isConnected('project')).toBe(false);

    const file = await c.connect('project');
    expect(file).toBe(path.join(tmp, '.cursor', 'hooks.json'));
    expect(await c.isConnected('project')).toBe(true);

    const cfg = await readJson(file);
    const hooks = cfg['hooks'] as { beforeShellExecution: { command: string }[] };
    expect(hooks.beforeShellExecution).toHaveLength(1);
    expect(hooks.beforeShellExecution[0]?.command).toContain('agent-hook');

    await c.disconnect('project');
    expect(await c.isConnected('project')).toBe(false);
  });

  it('is idempotent', async () => {
    const c = CONNECTORS['cursor']!;
    await c.connect('project');
    await c.connect('project');
    const cfg = await readJson(path.join(tmp, '.cursor', 'hooks.json'));
    const hooks = cfg['hooks'] as { beforeShellExecution: unknown[] };
    expect(hooks.beforeShellExecution).toHaveLength(1);
  });
});

describe('codex connector', () => {
  it('writes a Claude-compatible PreToolUse hook and round-trips', async () => {
    const c = CONNECTORS['codex']!;
    const file = await c.connect('project');
    expect(file).toBe(path.join(tmp, '.codex', 'hooks.json'));
    expect(await c.isConnected('project')).toBe(true);

    const cfg = await readJson(file);
    const hooks = cfg['hooks'] as { PreToolUse: { matcher: string; hooks: unknown[] }[] };
    expect(hooks.PreToolUse[0]?.matcher).toBe('Bash');

    await c.disconnect('project');
    expect(await c.isConnected('project')).toBe(false);
  });
});

describe('opencode connector', () => {
  it('writes a plugin file that shells to agent-hook', async () => {
    const c = CONNECTORS['opencode']!;
    const file = await c.connect('project');
    expect(file).toBe(path.join(tmp, '.opencode', 'plugin', 'gatehouse.js'));
    expect(await c.isConnected('project')).toBe(true);

    const src = await fs.readFile(file, 'utf8');
    expect(src).toContain('tool.execute.before');
    expect(src).toContain('agent-hook');
    expect(src).toContain('throw new Error');

    await c.disconnect('project');
    expect(await c.isConnected('project')).toBe(false);
  });

  it('disconnect returns null when nothing installed', async () => {
    const c = CONNECTORS['opencode']!;
    expect(await c.disconnect('project')).toBeNull();
  });
});
