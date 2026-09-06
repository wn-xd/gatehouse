import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startGuiServer } from '../src/gui/server.js';

let tmp: string;
let stop: (() => Promise<void>) | null = null;
let base = '';
const prevHome = process.env['GATEHOUSE_HOME'];

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'gatehouse-gui-'));
  process.env['GATEHOUSE_HOME'] = tmp;
  const srv = await startGuiServer(0); // OS-assigned free port
  base = srv.url.replace(/\/$/, '');
  stop = srv.close;
});

afterEach(async () => {
  if (stop !== null) await stop();
  stop = null;
  if (prevHome === undefined) delete process.env['GATEHOUSE_HOME'];
  else process.env['GATEHOUSE_HOME'] = prevHome;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('gui server (loopback)', () => {
  it('serves the single-page app at /', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<title>gatehouse</title>');
  });

  it('dashboard reports zeroed stats on a fresh home', async () => {
    const res = await fetch(`${base}/api/dashboard`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stats: Record<string, number>; feed: { synced: boolean } };
    expect(body.stats).toEqual({ green: 0, yellow: 0, red: 0 });
    expect(body.feed.synced).toBe(false); // not synced in this isolated home
  });

  it('lists all four connectors', async () => {
    const res = await fetch(`${base}/api/agents`);
    const body = (await res.json()) as { connectors: { id: string }[] };
    expect(body.connectors.map((c) => c.id).sort()).toEqual([
      'claude',
      'codex',
      'cursor',
      'opencode',
    ]);
  });

  it('validates quarantine POST input', async () => {
    const res = await fetch(`${base}/api/quarantine`, {
      method: 'POST',
      body: JSON.stringify({ name: '', state: 'bogus' }),
    });
    expect(res.status).toBe(400);
  });

  it('404s an unknown route', async () => {
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
  });

  it('check endpoint requires a spec', async () => {
    const res = await fetch(`${base}/api/check`);
    expect(res.status).toBe(400);
  });
});
