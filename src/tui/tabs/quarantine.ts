import {
  listQuarantine,
  setQuarantineState,
  type QuarantineEntry,
} from '../../core/history/quarantine.js';
import type { Key, Tab } from '../app.js';
import type { Screen } from '../buffer.js';
import { DARK, type Rgb } from '../theme.js';
import { table, type Box, type TableCell } from '../widgets.js';

/**
 * Quarantine: packages installed under observation, with promote and kill.
 *
 * Writes to the same store the watcher uses, so a manual decision here and an
 * automatic one from `gatehouse watch sweep` are the same kind of fact.
 */
export function quarantineTab(): Tab {
  let entries: QuarantineEntry[] = [];
  let selected = 0;
  let notice = '';

  const clamp = (): void => {
    if (selected < 0) selected = 0;
    if (selected >= entries.length) selected = Math.max(0, entries.length - 1);
  };

  const transition = async (state: 'promoted' | 'killed'): Promise<void> => {
    const entry = entries[selected];
    if (entry === undefined) return;
    await setQuarantineState(entry.name, entry.version, state);
    notice = `${entry.name} ${state}`;
    entries = await listQuarantine();
    clamp();
  };

  return {
    name: 'Quarantine',
    refresh: async () => {
      entries = await listQuarantine();
      notice = '';
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

    paint: (screen: Screen, box: Box) => {
      if (entries.length === 0) {
        screen.write(box.x, box.y, 'Nothing under watch.', { fg: DARK.textMuted });
        screen.write(box.x, box.y + 2, 'Packages that need review are observed here', {
          fg: DARK.textFaint,
        });
        screen.write(box.x, box.y + 3, 'after `gatehouse watch <package>`.', {
          fg: DARK.textFaint,
        });
        return;
      }

      screen.write(box.x, box.y, `${entries.length} watched`, { fg: DARK.textMuted });
      if (notice !== '') {
        screen.write(box.x + 14, box.y, notice, { fg: DARK.accent });
      }

      const listBox: Box = {
        x: box.x,
        y: box.y + 2,
        width: box.width,
        height: Math.max(3, box.height - 3),
      };
      const rows: TableCell[][] = entries.map((e) => [
        { text: e.state, style: { fg: stateColor(e.state), bold: true } },
        { text: e.version === null ? e.name : `${e.name}@${e.version}`, style: { fg: DARK.text } },
        { text: e.reasonCodes.join(', '), style: { fg: DARK.textMuted } },
        { text: e.since.replace('T', ' ').slice(0, 19), style: { fg: DARK.textFaint } },
      ]);

      const nameWidth = Math.max(16, Math.floor(box.width * 0.28));
      table(
        screen,
        listBox,
        [
          { header: 'state', width: 9 },
          { header: 'package', width: nameWidth },
          { header: 'reasons', width: Math.max(10, box.width - nameWidth - 34) },
          { header: 'since', width: 19 },
        ],
        rows,
        { selected },
      );

      screen.write(box.x, box.y + box.height - 1, 'p promote · k kill', {
        fg: DARK.textFaint,
      });
    },
  };
}

function stateColor(state: QuarantineEntry['state']): Rgb {
  if (state === 'promoted') return DARK.green;
  if (state === 'killed') return DARK.red;
  return DARK.yellow;
}
