import {
  readEncounters,
  type Encounter,
} from '../../core/history/encounters.js';
import { LEVEL_STYLE, paint, truncate } from '../ansi.js';
import type { Key, Tab } from '../app.js';
import { renderTable } from '../table.js';

/**
 * Reports: the full evidence browser. Every recorded encounter, newest first,
 * with ↑↓ to move a selection and Enter to expand the reason codes for the
 * highlighted row. This is the "every scan, every detail" surface from the spec.
 */
export function reportsTab(): Tab {
  let all: Encounter[] = [];
  let selected = 0;
  let expanded = false;

  const clampSelection = (): void => {
    if (selected < 0) selected = 0;
    if (selected >= all.length) selected = Math.max(0, all.length - 1);
  };

  return {
    name: 'Reports',
    refresh: async () => {
      all = await readEncounters(500);
      clampSelection();
    },
    onKey: (key: Key): boolean => {
      if (key.name === 'up') {
        selected--;
        clampSelection();
        return true;
      }
      if (key.name === 'down') {
        selected++;
        clampSelection();
        return true;
      }
      if (key.name === 'enter') {
        expanded = !expanded;
        return true;
      }
      return false;
    },
    render: (rows) => {
      if (all.length === 0) {
        return [paint('No scans recorded yet.', 'dim')];
      }

      const lines: string[] = [];
      lines.push(paint(`${all.length} scans (newest first)`, 'bold'));
      lines.push('');

      const detailLines = expanded ? 6 : 0;
      const budget = Math.max(1, rows - lines.length - detailLines - 1);

      // Keep the selection inside the visible window.
      let start = 0;
      if (selected >= budget) start = selected - budget + 1;
      const window = all.slice(start, start + budget);

      const table = renderTable(
        [
          { header: ' ', width: 1 },
          { header: 'WHEN', width: 19 },
          { header: 'LEVEL', width: 6 },
          { header: 'PACKAGE', width: 28 },
          { header: 'SRC', width: 6 },
          { header: 'MS', width: 6 },
        ],
        window.map((e, i) => {
          const marker = start + i === selected ? paint('▶', 'cyan') : ' ';
          return [
            marker,
            e.at.replace('T', ' ').slice(0, 19),
            paint(e.level.toUpperCase().slice(0, 5), LEVEL_STYLE[e.level]),
            truncate(e.version === null ? e.name : `${e.name}@${e.version}`, 28),
            e.source,
            String(e.durationMs),
          ];
        }),
      );
      lines.push(...table);

      const detail = all[selected];
      if (expanded && detail !== undefined) {
        const e = detail;
        lines.push('');
        lines.push(paint('─ detail ─', 'dim'));
        lines.push(
          `${paint(e.level.toUpperCase(), LEVEL_STYLE[e.level])} ` +
            `${e.version === null ? e.name : `${e.name}@${e.version}`}`,
        );
        lines.push(
          e.reasonCodes.length > 0
            ? `reasons: ${e.reasonCodes.join(', ')}`
            : paint('reasons: none (feed-clean)', 'dim'),
        );
        lines.push(paint(`source: ${e.source} · ${e.at}`, 'dim'));
      } else {
        lines.push('');
        lines.push(paint('↑↓ select · Enter toggles detail', 'dim'));
      }
      return lines;
    },
  };
}
