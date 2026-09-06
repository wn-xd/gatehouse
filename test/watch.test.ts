import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listQuarantine } from '../src/core/history/quarantine.js';
import {
  beginWatch,
  inspectWatched,
  promoteQuiet,
  sweepWatched,
} from '../src/core/quarantine/watch.js';

let tmp: string;
const prevHome = process.env['GATEHOUSE_HOME'];

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'gatehouse-watch-'));
  process.env['GATEHOUSE_HOME'] = tmp;
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env['GATEHOUSE_HOME'];
  else process.env['GATEHOUSE_HOME'] = prevHome;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('quarantine watch', () => {
  it('beginWatch registers a watching entry with a baseline', async () => {
    const entry = await beginWatch('left-pad', '1.3.0', ['recent-publish']);
    expect(entry.state).toBe('watching');

    // Immediately after baseline, nothing has changed → quiet.
    const finding = await inspectWatched('left-pad', '1.3.0');
    expect(finding.changes).toEqual([]);
  });

  it('sweep leaves a quiet package watching', async () => {
    await beginWatch('quiet-pkg', '1.0.0', ['recent-publish']);
    const results = await sweepWatched();
    expect(results).toHaveLength(1);
    expect(results[0]?.action).toBe('quiet');
    const list = await listQuarantine();
    expect(list[0]?.state).toBe('watching');
  });

  it('sweep kills a package that modifies a persistence surface', async () => {
    // Point a surface at a file inside our temp home by faking HOME so the
    // watcher fingerprints a file we control. .npmrc under home is on the list.
    const fakeHome = path.join(tmp, 'home');
    await fs.mkdir(fakeHome, { recursive: true });
    const prev = os.homedir;
    // @ts-expect-error override for test
    os.homedir = () => fakeHome;
    try {
      const npmrc = path.join(fakeHome, '.npmrc');
      await fs.writeFile(npmrc, 'registry=https://registry.npmjs.org/\n');
      await beginWatch('sneaky', '2.0.0', ['lifecycle-scripts']);

      // Simulate the package tampering with the surface after install.
      await fs.appendFile(npmrc, '//evil.example/:_authToken=stolen\n');

      const results = await sweepWatched();
      expect(results[0]?.action).toBe('killed');
      const list = await listQuarantine();
      expect(list[0]?.state).toBe('killed');
      expect(list[0]?.note).toContain('.npmrc');
    } finally {
      os.homedir = prev;
    }
  });

  it('promoteQuiet only promotes past the age window and only if clean', async () => {
    await beginWatch('young', '1.0.0', ['recent-publish']);
    // Age window far in the future → nothing promoted yet.
    expect(await promoteQuiet(72 * 3_600_000)).toEqual([]);
    // Zero window → the quiet package promotes.
    const promoted = await promoteQuiet(0);
    expect(promoted).toHaveLength(1);
    expect(promoted[0]?.state).toBe('promoted');
  });
});
