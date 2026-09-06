import fsAsync from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..');
export const GATEHOUSE_BIN = path.join(DIST_DIR, 'src/index.js');

export type ShimAction = 'install' | 'uninstall' | 'status';

/** Directory where shims are installed. */
function shimsDir(): string {
  return path.join(os.homedir(), '.gatehouse', 'shims');
}

/** Target commands to shim. */
const SHIM_TARGETS = ['npm', 'npx', 'bun', 'pnpm', 'yarn'] as const;

export type ShimTarget = (typeof SHIM_TARGETS)[number];

/**
 * Per-target install semantics, resolved at generation time.
 *
 * `verbs` empty means every invocation installs (npx), so the generated
 * script carries no runtime dispatch: each shim only contains the logic
 * for its own command.
 */
const INSTALL_VERBS: Record<ShimTarget, readonly string[]> = {
  npm: ['install', 'i', 'add', 'ci'],
  npx: [],
  bun: ['add', 'install', 'i'],
  pnpm: ['add', 'install', 'i'],
  yarn: ['add'],
};

/** Executable extensions to probe when resolving the real command on Windows. */
const WINDOWS_EXTS: Record<ShimTarget, readonly string[]> = {
  npm: ['.cmd', '.exe'],
  npx: ['.cmd', '.exe'],
  bun: ['.exe', '.cmd'],
  pnpm: ['.cmd', '.exe'],
  yarn: ['.cmd', '.exe'],
};

/**
 * True when `args` for `target` describe an install.
 *
 * Shared by the generators and the tests; the emitted scripts encode the
 * same decision inline so a shim never shells back into Node to classify.
 */
export function isInstallCommand(target: string, args: readonly string[]): boolean {
  const verbs = INSTALL_VERBS[target as ShimTarget];
  if (verbs === undefined) return false;
  if (verbs.length === 0) return true;
  return verbs.includes(args[0] ?? '');
}

/**
 * Package specs an install invocation would fetch, given the tokens AFTER
 * the command name. Encodes the same rule the generated shims apply inline:
 * npx gates its first non-flag argument, the verb-based managers gate every
 * non-flag argument following the install verb. Non-install commands yield
 * none. Shared with the agent hook so terminal and agent gates never drift.
 */
export function installSpecs(target: string, args: readonly string[]): string[] {
  if (!isInstallCommand(target, args)) return [];
  const verbs = INSTALL_VERBS[target as ShimTarget];
  const isFlag = (a: string): boolean => a.startsWith('-');
  if (verbs.length === 0) {
    // npx: the first non-flag token is the package about to be fetched.
    const first = args.find((a) => !isFlag(a));
    return first === undefined ? [] : [first];
  }
  return args.slice(1).filter((a) => !isFlag(a));
}

/** POSIX single-quoting; both call sites embed absolute paths into sh. */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Generate the POSIX shim for `target`.
 *
 * The script resolves the real command by walking PATH while skipping
 * `dir`, because the shim itself shadows the target name there.
 */
function generateUnixShim(target: ShimTarget, dir: string): string {
  const verbs = INSTALL_VERBS[target];
  const lines: string[] = [
    '#!/bin/sh',
    `# Gatehouse shim for ${target}`,
    '# This file is managed by gatehouse. Do not edit manually.',
    '',
    `GATEHOUSE_BIN=${shQuote(GATEHOUSE_BIN)}`,
    `SHIMS_DIR=${shQuote(dir)}`,
    '',
    'REAL_CMD=""',
    'saved_ifs=$IFS',
    'IFS=:',
    'for dir_entry in $PATH; do',
    '  [ -n "$dir_entry" ] || continue',
    '  [ "$dir_entry" = "$SHIMS_DIR" ] && continue',
    `  if [ -x "$dir_entry/${target}" ]; then`,
    `    REAL_CMD="$dir_entry/${target}"`,
    '    break',
    '  fi',
    'done',
    'IFS=$saved_ifs',
    '',
    'if [ -z "$REAL_CMD" ]; then',
    `  echo "gatehouse: real ${target} not found in PATH" >&2`,
    '  exit 127',
    'fi',
    '',
  ];

  if (verbs.length === 0) {
    // npx: the first non-flag argument is the package about to be fetched.
    lines.push(
      'for candidate in "$@"; do',
      '  case "$candidate" in',
      '    -*) continue ;;',
      '  esac',
      '  node "$GATEHOUSE_BIN" check "$candidate" >&2 || exit $?',
      '  break',
      'done',
      '',
    );
  } else {
    const pattern = verbs.join('|');
    lines.push(
      'case "${1:-}" in',
      `  ${pattern})`,
      '    shift',
      '    for candidate in "$@"; do',
      '      case "$candidate" in',
      '        -*) continue ;;',
      '      esac',
      '      node "$GATEHOUSE_BIN" check "$candidate" >&2 || exit $?',
      '    done',
      '    ;;',
      'esac',
      '',
    );
  }

  lines.push('exec "$REAL_CMD" "$@"', '');
  return lines.join('\n');
}

/** Generate the Windows CMD shim for `target`. */
function generateWindowsShim(target: ShimTarget, dir: string): string {
  const verbs = INSTALL_VERBS[target];
  const lines: string[] = [
    '@echo off',
    'setlocal enabledelayedexpansion',
    `REM Gatehouse shim for ${target}`,
    'REM This file is managed by gatehouse. Do not edit manually.',
    '',
    `set "GATEHOUSE_BIN=${GATEHOUSE_BIN}"`,
    `set "SHIMS_DIR=${dir}"`,
    'set "REAL_CMD="',
    '',
    'for %%D in ("%PATH:;=" "%") do (',
    '  if not "%%~D"=="" if /i not "%%~fD"=="%SHIMS_DIR%" (',
  ];

  for (const ext of WINDOWS_EXTS[target]) {
    lines.push(
      `    if not defined REAL_CMD if exist "%%~D\\${target}${ext}" set "REAL_CMD=%%~D\\${target}${ext}"`,
    );
  }

  lines.push(
    '  )',
    ')',
    '',
    'if not defined REAL_CMD (',
    `  echo gatehouse: real ${target} not found in PATH 1>&2`,
    '  exit /b 127',
    ')',
    '',
  );

  if (verbs.length === 0) {
    // npx: gate the first non-flag argument, then hand over.
    lines.push(
      ':npx_scan',
      'if "%~1"=="" goto :run_real',
      'set "ARG=%~1"',
      'if "!ARG:~0,1!"=="-" (',
      '  shift',
      '  goto :npx_scan',
      ')',
      'node "%GATEHOUSE_BIN%" check "!ARG!" 1>&2',
      'if errorlevel 1 exit /b !errorlevel!',
      'goto :run_real',
      '',
    );
  } else {
    lines.push('set "IS_INSTALL=0"');
    for (const verb of verbs) {
      lines.push(`if /i "%~1"=="${verb}" set "IS_INSTALL=1"`);
    }
    // Labels cannot live inside a parenthesized block, so the collect loop
    // is flat and guarded by a jump.
    lines.push(
      'if not "%IS_INSTALL%"=="1" goto :run_real',
      'shift',
      '',
      ':collect',
      'if "%~1"=="" goto :run_real',
      'set "ARG=%~1"',
      'if not "!ARG:~0,1!"=="-" (',
      '  node "%GATEHOUSE_BIN%" check "!ARG!" 1>&2',
      '  if errorlevel 1 exit /b !errorlevel!',
      ')',
      'shift',
      'goto :collect',
      '',
    );
  }

  lines.push(':run_real', '"%REAL_CMD%" %*', '');
  return lines.join('\r\n');
}

/** Install shims for all targets. */
export async function installShims(): Promise<number> {
  const dir = shimsDir();
  await fsAsync.mkdir(dir, { recursive: true });

  let created = 0;
  for (const target of SHIM_TARGETS) {
    await fsAsync.writeFile(path.join(dir, target), generateUnixShim(target, dir), {
      mode: 0o755,
    });
    created++;

    await fsAsync.writeFile(path.join(dir, `${target}.cmd`), generateWindowsShim(target, dir));
    created++;
  }

  console.log(`Installed ${created} shim scripts to ${dir}`);
  console.log('');
  console.log('Add this directory to your PATH to enable shims:');
  console.log('');
  console.log(`  export PATH="${dir}:$PATH"`);
  console.log('');
  console.log('Or run this once to add it permanently (bash/zsh):');
  console.log(`  echo 'export PATH="${dir}:$PATH"' >> ~/.bashrc`);
  console.log('');
  console.log('For Windows (PowerShell):');
  console.log(`  [Environment]::SetEnvironmentVariable('Path', "${dir};" + $env:Path, 'User')`);
  console.log('');
  console.log('Run `gatehouse shim status` to verify.');

  return 0;
}

/** Uninstall shims. */
export async function uninstallShims(): Promise<number> {
  const dir = shimsDir();
  try {
    await fsAsync.rm(dir, { recursive: true, force: true });
    console.log(`Removed shims directory: ${dir}`);
    console.log('Remember to remove it from your PATH if you added it.');
    return 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('Shims not installed.');
      return 0;
    }
    throw err;
  }
}

/** Show shim status. */
export async function statusShims(): Promise<number> {
  const dir = shimsDir();
  try {
    const entries = await fsAsync.readdir(dir);
    const shims = entries.filter((e) => SHIM_TARGETS.some((t) => e === t || e === `${t}.cmd`));
    if (shims.length === 0) {
      console.log('Shims: not installed');
      return 0;
    }
    console.log(`Shims: installed (${shims.length} scripts in ${dir})`);
    for (const s of shims.sort()) {
      console.log(`  ${s}`);
    }
    const pathEnv = process.env.PATH ?? '';
    const inPath = pathEnv.split(path.delimiter).some((p) => path.resolve(p) === path.resolve(dir));
    console.log(`  PATH: ${inPath ? 'yes' : 'no'}`);
    return 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('Shims: not installed');
      return 0;
    }
    throw err;
  }
}

/** Main shim command handler. */
export async function shim(action: ShimAction): Promise<number> {
  switch (action) {
    case 'install':
      return installShims();
    case 'uninstall':
      return uninstallShims();
    case 'status':
    default:
      return statusShims();
  }
}
