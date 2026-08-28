import { describe, expect, it } from 'vitest';

import { parseDatadogShaiHuludCsv } from '../src/core/feeds/datadog.js';
import { parseCsvLine, parseWizKeyvCsv } from '../src/core/feeds/wiz.js';
import { filterMalicious, type OsvVuln } from '../src/core/feeds/osv.js';

describe('parseWizKeyvCsv', () => {
  it('parses quoted multi-version lists and skips header', () => {
    const csv = [
      'Package,Malicious Versions',
      '@arv-bedrock/auth,"1.1.7, 1.1.8"',
      '@cacheable/memory,2.2.1',
      '',
      'not a name with spaces,1.0.0',
    ].join('\n');

    const entries = parseWizKeyvCsv(csv);
    expect(entries).toEqual([
      { name: '@arv-bedrock/auth', versions: ['1.1.7', '1.1.8'] },
      { name: '@cacheable/memory', versions: ['2.2.1'] },
    ]);
  });

  it('treats empty version field as all-versions', () => {
    const csv = 'Package,Malicious Versions\nbad-pkg,\n';
    expect(parseWizKeyvCsv(csv)).toEqual([
      { name: 'bad-pkg', versions: null },
    ]);
  });
});

describe('parseCsvLine', () => {
  it('handles quotes containing commas', () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
  });
});

describe('parseDatadogShaiHuludCsv', () => {
  it('parses package_name,package_version rows', () => {
    const csv = [
      'package_name,package_version',
      '02-echo,0.0.7',
      '@accordproject/concerto-metamodel,3.12.5',
    ].join('\n');

    expect(parseDatadogShaiHuludCsv(csv)).toEqual([
      { name: '02-echo', versions: ['0.0.7'] },
      {
        name: '@accordproject/concerto-metamodel',
        versions: ['3.12.5'],
      },
    ]);
  });
});

describe('filterMalicious (OSV classifier)', () => {
  const base = {
    id: 'GHSA-test-0000',
  };

  it('flags MAL-* records as malware', () => {
    const vulns: OsvVuln[] = [{ ...base, id: 'MAL-2026-12345' }];
    expect(filterMalicious(vulns)).toHaveLength(1);
  });

  it('flags CWE-506 (embedded malicious code)', () => {
    const vulns: OsvVuln[] = [
      {
        ...base,
        database_specific: { cwe_ids: ['CWE-506'] },
      },
    ];
    expect(filterMalicious(vulns)).toHaveLength(1);
  });

  it('does NOT flag advisories merely containing the word malicious', () => {
    // Regression: a plain ressource-injection advisory on express whose
    // prose mentions "malicious" must never hard-block an install.
    const vulns: OsvVuln[] = [
      {
        id: 'GHSA-cm5g-3pgc-8rg4',
        summary: 'Express ressource injection',
        details:
          'allows attackers to send malicious requests via crafted headers',
        database_specific: { cwe_ids: ['CWE-74'] },
      },
    ];
    expect(filterMalicious(vulns)).toHaveLength(0);
  });

  it('does NOT flag plain vulnerability advisories', () => {
    const vulns: OsvVuln[] = [
      {
        ...base,
        summary: 'Prototype pollution in merge-deep',
        database_specific: { cwe_ids: ['CWE-1321'] },
      },
    ];
    expect(filterMalicious(vulns)).toHaveLength(0);
  });
});
