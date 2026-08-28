import { safeFetch } from '../fetch.js';
import type { Result } from '../types.js';

const OSV_QUERY_ENDPOINT = 'https://api.osv.dev/v1/query';

/** Subset of the OSV schema we actually consume. */
export interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  database_specific?: {
    cwe_ids?: string[];
    severity?: string;
    github_reviewed?: boolean;
  };
}

/**
 * Query OSV for known advisories affecting name@version.
 * version may be null - OSV then returns every advisory for the package.
 */
export async function queryOsv(
  name: string,
  version: string | null,
): Promise<Result<OsvVuln[]>> {
  const body: Record<string, unknown> = {
    package: { name, ecosystem: 'npm' },
  };
  if (version !== null) {
    body['version'] = version;
  }

  const res = await safeFetch(OSV_QUERY_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return res;
  }

  try {
    const text = await res.value.text();
    const data = JSON.parse(text) as { vulns?: OsvVuln[] };
    return { ok: true, value: data.vulns ?? [] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `OSV response parse failed: ${msg}` };
  }
}

/**
 * Deterministic malicious-package classifier - STRICT by design.
 * A record counts as MALWARE (not merely a CVE) only when:
 *   - its id is an OpenSSF malicious-packages record (MAL-*), OR
 *   - it carries CWE-506 (Embedded Malicious Code)
 *
 * Deliberately NO keyword matching: vulnerability advisories routinely
 * contain words like "malicious" in their prose ("could allow malicious
 * requests"), and keyword rules produced a false RED on express during
 * development. Structural markers only.
 */
export function filterMalicious(vulns: OsvVuln[]): OsvVuln[] {
  return vulns.filter((v) => {
    if (v.id.startsWith('MAL-')) return true;
    const cwes = v.database_specific?.cwe_ids ?? [];
    return cwes.includes('CWE-506');
  });
}
