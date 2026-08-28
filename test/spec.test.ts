import { describe, expect, it } from 'vitest';

import { parseSpec } from '../src/core/spec.js';

describe('parseSpec', () => {
  it.each([
    ['express', { name: 'express', version: null }],
    ['lodash@4.17.21', { name: 'lodash', version: '4.17.21' }],
    [
      '@cacheable/memory',
      { name: '@cacheable/memory', version: null },
    ],
    [
      '@arv-bedrock/auth@1.1.8',
      { name: '@arv-bedrock/auth', version: '1.1.8' },
    ],
    [
      '@scope/pkg@10.0.0-beta.1',
      { name: '@scope/pkg', version: '10.0.0-beta.1' },
    ],
  ])('parses %s', (input, expected) => {
    const result = parseSpec(input);
    expect(result).toEqual({ ok: true, value: expected });
  });

  it.each(['', '@scopeonly', '@scope/', 'pkg@', '@'])(
    'rejects invalid specifier %s',
    (input) => {
      const result = parseSpec(input);
      expect(result.ok).toBe(false);
    },
  );
});
