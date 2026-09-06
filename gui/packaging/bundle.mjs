/**
 * Assemble the distributable Gatehouse application directory.
 *
 * The result is self-contained: it carries its own Node runtime, the native
 * webview addon, the compiled core engine and the desktop app. A user needs
 * nothing preinstalled except the WebView2 runtime, which ships with Windows
 * 11 and is a standard component on 10.
 *
 * A single-file executable is deliberately not the target. Node's SEA feature
 * embeds a JavaScript blob into the binary, but a native .node addon must exist
 * as a real file for the OS loader to map it — so a one-file build is not
 * possible while the app hosts a native webview. This produces the layout every
 * real desktop application uses instead: a launcher beside its dependencies.
 *
 * Layout:
 *   Gatehouse/
 *     Gatehouse.exe            GUI-subsystem launcher (no console window)
 *     runtime/node.exe         bundled Node runtime
 *     runtime/*.node           native webview addon
 *     app/dist/                compiled core engine (CLI + TUI)
 *     app/gui/dist/            compiled desktop app
 *     app/node_modules/        the addon's JS loader
 *     bin/gatehouse.cmd        CLI/TUI shim, placed on PATH by the installer
 */
import { cp, mkdir, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packaging = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packaging, '..', '..');
const out = path.join(repoRoot, 'gui', 'release', 'Gatehouse');

/** Total size of a directory tree, for the build summary. */
async function treeSize(dir) {
  const { readdir } = await import('node:fs/promises');
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await treeSize(full);
    else total += (await stat(full)).size;
  }
  return total;
}

async function main() {
  console.log('assembling', out);
  await rm(path.join(repoRoot, 'gui', 'release'), { recursive: true, force: true });
  await mkdir(path.join(out, 'runtime'), { recursive: true });
  await mkdir(path.join(out, 'app'), { recursive: true });
  await mkdir(path.join(out, 'bin'), { recursive: true });

  // --- launcher ---------------------------------------------------------
  await cp(path.join(packaging, 'gatehouse.exe'), path.join(out, 'Gatehouse.exe'));

  // --- Node runtime -----------------------------------------------------
  // Ship the running interpreter so the app does not depend on the user
  // having Node, or on which version they happen to have.
  await cp(process.execPath, path.join(out, 'runtime', 'node.exe'));

  // --- native addon -----------------------------------------------------
  const addon = 'webview.win32-x64-msvc.node';
  await cp(
    path.join(repoRoot, 'node_modules', '@webviewjs', 'webview-win32-x64-msvc', addon),
    path.join(out, 'runtime', addon),
  );

  // --- compiled engine + app -------------------------------------------
  await cp(path.join(repoRoot, 'dist'), path.join(out, 'app', 'dist'), { recursive: true });
  await cp(path.join(repoRoot, 'gui', 'dist'), path.join(out, 'app', 'gui', 'dist'), {
    recursive: true,
  });

  // The addon's JS loader is required at runtime; the platform-specific
  // binary it would normally find is supplied via NAPI_RS_NATIVE_LIBRARY_PATH.
  await cp(
    path.join(repoRoot, 'node_modules', '@webviewjs', 'webview'),
    path.join(out, 'app', 'node_modules', '@webviewjs', 'webview'),
    { recursive: true },
  );

  // The app imports the core by package name, so the installed tree needs the
  // same self-reference the repo uses. A copy (not a link) keeps the bundle
  // portable across machines.
  await cp(
    path.join(repoRoot, 'package.json'),
    path.join(out, 'app', 'node_modules', 'gatehouse', 'package.json'),
  );
  await cp(
    path.join(repoRoot, 'dist'),
    path.join(out, 'app', 'node_modules', 'gatehouse', 'dist'),
    { recursive: true },
  );

  // --- CLI/TUI shim -----------------------------------------------------
  // Installing the app also gives the user the command line, which is the
  // stated relationship: the GUI brings the TUI with it, never the reverse.
  await writeFile(
    path.join(out, 'bin', 'gatehouse.cmd'),
    [
      '@echo off',
      'REM Gatehouse CLI/TUI, installed alongside the desktop app.',
      'setlocal',
      'set "GH_ROOT=%~dp0.."',
      '"%GH_ROOT%\\runtime\\node.exe" "%GH_ROOT%\\app\\dist\\src\\index.js" %*',
      'endlocal',
      '',
    ].join('\r\n'),
    'utf8',
  );

  const bytes = await treeSize(out);
  console.log(`bundle ready: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`launcher:     ${path.join(out, 'Gatehouse.exe')}`);
}

await main();
