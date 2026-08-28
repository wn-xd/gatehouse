import { filterMalicious } from '../feeds/osv.js';
import type { OsvVuln } from '../feeds/osv.js';
import type {
  IocMatch,
  Reason,
  ReasonCode,
  RegistryProbe,
  Verdict,
  VerdictLevel,
} from '../types.js';

/**
 * Freshness window for the <48h rule. Exported so tests and the future
 * policy layer can tune it; defaults to the spec's locked value.
 */
export const RECENT_PUBLISH_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Cap for embedded lifecycle-script bodies in reason details. */
const SCRIPT_SNIPPET_MAX = 240;

export const RULES_TABLE: ReadonlyArray<{
  code: ReasonCode;
  level: VerdictLevel;
  description: string;
}> = [
  {
    code: 'ioc-feed-match',
    level: 'red',
    description: 'name@version appears on a malicious-package IOC list',
  },
  {
    code: 'osv-malicious',
    level: 'red',
    description: 'OSV record classifies this package as malware',
  },
  {
    code: 'ioc-name-overlap',
    level: 'yellow',
    description: 'other versions of this name are listed as malicious',
  },
  {
    code: 'recent-publish',
    level: 'yellow',
    description: 'evaluated version was published within the freshness window',
  },
  {
    code: 'lifecycle-scripts',
    level: 'yellow',
    description: 'package declares preinstall/install/postinstall hooks',
  },
  {
    code: 'registry-unreachable',
    level: 'yellow',
    description: 'registry metadata could not be fetched - failing safe',
  },
];

export interface EngineInput {
  name: string;
  version: string | null;
  iocMatch: IocMatch | null;
  osvMalicious: OsvVuln[];
  registry: RegistryProbe;
  now?: Date;
}

const LEVEL_RANK: Record<VerdictLevel, number> = { green: 0, yellow: 1, red: 2 };

function maxLevel(a: VerdictLevel, b: VerdictLevel): VerdictLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

/**
 * The deterministic heart of Gatehouse.
 * Pure function: same input, same verdict, no network, no clock surprises
 * (inject `now` in tests). Collects ALL applicable reasons - a RED verdict
 * still shows every YELLOW signal found alongside it.
 */
export function evaluate(input: EngineInput): Verdict {
  const now = input.now ?? new Date();
  const reasons: Reason[] = [];
  let level: VerdictLevel = 'green';

  // --- RED: exact IOC feed match -------------------------------------
  if (input.iocMatch !== null) {
    const match = input.iocMatch;
    const listed =
      match.entry.versions === null
        ? 'all versions'
        : match.entry.versions.join(', ');

    if (
      match.kind === 'exact-version' ||
      match.kind === 'all-versions' ||
      input.version === null
    ) {
      reasons.push({
        code: 'ioc-feed-match',
        detail: `${match.entry.name} is listed as malicious (${listed})`,
      });
      level = 'red';
    } else {
      // Pinned version is clean but siblings are known-bad.
      reasons.push({
        code: 'ioc-name-overlap',
        detail: `pinned ${input.version} not listed, but these versions are: ${listed}`,
      });
      level = maxLevel(level, 'yellow');
    }
  }

  // --- RED: OSV malware records --------------------------------------
  for (const vuln of filterMalicious(input.osvMalicious)) {
    const summary = vuln.summary ?? vuln.details ?? vuln.id;
    reasons.push({
      code: 'osv-malicious',
      detail: `${vuln.id}: ${summary}`.slice(0, 300),
    });
    level = 'red';
  }

  // --- YELLOW signals from registry metadata --------------------------
  if (!input.registry.ok) {
    reasons.push({
      code: 'registry-unreachable',
      detail: input.registry.error,
    });
    level = maxLevel(level, 'yellow');
  } else {
    const signals = input.registry.signals;

    if (
      signals.publishedAt !== null &&
      now.getTime() - signals.publishedAt.getTime() <
        RECENT_PUBLISH_WINDOW_MS
    ) {
      const hoursAgo = Math.max(
        0,
        Math.round((now.getTime() - signals.publishedAt.getTime()) / 3_600_000),
      );
      reasons.push({
        code: 'recent-publish',
        detail: `published ${hoursAgo}h ago (< ${RECENT_PUBLISH_WINDOW_MS / 3_600_000}h window)`,
      });
      level = maxLevel(level, 'yellow');
    }

    if (signals.scriptNames.length > 0) {
      const snippets = signals.scriptNames
        .map((hook) => {
          const body = signals.scriptBodies[hook] ?? '';
          const capped =
            body.length > SCRIPT_SNIPPET_MAX
              ? `${body.slice(0, SCRIPT_SNIPPET_MAX)}...`
              : body;
          return `${hook}: ${capped}`;
        })
        .join(' | ');
      reasons.push({
        code: 'lifecycle-scripts',
        detail: snippets,
      });
      level = maxLevel(level, 'yellow');
    }
  }

  return {
    name: input.name,
    version: input.version,
    level,
    reasons,
    sources: [],
    checkedAt: now.toISOString(),
  };
}
