import type { Result } from './types.js';

/**
 * Single fetch boundary for the whole codebase. Every network call goes
 * through here so timeouts and error shaping stay uniform, and so no other
 * module ever needs a try/catch.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Result<Response>> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': 'gatehouse/0.1 (local supply-chain gate)',
        accept: '*/*',
        ...init.headers,
      },
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} from ${url}` };
    }
    return { ok: true, value: res };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `${msg} (${url})` };
  }
}
