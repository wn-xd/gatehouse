import { readEncounters, type Encounter } from '../../core/history/encounters.js';
import type { Key, Tab } from '../app.js';
import type { Screen } from '../buffer.js';
import { DARK, type Rgb } from '../theme.js';
import { panel, scrollbar, table, type Box, type TableCell } from '../widgets.js';

/**
 * Reports: the full evidence browser.
 *
 * Every recorded encounter, newest first, with a selection that can be expanded
 * to show the reason codes behind a verdict. The detail panel is the point: a
 * verdict without its evidence is just a colour.
 */
export function reportsTab(): Tab {
  let all: Encounter[] = [];
  let selected = 0;
  let offset = 0;
  let expanded = false;

  const clamp = (visible: number): void => {
    if (selected < 0) selected = 0;
    if (selected >= all.length) selected = Math.max(0, all.length - 1);
    // Keep the selection inside the scrolled window.
    if (selected < offset) offset = selected;
    if (selected >= offset + visible) offset = selected - visible + 1;
    if (offset < 0) offset = 0;
  };

  return {
    name: 'Reports',
    refresh: async () => {
      all = await readEncounters(500);
      selected = 0;
      offset = 0;
    },

    onKey: (key: Key): boolean => {
      if (key.name === 'up') {
        selected--;
        return true;
      }
      if (key.name === 'down') {
        selected++;
        return true;
      }
      if (key.name === 'pageup') {
        selected -= 10;
        return true;
      }
      if (key.name === 'pagedown') {
        selected += 10;
        return true;
      }
      if (key.name === 'enter') {
        expanded = !expanded;
        return true;
      }
      return false;
    },

    paint: (screen: Screen, box: Box) => {
      if (all.length === 0) {
        screen.write(box.x, box.y, 'No scans recorded yet.', { fg: DARK.textFaint });
        return;
      }

      const detailHeight = expanded ? 6 : 0;
      const listHeight = Math.max(4, box.height - detailHeight - 1);
      const visibleRows = Math.max(1, listHeight - 2);
      clamp(visibleRows);

      screen.write(box.x, box.y, `${all.length} scans, newest first`, {
        fg: DARK.textMuted,
      });

      const listBox: Box = {
        x: box.x,
        y: box.y + 2,
        width: box.width - 2,
        height: listHeight,
      };
      const rows: TableCell[][] = all.map((e) => [
        { text: e.level.toUpperCase(), style: { fg: levelColor(e.level), bold: true } },
        { text: e.version === null ? e.name : `${e.name}@${e.version}`, style: { fg: DARK.text } },
        { text: e.source, style: { fg: DARK.textMuted } },
        { text: `${e.durationMs}ms`, style: { fg: DARK.textFaint } },
      ]);

      table(
        screen,
        listBox,
        [
          { header: 'verdict', width: 8 },
          { header: 'package', width: Math.max(18, box.width - 32) },
          { header: 'source', width: 7 },
          { header: 'took', width: 8, align: 'right' },
        ],
        rows,
        { selected, offset },
      );

      scrollbar(
        screen,
        { x: box.x + box.width - 1, y: box.y + 4, width: 1, height: visibleRows },
        all.length,
        visibleRows,
        offset,
      );

      if (!expanded) {
        screen.write(box.x, box.y + box.height - 1, 'Enter to show evidence', {
          fg: DARK.textFaint,
        });
        return;
      }

      const entry = all[selected];
      if (entry === undefined) return;

      const detailBox: Box = {
        x: box.x,
        y: box.y + listHeight + 2,
        width: box.width - 1,
        height: detailHeight,
      };
      panel(screen, detailBox, 'evidence', true);

      const spec = entry.version === null ? entry.name : `${entry.name}@${entry.version}`;
      screen.write(detailBox.x + 2, detailBox.y + 1, entry.level.toUpperCase(), {
        fg: levelColor(entry.level),
        bold: true,
      });
      screen.write(detailBox.x + 2 + entry.level.length + 1, detailBox.y + 1, spec, {
        fg: DARK.text,
      });

      const reasons =
        entry.reasonCodes.length > 0
          ? entry.reasonCodes.join(', ')
          : 'no signals — feed-clean at time of check';
      screen.write(detailBox.x + 2, detailBox.y + 2, reasons, {
        fg: entry.reasonCodes.length > 0 ? DARK.textMuted : DARK.textFaint,
      });
      screen.write(detailBox.x + 2, detailBox.y + 3, `${entry.source} · ${entry.at}`, {
        fg: DARK.textFaint,
      });
    },
  };
}

function levelColor(level: 'green' | 'yellow' | 'red'): Rgb {
  return level === 'red' ? DARK.red : level === 'yellow' ? DARK.yellow : DARK.green;
}
