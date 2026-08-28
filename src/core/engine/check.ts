import { queryOsv } from '../feeds/osv.js';
import type { OsvVuln } from '../feeds/osv.js';
import { getIocStore } from '../feeds/store.js';
import { extractSignals, fetchPackument } from '../registry/npm.js';
import { parseSpec } from '../spec.js';
import type {
  IocEntry,
  IocMatch,
  RegistryProbe,
  Result,
  Verdict,
} from '../types.js';
import { evaluate } from './verdict.js';

export interface CheckOutcome {
  verdict: Verdict;
  /** True when IOC data came from a stale cache (offline fallback). */
  feedStale: boolean;
  durationMs: number;
}

/**
 * Full gate check for one package specifier.
 *
 * Sequence matters:
 *   1. parse the spec
 *   2. load cached IOC lists (auto-sync when stale, offline fallback)
 *   3. fetch registry metadata and RESOLVE the version
 *      (pinned version, else dist-tags.latest)
 *   4. OSV query scoped to that resolved version - so historical
 *      advisories about long-fixed versions never leak into today's
 *      verdict. When resolution is impossible (registry down), fall back
 *      to an unversioned sweep: conservative, because we cannot prove
 *      which version you are getting.
 *   5. deterministic evaluation over all collected evidence
 */
export async function check(rawSpec: string): Promise<Result<CheckOutcome>> {
  const started = Date.now();

  const spec = parseSpec(rawSpec);
  if (!spec.ok) return spec;

  const ioc = await getIocStore();
  if (!ioc.ok) {
    return { ok: false, error: `IOC feeds unavailable: ${ioc.error}` };
  }

  // --- registry first: resolves the version everything else scopes to
  const packumentResult = await fetchPackument(spec.value.name);
  const registryProbe: RegistryProbe = packumentResult.ok
    ? extractSignals(packumentResult.value, spec.value.version)
    : { ok: false as const, error: packumentResult.error };

  const resolvedVersion =
    registryProbe.ok && registryProbe.signals.resolvedVersion.length > 0
      ? registryProbe.signals.resolvedVersion
      : null;

  // --- IOC match against the RESOLVED version (falls back to requested)
  const iocMatch = findIocMatch(ioc.value.store.entries, {
    name: spec.value.name,
    version: resolvedVersion ?? spec.value.version,
  });

  // --- OSV second: scoped to resolved (or pinned) version when known
  const osvScope = resolvedVersion ?? spec.value.version;
  const osvResult = await queryOsv(spec.value.name, osvScope);
  if (!osvResult.ok) {
    return {
      ok: false,
      error: `OSV unreachable - failing closed rather than passing unverified: ${osvResult.error}`,
    };
  }

  const verdict = evaluate({
    name: spec.value.name,
    version: resolvedVersion ?? spec.value.version,
    iocMatch,
    osvMalicious: osvResult.value,
    registry: registryProbe,
  });

  verdict.sources = [
    ...Object.entries(ioc.value.store.fetchedAt).map(
      ([id, at]) => `${id}@${at.slice(0, 10)}`,
    ),
    osvScope !== null ? 'osv@version-scoped' : 'osv@unscoped',
    registryProbe.ok ? 'registry@live' : 'registry@unreachable',
  ];

  return {
    ok: true,
    value: {
      verdict,
      feedStale: ioc.value.stale,
      durationMs: Date.now() - started,
    },
  };
}

/** First IOC entry matching this package, with match semantics. */
function findIocMatch(
  entries: IocEntry[],
  spec: { name: string; version: string | null },
): IocMatch | null {
  for (const entry of entries) {
    if (entry.name !== spec.name) continue;
    if (entry.versions === null) {
      return { entry, kind: 'all-versions' };
    }
    if (spec.version !== null && entry.versions.includes(spec.version)) {
      return { entry, kind: 'exact-version' };
    }
    return { entry, kind: 'name-only' };
  }
  return null;
}
