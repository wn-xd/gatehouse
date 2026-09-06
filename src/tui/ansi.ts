/**
 * Zero-dependency ANSI terminal primitives.
 *
 * Gatehouse ships no supply chain of its own, so the control center is drawn
 * with raw escape codes against the Node standard library — no ink, no blessed,
 * no react. This module is the whole rendering vocabulary: SGR color, cursor
 * control, screen clearing, and width-aware text helpers. Everything above it
 * (tabs, tables, the app loop) composes these.
 */

const ESC = '\x1b[';

/** SGR color/style codes, applied with {@link paint}. */
export const SGR = {
  reset: '0',
  bold: '1',
  dim: '2',
  inverse: '7',
  red: '1;31',
  yellow: '1;33',
  green: '1;32',
  cyan: '1;36',
  gray: '90',
} as const;

export type SgrName = keyof typeof SGR;

/** Wrap `text` in one SGR style, always resetting after. */
export function paint(text: string, style: SgrName): string {
  return `${ESC}${SGR[style]}m${text}${ESC}${SGR.reset}m`;
}

/** Verdict-level → color name, the one place the mapping lives for the TUI. */
export const LEVEL_STYLE: Record<'green' | 'yellow' | 'red', SgrName> = {
  green: 'green',
  yellow: 'yellow',
  red: 'red',
};

// --- cursor + screen control ------------------------------------------------

export const CURSOR_HOME = `${ESC}H`;
export const CLEAR_SCREEN = `${ESC}2J`;
export const CLEAR_LINE = `${ESC}2K`;
export const HIDE_CURSOR = `${ESC}?25l`;
export const SHOW_CURSOR = `${ESC}?25h`;
export const ALT_SCREEN_ON = `${ESC}?1049h`;
export const ALT_SCREEN_OFF = `${ESC}?1049l`;

/** Move the cursor to 1-indexed (row, col). */
export function moveTo(row: number, col: number): string {
  return `${ESC}${row};${col}H`;
}

// --- width-aware text helpers -----------------------------------------------

/**
 * Length of `text` ignoring SGR escape sequences, so layout math counts
 * glyphs, not bytes. Assumes single-width glyphs — adequate for ASCII package
 * names and codes; East-Asian double-width is out of scope.
 */
export function visibleLength(text: string): number {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/** Pad `text` to `width` visible columns; truncates with an ellipsis. */
export function pad(text: string, width: number): string {
  const len = visibleLength(text);
  if (len === width) return text;
  if (len < width) return text + ' '.repeat(width - len);
  // Too long: truncate the raw text to width-1 visible chars, add ellipsis.
  // Only safe for text without embedded SGR — callers pad plain cells.
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

/** Truncate to `width` visible columns with an ellipsis, no padding. */
export function truncate(text: string, width: number): string {
  if (visibleLength(text) <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}
