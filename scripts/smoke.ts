/**
 * M0 thesis test - the spec's kill criteria, as executable code.
 *
 *   1. Blocks a known-malicious package (real Shai-Hulud/ChainDrop IOC)
 *   2. Passes express untouched
 *   3. Completes with acceptable overhead (<2s per check)
 *
 * Run after build:  npm run smoke
 * Requires network (hits OSV + registry + GitHub raw).
 */
import { check } from '../src/core/engine/check.js';
import { syncIocStore } from '../src/core/feeds/store.js';

const MAX_OVERHEAD_MS = 2000;

let failures = 0;

function report(label: string, pass: boolean, detail: string): void {
  const mark = pass ? 'PASS' : 'FAIL';
  if (!pass) failures++;
  console.log(`[${mark}] ${label} — ${detail}`);
}

async function expectLevel(
  spec: string,
  expected: 'green' | 'yellow' | 'red',
): Promise<{ durationMs: number; actual: string }> {
  const outcome = await check(spec);
  if (!outcome.ok) {
    return { durationMs: -1, actual: `error: ${outcome.error}` };
  }
  return {
    durationMs: outcome.value.durationMs,
    actual: outcome.value.verdict.level,
  };
}

async function main(): Promise<void> {
  console.log('gatehouse M0 smoke — thesis test\n');

  console.log('syncing IOC feeds...');
  const sync = await syncIocStore();
  if (!sync.ok) {
    console.error(`FATAL: feed sync failed: ${sync.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `loaded ${sync.value.entries.length} IOC entries from ${Object.keys(sync.value.fetchedAt).length} feeds\n`,
  );

  // --- 1. must block a real, currently-listed malicious package -------
  // @cacheable/memory@2.2.1 appears in Wiz's ChainDrop keyv list.
  const malicious = await expectLevel('@cacheable/memory@2.2.1', 'red');
  report(
    'blocks known ChainDrop package',
    malicious.actual === 'red',
    `@cacheable/memory@2.2.1 -> ${malicious.actual} (${malicious.durationMs}ms)`,
  );

  // --- 2. must pass a clean established package -----------------------
  const clean = await expectLevel('express', 'green');
  report(
    'passes express untouched',
    clean.actual === 'green' || clean.actual === 'yellow',
    `express -> ${clean.actual} (${clean.durationMs}ms)`,
  );
  // Strict form: express should be fully green.
  report(
    'express verdict is exactly green',
    clean.actual === 'green',
    `got ${clean.actual}`,
  );

  // --- 3. overhead budget ---------------------------------------------
  const timings = [malicious.durationMs, clean.durationMs];
  const worst = Math.max(...timings);
  report(
    `overhead < ${MAX_OVERHEAD_MS}ms`,
    worst > 0 && worst < MAX_OVERHEAD_MS,
    `worst single check: ${worst}ms`,
  );

  console.log('');
  if (failures > 0) {
    console.error(`${failures} smoke check(s) FAILED`);
    process.exitCode = 1;
    return;
  }
  console.log('all smoke checks passed - M0 thesis holds');
}

main().catch((err: unknown) => {
  console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 70;
});
