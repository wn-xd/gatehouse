import fs from 'node:fs/promises';
import path from 'node:path';

import { ensureDirs, feedsDir } from '../config.js';
import { safeFetch } from '../fetch.js';
import type { IocEntry, Result } from '../types.js';
import { parseDatadogShaiHuludCsv } from './datadog.js';
import { parseWizKeyvCsv } from './wiz.js';

export interface FeedSource {
  id: string;
  url: string;
  parse: (csv: string) => IocEntry[];
}

export const FEED_SOURCES: FeedSource[] = [
  {
    id: 'wiz-keyv',
    url: 'https://raw.githubusercontent.com/wiz-sec-public/wiz-research-iocs/main/reports/keyv-packages.csv',
    parse: parseWizKeyvCsv,
  },
  {
    id: 'datadog-shai-hulud-2',
    url: 'https://raw.githubusercontent.com/DataDog/indicators-of-compromise/main/shai-hulud-2.0/shai-hulud-2.0.csv',
    parse: parseDatadogShaiHuludCsv,
  },
];

export interface IocStore {
  fetchedAt: Record<string, string>;
  entries: IocEntry[];
}

/** Default refresh window before a feed is considered stale. */
export const FEED_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function storeFile(): string {
  return path.join(feedsDir(), 'ioc.json');
}

export async function loadIocStore(): Promise<IocStore | null> {
  try {
    const raw = await fs.readFile(storeFile(), 'utf8');
    const parsed = JSON.parse(raw) as IocStore;
    if (!Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeAge(store: IocStore): number {
  const times = Object.values(store.fetchedAt);
  if (times.length === 0) return Number.POSITIVE_INFINITY;
  const newest = Math.max(...times.map((t) => Date.parse(t)));
  if (Number.isNaN(newest)) return Number.POSITIVE_INFINITY;
  return Date.now() - newest;
}

/** Fetch every feed and merge into one deduplicated store file. */
export async function syncIocStore(): Promise<Result<IocStore>> {
  ensureDirs();

  const merged: IocEntry[] = [];
  const fetchedAt: Record<string, string> = {};

  for (const source of FEED_SOURCES) {
    const res = await safeFetch(source.url);
    if (!res.ok) {
      return { ok: false, error: `feed ${source.id}: ${res.error}` };
    }
    const csv = await res.value.text();
    const parsed = source.parse(csv);
    merged.push(...parsed);
    fetchedAt[source.id] = new Date().toISOString();
  }

  const store: IocStore = { fetchedAt, entries: merged };
  await fs.writeFile(storeFile(), JSON.stringify(store), 'utf8');
  return { ok: true, value: store };
}

/**
 * Load the local store, refreshing from the network only when missing
 * or stale. Falls back to stale data when offline - checks keep working.
 */
export async function getIocStore(): Promise<
  Result<{ store: IocStore; stale: boolean }>
> {
  const existing = await loadIocStore();
  if (existing !== null && storeAge(existing) < FEED_TTL_MS) {
    return { ok: true, value: { store: existing, stale: false } };
  }

  const fresh = await syncIocStore();
  if (fresh.ok) {
    return { ok: true, value: { store: fresh.value, stale: false } };
  }

  // Offline fallback: stale beats nothing, but say so.
  if (existing !== null) {
    return { ok: true, value: { store: existing, stale: true } };
  }
  return { ok: false, error: fresh.error };
}
