import { describe, expect, it } from 'vitest';

import { Screen } from '../src/tui/buffer.js';
import { App, decodeKey, type Tab } from '../src/tui/app.js';
import { DARK } from '../src/tui/theme.js';
import { panel, scrollbar, table, type Box } from '../src/tui/widgets.js';

/** Collect what the app would write to a terminal. */
function captureStream(): { stream: NodeJS.WriteStream; text: () => string; reset: () => void } {
  let buffer = '';
  const stream = {
    write: (chunk: string) => {
      buffer += chunk;
      return true;
    },
    rows: 24,
    columns: 80,
    isTTY: true,
    on: () => stream,
    off: () => stream,
  } as unknown as NodeJS.WriteStream;
  return { stream, text: () => buffer, reset: () => (buffer = '') };
}

/** Strip escape sequences so assertions read the visible text. */
function visible(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
}

const BOX: Box = { x: 0, y: 0, width: 40, height: 10 };

describe('Screen', () => {
  it('emits only changed cells on a second paint', () => {
    const cap = captureStream();
    const screen = new Screen(10, 40, 'truecolor', cap.stream);

    screen.clear(DARK.base);
    screen.write(0, 0, 'hello world');
    screen.present();
    const first = cap.text().length;
    expect(first).toBeGreaterThan(0);

    // Repainting an identical frame must produce no output at all: this is the
    // property that removes flicker.
    cap.reset();
    screen.present();
    expect(cap.text()).toBe('');

    // A single changed cell must cost far less than the whole frame.
    cap.reset();
    screen.write(0, 0, 'J');
    screen.present();
    expect(cap.text().length).toBeGreaterThan(0);
    expect(cap.text().length).toBeLessThan(first / 2);
  });

  it('wraps output in a synchronized update so frames present atomically', () => {
    const cap = captureStream();
    const screen = new Screen(5, 20, 'truecolor', cap.stream);
    screen.write(0, 0, 'x');
    screen.present();
    expect(cap.text()).toContain('\x1b[?2026h');
    expect(cap.text()).toContain('\x1b[?2026l');
  });

  it('clips writes to the surface instead of overflowing', () => {
    const cap = captureStream();
    const screen = new Screen(3, 8, 'mono', cap.stream);
    screen.write(5, 1, 'abcdefghij');
    screen.present();
    // Only the three cells that fit are painted.
    expect(visible(cap.text())).toContain('abc');
    expect(visible(cap.text())).not.toContain('abcd');
  });

  it('repaints fully after a resize', () => {
    const cap = captureStream();
    const screen = new Screen(5, 20, 'truecolor', cap.stream);
    screen.write(0, 0, 'before');
    screen.present();

    cap.reset();
    screen.resize(6, 24);
    screen.write(0, 0, 'before');
    screen.present();
    // The front buffer no longer describes the terminal, so this must not be
    // diffed away to nothing.
    expect(cap.text().length).toBeGreaterThan(0);
  });

  it('degrades colour to the terminal tier', () => {
    const truecolor = captureStream();
    new Screen(2, 10, 'truecolor', truecolor.stream);
    const mono = captureStream();
    const monoScreen = new Screen(2, 10, 'mono', mono.stream);
    monoScreen.write(0, 0, 'x', { fg: DARK.red });
    monoScreen.present();
    // A monochrome terminal receives no colour parameters.
    expect(mono.text()).not.toContain('38;2;');
  });
});

describe('widgets', () => {
  it('draws a panel border with a title', () => {
    const cap = captureStream();
    const screen = new Screen(10, 40, 'truecolor', cap.stream);
    panel(screen, BOX, 'evidence');
    screen.present();
    const text = visible(cap.text());
    expect(text).toContain('evidence');
    expect(text).toContain('╭');
    expect(text).toContain('╯');
  });

  it('marks a focused panel with heavier glyphs, not colour alone', () => {
    const cap = captureStream();
    const screen = new Screen(10, 40, 'truecolor', cap.stream);
    panel(screen, BOX, 'focused', true);
    screen.present();
    expect(visible(cap.text())).toContain('┏');
  });

  it('renders table headers and rows', () => {
    const cap = captureStream();
    const screen = new Screen(10, 40, 'truecolor', cap.stream);
    table(
      screen,
      BOX,
      [
        { header: 'level', width: 6 },
        { header: 'name', width: 12 },
      ],
      [
        [{ text: 'RED' }, { text: 'evil-pkg' }],
        [{ text: 'GREEN' }, { text: 'express' }],
      ],
    );
    screen.present();
    const text = visible(cap.text());
    expect(text).toContain('LEVEL');
    expect(text).toContain('evil-pkg');
    expect(text).toContain('express');
  });

  it('truncates a cell that will not fit rather than overflowing its column', () => {
    const cap = captureStream();
    const screen = new Screen(6, 30, 'mono', cap.stream);
    table(
      screen,
      { x: 0, y: 0, width: 20, height: 5 },
      [{ header: 'name', width: 6 }],
      [[{ text: 'a-very-long-package-name' }]],
    );
    screen.present();
    expect(visible(cap.text())).toContain('…');
  });

  it('omits the scrollbar when content fits', () => {
    const cap = captureStream();
    const screen = new Screen(10, 40, 'truecolor', cap.stream);
    scrollbar(screen, { x: 39, y: 0, width: 1, height: 8 }, 5, 8, 0);
    screen.present();
    // Nothing overflowed, so no track should be drawn.
    expect(visible(cap.text()).trim()).toBe('');
  });

  it('draws a scrollbar thumb when content overflows', () => {
    const cap = captureStream();
    const screen = new Screen(10, 40, 'truecolor', cap.stream);
    scrollbar(screen, { x: 5, y: 0, width: 1, height: 8 }, 100, 8, 0);
    screen.present();
    expect(visible(cap.text())).toContain('┃');
  });
});

describe('decodeKey', () => {
  it('decodes control, arrow and paging keys', () => {
    expect(decodeKey('\r').name).toBe('enter');
    expect(decodeKey('\x1b[A').name).toBe('up');
    expect(decodeKey('\x1b[B').name).toBe('down');
    expect(decodeKey('\x1b[5~').name).toBe('pageup');
    expect(decodeKey('\x1b[6~').name).toBe('pagedown');
    expect(decodeKey('\x03').name).toBe('ctrl-c');
    expect(decodeKey('a').name).toBe('a');
  });
});

describe('App', () => {
  const makeTab = (name: string, body: string): Tab => ({
    name,
    paint: (screen, box) => {
      screen.write(box.x, box.y, body);
    },
  });

  it('paints the active surface and the sidebar', () => {
    const cap = captureStream();
    const app = new App([makeTab('Alpha', 'alpha-body'), makeTab('Beta', 'beta-body')], cap.stream);
    app.draw();
    const text = visible(cap.text());
    expect(text).toContain('Gatehouse');
    expect(text).toContain('Alpha');
    expect(text).toContain('Beta');
    expect(text).toContain('alpha-body');
  });

  it('switches surfaces on Tab and quits on q', async () => {
    const cap = captureStream();
    const app = new App([makeTab('Alpha', 'alpha-body'), makeTab('Beta', 'beta-body')], cap.stream);
    app.draw();

    cap.reset();
    expect(await app.handleGlobal(decodeKey('\t'))).toBe(true);
    app.draw();
    expect(visible(cap.text())).toContain('beta-body');

    expect(await app.handleGlobal(decodeKey('q'))).toBe(false);
  });

  it('jumps to a surface by number', async () => {
    const cap = captureStream();
    const app = new App([makeTab('Alpha', 'alpha-body'), makeTab('Beta', 'beta-body')], cap.stream);
    app.draw();

    cap.reset();
    await app.handleGlobal(decodeKey('2'));
    app.draw();
    expect(visible(cap.text())).toContain('beta-body');
  });

  it('lets a surface consume a key before global handling', async () => {
    const cap = captureStream();
    let typed = '';
    const typing: Tab = {
      name: 'Type',
      paint: (screen, box) => {
        screen.write(box.x, box.y, `typed:${typed}`);
      },
      onKey: (key) => {
        if (key.str.length === 1) {
          typed += key.str;
          return true;
        }
        return false;
      },
    };
    const app = new App([typing], cap.stream);

    // 'q' would normally quit, but the surface claims it.
    expect(await app.dispatch(decodeKey('q'))).toBe(true);
    expect(visible(cap.text())).toContain('typed:q');
  });

  it('calls refresh when entering a surface', async () => {
    const cap = captureStream();
    let refreshed = 0;
    const tabs: Tab[] = [
      makeTab('First', 'first'),
      {
        name: 'Second',
        paint: (screen, box) => screen.write(box.x, box.y, 'second'),
        refresh: () => {
          refreshed++;
        },
      },
    ];
    const app = new App(tabs, cap.stream);
    await app.handleGlobal(decodeKey('2'));
    expect(refreshed).toBe(1);
  });

  it('waits for an async refresh before painting the new surface', async () => {
    // Regression: switching surfaces used to fire refresh without awaiting it,
    // so a surface that loads from disk painted its empty initial state and
    // only showed data after the next keypress.
    const cap = captureStream();
    let loaded: string[] = [];
    // The refresh blocks on a gate this test opens only after dispatch has been
    // started, so the load is genuinely still pending at the moment an
    // unawaited implementation would paint. No wall-clock timing involved.
    let openGate = (): void => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const slow: Tab = {
      name: 'Slow',
      paint: (screen, box) => {
        screen.write(box.x, box.y, loaded.length === 0 ? 'nothing here' : loaded.join(','));
      },
      refresh: async () => {
        await gate;
        loaded = ['alpha', 'beta'];
      },
    };
    const app = new App([makeTab('First', 'first'), slow], cap.stream);

    cap.reset();
    const dispatched = app.dispatch(decodeKey('2'));
    // Let dispatch reach the refresh, then release it.
    await Promise.resolve();
    openGate();
    await dispatched;

    const text = visible(cap.text());
    expect(text).toContain('alpha,beta');
    expect(text).not.toContain('nothing here');
  });
});
