import { describe, expect, it } from 'vitest';

import { evaluate } from '../src/core/engine/verdict.js';
import type {
  IocMatch,
  RegistryProbe,
  RegistrySignals,
} from '../src/core/types.js';
import type { OsvVuln } from '../src/core/feeds/osv.js';

const NOW = new Date('2026-08-25T12:00:00Z');

function signals(o: {
  publishedAt?: Date | null;
  scripts?: string[];
}): RegistrySignals {
  return {
    resolvedVersion: '1.0.0',
    publishedAt: o.publishedAt ?? new Date('2024-01-01T00:00:00Z'),
    scriptNames: o.scripts ?? [],
    scriptBodies: Object.fromEntries(
      (o.scripts ?? []).map((s) => [s, 'node fix.js']),
    ),
  };
}

function registryOk(
  overrides: { publishedAt?: Date | null; scripts?: string[] } = {},
): RegistryProbe {
  return { ok: true, signals: signals(overrides) };
}

describe('evaluate - deterministic rules', () => {
  it('green for clean established package', () => {
    const verdict = evaluate({
      name: 'express',
      version: '5.2.1',
      iocMatch: null,
      osvMalicious: [],
      registry: registryOk(),
      now: NOW,
    });
    expect(verdict.level).toBe('green');
    expect(verdict.reasons).toHaveLength(0);
  });

  it('red on exact IOC feed match', () => {
    const match: IocMatch = {
      entry: { name: '@cacheable/memory', versions: ['2.2.1'] },
      kind: 'exact-version',
    };
    const verdict = evaluate({
      name: '@cacheable/memory',
      version: '2.2.1',
      iocMatch: match,
      osvMalicious: [],
      registry: registryOk(),
      now: NOW,
    });
    expect(verdict.level).toBe('red');
    expect(verdict.reasons[0]?.code).toBe('ioc-feed-match');
  });

  it('red when any version is listed and caller did not pin', () => {
    const match: IocMatch = {
      entry: { name: 'pkg-x', versions: ['1.0.0'] },
      kind: 'name-only',
    };
    const verdict = evaluate({
      name: 'pkg-x',
      version: null,
      iocMatch: match,
      osvMalicious: [],
      registry: registryOk(),
      now: NOW,
    });
    expect(verdict.level).toBe('red');
  });

  it('yellow (not red) when pinned clean version has malicious siblings', () => {
    const match: IocMatch = {
      entry: { name: 'pkg-x', versions: ['1.0.0'] },
      kind: 'name-only',
    };
    const verdict = evaluate({
      name: 'pkg-x',
      version: '2.0.0',
      iocMatch: match,
      osvMalicious: [],
      registry: registryOk(),
      now: NOW,
    });
    expect(verdict.level).toBe('yellow');
    expect(verdict.reasons[0]?.code).toBe('ioc-name-overlap');
  });

  it('red on OSV malware record', () => {
    const vuln: OsvVuln = {
      id: 'MAL-2026-9999',
      summary: 'credential stealer',
    };
    const verdict = evaluate({
      name: 'evil-pkg',
      version: '1.0.0',
      iocMatch: null,
      osvMalicious: [vuln],
      registry: registryOk(),
      now: NOW,
    });
    expect(verdict.level).toBe('red');
    expect(verdict.reasons.some((r) => r.code === 'osv-malicious')).toBe(true);
  });

  it('yellow when published within 48h window', () => {
    const fresh = new Date(NOW.getTime() - 3 * 3_600_000); // 3h old
    const verdict = evaluate({
      name: 'brand-new',
      version: '0.0.1',
      iocMatch: null,
      osvMalicious: [],
      registry: registryOk({ publishedAt: fresh }),
      now: NOW,
    });
    expect(verdict.level).toBe('yellow');
    expect(verdict.reasons[0]?.code).toBe('recent-publish');
  });

  it('yellow when lifecycle scripts present, includes script body', () => {
    const verdict = evaluate({
      name: 'native-ish',
      version: '1.0.0',
      iocMatch: null,
      osvMalicious: [],
      registry: registryOk({ scripts: ['postinstall'] }),
      now: NOW,
    });
    expect(verdict.level).toBe('yellow');
    expect(verdict.reasons[0]?.code).toBe('lifecycle-scripts');
    expect(verdict.reasons[0]?.detail).toContain('postinstall');
    expect(verdict.reasons[0]?.detail).toContain('node fix.js');
  });

  it('fails safe: unreachable registry yields yellow, never green', () => {
    const verdict = evaluate({
      name: 'mystery',
      version: '1.0.0',
      iocMatch: null,
      osvMalicious: [],
      registry: { ok: false, error: 'DNS timeout' },
      now: NOW,
    });
    expect(verdict.level).toBe('yellow');
    expect(verdict.reasons[0]?.code).toBe('registry-unreachable');
  });

  it('red dominates even when yellow reasons also exist', () => {
    const fresh = new Date(NOW.getTime() - 1 * 3_600_000);
    const verdict = evaluate({
      name: 'fresh-evil',
      version: null,
      iocMatch: {
        entry: { name: 'fresh-evil', versions: null },
        kind: 'all-versions',
      },
      osvMalicious: [],
      registry: registryOk({ publishedAt: fresh, scripts: ['preinstall'] }),
      now: NOW,
    });
    expect(verdict.level).toBe('red');
    const codes = verdict.reasons.map((r) => r.code);
    expect(codes).toContain('recent-publish');
    expect(codes).toContain('lifecycle-scripts');
    expect(codes).toContain('ioc-feed-match');
  });
});
