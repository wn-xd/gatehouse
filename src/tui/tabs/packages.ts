import { check } from '../../core/engine/check.js';
import { searchRegistry, type SearchHit } from '../../core/registry/npm.js';
import type { VerdictLevel } from '../../core/types.js';
import { LEVEL_STYLE, paint, truncate } from '../ansi.js';
import type { Key, Tab } from '../app.js';
import { renderTable } from '../table.js';

/**
 * Packages: npm registry search where every result shows its live gate verdict
 * inline — the column no other package browser renders. Type a query, Enter to
 * search; each hit is then gated concurrently and its verdict fills in.
 *
 * The search box owns printable keys while active, so typing "r" queries for
 * "r" instead of triggering a global refresh. Enter runs the search; results
 * gate in the background and the app redraws as verdicts arrive.
 */
export function packagesTab(redraw: () => void): Tab {
  let query = '';
  let hits: SearchHit[] = [];
  const verdicts: Record<string, VerdictLevel | 'checking'> = {};
  let status = '';

  const runSearch = async (): Promise<void> => {
    if (query.trim().length === 0) return;
    status = `searching "${query}"…`;
    redraw();
    const res = await searchRegistry(query.trim(), 15);
    if (!res.ok) {
      status = paint(`search failed: ${res.error}`, 'yellow');
      hits = [];
      redraw();
      return;
    }
    hits = res.value;
    status = `${hits.length} results`;
    for (const key of Object.keys(verdicts)) delete verdicts[key];
    redraw();

    // Gate every hit concurrently; fill verdicts in as they land.
    await Promise.all(
      hits.map(async (hit) => {
        verdicts[hit.name] = 'checking';
        const outcome = await check(hit.name);
        verdicts[hit.name] = outcome.ok ? outcome.value.verdict.level : 'yellow';
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
      // Printable single characters extend the query and are consumed here so
      // global shortcuts (q, r, digits) do not fire while typing.
      if (key.str.length === 1 && key.str >= ' ' && key.str !== '\x7f') {
        query += key.str;
        return true;
      }
      return false;
    },
    render: (rows) => {
      const lines: string[] = [];
      lines.push(`${paint('search:', 'bold')} ${query}${paint('▏', 'cyan')}`);
      lines.push(paint(status, 'dim'));
      lines.push('');

      if (hits.length === 0) {
        lines.push(paint('Type a package name and press Enter.', 'dim'));
        return lines;
      }

      const budget = Math.max(1, rows - lines.length - 1);
      const table = renderTable(
        [
          { header: 'VERDICT', width: 8 },
          { header: 'PACKAGE', width: 28 },
          { header: 'VER', width: 10 },
          { header: 'DESCRIPTION', width: 32 },
        ],
        hits.slice(0, budget).map((h) => {
          const v = verdicts[h.name];
          const cell =
            v === undefined || v === 'checking'
              ? paint('·····', 'dim')
              : paint(v.toUpperCase(), LEVEL_STYLE[v]);
          return [
            cell,
            truncate(h.name, 28),
            truncate(h.version, 10),
            truncate(h.description, 32),
          ];
        }),
      );
      lines.push(...table);
      return lines;
    },
  };
}
