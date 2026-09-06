import { describe, expect, it } from 'vitest';

import { pad, truncate, visibleLength, paint } from '../src/tui/ansi.js';
import { App, decodeKey, type Tab } from '../src/tui/app.js';
import { renderTable } from '../src/tui/table.js';

describe('ansi helpers', () => {
  it('visibleLength ignores SGR codes', () => {
    expect(visibleLength(paint('hello', 'red'))).toBe(5);
    expect(visibleLength('plain')).toBe(5);
  });

  it('pad fills to width by visible length', () => {
    expect(pad('ab', 5)).toBe('ab   ');
    expect(visibleLength(pad('ab', 5))).toBe(5);
  });

  it('truncate adds an ellipsis past width', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});

describe('renderTable', () => {
  it('aligns columns and emits header + separator + rows', () => {
    const lines = renderTable(
      [
        { header: 'A', width: 3 },
        { header: 'B', width: 3 },
      ],
      [['x', 'y']],
    );
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('A');
    expect(lines[2]).toContain('x');
  });
});

describe('decodeKey', () => {
  it('decodes control and arrow keys', () => {
    expect(decodeKey('\r').name).toBe('enter');
    expect(decodeKey('\x1b[A').name).toBe('up');
    expect(decodeKey('\x03').name).toBe('ctrl-c');
    expect(decodeKey('a').name).toBe('a');
  });
});

describe('App', () => {
  const tabA: Tab = { name: 'Alpha', render: () => ['alpha-body'] };
  const tabB: Tab = { name: 'Beta', render: () => ['beta-body'] };

  it('renders the active tab body and tab bar', () => {
    const app = new App([tabA, tabB]);
    const frame = app.frame();
    expect(frame).toContain('Alpha');
    expect(frame).toContain('alpha-body');
    expect(frame).toContain('gatehouse');
  });

  it('Tab key switches tabs, q quits', async () => {
    const app = new App([tabA, tabB]);
    expect(await app.handleGlobal(decodeKey('\t'))).toBe(true);
    expect(app.frame()).toContain('beta-body');
    expect(await app.handleGlobal(decodeKey('q'))).toBe(false);
  });

  it('digit keys jump to a tab', async () => {
    const app = new App([tabA, tabB]);
    await app.handleGlobal(decodeKey('2'));
    expect(app.frame()).toContain('beta-body');
    await app.handleGlobal(decodeKey('1'));
    expect(app.frame()).toContain('alpha-body');
  });

  it('a tab that consumes a key shadows global handling', async () => {
    let seen = '';
    const typing: Tab = {
      name: 'Type',
      render: () => [`q=${seen}`],
      onKey: (key) => {
        if (key.str.length === 1) {
          seen += key.str;
          return true;
        }
        return false;
      },
    };
    const app = new App([typing]);
    // 'q' would normally quit, but the tab consumes it.
    expect(await app.dispatch(decodeKey('q'))).toBe(true);
    expect(app.frame()).toContain('q=q');
  });
});
