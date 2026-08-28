import type { ParsedSpec, Result } from './types.js';

/**
 * Parse "name", "name@version", "@scope/name" or "@scope/name@1.2.3".
 * Scoped names may contain '@' only as the leading scope marker, so we
 * split on the LAST '@' that is not part of the scope prefix.
 */
export function parseSpec(raw: string): Result<ParsedSpec> {
  const input = raw.trim();
  if (input.length === 0) {
    return { ok: false, error: 'empty package specifier' };
  }

  if (input.startsWith('@')) {
    const slash = input.indexOf('/');
    if (slash === -1 || slash === input.length - 1) {
      return { ok: false, error: `invalid scoped package: ${input}` };
    }
    const rest = input.slice(slash + 1);
    const at = rest.indexOf('@');
    if (at <= 0) {
      // no version part (at === -1) or empty version (at === 0)
      if (at === 0) {
        return { ok: false, error: `invalid version in: ${input}` };
      }
      return { ok: true, value: { name: input, version: null } };
    }
    const name = input.slice(0, slash + 1 + at);
    const version = rest.slice(at + 1);
    if (version.length === 0) {
      return { ok: false, error: `invalid version in: ${input}` };
    }
    return { ok: true, value: { name, version } };
  }

  const at = input.indexOf('@');
  if (at === -1) {
    return { ok: true, value: { name: input, version: null } };
  }
  if (at === 0 || at === input.length - 1) {
    return { ok: false, error: `invalid package specifier: ${input}` };
  }
  return {
    ok: true,
    value: { name: input.slice(0, at), version: input.slice(at + 1) },
  };
}
