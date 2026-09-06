/**
 * Compile the GUI launcher from source.
 *
 * Uses the C# compiler that ships with the .NET Framework, present on every
 * supported Windows install — so the launcher is reproducible from source with
 * no toolchain to install and no prebuilt binary committed to the repository.
 *
 * The `/target:winexe` flag is the important part: it marks the PE header's
 * subsystem as GUI (2) rather than console (3), which is what stops a console
 * window flashing up when the user double-clicks the app.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Locate csc.exe across the installed .NET Framework versions. */
function findCompiler() {
  const root = path.join(
    process.env['WINDIR'] ?? 'C:\\Windows',
    'Microsoft.NET',
    'Framework64',
  );
  // Newest first: v4 is present on everything current.
  for (const version of ['v4.0.30319', 'v3.5', 'v2.0.50727']) {
    const candidate = path.join(root, version, 'csc.exe');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    'csc.exe not found. The launcher needs the .NET Framework compiler,\n' +
      'which normally ships with Windows. Looked under: ' + root,
  );
}

/** Confirm the emitted binary really is a GUI-subsystem executable. */
function assertGuiSubsystem(exePath) {
  const buf = readFileSync(exePath);
  const peOffset = buf.readUInt32LE(0x3c);
  if (buf.toString('ascii', peOffset, peOffset + 2) !== 'PE') {
    throw new Error('emitted file is not a PE executable');
  }
  // Optional header begins after the 24-byte COFF header; Subsystem sits at
  // offset 68 within it, for both PE32 and PE32+.
  const subsystem = buf.readUInt16LE(peOffset + 24 + 68);
  if (subsystem !== 2) {
    throw new Error(
      `expected GUI subsystem (2) so no console window appears, got ${subsystem}`,
    );
  }
}

const compiler = findCompiler();
const output = path.join(here, 'gatehouse.exe');

execFileSync(
  compiler,
  [
    '-nologo',
    '-optimize+',
    '-target:winexe',
    `-out:${output}`,
    '-reference:System.dll,System.Windows.Forms.dll',
    path.join(here, 'launcher.cs'),
  ],
  { stdio: 'inherit' },
);

assertGuiSubsystem(output);
console.log('launcher built (GUI subsystem, no console window):', output);
