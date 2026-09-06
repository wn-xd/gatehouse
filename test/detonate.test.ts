import { describe, expect, it } from 'vitest';

import { classify, type DetonationRaw } from '../src/core/detonate/runner.js';

function evidence(over: Partial<DetonationRaw['evidence'] & object> = {}): DetonationRaw {
  return {
    spec: 'demo@1.0.0',
    installExit: 0,
    evidence: {
      outboundConnections: [],
      dnsLookups: [],
      requestLines: [],
      persistenceWrites: [],
      credentialReads: [],
      execCount: 0,
      filesWrittenCount: 0,
      filesReadCount: 0,
      ...over,
    },
  };
}

describe('classify detonation evidence', () => {
  it('unremarkable when nothing notable happened (never "safe")', () => {
    const r = classify(evidence());
    expect(r.category).toBe('unremarkable');
    expect(r.findings).toEqual([]);
  });

  it('malicious-indicators when credential read pairs with an outbound attempt', () => {
    const r = classify(
      evidence({
        credentialReads: ['/root/.ssh/id_rsa'],
        outboundConnections: ['185.220.101.5:443'],
      }),
    );
    expect(r.category).toBe('malicious-indicators');
    expect(r.findings).toContain('read credential file /root/.ssh/id_rsa');
    expect(r.findings).toContain('attempted connection to 185.220.101.5:443');
  });

  it('malicious-indicators when persistence write pairs with a DNS lookup', () => {
    const r = classify(
      evidence({
        persistenceWrites: ['/root/.bashrc'],
        dnsLookups: ['evil-c2.example.com'],
      }),
    );
    expect(r.category).toBe('malicious-indicators');
  });

  it('suspicious when only a persistence write, no exfil', () => {
    const r = classify(evidence({ persistenceWrites: ['/root/.npmrc'] }));
    expect(r.category).toBe('suspicious');
  });

  it('suspicious when only an outbound attempt, no credential/persistence', () => {
    const r = classify(evidence({ outboundConnections: ['1.2.3.4:80'] }));
    expect(r.category).toBe('suspicious');
  });

  it('surfaces a harness error as unremarkable with the error preserved', () => {
    const r = classify({ spec: 'x@1', error: 'fetch failed (exit 1)' });
    expect(r.category).toBe('unremarkable');
    expect(r.error).toBe('fetch failed (exit 1)');
    expect(r.evidence).toBeNull();
  });
});
