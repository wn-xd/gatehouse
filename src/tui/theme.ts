/**
 * The TUI's visual language: a single table of deliberate values.
 *
 * Every colour, glyph and spacing constant lives here so the interface has one
 * defensible source of truth rather than literals scattered across renderers.
 * Colours are authored once in 24-bit truecolor and degraded at startup to
 * whatever the terminal actually supports, so the same token works on Windows
 * Terminal (truecolor), an older conhost (256/16) and a pipe (mono).
 *
 * Palette intent, borrowed from Apple's approach to depth: structure recedes
 * and content advances. Backgrounds sit in a narrow tonal band (base → raised →
 * overlay) that reads as layered surfaces rather than boxes drawn on a flat
 * field; text uses three weights of the same neutral instead of many hues; and
 * saturated colour is reserved for verdicts, where it carries meaning.
 */

/** A 24-bit colour. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const rgb = (r: number, g: number, b: number): Rgb => ({ r, g, b });

/** How much colour the attached terminal can render. */
export type ColorTier = 'truecolor' | 'ansi256' | 'ansi16' | 'mono';

/**
 * Detect the terminal's colour capability once, at startup.
 *
 * Order matters: an explicit NO_COLOR (the de-facto standard) wins over
 * everything, then a non-TTY (piped output) must stay plain, then COLORTERM
 * advertises truecolor, then TERM hints at 256. Windows Terminal sets
 * WT_SESSION and has supported truecolor since Windows 10 1703, so treat it as
 * truecolor even when COLORTERM is absent.
 */
export function detectColorTier(stream: NodeJS.WriteStream = process.stdout): ColorTier {
  if (process.env['NO_COLOR'] !== undefined && process.env['NO_COLOR'] !== '') return 'mono';
  if (stream.isTTY !== true) return 'mono';

  const colorterm = (process.env['COLORTERM'] ?? '').toLowerCase();
  if (colorterm === 'truecolor' || colorterm === '24bit') return 'truecolor';
  if (process.env['WT_SESSION'] !== undefined) return 'truecolor';

  const term = (process.env['TERM'] ?? '').toLowerCase();
  if (term.includes('256')) return 'ansi256';
  if (term === 'dumb') return 'mono';
  if (term !== '') return 'ansi16';

  // Windows conhost without TERM still renders colour via the console API.
  return process.platform === 'win32' ? 'ansi256' : 'ansi16';
}

/**
 * Semantic colour tokens. Renderers name intent ("border", "textMuted"), never
 * a raw colour, so the palette can change in one place.
 */
export interface Palette {
  /** Deepest layer — the window itself. */
  base: Rgb;
  /** A panel lifted off the base. */
  raised: Rgb;
  /** Transient surface above panels (selection, popover). */
  overlay: Rgb;
  /** Hairline between structural regions. */
  border: Rgb;
  /** Brighter edge where light would catch a raised surface. */
  borderLit: Rgb;
  /** Primary reading text. */
  text: Rgb;
  /** Secondary text: labels, metadata. */
  textMuted: Rgb;
  /** Tertiary text: hints, disabled. */
  textFaint: Rgb;
  /** Brand / focus accent. */
  accent: Rgb;
  /** Verdict colours — the only place saturation is spent freely. */
  green: Rgb;
  yellow: Rgb;
  red: Rgb;
}

/**
 * The shipped dark palette. Values are chosen for a consistent perceptual step
 * between layers (roughly +6 lightness per level) so depth reads without
 * borders doing all the work.
 */
export const DARK: Palette = {
  base: rgb(13, 17, 23),
  raised: rgb(22, 27, 34),
  overlay: rgb(33, 38, 45),
  border: rgb(48, 54, 61),
  borderLit: rgb(72, 79, 88),
  text: rgb(230, 237, 243),
  textMuted: rgb(139, 148, 158),
  textFaint: rgb(96, 105, 113),
  accent: rgb(57, 197, 207),
  green: rgb(63, 185, 80),
  yellow: rgb(210, 153, 34),
  red: rgb(248, 81, 73),
};

/** Nearest xterm-256 index for an RGB triple (6x6x6 cube + greyscale ramp). */
function to256(c: Rgb): number {
  // Greys collapse to the 24-step ramp, which is finer than the cube's grey axis.
  if (Math.abs(c.r - c.g) < 8 && Math.abs(c.g - c.b) < 8) {
    if (c.r < 8) return 16;
    if (c.r > 248) return 231;
    return 232 + Math.round(((c.r - 8) / 247) * 23);
  }
  const q = (v: number): number => Math.round((v / 255) * 5);
  return 16 + 36 * q(c.r) + 6 * q(c.g) + q(c.b);
}

/** Nearest basic-16 code for an RGB triple, as an SGR foreground number. */
function to16(c: Rgb): number {
  const bright = (c.r + c.g + c.b) / 3 > 128;
  const bit = (v: number): number => (v > 110 ? 1 : 0);
  const code = bit(c.r) + bit(c.g) * 2 + bit(c.b) * 4;
  // 30..37 normal, 90..97 bright.
  return (bright ? 90 : 30) + code;
}

/**
 * Compile a palette into ready-to-emit SGR parameter strings for the detected
 * tier. Doing this once at startup keeps the paint path free of branching:
 * the differ concatenates precomputed strings instead of deciding per cell.
 */
export interface CompiledStyle {
  fg: (c: Rgb) => string;
  bg: (c: Rgb) => string;
  tier: ColorTier;
}

export function compileStyle(tier: ColorTier): CompiledStyle {
  if (tier === 'mono') {
    return { fg: () => '', bg: () => '', tier };
  }
  if (tier === 'truecolor') {
    return {
      fg: (c) => `38;2;${c.r};${c.g};${c.b}`,
      bg: (c) => `48;2;${c.r};${c.g};${c.b}`,
      tier,
    };
  }
  if (tier === 'ansi256') {
    return {
      fg: (c) => `38;5;${to256(c)}`,
      bg: (c) => `48;5;${to256(c)}`,
      tier,
    };
  }
  return {
    fg: (c) => String(to16(c)),
    bg: (c) => String(to16(c) + 10),
    tier,
  };
}

/**
 * Box-drawing glyphs. Rounded corners read softer than square ones and match
 * the visual language of modern native UI; the heavy variants mark focus.
 */
export const GLYPH = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  /** Focused panel edge — a doubled line, not a colour change alone. */
  horizontalHeavy: '━',
  verticalHeavy: '┃',
  topLeftHeavy: '┏',
  topRightHeavy: '┓',
  bottomLeftHeavy: '┗',
  bottomRightHeavy: '┛',
  /** Row selection marker. */
  caret: '▌',
  /** Scrollbar track and thumb. */
  scrollTrack: '│',
  scrollThumb: '┃',
  /** Verdict dot — a filled circle carries the colour at small size. */
  dot: '●',
  /** In-progress indicator frames, for indeterminate work. */
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
} as const;

/**
 * Spacing scale, in cells. A 4-step scale keeps rhythm consistent — every gap
 * in the interface is one of these, never an ad-hoc number.
 */
export const SPACE = { xs: 1, sm: 2, md: 4, lg: 6 } as const;
