import { describe, expect, it } from 'vitest';

import { extractInstallTargets, tokenize } from '../src/agent/command.js';
import { runHook } from '../src/agent/hook.js';

describe('runHook (offline paths)', () => {
  it('stays silent on a non-shell tool', async () => {
    let out = '';
    const code = await runHook(
      JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/x' } }),
      (l) => (out += l),
    );
    expect(code).toBe(0);
    expect(out).toBe('');
  });

  it('stays silent when the command installs nothing', async () => {
    let out = '';
    await runHook(
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm run build' } }),
      (l) => (out += l),
    );
    expect(out).toBe('');
  });

  it('stays silent on unparseable stdin', async () => {
    let out = '';
    const code = await runHook('not json', (l) => (out += l));
    expect(code).toBe(0);
    expect(out).toBe('');
  });

  it('reads Cursor top-level command field', async () => {
    // 'git status' installs nothing → silent, but proves the field is read
    // without throwing on the Cursor-shaped payload (no tool_input).
    let out = '';
    const code = await runHook(
      JSON.stringify({ command: 'git status' }),
      (l) => (out += l),
      'cursor',
    );
    expect(code).toBe(0);
    expect(out).toBe('');
  });
});

describe('tokenize', () => {
  it('keeps quoted args as one token', () => {
    expect(tokenize('npm install "left-pad@1.0"')).toEqual([
      'npm',
      'install',
      'left-pad@1.0',
    ]);
  });

  it('surfaces control operators as their own tokens', () => {
    expect(tokenize('npm i a && npx b')).toEqual([
      'npm',
      'i',
      'a',
      '&&',
      'npx',
      'b',
    ]);
  });

  it('honors backslash escapes outside single quotes', () => {
    expect(tokenize('echo a\\ b')).toEqual(['echo', 'a b']);
  });
});

describe('extractInstallTargets', () => {
  it('extracts npm install packages, skipping flags', () => {
    expect(extractInstallTargets('npm install express --save-dev lodash')).toEqual([
      { manager: 'npm', spec: 'express' },
      { manager: 'npm', spec: 'lodash' },
    ]);
  });

  it('recognizes short and alias verbs', () => {
    expect(extractInstallTargets('npm i react')).toEqual([
      { manager: 'npm', spec: 'react' },
    ]);
    expect(extractInstallTargets('npm add react')).toEqual([
      { manager: 'npm', spec: 'react' },
    ]);
  });

  it('gates only npx first non-flag argument', () => {
    expect(extractInstallTargets('npx --yes cowsay hello world')).toEqual([
      { manager: 'npx', spec: 'cowsay' },
    ]);
  });

  it('ignores non-install subcommands', () => {
    expect(extractInstallTargets('npm run build')).toEqual([]);
    expect(extractInstallTargets('git status')).toEqual([]);
    expect(extractInstallTargets('yarn install')).toEqual([]);
  });

  it('splits compound commands and gates each install', () => {
    expect(
      extractInstallTargets('npm ci && npm install left-pad && npx cowsay'),
    ).toEqual([
      { manager: 'npm', spec: 'left-pad' },
      { manager: 'npx', spec: 'cowsay' },
    ]);
  });

  it('strips leading env assignments before the command name', () => {
    expect(extractInstallTargets('FOO=bar npm install express')).toEqual([
      { manager: 'npm', spec: 'express' },
    ]);
  });

  it('normalizes a command path with extension', () => {
    expect(extractInstallTargets('/usr/local/bin/npm install express')).toEqual([
      { manager: 'npm', spec: 'express' },
    ]);
    expect(extractInstallTargets('"C:/Program Files/nodejs/npm.cmd" install express')).toEqual([
      { manager: 'npm', spec: 'express' },
    ]);
  });

  it('keeps scoped and pinned specs intact', () => {
    expect(extractInstallTargets('pnpm add @scope/pkg@2.1.0')).toEqual([
      { manager: 'pnpm', spec: '@scope/pkg@2.1.0' },
    ]);
  });

  it('gates bun add but not bun run', () => {
    expect(extractInstallTargets('bun add zod')).toEqual([
      { manager: 'bun', spec: 'zod' },
    ]);
    expect(extractInstallTargets('bun run dev')).toEqual([]);
  });
});
