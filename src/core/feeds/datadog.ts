import type { IocEntry } from '../types.js';

/**
 * Parser for DataDog indicators-of-compromise shai-hulud-2.0.csv.
 * Format:
 *   package_name,package_version
 *   02-echo,0.0.7
 */
export function parseDatadogShaiHuludCsv(csv: string): IocEntry[] {
  const entries: IocEntry[] = [];
  const lines = csv.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.toLowerCase().startsWith('package_name,')) continue;

    const idx = trimmed.indexOf(',');
    if (idx === -1) continue;

    const name = trimmed.slice(0, idx).trim();
    const version = trimmed.slice(idx + 1).trim();
    if (!isValidName(name)) continue;

    entries.push({
      name,
      versions: version.length > 0 ? [version] : null,
    });
  }

  return entries;
}

function isValidName(name: string): boolean {
  if (name.length === 0 || name.length > 214) return false;
  if (name !== name.toLowerCase()) return false;
  if (/\s/.test(name)) return false;
  return true;
}
