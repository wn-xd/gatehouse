import { check } from '../../core/engine/check.js';
import { searchRegistry, type SearchHit } from '../../core/registry/npm.js';
import type { VerdictLevel } from '../../core/types.js';
import type { Key, Tab } from '../app.js';
import type { Screen } from '../buffer.js';
import { DARK, GLYPH, type Rgb } from '../theme.js';
import { table, type Box, type TableCell } from '../widgets.js';

/**
 * Packages: registry search where every result carries its verdict.
 *
 * The verdict column is the differentiator — no other package browser can show
 * it. Hits are gated concurrently through the same engine the CLI uses and fill
 * in as they resolve, so the list stays useful while checks are still running.
 *
 * The search field owns printable keys while this surface is active, so typing
 * "r" searches for "r" instead of triggering the global refresh.
 */
export function packagesTab(redraw: () => void): Tab {
  let query = '';
  let hits: SearchHit[] = [];
  const verdicts = new Map<string, VerdictLevel | 'checking'>();
  let status = 'Type a package name and press Enter.';
  let searching = false;

  const runSearch = async (): Promise<void> => {
    const text = query.trim();
    if (text === '') return;
    searching = true;
    status = `Searching for "${text}"`;
    hits = [];
    verdicts.clear();
    redraw();

    const result = await searchRegistry(text, 20);
    searching = false;
    if (!result.ok) {
      status = `Search failed: ${result.error}`;
      redraw();
      return;
    }
    hits = result.value;
    status = `${hits.length} results`;
    redraw();

    // Gate every hit through the shared engine; fill verdicts in as they land.
    await Promise.all(
      hits.map(async (hit) => {
        verdicts.set(hit.name, 'checking');
        const outcome = await check(hit.name);
        // A check that cannot complete is reported as unknown, never as clean.
        verdicts.set(hit.name, outcome.ok ? outcome.value.verdict.level : 'yellow');
        redraw();
      }),
    );
  };

  return {
    name: 'Packages',

    onKey: async (key: Key): Promise<boolean> => {
      if (key.name === 'enter') {
        await runSearch();
        return true;
      }
      if (key.name === 'backspace') {
        query = query.slice(0, -1);
        return true;
      }
      if (key.name === 'escape') {
        query = '';
        return true;
      }
      // Printable characters extend the query and are consumed here so global
      // shortcuts do not fire mid-word.
      if (key.str.length === 1 && key.str >= ' ' && key.str !== '\x7f') {
        query += key.str;
        return true;
      }
      return false;
    },

    paint: (screen: Screen, box: Box) => {
      // Search field: a labelled input with a visible caret.
      screen.write(box.x, box.y, 'SEARCH', { fg: DARK.textFaint, bold: true });
      screen.fill(box.x, box.y + 1, Math.min(box.width, 48), 1, DARK.raised);
      const shown = query.length === 0 ? '' : query;
      screen.write(box.x + 1, box.y + 1, shown, { fg: DARK.text, bg: DARK.raised });
      screen.write(box.x + 1 + shown.length, box.y + 1, GLYPH.caret, {
        fg: DARK.accent,
        bg: DARK.raised,
      });

      screen.write(box.x, box.y + 3, status, {
        fg: searching ? DARK.accent : DARK.textMuted,
      });

      if (hits.length === 0) return;

      const listBox: Box = {
        x: box.x,
        y: box.y + 5,
        width: box.width,
        height: Math.max(3, box.height - 5),
      };
      const rows: TableCell[][] = hits.map((hit) => {
        const level = verdicts.get(hit.name);
        const cell: TableCell =
          level === undefined || level === 'checking'
            ? { text: '·····', style: { fg: DARK.textFaint } }
            : { text: level.toUpperCase(), style: { fg: levelColor(level), bold: true } };
        return [
          cell,
          { text: hit.name, style: { fg: DARK.text } },
          { text: hit.version, style: { fg: DARK.textMuted } },
          { text: hit.description, style: { fg: DARK.textFaint } },
        ];
      });

      const nameWidth = Math.max(16, Math.floor(box.width * 0.3));
      table(
        screen,
        listBox,
        [
          { header: 'verdict', width: 8 },
          { header: 'package', width: nameWidth },
          { header: 'version', width: 10 },
          { header: 'description', width: Math.max(10, box.width - nameWidth - 30) },
        ],
        rows,
      );
    },
  };
}

function levelColor(level: VerdictLevel): Rgb {
  return level === 'red' ? DARK.red : level === 'yellow' ? DARK.yellow : DARK.green;
}
