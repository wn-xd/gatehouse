import {
  CONNECTOR_LIST,
  type Connector,
  type ConnectorScope,
} from '../../agent/connectors.js';
import { paint } from '../ansi.js';
import type { Key, Tab } from '../app.js';
import { renderTable } from '../table.js';

/**
 * Agents: connect / disconnect AI-agent hosts in one keypress. ↑↓ selects a
 * host, Enter toggles its connection for the chosen scope, s flips scope
 * between user and project. "Connect Claude Code" writes the settings hook;
 * disconnect cleans it — the same connectors the CLI drives.
 */
export function agentsTab(): Tab {
  let scope: ConnectorScope = 'user';
  let selected = 0;
  let connected: Record<string, boolean> = {};
  let busy = '';

  const reload = async (): Promise<void> => {
    const next: Record<string, boolean> = {};
    for (const c of CONNECTOR_LIST) next[c.id] = await c.isConnected(scope);
    connected = next;
  };

  const toggle = async (connector: Connector): Promise<void> => {
    busy = `${connector.label}…`;
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
    render: () => {
      const lines: string[] = [];
      lines.push(`${paint('scope:', 'bold')} ${scope}   ${paint(busy, 'dim')}`);
      lines.push('');
      const table = renderTable(
        [
          { header: ' ', width: 1 },
          { header: 'STATUS', width: 15 },
          { header: 'AGENT', width: 16 },
        ],
        CONNECTOR_LIST.map((c, i) => [
          i === selected ? paint('▶', 'cyan') : ' ',
          connected[c.id] === true
            ? paint('connected', 'green')
            : paint('not connected', 'dim'),
          c.label,
        ]),
      );
      lines.push(...table);
      lines.push('');
      lines.push(paint('↑↓ select · Enter connect/disconnect · s toggle scope', 'dim'));
      return lines;
    },
  };
}
