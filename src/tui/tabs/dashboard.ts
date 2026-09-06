import { loadIocStore, storeAge, FEED_TTL_MS } from '../../core/feeds/store.js';
import {
  encounterStats,
  readEncounters,
  type Encounter,
} from '../../core/history/encounters.js';
import { LEVEL_STYLE, paint, truncate } from '../ansi.js';
import type { Tab } from '../app.js';
import { renderTable } from '../table.js';

/**
 * Dashboard: the at-a-glance surface. Shows lifetime verdict tallies, feed
 * sync freshness, and the most recent encounters. Read-only — it reflects the
 * history the gate has already written, never triggers a check itself.
 */
export function dashboardTab(): Tab {
  let recent: Encounter[] = [];
  let stats = { green: 0, yellow: 0, red: 0 };
  let feedLine = 'feeds: unknown';

  return {
    name: 'Dashboard',
    refresh: async () => {
      recent = await readEncounters(20);
      stats = await encounterStats();
      const store = await loadIocStore();
      if (store === null) {
        feedLine = paint('feeds: not synced — run `gatehouse sync`', 'yellow');
      } else {
        const ageH = Math.round(storeAge(store) / 3_600_000);
        const stale = storeAge(store) >= FEED_TTL_MS;
        const count = store.entries.length;
        const label = `feeds: ${count} IOC entries · synced ${ageH}h ago`;
        feedLine = stale ? paint(`${label} (STALE)`, 'yellow') : paint(label, 'green');
      }
    },
    render: (rows) => {
      const lines: string[] = [];
      lines.push(
        `${paint('GREEN', 'green')} ${stats.green}   ` +
          `${paint('YELLOW', 'yellow')} ${stats.yellow}   ` +
          `${paint('RED', 'red')} ${stats.red}`,
      );
      lines.push('');
      lines.push(feedLine);
      lines.push('');
      lines.push(paint('Recent encounters', 'bold'));

      if (recent.length === 0) {
        lines.push(paint('  none yet — run `gatehouse check <pkg>`', 'dim'));
        return lines;
      }

      const budget = Math.max(1, rows - lines.length - 2);
      const table = renderTable(
        [
          { header: 'WHEN', width: 20 },
          { header: 'LEVEL', width: 6 },
          { header: 'PACKAGE', width: 30 },
          { header: 'SOURCE', width: 7 },
        ],
        recent.slice(0, budget).map((e) => [
          e.at.replace('T', ' ').slice(0, 19),
          paint(e.level.toUpperCase().slice(0, 5), LEVEL_STYLE[e.level]),
          truncate(e.version === null ? e.name : `${e.name}@${e.version}`, 30),
          e.source,
        ]),
      );
      lines.push(...table);
      return lines;
    },
  };
}
