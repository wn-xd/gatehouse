import fs from 'node:fs';
import fsAsync from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..');
const GATEHOUSE_BIN = path.join(DIST_DIR, 'src/index.js');

export type ShimAction = 'install' | 'uninstall' | 'status';

/** Directory where shims are installed. */
function shimsDir(): string {
  return path.join(os.homedir(), '.gatehouse', 'shims');
}

/** Target commands to shim. */
const SHIM_TARGETS = ['npm', 'npx', 'bun', 'pnpm', 'yarn'] as const;

/** Check if a command looks like an install command. */
function isInstallCommand(cmd: string, args: string[]): boolean {
  const firstArg = args[0] ?? '';
  if (cmd === 'npx') {
    return true;
  }
  if (cmd === 'bun') {
    return firstArg === 'add' || firstArg === 'install' || firstArg === 'i';
  }
  if (cmd === 'pnpm') {
    return firstArg === 'add' || firstArg === 'install' || firstArg === 'i';
  }
  if (cmd === 'yarn') {
    return firstArg === 'add';
  }
  return firstArg === 'install' || firstArg === 'i' || firstArg === 'add' || firstArg === 'ci';
}

/** Generate Unix shell shim script. */
function generateUnixShim(target: string): string {
  return `#!/bin/sh
# Gatehouse shim for ${target}
# This file is managed by gatehouse. Do not edit manually.

GATEHOUSE_BIN="${GATEHOUSE_BIN}"
REAL_CMD="$(command -v ${target} 2>/dev/null | head -1)"

if [ -z "${REAL_CMD}" ] || [ "${REAL_CMD}" = "${SHIMS_DIR}/${target}" ]; then
  echo "gatehouse: real ${target} not found in PATH" >&2
  exit 127
fi

IS_INSTALL=0
case "${target}" in
  npx)
    IS_INSTALL=1
    ;;
  bun)
    case "${1}" in
      add|install|i) IS_INSTALL=1 ;;
    esac
    ;;
  pnpm|yarn)
    case "${1}" in
      add|install|i) IS_INSTALL=1 ;;
    esac
    ;;
  *)
    case "${1}" in
      install|i|add|ci) IS_INSTALL=1 ;;
    esac
    ;;
esac

if [ "${IS_INSTALL}" = "1" ]; then
  SPECS=""
  case "${target}" in
    npx)
      SPECS="${1}"
      ;;
    bun|pnpm|yarn)
      shift
      for arg in "$@"; do
        case "${arg}" in
          -*) continue ;;
        esac
        SPECS="${SPECS} ${arg}"
      done
      ;;
    *)
      shift
      for arg in "$@"; do
        case "${arg}" in
          -*) break ;;
        esac
        SPECS="${SPECS} ${arg}"
      done
      ;;
  esac

  for spec in ${SPECS}; do
    if [ -n "${spec}" ]; then
      node "${GATEHOUSE_BIN}" check "${spec}" >&2 || exit $?
    fi
  done
fi

exec "${REAL_CMD}" "$@"
`;
}

/** Generate Windows CMD shim script. */
function generateWindowsShim(target: string): string {
  const binPath = GATEHOUSE_BIN.replace(/\\/g, '\\\\');
  return `@echo off
REM Gatehouse shim for ${target}
REM This file is managed by gatehouse. Do not edit manually.

set "GATEHOUSE_BIN=${binPath}"
set "REAL_EXEC="

REM Find real ${target} in PATH (skip shim dir itself)
for %%E in (${target}.cmd ${target}.exe) do (
  if defined REAL_EXEC goto :found_real
  for %%D in (PATH) do (
    for %%F in (%%~dp$%%D:I${target} 2>nul) do (
      echo.%%~fF | findstr /i /v "%~dp0" >nul
      if not errorlevel 1 (
        echo.%%~nxF | findstr /i /v "real_" >nul
        if not errorlevel 1 set "REAL_EXEC=%%~fF"
      )
    )
  )
)

:found_real
if not defined REAL_EXEC (
  echo gatehouse: real ${target} not found in PATH >&2
  exit /b 127
)

REM Detect install commands
set "IS_INSTALL=0"
for %%A in (install i add ci) do if /i "%~1" == "%%A" set "IS_INSTALL=1"
for %%A in (-D -P -O --save-dev --save-prod --save-optional --no-save) do if /i "%~1" == "%%A" set "IS_INSTALL=1"
if /i "%~nx0" == "npx.cmd" set "IS_INSTALL=1"

if "%IS_INSTALL%"=="1" (
  set "SPECS="
  :npm_loop
  if "%~1"=="" goto :check_specs
  echo %~1|findstr /i /r "^-">nul
  if errorlevel 1 (
    set "SPECS=!SPECS! %~1"
  ) else (
    if /i "%~1"=="-D" goto :skip_spec
    if /i "%~1"=="-P" goto :skip_spec
    if /i "%~1"=="-O" goto :skip_spec
    if /i "%~1"=="--save-dev" goto :skip_spec
    if /i "%~1"=="--save-prod" goto :skip_spec
    if /i "%~1"=="--save-optional" goto :skip_spec
    if /i "%~1"=="--no-save" goto :skip_spec
    set "SPECS=!SPECS! %~1"
  )
  :skip_spec
  shift
  goto :npm_loop

  :check_specs
  for %%S in (!SPECS!) do (
    if not "%%~S"=="" (
      node "%GATEHOUSE_BIN%" check "%%~S" >&2
      if errorlevel 1 exit /b %errorlevel%
    )
  )
)

%REAL_EXEC% %*
`;
}

/** Install shims for all targets. */
export async function installShims(): Promise<number> {
  const dir = shimsDir();
  await fsAsync.mkdir(dir, { recursive: true });

  let created = 0;
  for (const target of SHIM_TARGETS) {
    // Unix shim
    const unixPath = path.join(dir, target);
    const unixContent = generateUnixShim(target).replace('${SHIMS_DIR}', dir);
    await fsAsync.writeFile(unixPath, unixContent, { mode: 0o755 });
    created++;

    // Windows shim
    const winPath = path.join(dir, `${target}.cmd`);
    const winContent = generateWindowsShim(target);
    await fsAsync.writeFile(winPath, winContent);
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
  console.log(`  [Environment]::SetEnvironmentVariable('Path', $env:Path + ';${dir}', 'User')`);
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