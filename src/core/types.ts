/** Core domain types for the Gatehouse gate engine. */

export type VerdictLevel = 'green' | 'yellow' | 'red';

/**
 * Machine-readable reason codes. The TUI/GUI and agent adapters render
 * these directly - they are part of the public contract, treat as stable.
 */
export type ReasonCode =
  | 'ioc-feed-match'
  | 'ioc-name-overlap'
  | 'osv-malicious'
  | 'recent-publish'
  | 'lifecycle-scripts'
  | 'registry-unreachable';

export interface Reason {
  code: ReasonCode;
  /** Human-readable one-liner; safe to show verbatim. */
  detail: string;
}

export interface Verdict {
  name: string;
  /** Resolved/pinned version, null when caller did not pin one. */
  version: string | null;
  level: VerdictLevel;
  reasons: Reason[];
  /** Feed/source labels consulted, e.g. "osv@live", "wiz-keyv@2026-08-06". */
  sources: string[];
  checkedAt: string;
}

export interface ParsedSpec {
  name: string;
  /** null when unpinned - engine resolves to registry latest. */
  version: string | null;
}

/** One IOC list entry. versions === null means "all versions suspect". */
export interface IocEntry {
  name: string;
  versions: string[] | null;
}

export interface IocMatch {
  entry: IocEntry;
  /** How the match happened against the requested version. */
  kind: 'exact-version' | 'all-versions' | 'name-only';
}

export interface RegistrySignals {
  /** The version actually evaluated (pinned, or dist-tags.latest). */
  resolvedVersion: string;
  /** Publish time of the evaluated version (or latest when unpinned). */
  publishedAt: Date | null;
  /** Lifecycle script NAMES present on the evaluated version. */
  scriptNames: string[];
  /** Raw lifecycle script bodies, capped by the engine before display. */
  scriptBodies: Record<string, string>;
  /** Maintainer count when the registry exposes one. */
  maintainerCount?: number;
}

export type RegistryProbe =
  | { ok: true; signals: RegistrySignals }
  | { ok: false; error: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
