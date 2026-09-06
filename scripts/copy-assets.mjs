// Copy non-TS runtime assets into dist/ after tsc.
// tsc only emits .js; the detonation harness is a Python file that must ship
// alongside the compiled runner, so copy it into the mirrored dist path.
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const assets = [['src/core/detonate/harness.py', 'dist/src/core/detonate/harness.py']];

for (const [from, to] of assets) {
  const dest = path.join(root, to);
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(path.join(root, from), dest);
  console.log(`copied ${from} -> ${to}`);
}
