import { check } from '../core/engine/check.js';
import { recordEncounter } from '../core/history/encounters.js';
import type { Verdict, VerdictLevel } from '../core/types.js';
import { extractInstallTargets } from './command.js';

/**
 * PreToolUse hook input we consume. Claude Code sends a richer object; we
 * only read the two fields the gate needs and ignore the rest.
 */
interface HookInput {
  tool_name?: string;
  tool_input?: { command?: string };
  /** Cursor's beforeShellExecution puts the command at the top level. */
  command?: string;
}

/** `permissionDecision` values PreToolUse understands. */
export type PermissionDecision = 'allow' | 'deny' | 'ask';

/**
 * Structured hook output. `flags` is the machine-readable verdict list the
 * agent can act on ("package X blocked → pick alternative"); it rides inside
 * `additionalContext` so the model always sees it, whatever the decision.
 */
export interface HookDecision {
  permissionDecision: PermissionDecision;
  permissionDecisionReason: string;
  /** One entry per gated package spec. */
  flags: VerdictFlag[];
}

export interface VerdictFlag {
  manager: string;
  spec: string;
  level: VerdictLevel;
  reasons: { code: string; detail: string }[];
}

/** worst-of two levels, red > yellow > green. */
const LEVEL_RANK: Record<VerdictLevel, number> = { green: 0, yellow: 1, red: 2 };

/**
 * Decide a PreToolUse verdict for one Bash command.
 *
 * Runs the SAME deterministic gate the shims and CLI use over every package
 * the command would install, then folds the per-package verdicts into one
 * decision by worst case:
 *   - any RED  → deny (auto-block, no prompt: known malware)
 *   - any YELLOW (and no RED) → ask (human confirms suspicious-unproven)
 *   - all GREEN, or nothing installed → allow silently
 * The engine is always the deciding party; the agent only receives flags.
 */
export async function decide(command: string): Promise<HookDecision> {
  const targets = extractInstallTargets(command);
  if (targets.length === 0) {
    return {
      permissionDecision: 'allow',
      permissionDecisionReason: 'no package install detected',
      flags: [],
    };
  }

  const flags: VerdictFlag[] = [];
  let worst: VerdictLevel = 'green';

  for (const target of targets) {
    const outcome = await check(target.spec);
    if (!outcome.ok) {
      // A gate that cannot verify fails safe: treat as YELLOW, never allow.
      flags.push({
        manager: target.manager,
        spec: target.spec,
        level: 'yellow',
        reasons: [{ code: 'gate-error', detail: outcome.error }],
      });
      if (LEVEL_RANK.yellow > LEVEL_RANK[worst]) worst = 'yellow';
      continue;
    }
    const verdict: Verdict = outcome.value.verdict;
    flags.push({
      manager: target.manager,
      spec: target.spec,
      level: verdict.level,
      reasons: verdict.reasons.map((r) => ({ code: r.code, detail: r.detail })),
    });
    if (LEVEL_RANK[verdict.level] > LEVEL_RANK[worst]) worst = verdict.level;
    await recordEncounter({
      at: verdict.checkedAt,
      name: verdict.name,
      version: verdict.version,
      level: verdict.level,
      reasonCodes: verdict.reasons.map((r) => r.code),
      source: 'agent',
      durationMs: outcome.value.durationMs,
    });
  }

  if (worst === 'red') {
    return {
      permissionDecision: 'deny',
      permissionDecisionReason: reasonLine('BLOCKED (malware evidence)', flags, 'red'),
      flags,
    };
  }
  if (worst === 'yellow') {
    return {
      permissionDecision: 'ask',
      permissionDecisionReason: reasonLine('review needed (suspicious signals)', flags, 'yellow'),
      flags,
    };
  }
  return {
    permissionDecision: 'allow',
    permissionDecisionReason: 'gatehouse: all packages clear',
    flags,
  };
}

/** One-line human reason naming the packages at `level` and their top codes. */
function reasonLine(head: string, flags: VerdictFlag[], level: VerdictLevel): string {
  const hits = flags
    .filter((f) => f.level === level)
    .map((f) => {
      const codes = f.reasons.map((r) => r.code).join(', ');
      return codes.length > 0 ? `${f.spec} (${codes})` : f.spec;
    });
  return `gatehouse: ${head}: ${hits.join('; ')}`;
}

/** Output dialect per agent host. */
export type HookDialect = 'claude' | 'cursor';

/**
 * Read a PreToolUse-style event on stdin, gate any install it describes, and
 * write the host's hook response on stdout.
 *
 * Contract: always exits 0 and speaks through JSON, so a gate hiccup never
 * hard-crashes the agent's turn. A non-shell tool, an unparseable payload, or
 * an empty command yields no decision (empty stdout), letting the normal
 * permission flow proceed. Only a real verdict emits a decision.
 *
 * `dialect` selects the wire shape:
 *   - claude: Claude Code / Codex `hookSpecificOutput.permissionDecision`
 *   - cursor: Cursor `beforeShellExecution` `{ permission, userMessage, agentMessage }`
 * Both derive from the SAME deterministic `decide()`; only serialization differs.
 */
export async function runHook(
  stdin: string,
  emit: (line: string) => void,
  dialect: HookDialect = 'claude',
): Promise<number> {
  let input: HookInput;
  try {
    input = JSON.parse(stdin) as HookInput;
  } catch {
    return 0; // unparseable → no decision, normal flow applies
  }

  // Claude/Codex send tool_name + tool_input.command; Cursor sends command
  // at the top level for beforeShellExecution. Accept either.
  const isShellTool =
    input.tool_name === undefined ||
    input.tool_name === 'Bash' ||
    input.tool_name === 'PowerShell' ||
    input.tool_name === 'Shell';
  const command = input.tool_input?.command ?? input.command;
  if (!isShellTool || typeof command !== 'string' || command.trim().length === 0) {
    return 0;
  }

  const decision = await decide(command);
  if (decision.flags.length === 0) {
    return 0; // installs nothing → stay silent, do not force an allow
  }

  const context = JSON.stringify({ gatehouse: decision.flags });
  if (dialect === 'cursor') {
    // Cursor: allow | deny | ask via `permission`; messages are optional.
    const permission =
      decision.permissionDecision === 'allow' ? 'allow' : decision.permissionDecision;
    emit(
      JSON.stringify({
        permission,
        agentMessage: decision.permissionDecisionReason,
        userMessage: decision.permissionDecisionReason,
      }),
    );
    return 0;
  }

  emit(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision.permissionDecision,
        permissionDecisionReason: decision.permissionDecisionReason,
        additionalContext: context,
      },
    }),
  );
  return 0;
}
