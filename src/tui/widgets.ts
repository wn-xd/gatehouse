import type { Screen, Style } from './buffer.js';
import { DARK, GLYPH, type Rgb } from './theme.js';

/**
 * Composite drawing built on the cell surface: panels, headers, tables and
 * scrollbars.
 *
 * These are the pieces that give the terminal interface structure rather than
 * rows of space-padded text. Everything here draws into a {@link Screen}, so it
 * all participates in the same diffed, synchronized paint.
 */

/** A rectangular region. Widgets clip themselves to their box. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Draw a rounded panel border with an optional title.
 *
 * A focused panel is drawn with heavy box glyphs as well as an accent colour,
 * so focus survives a monochrome terminal and does not depend on colour vision.
 */
export function panel(
  screen: Screen,
  box: Box,
  title?: string,
  focused = false,
): void {
  const edge: Style = { fg: focused ? DARK.accent : DARK.border };
  const g = focused
    ? {
        tl: GLYPH.topLeftHeavy,
        tr: GLYPH.topRightHeavy,
        bl: GLYPH.bottomLeftHeavy,
        br: GLYPH.bottomRightHeavy,
        h: GLYPH.horizontalHeavy,
        v: GLYPH.verticalHeavy,
      }
    : {
        tl: GLYPH.topLeft,
        tr: GLYPH.topRight,
        bl: GLYPH.bottomLeft,
        br: GLYPH.bottomRight,
        h: GLYPH.horizontal,
        v: GLYPH.vertical,
      };

  const right = box.x + box.width - 1;
  const bottom = box.y + box.height - 1;

  screen.write(box.x, box.y, g.tl + g.h.repeat(Math.max(0, box.width - 2)) + g.tr, edge);
  screen.write(box.x, bottom, g.bl + g.h.repeat(Math.max(0, box.width - 2)) + g.br, edge);
  for (let y = box.y + 1; y < bottom; y++) {
    screen.write(box.x, y, g.v, edge);
    screen.write(right, y, g.v, edge);
  }

  if (title !== undefined && title.length > 0) {
    // Inset the title and pad it, so the border reads as interrupted rather
    // than collided with.
    screen.write(box.x + 2, box.y, ` ${title} `, {
      fg: focused ? DARK.accent : DARK.textMuted,
      bold: true,
    });
  }
}

/** A table column: header text, width in cells, and optional alignment. */
export interface Column {
  header: string;
  width: number;
  align?: 'left' | 'right';
}

/** One rendered cell: text plus the style to draw it in. */
export interface TableCell {
  text: string;
  style?: Style;
}

/** Clip text to a width, marking truncation so nothing is silently lost. */
function clip(text: string, width: number): string {
  if (width <= 0) return '';
  const chars = [...text];
  if (chars.length <= width) return text;
  return chars.slice(0, Math.max(0, width - 1)).join('') + '…';
}

/**
 * Draw a table with a header rule and a selected row.
 *
 * Rows are drawn as a background band rather than a marker character alone: the
 * selection reads as a surface, which is both clearer and consistent with how
 * the desktop app shows the same data. `offset` is the index of the first
 * visible row, so callers own scrolling.
 */
export function table(
  screen: Screen,
  box: Box,
  columns: Column[],
  rows: TableCell[][],
  options: { selected?: number; offset?: number } = {},
): void {
  const offset = options.offset ?? 0;
  const gap = 2;

  // Header.
  let cx = box.x;
  for (const column of columns) {
    const label = clip(column.header.toUpperCase(), column.width);
    screen.write(cx, box.y, label, { fg: DARK.textFaint, bold: true });
    cx += column.width + gap;
  }
  screen.write(
    box.x,
    box.y + 1,
    GLYPH.horizontal.repeat(Math.max(0, Math.min(box.width, cx - box.x - gap))),
    { fg: DARK.border },
  );

  // Body.
  const bodyTop = box.y + 2;
  const visible = Math.max(0, box.height - 2);
  for (let i = 0; i < visible; i++) {
    const rowIndex = offset + i;
    const row = rows[rowIndex];
    if (row === undefined) break;
    const y = bodyTop + i;
    const isSelected = options.selected === rowIndex;

    if (isSelected) {
      screen.fill(box.x, y, box.width, 1, DARK.overlay);
      screen.write(box.x, y, GLYPH.caret, { fg: DARK.accent, bg: DARK.overlay });
    }

    let x = box.x + 2;
    for (let c = 0; c < columns.length; c++) {
      const column = columns[c] as Column;
      const cell = row[c];
      if (cell !== undefined) {
        const text = clip(cell.text, column.width);
        const pad =
          column.align === 'right' ? ' '.repeat(Math.max(0, column.width - [...text].length)) : '';
        const style: Style = { ...(cell.style ?? {}) };
        if (isSelected) style.bg = DARK.overlay;
        screen.write(x, y, pad + text, style);
      }
      x += column.width + gap;
    }
  }
}

/**
 * Draw a vertical scrollbar for a scrolled list.
 *
 * Only drawn when content actually overflows: a permanent track on a short list
 * is noise implying there is more to see.
 */
export function scrollbar(
  screen: Screen,
  box: Box,
  total: number,
  visible: number,
  offset: number,
): void {
  if (total <= visible) return;
  const trackHeight = box.height;
  const thumbHeight = Math.max(1, Math.round((visible / total) * trackHeight));
  const maxOffset = total - visible;
  const thumbTop =
    maxOffset === 0 ? 0 : Math.round((offset / maxOffset) * (trackHeight - thumbHeight));

  for (let i = 0; i < trackHeight; i++) {
    const inThumb = i >= thumbTop && i < thumbTop + thumbHeight;
    screen.write(box.x, box.y + i, inThumb ? GLYPH.scrollThumb : GLYPH.scrollTrack, {
      fg: inThumb ? DARK.textMuted : DARK.border,
    });
  }
}

/**
 * Draw a labelled statistic.
 *
 * Hierarchy comes from weight and tone, not size alone: a quiet uppercase label
 * over a bright value, which keeps a row of these scannable.
 */
export function stat(
  screen: Screen,
  x: number,
  y: number,
  label: string,
  value: string,
  color: Rgb,
): void {
  screen.write(x, y, label.toUpperCase(), { fg: DARK.textFaint, bold: true });
  screen.write(x, y + 1, value, { fg: color, bold: true });
}

/** Draw a verdict pill: a coloured dot plus its label. */
export function verdictChip(
  screen: Screen,
  x: number,
  y: number,
  level: 'green' | 'yellow' | 'red',
  background?: Rgb,
): number {
  const color = level === 'red' ? DARK.red : level === 'yellow' ? DARK.yellow : DARK.green;
  const style: Style = { fg: color, bold: true };
  if (background !== undefined) style.bg = background;
  const text = `${GLYPH.dot} ${level.toUpperCase()}`;
  screen.write(x, y, text, style);
  return x + [...text].length;
}
