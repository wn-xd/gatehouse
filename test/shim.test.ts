import { describe, expect, it } from 'vitest';

import { isInstallCommand } from '../src/shim.js';

describe('isInstallCommand', () => {
  it('recognizes npm install verbs', () => {
    expect(isInstallCommand('npm', ['install', 'express'])).toBe(true);
    expect(isInstallCommand('npm', ['i', 'express'])).toBe(true);
    expect(isInstallCommand('npm', ['add', 'express'])).toBe(true);
    expect(isInstallCommand('npm', ['ci'])).toBe(true);
  });

  it('leaves non-install npm subcommands alone', () => {
    expect(isInstallCommand('npm', ['run', 'build'])).toBe(false);
    expect(isInstallCommand('npm', ['test'])).toBe(false);
    expect(isInstallCommand('npm', [])).toBe(false);
  });

  it('treats every npx invocation as an install', () => {
    expect(isInstallCommand('npx', ['cowsay'])).toBe(true);
    expect(isInstallCommand('npx', [])).toBe(true);
  });

  it('uses yarn add only — yarn install resolves a lockfile', () => {
    expect(isInstallCommand('yarn', ['add', 'express'])).toBe(true);
    expect(isInstallCommand('yarn', ['install'])).toBe(false);
  });

  it('recognizes bun and pnpm verbs', () => {
    expect(isInstallCommand('bun', ['add', 'express'])).toBe(true);
    expect(isInstallCommand('pnpm', ['i'])).toBe(true);
    expect(isInstallCommand('bun', ['run', 'dev'])).toBe(false);
  });

  it('ignores commands it does not shim', () => {
    expect(isInstallCommand('cargo', ['install', 'ripgrep'])).toBe(false);
  });
});
