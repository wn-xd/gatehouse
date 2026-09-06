import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { cacheRoot, ensureDirs } from '../config.js';
import {
  addToQuarantine,
  listQuarantine,
  setQuarantineState,
  type QuarantineEntry,
} from '../history/quarantine.js';

/**
 * Persistence surfaces attackers are known to abuse (ChainDrop injected the
 * first two). The watcher fingerprints these before and after a watched
 * package is live; an unexpected change is the misbehavior signal that flips a
 * quiet YELLOW into a caught RED. This list is the spec's "persistence surface"
 * made concrete — extend it as new abuse vectors appear.
 */
export function persistenceSurfaces(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.claude', 'settings.json'),
    path.join(process.cwd(), '.claude', 'settings.json'),
    path.join(process.cwd(), '.vscode', 'tasks.json'),
    path.join(home, '.bashrc'),
    path.join(home, '.zshrc'),
    path.join(home, '.profile'),
    path.join(home, '.npmrc'),
  ];
}

/** SHA-256 of a file's contents, or null when it does not exist. */
async function fingerprint(file: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(file);
    return createHash('sha256').update(buf).digest('hex');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null; // unreadable → treat as absent; the diff still catches changes
  }
}

/** name@version → { surface → hash|null } snapshot of the watched surfaces. */
type Baseline = Record<string, Record<string, string | null>>;

function baselineFile(): string {
  return path.join(cacheRoot(), 'quarantine-baseline.json');
}

async function loadBaseline(): Promise<Baseline> {
  try {
    return JSON.parse(await fs.readFile(baselineFile(), 'utf8')) as Baseline;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

async function saveBaseline(b: Baseline): Promise<void> {
  ensureDirs();
  await fs.writeFile(baselineFile(), `${JSON.stringify(b, null, 2)}\n`, 'utf8');
}

/** Snapshot every persistence surface right now. */
async function snapshot(): Promise<Record<string, string | null>> {
  const surfaces = persistenceSurfaces();
  const entries = await Promise.all(
    surfaces.map(async (s) => [s, await fingerprint(s)] as const),
  );
  return Object.fromEntries(entries);
}

function keyOf(name: string, version: string | null): string {
  return version === null ? name : `${name}@${version}`;
}

/**
 * Enter a YELLOW package into watch mode: register it in the quarantine store
 * and capture a baseline fingerprint of the persistence surfaces, so a later
 * {@link checkWatched} can prove whether the package altered any of them.
 *
 * This does not perform the install itself — the caller (shim/agent/CLI) still
 * runs npm. Watch mode is the observation wrapper around that install.
 */
export async function beginWatch(
  name: string,
  version: string | null,
  reasonCodes: string[],
): Promise<QuarantineEntry> {
  const entry = await addToQuarantine(name, version, reasonCodes);
  const baseline = await loadBaseline();
  baseline[keyOf(name, version)] = await snapshot();
  await saveBaseline(baseline);
  return entry;
}

/** A surface that changed since a package entered watch mode. */
export interface SurfaceChange {
  surface: string;
  was: 'absent' | 'present';
  now: 'absent' | 'present' | 'modified';
}

export interface WatchFinding {
  name: string;
  version: string | null;
  /** Empty when the package has been quiet. */
  changes: SurfaceChange[];
}

/** Diff current surface fingerprints against a package's baseline. */
export async function inspectWatched(
  name: string,
  version: string | null,
): Promise<WatchFinding> {
  const baseline = await loadBaseline();
  const base = baseline[keyOf(name, version)] ?? {};
  const current = await snapshot();
  const changes: SurfaceChange[] = [];

  for (const surface of persistenceSurfaces()) {
    const before = base[surface] ?? null;
    const after = current[surface] ?? null;
    if (before === after) continue;
    changes.push({
      surface,
      was: before === null ? 'absent' : 'present',
      now: after === null ? 'absent' : before === null ? 'present' : 'modified',
    });
  }
  return { name, version, changes };
}

export interface SweepResult {
  finding: WatchFinding;
  /** Action taken: 'killed' when surfaces changed, 'quiet' otherwise. */
  action: 'killed' | 'quiet';
}

/**
 * Inspect every currently-watched package and act on the evidence:
 *   - any persistence surface changed → flip to killed (caught misbehaving)
 *   - quiet → left watching; promotion is a separate, time-gated decision so a
 *     sweep never promotes prematurely on its own.
 *
 * Returns one result per watched package. Promotion of long-quiet packages is
 * {@link promoteQuiet}, kept separate so "caught" and "trusted" stay distinct.
 */
export async function sweepWatched(): Promise<SweepResult[]> {
  const entries = await listQuarantine();
  const results: SweepResult[] = [];
  for (const entry of entries) {
    if (entry.state !== 'watching') continue;
    const finding = await inspectWatched(entry.name, entry.version);
    if (finding.changes.length > 0) {
      await setQuarantineState(
        entry.name,
        entry.version,
        'killed',
        `touched ${finding.changes.map((c) => path.basename(c.surface)).join(', ')}`,
      );
      results.push({ finding, action: 'killed' });
    } else {
      results.push({ finding, action: 'quiet' });
    }
  }
  return results;
}

/**
 * Promote packages that have been quietly watching for at least `minAgeMs`.
 * Time-gated so a package must survive the observation window, not merely one
 * clean sweep. Returns the entries promoted.
 */
export async function promoteQuiet(
  minAgeMs: number,
  now: Date = new Date(),
): Promise<QuarantineEntry[]> {
  const entries = await listQuarantine();
  const promoted: QuarantineEntry[] = [];
  for (const entry of entries) {
    if (entry.state !== 'watching') continue;
    const age = now.getTime() - Date.parse(entry.since);
    if (age < minAgeMs) continue;
    const finding = await inspectWatched(entry.name, entry.version);
    if (finding.changes.length > 0) continue; // never promote a dirty package
    const updated = await setQuarantineState(
      entry.name,
      entry.version,
      'promoted',
      `quiet for ${Math.round(age / 3_600_000)}h`,
    );
    if (updated !== null) promoted.push(updated);
  }
  return promoted;
}
