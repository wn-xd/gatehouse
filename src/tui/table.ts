import { pad, visibleLength } from './ansi.js';

/** A column: header label and fixed visible width. */
export interface Column {
  header: string;
  width: number;
}

/**
 * Render a fixed-width table as an array of lines (header + separator + rows).
 *
 * Cells may contain SGR color; width math uses {@link visibleLength} so colored
 * cells still align. A row with fewer cells than columns is padded with blanks;
 * extra cells are dropped. This is layout only — no borders, no wrapping — because
 * the TUI favors dense scannable rows over boxes.
 */
export function renderTable(columns: Column[], rows: string[][]): string[] {
  const header = columns.map((c) => pad(c.header, c.width)).join('  ');
  const sep = columns.map((c) => '─'.repeat(c.width)).join('  ');

  const body = rows.map((row) =>
    columns
      .map((col, i) => {
        const cell = row[i] ?? '';
        // Pad by visible length so embedded color codes do not skew the column.
        const visible = visibleLength(cell);
        if (visible >= col.width) return cell;
        return cell + ' '.repeat(col.width - visible);
      })
      .join('  '),
  );

  return [header, sep, ...body];
}
