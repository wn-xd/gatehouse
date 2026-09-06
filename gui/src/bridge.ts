// The GUI consumes the core through its published `exports` surface. The
// dependency runs one way only: core never imports anything from here, so
// installing the CLI/TUI can never pull in the desktop app or its native addon.
import { CONNECTOR_LIST, CONNECTORS } from 'gatehouse/connectors';
import { check } from 'gatehouse/engine';
import { FEED_TTL_MS, loadIocStore, storeAge } from 'gatehouse/feeds';
import { encounterStats, readEncounters } from 'gatehouse/history/encounters';
import { listQuarantine, setQuarantineState } from 'gatehouse/history/quarantine';
import { searchRegistry } from 'gatehouse/registry';

/**
 * Engine routes exposed to the UI.
 *
 * This is the desktop equivalent of the old loopback HTTP router, with the
 * socket removed: same function calls, same core, delivered over the webview's
 * IPC channel. Keeping the surface as a route table (rather than exposing the
 * engine wholesale) means the UI can only ask for things the app has decided
 * to offer.
 */
type Route = (payload: Record<string, unknown>) => Promise<unknown>;

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback;

const routes: Record<string, Route> = {
  /** Verdict tallies, feed freshness and the most recent encounters. */
  'dashboard/load': async () => {
    const [stats, recent, store] = await Promise.all([
      encounterStats(),
      readEncounters(25),
      loadIocStore(),
    ]);
    const feed =
      store === null
        ? { synced: false as const }
        : {
            synced: true as const,
            entries: store.entries.length,
            ageHours: Math.round(storeAge(store) / 3_600_000),
            stale: storeAge(store) >= FEED_TTL_MS,
          };
    return { stats, recent, feed };
  },

  /** npm registry search; verdicts are fetched per hit by `packages/check`. */
  'packages/search': async (payload) => {
    const query = str(payload['query']).trim();
    if (query === '') return { hits: [] };
    const res = await searchRegistry(query, 20);
    if (!res.ok) throw new Error(res.error);
    return { hits: res.value };
  },

  /** One package's verdict, straight from the shared gate. */
  'packages/check': async (payload) => {
    const spec = str(payload['spec']).trim();
    if (spec === '') throw new Error('spec required');
    const outcome = await check(spec);
    if (!outcome.ok) throw new Error(outcome.error);
    return outcome.value.verdict;
  },

  /** Full scan history for the reports surface. */
  'reports/load': async () => ({ encounters: await readEncounters(500) }),

  'quarantine/load': async () => ({ entries: await listQuarantine() }),

  /** Promote or kill a watched package. */
  'quarantine/set': async (payload) => {
    const name = str(payload['name']);
    const version = payload['version'] === null ? null : str(payload['version']);
    const state = str(payload['state']);
    if (name === '' || (state !== 'promoted' && state !== 'killed')) {
      throw new Error('name and state (promoted|killed) required');
    }
    return { entry: await setQuarantineState(name, version, state) };
  },

  /** Connector status for every supported agent host. */
  'agents/load': async (payload) => {
    const scope = payload['scope'] === 'project' ? 'project' : 'user';
    const connectors = await Promise.all(
      CONNECTOR_LIST.map(async (c: (typeof CONNECTOR_LIST)[number]) => ({
        id: c.id,
        label: c.label,
        connected: await c.isConnected(scope),
      })),
    );
    return { scope, connectors };
  },

  /** Connect or disconnect one agent host. */
  'agents/toggle': async (payload) => {
    const id = str(payload['id']);
    const scope = payload['scope'] === 'project' ? 'project' : 'user';
    const connector = CONNECTORS[id];
    if (connector === undefined) throw new Error(`unknown connector: ${id}`);
    const connected = await connector.isConnected(scope);
    if (connected) await connector.disconnect(scope);
    else await connector.connect(scope);
    return { id, connected: await connector.isConnected(scope) };
  },
};

/** Dispatch one IPC route. Unknown routes fail loudly rather than silently. */
export async function handleRequest(
  route: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const handler = routes[route];
  if (handler === undefined) throw new Error(`unknown route: ${route}`);
  return handler(payload);
}
