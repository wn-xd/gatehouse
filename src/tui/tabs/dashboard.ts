import { FEED_TTL_MS, loadIocStore, storeAge } from '../../core/feeds/store.js';
import {
  encounterStats,
  readEncounters,
  type Encounter,
} from '../../core/history/encounters.js';
import type { Screen } from '../buffer.js';
import type { Tab } from '../app.js';
import { DARK, type Rgb } from '../theme.js';
import { stat, table, type Box, type TableCell } from '../widgets.js';

/**
 * Dashboard: verdict tallies, feed freshness and recent activity.
 *
 * Read-only — it reflects history the gate already wrote and never performs a
 * check itself, so nothing here can diverge from what the CLI would say.
 */
export function dashboardTab(): Tab {
  let recent: Encounter[] = [];
  let stats = { green: 0, yellow: 0, red: 0 };
  let feedText = 'checking feeds';
  let feedStale = false;
  let feedMissing = false;

  return {
    name: 'Dashboard',
    refresh: async () => {
      recent = await readEncounters(50);
      stats = await encounterStats();
      const store = await loadIocStore();
      if (store === null) {
        feedText = 'feeds not synced — run `gatehouse sync`';
        feedMissing = true;
        return;
      }
      feedMissing = false;
      feedStale = storeAge(store) >= FEED_TTL_MS;
      const hours = Math.round(storeAge(store) / 3_600_000);
      feedText = `${store.entries.length} IOC entries · synced ${hours}h ago${feedStale ? ' · stale' : ''}`;
    },

    paint: (screen: Screen, box: Box) => {
      // Tallies across the top: label above value, hierarchy from weight.
      const columnWidth = Math.max(14, Math.floor(box.width / 3));
      stat(screen, box.x, box.y, 'allowed', String(stats.green), DARK.green);
      stat(screen, box.x + columnWidth, box.y, 'needs review', String(stats.yellow), DARK.yellow);
      stat(screen, box.x + columnWidth * 2, box.y, 'blocked', String(stats.red), DARK.red);

      screen.write(box.x, box.y + 3, feedText, {
        fg: feedMissing || feedStale ? DARK.yellow : DARK.textMuted,
      });

      screen.write(box.x, box.y + 5, 'RECENT ACTIVITY', { fg: DARK.textFaint, bold: true });

      if (recent.length === 0) {
        screen.write(box.x, box.y + 7, 'No packages checked yet.', { fg: DARK.textFaint });
        return;
      }

      const listBox: Box = {
        x: box.x,
        y: box.y + 6,
        width: box.width,
        height: Math.max(3, box.height - 6),
      };
      const rows: TableCell[][] = recent.map((e) => [
        { text: e.level.toUpperCase(), style: { fg: levelColor(e.level), bold: true } },
        { text: e.version === null ? e.name : `${e.name}@${e.version}`, style: { fg: DARK.text } },
        { text: e.source, style: { fg: DARK.textMuted } },
        { text: e.at.replace('T', ' ').slice(0, 19), style: { fg: DARK.textFaint } },
      ]);

      table(
        screen,
        listBox,
        [
          { header: 'verdict', width: 8 },
          { header: 'package', width: Math.max(18, box.width - 42) },
          { header: 'source', width: 7 },
          { header: 'when', width: 19 },
        ],
        rows,
      );
    },
  };
}

function levelColor(level: 'green' | 'yellow' | 'red'): Rgb {
  return level === 'red' ? DARK.red : level === 'yellow' ? DARK.yellow : DARK.green;
}
