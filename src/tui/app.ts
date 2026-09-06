import {
  ALT_SCREEN_OFF,
  ALT_SCREEN_ON,
  CLEAR_SCREEN,
  CURSOR_HOME,
  HIDE_CURSOR,
  paint,
  SHOW_CURSOR,
} from './ansi.js';

/**
 * A single tab in the control center. `render` returns the body lines for the
 * given viewport size; `onKey` optionally handles a keypress and returns true
 * when it consumed it (so the app skips global handling). `refresh` reloads any
 * data the tab shows, called on entry and on the manual refresh key.
 */
export interface Tab {
  name: string;
  render: (rows: number, cols: number) => string[];
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
    case '\t':
      return { str: raw, name: 'tab' };
    default:
      return { str: raw, name: raw };
  }
}

/** Terminal viewport size, defaulting when not a TTY. */
export function viewport(): { rows: number; cols: number } {
  return {
    rows: process.stdout.rows ?? 24,
    cols: process.stdout.columns ?? 80,
  };
}

/**
 * The control-center runtime. Owns the alt-screen, the tab bar, key routing,
 * and the render frame. Tabs supply content; the app supplies the chrome.
 *
 * Global keys: Tab / 1-9 switch tabs, r refreshes, q or Ctrl-C quits. A tab's
 * own onKey runs first and can shadow these (e.g. Packages' search box eats
 * printable keys), which is why onKey returns whether it consumed the event.
 */
export class App {
  private active = 0;
  private running = false;
  private readonly out: NodeJS.WriteStream;

  constructor(
    private readonly tabs: Tab[],
    out: NodeJS.WriteStream = process.stdout,
  ) {
    this.out = out;
  }

  private current(): Tab {
    return this.tabs[this.active] as Tab;
  }

  /** Compose one full frame: tab bar, body, footer. */
  frame(): string {
    const { rows, cols } = viewport();
    const bar = this.tabBar();
    const footerText = ' Tab/1-9 switch · ↑↓ move · r refresh · q quit ';
    const bodyRows = Math.max(1, rows - 3); // bar + blank + footer
    const body = this.current().render(bodyRows, cols);

    const lines: string[] = [bar, ''];
    for (let i = 0; i < bodyRows; i++) {
      lines.push(body[i] ?? '');
    }
    lines.push(paint(footerText, 'dim'));
    return lines.join('\n');
  }

  private tabBar(): string {
    const cells = this.tabs.map((tab, i) => {
      const label = ` ${i + 1} ${tab.name} `;
      return i === this.active ? paint(label, 'inverse') : label;
    });
    const bar = cells.join('');
    const title = paint(' gatehouse ', 'cyan');
    return title + bar;
  }

  /** Draw the current frame to the output stream. */
  draw(): void {
    this.out.write(CURSOR_HOME + CLEAR_SCREEN + this.frame());
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
   * Dispatch one key: the active tab sees it first and may consume it; only
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

  /** Enter the alt-screen loop over raw stdin. Resolves when the user quits. */
  async run(): Promise<void> {
    const input = process.stdin;
    this.running = true;
    this.out.write(ALT_SCREEN_ON + HIDE_CURSOR);
    if (input.isTTY) input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');

    await this.current().refresh?.();
    this.draw();

    await new Promise<void>((resolve) => {
      const onData = (chunk: string): void => {
        if (!this.running) return;
        void this.dispatch(decodeKey(chunk)).then((keepRunning) => {
          if (!keepRunning) {
            this.running = false;
            input.off('data', onData);
            if (input.isTTY) input.setRawMode(false);
            input.pause();
            this.out.write(SHOW_CURSOR + ALT_SCREEN_OFF);
            resolve();
          }
        });
      };
      input.on('data', onData);
    });
  }
}
