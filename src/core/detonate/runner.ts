import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Raw evidence the harness emits (mirrors harness.py's JSON shape). */
export interface DetonationEvidence {
  outboundConnections: string[];
  dnsLookups: string[];
  requestLines: string[];
  persistenceWrites: string[];
  credentialReads: string[];
  execCount: number;
  filesWrittenCount: number;
  filesReadCount: number;
}

export interface DetonationRaw {
  spec: string;
  installExit?: number;
  evidence?: DetonationEvidence;
  installOutputTail?: string;
  error?: string;
}

/**
 * Evidence category. Never "safe": a sandbox proves guilt, never innocence, so
 * the calmest verdict is "unremarkable — no known evidence of malice".
 */
export type EvidenceCategory = 'malicious-indicators' | 'suspicious' | 'unremarkable';

export interface DetonationReport {
  spec: string;
  category: EvidenceCategory;
  /** Human-readable evidence lines, e.g. "wrote ~/.npmrc", "resolved evil.io". */
  findings: string[];
  evidence: DetonationEvidence | null;
  error: string | null;
}

/** Absolute path to the bundled harness. */
function harnessPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // In dist, copy-assets places harness.py beside the compiled runner. In the
  // source tree (tests via tsx/vitest) it sits beside this .ts file. Both are
  // the same directory relative to the module, so one resolution serves both.
  return path.join(here, 'harness.py');
}

/** Translate a Windows path to a WSL /mnt path. */
function toWslPath(winPath: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(winPath);
  if (m === null) return winPath;
  const drive = (m[1] as string).toLowerCase();
  const rest = (m[2] as string).replace(/\\/g, '/');
  return `/mnt/${drive}/${rest}`;
}

/**
 * Detonate one package inside WSL2 and return a categorized evidence report.
 *
 * Runs the Python harness under `wsl.exe -d <distro>`; the harness handles the
 * namespace isolation, sinkhole, strace, and evidence extraction. This side
 * only marshals the call and classifies the result. `distro` defaults to the
 * WSL default distribution.
 */
export async function detonate(
  spec: string,
  distro?: string,
  timeoutMs = 240_000,
): Promise<DetonationReport> {
  const wslHarness = toWslPath(harnessPath());
  const workdir = `/tmp/gatehouse-deto-${Date.now()}`;
  const inner = `python3 ${JSON.stringify(wslHarness)} ${JSON.stringify(spec)} ${JSON.stringify(workdir)} /usr/bin/npm`;
  const args = [...(distro ? ['-d', distro] : []), '--', 'bash', '-lc', inner];

  const raw = await new Promise<DetonationRaw>((resolve) => {
    const child = spawn('wsl.exe', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ spec, error: `detonation timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ spec, error: `cannot launch WSL: ${err.message}` });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const line = stdout.trim().split('\n').filter(Boolean).at(-1) ?? '';
      try {
        resolve(JSON.parse(line) as DetonationRaw);
      } catch {
        resolve({ spec, error: `harness produced no JSON: ${stderr.slice(-200) || stdout.slice(-200)}` });
      }
    });
  });

  return classify(raw);
}

/**
 * Turn raw evidence into a category + human findings. The rules mirror the
 * gate's philosophy: persistence writes and credential reads paired with an
 * outbound attempt are the ChainDrop signature → malicious-indicators; either
 * alone is suspicious; a quiet install is unremarkable (never "safe").
 */
export function classify(raw: DetonationRaw): DetonationReport {
  if (raw.error !== undefined || raw.evidence === undefined) {
    return {
      spec: raw.spec,
      category: 'unremarkable',
      findings: [],
      evidence: null,
      error: raw.error ?? 'no evidence produced',
    };
  }

  const e = raw.evidence;
  const findings: string[] = [];
  for (const w of e.persistenceWrites) findings.push(`wrote persistence surface ${w}`);
  for (const c of e.credentialReads) findings.push(`read credential file ${c}`);
  for (const h of e.dnsLookups) findings.push(`resolved ${h}`);
  for (const conn of e.outboundConnections) findings.push(`attempted connection to ${conn}`);
  for (const req of e.requestLines) findings.push(`sent request: ${req}`);

  const exfilAttempt = e.outboundConnections.length > 0 || e.dnsLookups.length > 0;
  const persistence = e.persistenceWrites.length > 0;
  const credentials = e.credentialReads.length > 0;

  let category: EvidenceCategory;
  if ((persistence || credentials) && exfilAttempt) {
    category = 'malicious-indicators';
  } else if (persistence || credentials || exfilAttempt) {
    category = 'suspicious';
  } else {
    category = 'unremarkable';
  }

  return { spec: raw.spec, category, findings, evidence: e, error: null };
}

/** True when WSL is available to run the sandbox. */
export async function wslAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('wsl.exe', ['--status'], { windowsHide: true });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}
