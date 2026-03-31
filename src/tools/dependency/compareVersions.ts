import type { CompareVersionsInput, CompareVersionsOutput, VersionComparison, VersionDelta } from '../../types/tools.js';
import type { Severity } from '../../types/findings.js';

export function compareVersions(input: CompareVersionsInput): CompareVersionsOutput {
  const results: VersionComparison[] = [];

  for (const pkg of input.installed) {
    const latest = input.latest[pkg.name];
    if (!latest) continue;

    const installed = parseSemver(cleanVersion(pkg.version));
    const latestParsed = parseSemver(latest.latest);

    if (!installed || !latestParsed) continue;

    const { delta, severity } = computeDelta(installed, latestParsed);

    results.push({
      package: pkg.name,
      installed: cleanVersion(pkg.version),
      latest: latest.latest,
      delta,
      severity,
    });
  }

  return { results };
}

interface Semver { major: number; minor: number; patch: number }

function cleanVersion(v: string): string {
  return v.replace(/^[\^~>=<]+/, '');
}

function parseSemver(v: string): Semver | null {
  const match = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: +match[1], minor: +match[2], patch: +match[3] };
}

function computeDelta(
  installed: Semver,
  latest: Semver,
): { delta: VersionDelta; severity: Severity } {
  const majorDiff = latest.major - installed.major;
  const minorDiff = latest.minor - installed.minor;

  // Pre-1.0: minor treated as major
  const isPreRelease = installed.major === 0;

  if (majorDiff === 0 && minorDiff === 0) {
    return { delta: 'current', severity: 'info' };
  }

  if (majorDiff === 0) {
    if (isPreRelease) {
      // Pre-1.0 minor diff → treat as major
      if (minorDiff >= 3) return { delta: 'major-behind-3+', severity: 'critical' };
      if (minorDiff >= 2) return { delta: 'major-behind-2', severity: 'high' };
      return { delta: 'major-behind-1', severity: 'medium' };
    }
    if (minorDiff <= 1) return { delta: 'minor-behind', severity: 'info' };
    return { delta: 'minor-behind', severity: 'low' };
  }

  if (majorDiff === 1) return { delta: 'major-behind-1', severity: 'medium' };
  if (majorDiff === 2) return { delta: 'major-behind-2', severity: 'high' };
  return { delta: 'major-behind-3+', severity: 'critical' };
}
