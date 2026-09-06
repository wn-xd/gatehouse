import fs from 'node:fs/promises';
import path from 'node:path';

import { cacheRoot, ensureDirs } from '../config.js';

/** Lifecycle of a watched package. */
export type QuarantineState = 'watching' | 'promoted' | 'killed';

/**
 * A YELLOW package a user chose to install under observation instead of
 * blocking outright. The watcher (M5) promotes quiet ones and flags any that
 * misbehave. Stored as a keyed table (name@version → entry), not a log, so
 * state transitions overwrite in place and the set stays small.
 */
export interface QuarantineEntry {
  name: string;
  version: string | null;
  state: QuarantineState;
  /** When the package entered watch mode. */
  since: string;
  /** Last state change. */
  updatedAt: string;
  /** Why it was quarantined: the YELLOW reason codes. */
  reasonCodes: string[];
  /** Human note attached on promote/kill, if any. */
  note?: string;
}

interface QuarantineFile {
  entries: Record<string, QuarantineEntry>;
}

function quarantineFile(): string {
  return path.join(cacheRoot(), 'quarantine.json');
}

/** Stable key for an entry. */
function keyOf(name: string, version: string | null): string {
  return version === null ? name : `${name}@${version}`;
}

async function load(): Promise<QuarantineFile> {
  try {
    const raw = await fs.readFile(quarantineFile(), 'utf8');
    const parsed = JSON.parse(raw) as QuarantineFile;
    if (parsed.entries === undefined) return { entries: {} };
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { entries: {} };
    throw err;
  }
}

async function save(file: QuarantineFile): Promise<void> {
  ensureDirs();
  await fs.writeFile(quarantineFile(), `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

/** All quarantine entries, newest-updated first. */
export async function listQuarantine(): Promise<QuarantineEntry[]> {
  const file = await load();
  return Object.values(file.entries).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

/** Add or refresh a watched package; returns the stored entry. */
export async function addToQuarantine(
  name: string,
  version: string | null,
  reasonCodes: string[],
): Promise<QuarantineEntry> {
  const file = await load();
  const key = keyOf(name, version);
  const now = new Date().toISOString();
  const existing = file.entries[key];
  const entry: QuarantineEntry = existing
    ? { ...existing, reasonCodes, updatedAt: now, state: 'watching' }
    : { name, version, state: 'watching', since: now, updatedAt: now, reasonCodes };
  file.entries[key] = entry;
  await save(file);
  return entry;
}

/**
 * Transition an entry to promoted or killed. Returns the updated entry, or
 * null when no such entry is watched.
 */
export async function setQuarantineState(
  name: string,
  version: string | null,
  state: 'promoted' | 'killed',
  note?: string,
): Promise<QuarantineEntry | null> {
  const file = await load();
  const key = keyOf(name, version);
  const existing = file.entries[key];
  if (existing === undefined) return null;
  const updated: QuarantineEntry = {
    ...existing,
    state,
    updatedAt: new Date().toISOString(),
    ...(note !== undefined ? { note } : {}),
  };
  file.entries[key] = updated;
  await save(file);
  return updated;
}

/** Remove an entry entirely. Returns true when something was removed. */
export async function removeFromQuarantine(
  name: string,
  version: string | null,
): Promise<boolean> {
  const file = await load();
  const key = keyOf(name, version);
  if (file.entries[key] === undefined) return false;
  delete file.entries[key];
  await save(file);
  return true;
}
