import {
  listQuarantine,
  setQuarantineState,
  type QuarantineEntry,
} from '../../core/history/quarantine.js';
import { paint, truncate } from '../ansi.js';
import type { Key, Tab } from '../app.js';
import { renderTable } from '../table.js';

const STATE_STYLE: Record<QuarantineEntry['state'], 'green' | 'yellow' | 'red'> = {
  watching: 'yellow',
  promoted: 'green',
  killed: 'red',
};

/**
 * Quarantine: watch-mode packages with promote / kill controls. ↑↓ selects a
 * row; p promotes the highlighted package, k kills it. Reflects the store M5's
 * watcher also writes to, so manual and automatic decisions share one table.
 */
export function quarantineTab(): Tab {
  let entries: QuarantineEntry[] = [];
  let selected = 0;

  const clamp = (): void => {
    if (selected < 0) selected = 0;
    if (selected >= entries.length) selected = Math.max(0, entries.length - 1);
  };

  const transition = async (state: 'promoted' | 'killed'): Promise<void> => {
    const entry = entries[selected];
    if (entry === undefined) return;
    await setQuarantineState(entry.name, entry.version, state);
    entries = await listQuarantine();
    clamp();
  };

  return {
    name: 'Quarantine',
    refresh: async () => {
      entries = await listQuarantine();
      clamp();
    },
    onKey: async (key: Key): Promise<boolean> => {
      if (key.name === 'up') {
        selected--;
        clamp();
        return true;
      }
      if (key.name === 'down') {
        selected++;
        clamp();
        return true;
      }
      if (key.name === 'p') {
        await transition('promoted');
        return true;
      }
      if (key.name === 'k') {
        await transition('killed');
        return true;
      }
      return false;
    },
    render: (rows) => {
      if (entries.length === 0) {
        return [
          paint('No packages under watch.', 'dim'),
          '',
          paint('YELLOW installs can be quarantined for observation.', 'dim'),
        ];
      }

      const lines: string[] = [paint(`${entries.length} watched packages`, 'bold'), ''];
      const budget = Math.max(1, rows - lines.length - 1);
      const table = renderTable(
        [
          { header: ' ', width: 1 },
          { header: 'STATE', width: 9 },
          { header: 'PACKAGE', width: 30 },
          { header: 'SINCE', width: 19 },
          { header: 'REASONS', width: 24 },
        ],
        entries.slice(0, budget).map((e, i) => [
          i === selected ? paint('▶', 'cyan') : ' ',
          paint(e.state, STATE_STYLE[e.state]),
          truncate(e.version === null ? e.name : `${e.name}@${e.version}`, 30),
          e.since.replace('T', ' ').slice(0, 19),
          truncate(e.reasonCodes.join(', '), 24),
        ]),
      );
      lines.push(...table);
      lines.push('');
      lines.push(paint('↑↓ select · p promote · k kill', 'dim'));
      return lines;
    },
  };
}
