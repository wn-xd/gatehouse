import type { IocEntry } from '../types.js';

/**
 * Parser for Wiz research IOCs (keyv-packages.csv).
 * Format:
 *   Package,Malicious Versions
 *   @arv-bedrock/auth,"1.1.7, 1.1.8"
 *   some-pkg,2.2.1
 * A quoted field may contain a comma-separated version list.
 * An entry with no versions means "every published version".
 */
export function parseWizKeyvCsv(csv: string): IocEntry[] {
  const entries: IocEntry[] = [];
  const lines = csv.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // skip header
    if (trimmed.toLowerCase().startsWith('package,')) continue;

    const parsed = parseCsvLine(trimmed);
    if (parsed.length < 1) continue;

    const name = parsed[0]?.trim() ?? '';
    if (!isValidPackageName(name)) continue;

    const versionsRaw = parsed[1]?.trim() ?? '';
    const versions = versionsRaw
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);

    entries.push({ name, versions: versions.length > 0 ? versions : null });
  }

  return entries;
}

/** Minimal CSV line splitter handling double-quoted fields. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === undefined) break;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields;
}

/** npm package names: lowercase, scope allowed, no spaces. Loose on purpose. */
function isValidPackageName(name: string): boolean {
  if (name.length === 0 || name.length > 214) return false;
  if (name !== name.toLowerCase()) return false;
  if (/\s/.test(name)) return false;
  return true;
}
