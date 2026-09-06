import {
  CONNECTOR_LIST,
  type Connector,
  type ConnectorScope,
} from '../../agent/connectors.js';
import type { Key, Tab } from '../app.js';
import type { Screen } from '../buffer.js';
import { DARK, GLYPH } from '../theme.js';
import type { Box } from '../widgets.js';

/**
 * Agents: connect or disconnect an AI agent host in one keypress.
 *
 * Drives the same connectors the CLI does, so a host gated here is gated
 * everywhere. Shown as rows rather than a table because each is an action, not
 * a record.
 */
export function agentsTab(): Tab {
  let scope: ConnectorScope = 'user';
  let selected = 0;
  let connected: Record<string, boolean> = {};
  let busy = '';

  const reload = async (): Promise<void> => {
    const next: Record<string, boolean> = {};
    for (const connector of CONNECTOR_LIST) {
      next[connector.id] = await connector.isConnected(scope);
    }
    connected = next;
  };

  const toggle = async (connector: Connector): Promise<void> => {
    busy = connector.label;
    if (connected[connector.id] === true) await connector.disconnect(scope);
    else await connector.connect(scope);
    busy = '';
    await reload();
  };

  return {
    name: 'Agents',
    refresh: reload,

    onKey: async (key: Key): Promise<boolean> => {
      if (key.name === 'up') {
        selected = Math.max(0, selected - 1);
        return true;
      }
      if (key.name === 'down') {
        selected = Math.min(CONNECTOR_LIST.length - 1, selected + 1);
        return true;
      }
      if (key.name === 's') {
        scope = scope === 'user' ? 'project' : 'user';
        await reload();
        return true;
      }
      if (key.name === 'enter') {
        const connector = CONNECTOR_LIST[selected];
        if (connector !== undefined) await toggle(connector);
        return true;
      }
      return false;
    },

    paint: (screen: Screen, box: Box) => {
      screen.write(box.x, box.y, `SCOPE  ${scope}`, { fg: DARK.textFaint, bold: true });
      if (busy !== '') {
        screen.write(box.x + 20, box.y, `working on ${busy}`, { fg: DARK.accent });
      }

      const width = Math.min(box.width, 52);
      for (let i = 0; i < CONNECTOR_LIST.length; i++) {
        const connector = CONNECTOR_LIST[i] as Connector;
        const y = box.y + 2 + i * 2;
        if (y >= box.y + box.height - 1) break;

        const isSelected = i === selected;
        const isOn = connected[connector.id] === true;

        if (isSelected) {
          screen.fill(box.x, y, width, 1, DARK.overlay);
          screen.write(box.x, y, GLYPH.caret, { fg: DARK.accent, bg: DARK.overlay });
        }

        const background = isSelected ? DARK.overlay : undefined;
        screen.write(box.x + 2, y, connector.label, {
          fg: DARK.text,
          bold: isSelected,
          ...(background !== undefined ? { bg: background } : {}),
        });
        screen.write(box.x + 22, y, isOn ? `${GLYPH.dot} gated` : '  not gated', {
          fg: isOn ? DARK.green : DARK.textFaint,
          ...(background !== undefined ? { bg: background } : {}),
        });
      }

      screen.write(box.x, box.y + box.height - 1, 'Enter toggle · s scope', {
        fg: DARK.textFaint,
      });
    },
  };
}
