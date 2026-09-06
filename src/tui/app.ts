import { ALT_SCREEN_OFF, ALT_SCREEN_ON, HIDE_CURSOR, SHOW_CURSOR } from './ansi.js';
import { Screen } from './buffer.js';
import { DARK, detectColorTier, GLYPH } from './theme.js';
import type { Box } from './widgets.js';

/**
 * A surface in the control center.
 *
 * `paint` draws into the shared cell buffer within the box the app allocates —
 * every surface participates in one diffed, synchronized frame rather than
 * printing its own lines. `onKey` may consume a key before global handling
 * sees it (so a search field can own printable characters), and `refresh`
 * reloads data on entry and on demand.
 */
export interface Tab {
  name: string;
  paint: (screen: Screen, box: Box) => void;
  onKey?: (key: Key) => boolean | Promise<boolean>;
  refresh?: () => void | Promise<void>;
}

/** A decoded keypress. */
export interface Key {
  /** The raw string for printable keys, e.g. "a", "/". */
  str: string;
  name: string;
}

/** Decode a raw stdin chunk into a Key. Covers the keys the TUI uses. */
export function decodeKey(raw: string): Key {
  switch (raw) {
    case '\r':
    case '\n':
      return { str: raw, name: 'enter' };
    case '\x1b':
      return { str: raw, name: 'escape' };
    case '\x7f':
    case '\b':
      return { str: raw, name: 'backspace' };
    case '\x03':
      return { str: raw, name: 'ctrl-c' };
    case '\x1b[A':
      return { str: raw, name: 'up' };
    case '\x1b[B':
      return { str: raw, name: 'down' };
    case '\x1b[C':
      return { str: raw, name: 'right' };
    case '\x1b[D':
      return { str: raw, name: 'left' };
    case '\x1b[5~':
      return { str: raw, name: 'pageup' };
    case '\x1b[6~':
      return { str: raw, name: 'pagedown' };
    case '\t':
      return { str: raw, name: 'tab' };
    default:
      return { str: raw, name: raw };
  }
}

/** Terminal viewport size, with a sane default when not attached to a TTY. */
export function viewport(): { rows: number; cols: number } {
  return {
    rows: process.stdout.rows ?? 24,
    cols: process.stdout.columns ?? 80,
  };
}

const SIDEBAR_WIDTH = 20;

/**
 * The control-center runtime.
 *
 * Owns the alternate screen, the cell buffer, key routing and the chrome;
 * surfaces own their content. Layout mirrors the desktop app — a sidebar of
 * named destinations beside a content region — so the two faces read as the
 * same product rather than two unrelated tools.
 */
export class App {
  private active = 0;
  private running = false;
  private readonly screen: Screen;
  private onResize: (() => void) | null = null;

  constructor(
    private readonly tabs: Tab[],
    private readonly out: NodeJS.WriteStream = process.stdout,
  ) {
    const { rows, cols } = viewport();
    this.screen = new Screen(rows, cols, detectColorTier(out), out);
  }

  private current(): Tab {
    return this.tabs[this.active] as Tab;
  }

  /** The box allocated to surface content, inside the chrome. */
  private contentBox(): Box {
    return {
      x: SIDEBAR_WIDTH + 2,
      y: 2,
      width: Math.max(1, this.screen.cols - SIDEBAR_WIDTH - 3),
      height: Math.max(1, this.screen.rows - 3),
    };
  }

  /** Draw the sidebar: brand, destinations, and the active indicator. */
  private paintSidebar(): void {
    const s = this.screen;
    s.fill(0, 0, SIDEBAR_WIDTH, s.rows, DARK.raised);

    s.write(2, 0, '● Gatehouse', { fg: DARK.accent, bold: true });

    for (let i = 0; i < this.tabs.length; i++) {
      const tab = this.tabs[i] as Tab;
      const y = 2 + i;
      const isActive = i === this.active;
      if (isActive) {
        s.fill(0, y, SIDEBAR_WIDTH, 1, DARK.overlay);
        // A bar at the edge marks the selection, matching the desktop app.
        s.write(0, y, GLYPH.caret, { fg: DARK.accent, bg: DARK.overlay });
      }
      s.write(2, y, `${i + 1}`, {
        fg: isActive ? DARK.accent : DARK.textFaint,
        bg: isActive ? DARK.overlay : DARK.raised,
      });
      s.write(4, y, tab.name, {
        fg: isActive ? DARK.text : DARK.textMuted,
        bg: isActive ? DARK.overlay : DARK.raised,
        bold: isActive,
      });
    }

    // Vertical rule separating the structural region from content.
    for (let y = 0; y < s.rows; y++) {
      s.write(SIDEBAR_WIDTH, y, GLYPH.vertical, { fg: DARK.border });
    }
  }

  /** Draw the title row and the key hints. */
  private paintChrome(): void {
    const s = this.screen;
    s.write(SIDEBAR_WIDTH + 2, 0, this.current().name, { fg: DARK.text, bold: true });

    const hints = ' 1-5 switch · ↑↓ move · r refresh · q quit';
    s.write(SIDEBAR_WIDTH + 2, s.rows - 1, hints, { fg: DARK.textFaint });
  }

  /** Compose and present one frame. */
  draw(): void {
    this.screen.clear(DARK.base);
    this.paintSidebar();
    this.paintChrome();
    this.current().paint(this.screen, this.contentBox());
    this.screen.present();
  }

  private switchTo(index: number): void {
    if (index < 0 || index >= this.tabs.length || index === this.active) return;
    this.active = index;
    void this.current().refresh?.();
  }

  /** Route a global key. Returns false when the app should quit. */
  async handleGlobal(key: Key): Promise<boolean> {
    if (key.name === 'q' || key.name === 'ctrl-c') return false;
    if (key.name === 'tab') {
      this.switchTo((this.active + 1) % this.tabs.length);
      return true;
    }
    if (key.name === 'r') {
      await this.current().refresh?.();
      return true;
    }
    if (/^[1-9]$/.test(key.name)) {
      this.switchTo(Number(key.name) - 1);
      return true;
    }
    return true;
  }

  /**
   * Dispatch one key: the active surface sees it first and may consume it; only
   * unconsumed keys reach global handling. Returns false to quit.
   */
  async dispatch(key: Key): Promise<boolean> {
    const consumed = await this.current().onKey?.(key);
    if (consumed === true) {
      this.draw();
      return true;
    }
    const keepRunning = await this.handleGlobal(key);
    if (keepRunning) this.draw();
    return keepRunning;
  }

  /** Enter the alternate screen loop over raw stdin. Resolves when the user quits. */
  async run(): Promise<void> {
    const input = process.stdin;
    this.running = true;
    this.out.write(ALT_SCREEN_ON + HIDE_CURSOR);
    if (input.isTTY) input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');

    // Terminal resizes were previously ignored entirely, so the layout stayed
    // wrong until the next keypress. Re-measure and repaint immediately.
    this.onResize = (): void => {
      const { rows, cols } = viewport();
      this.screen.resize(rows, cols);
      this.draw();
    };
    this.out.on('resize', this.onResize);

    await this.current().refresh?.();
    this.draw();

    await new Promise<void>((resolve) => {
      const onData = (chunk: string): void => {
        if (!this.running) return;
        void this.dispatch(decodeKey(chunk)).then((keepRunning) => {
          if (keepRunning) return;
          this.running = false;
          input.off('data', onData);
          if (this.onResize !== null) this.out.off('resize', this.onResize);
          if (input.isTTY) input.setRawMode(false);
          input.pause();
          this.out.write(SHOW_CURSOR + ALT_SCREEN_OFF);
          resolve();
        });
      };
      input.on('data', onData);
    });
  }
}
