import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Application } from '@webviewjs/webview';

import { PAGE_HTML } from './page.js';
import { handleRequest } from './bridge.js';

/**
 * Gatehouse desktop app.
 *
 * A real OS window hosting WebView2, with the security engine running in the
 * same process. There is deliberately no HTTP server: the document is served
 * through a custom `app://` scheme and the UI talks to the engine over the
 * webview's IPC channel. Nothing listens on a socket, so the app has no
 * network surface of its own — a strictly smaller attack surface than the
 * loopback-server approach it replaces.
 *
 * The window is undecorated; chrome is drawn by the document so the interface
 * can follow one visual language instead of inheriting the platform title bar.
 */

/**
 * WebView2 writes a user-data folder and must be given somewhere writable.
 * Left to itself it targets the host executable's directory — under a global
 * npm/Node install that is Program Files, and environment creation fails with
 * E_ACCESSDENIED (0x80070005). Anchor it in LOCALAPPDATA instead.
 */
function webviewDataDir(): string {
  const base =
    process.env['LOCALAPPDATA'] ??
    process.env['XDG_DATA_HOME'] ??
    path.join(os.homedir(), '.local', 'share');
  const dir = path.join(base, 'gatehouse', 'webview');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** MIME type for the few asset kinds the app serves. */
function mimeFor(pathname: string): string {
  if (pathname.endsWith('.js')) return 'text/javascript';
  if (pathname.endsWith('.css')) return 'text/css';
  if (pathname.endsWith('.svg')) return 'image/svg+xml';
  return 'text/html';
}

export function launch(): void {
  const app = new Application();
  const context = app.createWebContext({ dataDirectory: webviewDataDir() });

  const win = app.createBrowserWindow({
    title: 'Gatehouse',
    width: 1180,
    height: 760,
    resizable: true,
    // Chrome is ours; see the document's title bar implementation.
    decorations: false,
  });

  // Register the scheme BEFORE creating the webview, so the first navigation
  // to app:// already has a handler waiting.
  win.registerProtocol('app', (request) => {
    const pathname = new URL(request.url).pathname;
    const route = pathname === '/' || pathname === '' ? '/index.html' : pathname;
    if (route === '/index.html') {
      return new Response(PAGE_HTML, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('', { status: 404, headers: { 'content-type': mimeFor(route) } });
  });

  const webview = win.createWebview({
    webContext: context,
    // A file: document cannot post IPC messages in this webview host, so the
    // app is served from a custom scheme instead.
    url: 'app://gatehouse/index.html',
    preload: `window.__GATEHOUSE__ = { platform: ${JSON.stringify(process.platform)} };`,
    enableDevtools: process.env['GATEHOUSE_DEVTOOLS'] === '1',
  });

  /**
   * The one bridge between UI and engine. Every message names a route and
   * carries a request id; the reply is posted back on the same id. Routes call
   * the same `check()`/store functions the CLI uses, so a verdict shown here is
   * the verdict the terminal would print — the GUI is a face, never a bypass.
   */
  webview.onIpcMessage(async (event) => {
    let id: number | null = null;
    try {
      const msg = JSON.parse(event.body.toString('utf8')) as {
        id: number;
        route: string;
        payload?: Record<string, unknown>;
      };
      id = msg.id;

      // Window commands are chrome, not engine work; handle them here.
      if (msg.route === 'window/minimize') {
        win.setMinimized(true);
        return;
      }
      if (msg.route === 'window/maximize') {
        win.setMaximized(!win.isMaximized());
        return;
      }
      if (msg.route === 'window/close') {
        app.exit();
        return;
      }

      const result = await handleRequest(msg.route, msg.payload ?? {});
      reply(id, { ok: true, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (id !== null) reply(id, { ok: false, error: message });
    }
  });

  function reply(id: number, body: unknown): void {
    const json = JSON.stringify({ id, ...(body as object) });
    // Deliver into the page's pending-request table.
    webview.evaluateScript(`window.__resolve(${JSON.stringify(json)})`);
  }

  app.run();
}

launch();
