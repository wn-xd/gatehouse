import { safeFetch } from '../fetch.js';
import type { RegistryProbe, Result } from '../types.js';

interface PackumentVersion {
  scripts?: Record<string, string>;
}

interface Packument {
  'dist-tags'?: Record<string, string>;
  time?: Record<string, string>;
  versions?: Record<string, PackumentVersion>;
  maintainers?: unknown[];
}

function registryUrl(name: string): string {
  return `https://registry.npmjs.org/${encodeURIComponent(name)}`;
}

/**
 * Fetch the packument (full metadata doc) for a package.
 * Scoped names arrive already in "@scope/name" form; encodeURIComponent
 * escapes the slash, which the registry accepts.
 */
export async function fetchPackument(
  name: string,
): Promise<Result<Packument>> {
  const res = await safeFetch(registryUrl(name), {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    return res;
  }
  try {
    const text = await res.value.text();
    const data = JSON.parse(text) as Packument;
    if (typeof data !== 'object' || data === null || !('name' in data)) {
      // The registry returns a plain error object for unknown packages.
      return { ok: false, error: `package not found: ${name}` };
    }
    return { ok: true, value: data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `registry response parse failed: ${msg}` };
  }
}

const LIFECYCLE_HOOKS = ['preinstall', 'install', 'postinstall'] as const;

/**
 * Extract the signals the verdict engine needs. Never throws - a probe
 * that cannot produce signals reports itself as unreachable so the engine
 * can fail safe instead of silently passing.
 */
export function extractSignals(
  packument: Packument,
  requestedVersion: string | null,
): RegistryProbe {
  const timeMap = packument.time ?? {};
  const versions = packument.versions ?? {};

  let resolved: string | null = null;
  if (requestedVersion !== null && requestedVersion in versions) {
    resolved = requestedVersion;
  } else if (requestedVersion === null) {
    resolved = packument['dist-tags']?.['latest'] ?? null;
  }
  if (resolved === null) {
    // Distinguish "bad version pin" from "package was unpublished" -
    // takedowns of malicious packages are themselves evidence.
    const unpublished = timeMap['unpublished'];
    if (typeof unpublished === 'string') {
      return {
        ok: false,
        error: `package was UNPUBLISHED from the registry (${unpublished.slice(0, 10)}) - typical malware takedown`,
      };
    }
    if (requestedVersion !== null) {
      return { ok: false, error: `version ${requestedVersion} not found on registry` };
    }
    return { ok: false, error: `no resolvable version on registry` };
  }

  const publishedRaw = timeMap[resolved];
  const publishedAt =
    typeof publishedRaw === 'string' && !Number.isNaN(Date.parse(publishedRaw))
      ? new Date(publishedRaw)
      : null;

  const scriptBodies: Record<string, string> = {};
  for (const hook of LIFECYCLE_HOOKS) {
    const body = versions[resolved]?.scripts?.[hook];
    if (typeof body === 'string' && body.trim().length > 0) {
      scriptBodies[hook] = body.trim();
    }
  }

  const maintainerCount = Array.isArray(packument.maintainers)
    ? packument.maintainers.length
    : undefined;

  return {
    ok: true,
    signals: {
      resolvedVersion: resolved,
      publishedAt,
      scriptNames: Object.keys(scriptBodies),
      scriptBodies,
      ...(maintainerCount !== undefined ? { maintainerCount } : {}),
    },
  };
}
