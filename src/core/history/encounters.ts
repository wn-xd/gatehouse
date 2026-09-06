import fs from 'node:fs/promises';
import path from 'node:path';

import { cacheRoot, ensureDirs } from '../config.js';
import type { VerdictLevel } from '../types.js';

/**
 * One recorded gate encounter. Append-only: every check the CLI, shim, or
 * agent hook performs lands here so the Dashboard and Reports surfaces have
 * a real history to render. Deliberately flat and self-describing — a future
 * reader never needs a schema doc, and JSONL survives partial writes.
 */
export interface Encounter {
  /** ISO-8601 timestamp of the check. */
  at: string;
  name: string;
  version: string | null;
  level: VerdictLevel;
  /** Reason codes only; full details live in the verdict, this is the index. */
  reasonCodes: string[];
  /** Where the check came from: cli | shim | agent | tui. */
  source: string;
  /** How long the check took, ms. */
  durationMs: number;
}

function encountersFile(): string {
  return path.join(cacheRoot(), 'encounters.jsonl');
}

/**
 * Append one encounter. Never throws into the caller's hot path: a history
 * write failing must not break a verdict, so errors are swallowed after a
 * best-effort attempt. The gate's job is to decide, not to journal perfectly.
 */
export async function recordEncounter(enc: Encounter): Promise<void> {
  try {
    ensureDirs();
    await fs.appendFile(encountersFile(), `${JSON.stringify(enc)}\n`, 'utf8');
  } catch {
    // history is advisory, never load-bearing
  }
}

/**
 * Read the most recent `limit` encounters, newest first.
 *
 * Reads the whole file then slices — encounters are small and a dev machine
 * accumulates thousands, not millions. If that ever changes, rotate the file;
 * do not add a streaming reader speculatively.
 */
export async function readEncounters(limit = 100): Promise<Encounter[]> {
  let raw: string;
  try {
    raw = await fs.readFile(encountersFile(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const out: Encounter[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      out.push(JSON.parse(line) as Encounter);
    } catch {
      // skip a torn final line rather than fail the whole read
    }
  }
  out.reverse();
  return out.slice(0, limit);
}

/** Count encounters by verdict level across the whole log. */
export async function encounterStats(): Promise<Record<VerdictLevel, number>> {
  const all = await readEncounters(Number.POSITIVE_INFINITY);
  const stats: Record<VerdictLevel, number> = { green: 0, yellow: 0, red: 0 };
  for (const enc of all) stats[enc.level]++;
  return stats;
}
