import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';

import { check } from '../core/engine/check.js';
import { loadIocStore, storeAge, FEED_TTL_MS } from '../core/feeds/store.js';
import { encounterStats, readEncounters } from '../core/history/encounters.js';
import {
  listQuarantine,
  setQuarantineState,
} from '../core/history/quarantine.js';
import { searchRegistry } from '../core/registry/npm.js';
import { CONNECTOR_LIST, CONNECTORS } from '../agent/connectors.js';
import { GUI_HTML } from './page.js';

/**
 * The GUI is a face, never a bypass. Every endpoint here calls the SAME core
 * functions the CLI and shims use — `check()` is the one gate, so a verdict the
 * browser shows is the verdict the terminal would show. The server is Node
 * stdlib only (no framework, no deps), bound to loopback: no supply chain of
 * its own, and not reachable off the machine, so it needs no auth layer.
 */

type Handler = (
  url: URL,
  req: IncomingMessage,
) => Promise<{ status: number; body: unknown }>;

/** Read and JSON-parse a request body, tolerating an empty one. */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const routes: Record<string, Handler> = {
  'GET /api/dashboard': async () => {
    const [stats, recent, store] = await Promise.all([
      encounterStats(),
      readEncounters(25),
      loadIocStore(),
    ]);
    const feed =
      store === null
        ? { synced: false }
        : {
            synced: true,
            entries: store.entries.length,
            ageHours: Math.round(storeAge(store) / 3_600_000),
            stale: storeAge(store) >= FEED_TTL_MS,
          };
    return { status: 200, body: { stats, recent, feed } };
  },

  'GET /api/search': async (url) => {
    const q = url.searchParams.get('q') ?? '';
    if (q.trim().length === 0) return { status: 200, body: { hits: [] } };
    const res = await searchRegistry(q.trim(), 15);
    if (!res.ok) return { status: 502, body: { error: res.error } };
    return { status: 200, body: { hits: res.value } };
  },

  'GET /api/check': async (url) => {
    const spec = url.searchParams.get('spec') ?? '';
    if (spec.trim().length === 0) return { status: 400, body: { error: 'spec required' } };
    const outcome = await check(spec.trim());
    if (!outcome.ok) return { status: 502, body: { error: outcome.error } };
    return { status: 200, body: outcome.value.verdict };
  },

  'GET /api/reports': async () => {
    return { status: 200, body: { encounters: await readEncounters(500) } };
  },

  'GET /api/quarantine': async () => {
    return { status: 200, body: { entries: await listQuarantine() } };
  },

  'POST /api/quarantine': async (_url, req) => {
    const body = await readBody(req);
    const name = String(body['name'] ?? '');
    const version = body['version'] === null ? null : String(body['version'] ?? '');
    const state = String(body['state'] ?? '');
    if (name === '' || (state !== 'promoted' && state !== 'killed')) {
      return { status: 400, body: { error: 'name and state (promoted|killed) required' } };
    }
    const updated = await setQuarantineState(name, version, state);
    return { status: 200, body: { entry: updated } };
  },

  'GET /api/agents': async (url) => {
    const scope = url.searchParams.get('scope') === 'project' ? 'project' : 'user';
    const list = await Promise.all(
      CONNECTOR_LIST.map(async (c) => ({
        id: c.id,
        label: c.label,
        connected: await c.isConnected(scope),
      })),
    );
    return { status: 200, body: { scope, connectors: list } };
  },

  'POST /api/agents': async (_url, req) => {
    const body = await readBody(req);
    const id = String(body['id'] ?? '');
    const scope = body['scope'] === 'project' ? 'project' : 'user';
    const action = String(body['action'] ?? '');
    const connector = CONNECTORS[id];
    if (connector === undefined) return { status: 400, body: { error: 'unknown connector' } };
    if (action === 'connect') await connector.connect(scope);
    else if (action === 'disconnect') await connector.disconnect(scope);
    else return { status: 400, body: { error: 'action must be connect|disconnect' } };
    return { status: 200, body: { id, connected: await connector.isConnected(scope) } };
  },
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Start the GUI server on loopback. Resolves with the chosen port and a close
 * function once listening. `port = 0` lets the OS pick a free port.
 */
export function startGuiServer(
  port = 7457,
): Promise<{ port: number; url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(GUI_HTML);
      return;
    }
    const key = `${req.method} ${url.pathname}`;
    const route = routes[key];
    if (route === undefined) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    try {
      const { status, body } = await route(url, req);
      sendJson(res, status, body);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // Bind to loopback only — never reachable off this machine.
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr !== null ? addr.port : port;
      resolve({
        port: actual,
        url: `http://127.0.0.1:${actual}/`,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}
