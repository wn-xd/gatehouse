import path from 'node:path';

import { installSpecs } from '../shim.js';

/** One package spec a shell command would install, with its source manager. */
export interface InstallTarget {
  /** The package manager that fetches it: npm | npx | bun | pnpm | yarn. */
  manager: string;
  /** The package specifier passed on the command line, e.g. "express@4". */
  spec: string;
}

const OPERATORS: Record<string, true> = {
  '&&': true,
  '||': true,
  ';': true,
  '|': true,
  '&': true,
  '\n': true,
};

/**
 * Tokenize a POSIX-ish shell command into words and control operators.
 *
 * Honors single and double quotes so an install arg wrapped in quotes stays
 * one token, and backslash escapes outside single quotes. Control operators
 * (`&&`, `||`, `;`, `|`, `&`, newline) surface as their own tokens so the
 * caller can split a compound command into its component invocations.
 *
 * This is deliberately conservative: it does not expand variables, globs, or
 * command substitution. Anything it cannot resolve statically it leaves as an
 * opaque token, which the spec extractor then ignores. The gate never depends
 * on this being a full shell — it depends on it never MISSING a literal
 * `npm install <pkg>`, which quote-aware tokenization guarantees.
 */
export function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let hasCurrent = false;
  let i = 0;
  const n = command.length;

  const flush = (): void => {
    if (hasCurrent) {
      tokens.push(current);
      current = '';
      hasCurrent = false;
    }
  };

  while (i < n) {
    const ch = command[i] as string;

    if (ch === "'") {
      hasCurrent = true;
      i++;
      while (i < n && command[i] !== "'") {
        current += command[i];
        i++;
      }
      i++; // consume closing quote
      continue;
    }

    if (ch === '"') {
      hasCurrent = true;
      i++;
      while (i < n && command[i] !== '"') {
        if (command[i] === '\\' && i + 1 < n) {
          current += command[i + 1];
          i += 2;
          continue;
        }
        current += command[i];
        i++;
      }
      i++; // consume closing quote
      continue;
    }

    if (ch === '\\' && i + 1 < n) {
      hasCurrent = true;
      current += command[i + 1];
      i += 2;
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      flush();
      i++;
      continue;
    }

    // Two-character operators first.
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      flush();
      tokens.push(two);
      i += 2;
      continue;
    }

    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n') {
      flush();
      tokens.push(ch);
      i++;
      continue;
    }

    hasCurrent = true;
    current += ch;
    i++;
  }

  flush();
  return tokens;
}

/** Split a flat token list into subcommands at control operators. */
function segments(tokens: string[]): string[][] {
  const out: string[][] = [];
  let seg: string[] = [];
  for (const tok of tokens) {
    if (OPERATORS[tok] === true) {
      if (seg.length > 0) out.push(seg);
      seg = [];
      continue;
    }
    seg.push(tok);
  }
  if (seg.length > 0) out.push(seg);
  return out;
}

/** Normalize a command word to its bare name: strip path and .exe/.cmd. */
function commandName(token: string): string {
  let name = path.basename(token);
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    const ext = name.slice(dot).toLowerCase();
    if (ext === '.exe' || ext === '.cmd' || ext === '.bat' || ext === '.ps1') {
      name = name.slice(0, dot);
    }
  }
  return name;
}

/**
 * Every package a shell command would install, across compound invocations.
 *
 * Mirrors the shim gate exactly: it reuses {@link installSpecs} so an agent's
 * `npm install lodash && npx cowsay` is gated identically whether it arrives
 * through a PATH shim or a Claude Code PreToolUse hook. Returns an empty array
 * for anything that installs nothing (`npm run build`, `git status`, ...).
 */
export function extractInstallTargets(command: string): InstallTarget[] {
  const results: InstallTarget[] = [];
  for (const seg of segments(tokenize(command))) {
    let idx = 0;
    while (idx < seg.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(seg[idx] as string)) idx++;
    if (idx >= seg.length) continue;

    const manager = commandName(seg[idx] as string);
    const args = seg.slice(idx + 1);
    for (const spec of installSpecs(manager, args)) {
      results.push({ manager, spec });
    }
  }
  return results;
}
