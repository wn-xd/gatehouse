import { App } from './app.js';
import { agentsTab } from './tabs/agents.js';
import { dashboardTab } from './tabs/dashboard.js';
import { packagesTab } from './tabs/packages.js';
import { quarantineTab } from './tabs/quarantine.js';
import { reportsTab } from './tabs/reports.js';

/**
 * Launch the control center. Tab order follows the locked spec:
 * Dashboard · Quarantine · Packages · Agents · Reports. Every surface reads
 * or drives the same core the CLI and shims use — no tab bypasses the gate.
 *
 * Requires an interactive TTY; refuses politely otherwise so a piped or CI
 * invocation gets a clear message instead of a frozen alt-screen.
 */
export async function runTui(): Promise<number> {
  if (process.stdout.isTTY !== true || process.stdin.isTTY !== true) {
    console.error('gatehouse tui requires an interactive terminal.');
    return 64;
  }

  // The Packages tab gates results asynchronously and must trigger redraws as
  // verdicts land, so it needs a handle to the app's draw. Build the app, then
  // give the tab a closure over it.
  let app: App;
  const redraw = (): void => app.draw();

  app = new App([
    dashboardTab(),
    quarantineTab(),
    packagesTab(redraw),
    agentsTab(),
    reportsTab(),
  ]);

  await app.run();
  return 0;
}
