import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  connectClaude,
  disconnectClaude,
  isConnected,
  settingsPath,
} from '../src/agent/claude.js';

let tmp: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'gatehouse-claude-'));
  process.chdir(tmp);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmp, { recursive: true, force: true });
});

async function readSettings(): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(settingsPath('project'), 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('connectClaude / disconnectClaude (project scope)', () => {
  it('writes a PreToolUse gate hook into a fresh settings file', async () => {
    expect(await isConnected('project')).toBe(false);

    const file = await connectClaude('project');
    expect(file).toBe(settingsPath('project'));
    expect(await isConnected('project')).toBe(true);

    const settings = await readSettings();
    const pre = (settings.hooks as { PreToolUse: unknown[] }).PreToolUse;
    expect(pre).toHaveLength(1);
    const group = pre[0] as { matcher: string; hooks: { command: string; args: string[] }[] };
    expect(group.matcher).toBe('Bash|PowerShell');
    expect(group.hooks[0]?.command).toBe('node');
    expect(group.hooks[0]?.args).toContain('agent-hook');
  });

  it('is idempotent: connecting twice does not stack duplicates', async () => {
    await connectClaude('project');
    await connectClaude('project');
    const settings = await readSettings();
    const pre = (settings.hooks as { PreToolUse: { hooks: unknown[] }[] }).PreToolUse;
    expect(pre).toHaveLength(1);
    expect(pre[0]?.hooks).toHaveLength(1);
  });

  it('preserves unrelated hooks on connect and disconnect', async () => {
    const file = settingsPath('project');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Edit', hooks: [{ type: 'command', command: 'lint.sh' }] },
          ],
        },
      }),
      'utf8',
    );

    await connectClaude('project');
    let settings = await readSettings();
    let pre = (settings.hooks as { PreToolUse: { matcher: string }[] }).PreToolUse;
    expect(pre).toHaveLength(2); // Edit group + our Bash|PowerShell group

    await disconnectClaude('project');
    settings = await readSettings();
    pre = (settings.hooks as { PreToolUse: { matcher: string }[] }).PreToolUse;
    expect(pre).toHaveLength(1);
    expect(pre[0]?.matcher).toBe('Edit');
    expect(await isConnected('project')).toBe(false);
  });

  it('disconnect returns null when nothing is installed', async () => {
    expect(await disconnectClaude('project')).toBeNull();
  });
});
