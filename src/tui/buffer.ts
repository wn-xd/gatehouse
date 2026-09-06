import {
  compileStyle,
  type ColorTier,
  type CompiledStyle,
  type Rgb,
} from './theme.js';

/**
 * A double-buffered terminal surface with diff-based painting.
 *
 * The previous implementation cleared the screen and rewrote every line on each
 * keypress, which makes the terminal render a blank intermediate frame — the
 * flicker you see. This replaces it with the approach a real terminal UI uses:
 * draw into a back buffer of cells, compare against what is already on screen,
 * and emit only the runs that actually changed.
 *
 * Two properties matter for smoothness:
 *   - Minimal output. Moving a selection marker rewrites two cells, not a
 *     screenful, so there is nothing for the terminal to visibly repaint.
 *   - Atomic presentation. The whole diff goes out inside one synchronized
 *     update and a single write, so the terminal shows the finished frame
 *     rather than composing it in front of the user.
 */

/** One character cell: a glyph plus its resolved colours and attributes. */
interface Cell {
  ch: string;
  fg: Rgb | null;
  bg: Rgb | null;
  bold: boolean;
  dim: boolean;
}

const BLANK: Cell = { ch: ' ', fg: null, bg: null, bold: false, dim: false };

/** Style to apply to written text. */
export interface Style {
  fg?: Rgb;
  bg?: Rgb;
  bold?: boolean;
  dim?: boolean;
}

const ESC = '\x1b[';

/**
 * Begin/End Synchronized Update (DEC private mode 2026).
 *
 * Tells the terminal to buffer output and present it as one frame. Windows
 * Terminal supports this (merged 2025, in stable since 1.23), as do most modern
 * terminals; those that do not simply ignore the sequence, so it is safe to
 * emit unconditionally and costs nothing where unsupported.
 */
const SYNC_BEGIN = `${ESC}?2026h`;
const SYNC_END = `${ESC}?2026l`;

function sameCell(a: Cell, b: Cell): boolean {
  return (
    a.ch === b.ch &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    sameColor(a.fg, b.fg) &&
    sameColor(a.bg, b.bg)
  );
}

function sameColor(a: Rgb | null, b: Rgb | null): boolean {
  if (a === null || b === null) return a === b;
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

export class Screen {
  private front: Cell[][] = [];
  private back: Cell[][] = [];
  private readonly style: CompiledStyle;
  /** Set when the terminal was resized and the next paint must be complete. */
  private invalid = true;

  constructor(
    public rows: number,
    public cols: number,
    tier: ColorTier,
    private readonly out: NodeJS.WriteStream = process.stdout,
  ) {
    this.style = compileStyle(tier);
    this.allocate();
  }

  private allocate(): void {
    const make = (): Cell[][] =>
      Array.from({ length: this.rows }, () =>
        Array.from({ length: this.cols }, () => ({ ...BLANK })),
      );
    this.front = make();
    this.back = make();
  }

  /**
   * Adopt a new terminal size.
   *
   * The front buffer no longer describes what is on screen after a resize, so
   * the next paint is forced to be complete rather than a diff against stale
   * contents.
   */
  resize(rows: number, cols: number): void {
    if (rows === this.rows && cols === this.cols) return;
    this.rows = rows;
    this.cols = cols;
    this.allocate();
    this.invalid = true;
  }

  /** Clear the back buffer, optionally to a background colour. */
  clear(bg?: Rgb): void {
    for (let y = 0; y < this.rows; y++) {
      const row = this.back[y] as Cell[];
      for (let x = 0; x < this.cols; x++) {
        const cell = row[x] as Cell;
        cell.ch = ' ';
        cell.fg = null;
        cell.bg = bg ?? null;
        cell.bold = false;
        cell.dim = false;
      }
    }
  }

  /**
   * Write text into the back buffer at (x, y), clipped to the surface.
   *
   * Returns the column just past the text, so callers can lay out runs without
   * tracking widths themselves.
   */
  write(x: number, y: number, text: string, style: Style = {}): number {
    if (y < 0 || y >= this.rows) return x;
    const row = this.back[y] as Cell[];
    let cx = x;
    // Iterate by code point so an emoji or box glyph is not split in half.
    for (const ch of text) {
      if (cx >= this.cols) break;
      if (cx >= 0) {
        const cell = row[cx] as Cell;
        cell.ch = ch;
        cell.fg = style.fg ?? null;
        cell.bg = style.bg ?? null;
        cell.bold = style.bold === true;
        cell.dim = style.dim === true;
      }
      cx++;
    }
    return cx;
  }

  /** Fill a rectangle with a background colour (used for panels and bars). */
  fill(x: number, y: number, width: number, height: number, bg: Rgb): void {
    for (let row = y; row < y + height; row++) {
      if (row < 0 || row >= this.rows) continue;
      for (let col = x; col < x + width; col++) {
        if (col < 0 || col >= this.cols) continue;
        const cell = (this.back[row] as Cell[])[col] as Cell;
        cell.bg = bg;
      }
    }
  }

  /** SGR sequence for a cell, or '' when it needs no styling. */
  private sgrFor(cell: Cell): string {
    const parts: string[] = [];
    if (cell.bold) parts.push('1');
    if (cell.dim) parts.push('2');
    if (cell.fg !== null) parts.push(this.style.fg(cell.fg));
    if (cell.bg !== null) parts.push(this.style.bg(cell.bg));
    return parts.length === 0 ? '' : `${ESC}${parts.join(';')}m`;
  }

  /**
   * Present the back buffer.
   *
   * Walks each row and emits contiguous runs of changed cells, repositioning
   * the cursor only when a run does not continue from the last write. The whole
   * emission is wrapped in a synchronized update and flushed as one write, so
   * the terminal never displays a partially painted frame.
   */
  present(): void {
    const chunks: string[] = [SYNC_BEGIN];
    let lastStyle = '';
    let cursorRow = -1;
    let cursorCol = -1;

    for (let y = 0; y < this.rows; y++) {
      const backRow = this.back[y] as Cell[];
      const frontRow = this.front[y] as Cell[];

      for (let x = 0; x < this.cols; x++) {
        const cell = backRow[x] as Cell;
        if (!this.invalid && sameCell(cell, frontRow[x] as Cell)) continue;

        // Reposition only when this cell does not follow the previous write.
        if (cursorRow !== y || cursorCol !== x) {
          chunks.push(`${ESC}${y + 1};${x + 1}H`);
          cursorRow = y;
          cursorCol = x;
        }

        const sgr = this.sgrFor(cell);
        if (sgr !== lastStyle) {
          // Reset first so no attribute leaks from the previous run.
          chunks.push(`${ESC}0m`, sgr);
          lastStyle = sgr;
        }
        chunks.push(cell.ch);
        cursorCol++;

        // Commit to the front buffer as we go.
        const target = frontRow[x] as Cell;
        target.ch = cell.ch;
        target.fg = cell.fg;
        target.bg = cell.bg;
        target.bold = cell.bold;
        target.dim = cell.dim;
      }
    }

    if (lastStyle !== '') chunks.push(`${ESC}0m`);
    chunks.push(SYNC_END);
    this.invalid = false;

    // One write: the frame arrives at the terminal as a single unit.
    if (chunks.length > 2) this.out.write(chunks.join(''));
  }

  /** Force the next present to repaint everything. */
  invalidate(): void {
    this.invalid = true;
  }
}
