import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  encounterStats,
  readEncounters,
  recordEncounter,
} from '../src/core/history/encounters.js';
import {
  addToQuarantine,
  listQuarantine,
  removeFromQuarantine,
  setQuarantineState,
} from '../src/core/history/quarantine.js';

let tmp: string;
const prevHome = process.env['GATEHOUSE_HOME'];

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'gatehouse-hist-'));
  process.env['GATEHOUSE_HOME'] = tmp;
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env['GATEHOUSE_HOME'];
  else process.env['GATEHOUSE_HOME'] = prevHome;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('encounter store', () => {
  it('returns empty before anything is recorded', async () => {
    expect(await readEncounters()).toEqual([]);
    expect(await encounterStats()).toEqual({ green: 0, yellow: 0, red: 0 });
  });

  it('records and reads back newest-first', async () => {
    await recordEncounter({
      at: '2026-09-01T00:00:00.000Z',
      name: 'express',
      version: '4.0.0',
      level: 'green',
      reasonCodes: [],
      source: 'cli',
      durationMs: 10,
    });
    await recordEncounter({
      at: '2026-09-02T00:00:00.000Z',
      name: 'evil',
      version: '1.0.0',
      level: 'red',
      reasonCodes: ['ioc-feed-match'],
      source: 'agent',
      durationMs: 20,
    });

    const recent = await readEncounters();
    expect(recent).toHaveLength(2);
    expect(recent[0]?.name).toBe('evil'); // newest first
    expect(recent[1]?.name).toBe('express');
    expect(await encounterStats()).toEqual({ green: 1, yellow: 0, red: 1 });
  });

  it('respects the limit argument', async () => {
    for (let i = 0; i < 5; i++) {
      await recordEncounter({
        at: `2026-09-0${i + 1}T00:00:00.000Z`,
        name: `pkg-${i}`,
        version: null,
        level: 'green',
        reasonCodes: [],
        source: 'cli',
        durationMs: 1,
      });
    }
    const recent = await readEncounters(2);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.name).toBe('pkg-4');
  });

  it('skips a torn final line without failing', async () => {
    const file = path.join(tmp, 'encounters.jsonl');
    await fs.writeFile(
      file,
      `${JSON.stringify({ at: 'x', name: 'ok', version: null, level: 'green', reasonCodes: [], source: 'cli', durationMs: 1 })}\n{"name":"torn`,
      'utf8',
    );
    const recent = await readEncounters();
    expect(recent).toHaveLength(1);
    expect(recent[0]?.name).toBe('ok');
  });
});

describe('quarantine store', () => {
  it('adds, lists, transitions and removes entries', async () => {
    expect(await listQuarantine()).toEqual([]);

    const added = await addToQuarantine('left-pad', '1.3.0', ['recent-publish']);
    expect(added.state).toBe('watching');
    expect(added.since).toBe(added.updatedAt);

    const list = await listQuarantine();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('left-pad');

    const promoted = await setQuarantineState('left-pad', '1.3.0', 'promoted', 'quiet 3 days');
    expect(promoted?.state).toBe('promoted');
    expect(promoted?.note).toBe('quiet 3 days');

    expect(await removeFromQuarantine('left-pad', '1.3.0')).toBe(true);
    expect(await listQuarantine()).toEqual([]);
  });

  it('re-adding an entry refreshes it to watching in place', async () => {
    await addToQuarantine('pkg', '1.0.0', ['recent-publish']);
    await setQuarantineState('pkg', '1.0.0', 'killed');
    const readded = await addToQuarantine('pkg', '1.0.0', ['lifecycle-scripts']);
    expect(readded.state).toBe('watching');
    expect(readded.reasonCodes).toEqual(['lifecycle-scripts']);
    expect(await listQuarantine()).toHaveLength(1);
  });

  it('setQuarantineState on a missing entry returns null', async () => {
    expect(await setQuarantineState('ghost', null, 'promoted')).toBeNull();
  });
});
