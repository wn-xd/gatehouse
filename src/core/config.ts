import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** All local state lives under one directory. Override for tests/CI. */
export function cacheRoot(): string {
  return process.env['GATEHOUSE_HOME'] ?? path.join(os.homedir(), '.gatehouse');
}

export function feedsDir(): string {
  return path.join(cacheRoot(), 'feeds');
}

export function ensureDirs(): void {
  fs.mkdirSync(feedsDir(), { recursive: true });
}
