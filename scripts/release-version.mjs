#!/usr/bin/env node
// Works out the next version from the commit subjects of a push to master.
//
// A release is asked for by a marker at the START of a commit subject:
//
//   !major   1.4.2        -> 2.0.0          stable
//   !feat    1.4.2        -> 1.5.0          stable
//   !fix     1.4.2        -> 1.4.3          stable
//   !alpha   0.0.1        -> 0.0.2-alpha.1  pre-release
//            0.0.2-alpha.1 -> 0.0.2-alpha.2
//   !beta    0.0.2-alpha.3 -> 0.0.2-beta.1  promote, same base
//            0.0.2-beta.1  -> 0.0.2-beta.2
//   !stable  0.0.2-beta.2 -> 0.0.2          promote to stable, no bump
//
// A push with no marker is not a release. When several pushed commits carry
// markers the strongest wins, in the order listed above - a push containing
// both !fix and !alpha is a stable fix, because the alpha it would have
// produced is already contained in it.
//
// A channel can be promoted but not demoted in place: !alpha on a beta starts
// a fresh alpha on the NEXT patch, because 0.0.2-alpha.1 sorts below a
// 0.0.2-beta.1 that has already shipped.
//
// Usage:
//   node scripts/release-version.mjs --current 0.0.1 --subjects-file subjects.txt
//   node scripts/release-version.mjs --check      # self-check, no arguments

import { strictEqual, throws } from 'node:assert';
import { readFileSync } from 'node:fs';

const CHANNELS = { alpha: 1, beta: 2 };

// Strongest first: the winner of a push carrying more than one marker.
const MARKERS = ['major', 'feat', 'fix', 'stable', 'beta', 'alpha'];

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta)\.(\d+))?$/;

// A commit the release flow wrote itself. Ignored, so re-running over a range
// that includes one does not release twice.
const RELEASE_COMMIT_RE = /^\s*chore\(release\):/i;

export function parseVersion(version) {
  const match = VERSION_RE.exec(String(version).trim());
  if (!match) throw new Error(`Invalid version '${version}'. Expected X.Y.Z or X.Y.Z-alpha.N.`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    channel: match[4] ?? '',
    pre: match[5] ? Number(match[5]) : 0,
  };
}

export function detectMarker(subjects) {
  const candidates = subjects
    .map((s) => s.trim())
    .filter((s) => s && !RELEASE_COMMIT_RE.test(s));
  const found = new Set();
  for (const subject of candidates) {
    const match = /^\s*!(major|feat|fix|stable|alpha|beta)(?![a-z0-9])/i.exec(subject);
    if (match) found.add(match[1].toLowerCase());
  }
  return MARKERS.find((marker) => found.has(marker)) ?? '';
}

export function nextVersion(current, marker) {
  const { major, minor, patch, channel, pre } = parseVersion(current);
  const stable = (m, n, p) => `${m}.${n}.${p}`;

  switch (marker) {
    case 'major':
      return stable(major + 1, 0, 0);
    case 'feat':
      return stable(major, minor + 1, 0);
    case 'fix':
      // From a pre-release this deliberately moves past it: 0.0.2-beta.1 is a
      // draft of 0.0.2, and !fix asks for the next fix, not for that draft to
      // be declared finished. !stable is what declares it finished.
      return stable(major, minor, patch + 1);
    case 'stable':
      if (!channel) throw new Error(`!stable needs a pre-release to promote; ${current} is already stable.`);
      return stable(major, minor, patch);
    case 'alpha':
    case 'beta': {
      const sameOrLower = channel && CHANNELS[channel] <= CHANNELS[marker];
      if (sameOrLower) {
        const counter = channel === marker ? pre + 1 : 1;
        return `${stable(major, minor, patch)}-${marker}.${counter}`;
      }
      return `${stable(major, minor, patch + 1)}-${marker}.1`;
    }
    default:
      throw new Error(`Unknown marker '${marker}'.`);
  }
}

function selfCheck() {
  const eq = (current, marker, expected) =>
    strictEqual(nextVersion(current, marker), expected, `${current} + !${marker}`);

  eq('0.0.0', 'fix', '0.0.1');
  eq('0.0.0', 'alpha', '0.0.1-alpha.1');
  eq('0.0.1-alpha.1', 'alpha', '0.0.1-alpha.2');
  eq('0.0.1-alpha.3', 'beta', '0.0.1-beta.1');
  eq('0.0.1-beta.1', 'beta', '0.0.1-beta.2');
  eq('0.0.1-beta.2', 'stable', '0.0.1');
  eq('0.0.1-beta.2', 'alpha', '0.0.2-alpha.1');
  eq('0.0.1', 'alpha', '0.0.2-alpha.1');
  eq('0.0.1', 'feat', '0.1.0');
  eq('0.1.0', 'major', '1.0.0');
  eq('1.4.2', 'fix', '1.4.3');
  eq('0.0.2-beta.1', 'fix', '0.0.3');

  throws(() => nextVersion('0.0.1', 'stable'), /already stable/);
  throws(() => parseVersion('1.2'), /Invalid version/);
  throws(() => parseVersion('1.2.3-rc.1'), /Invalid version/);

  strictEqual(detectMarker(['!feat: a thing']), 'feat');
  strictEqual(detectMarker(['docs: nothing']), '');
  // Strongest wins.
  strictEqual(detectMarker(['!alpha: x', '!fix: y']), 'fix');
  strictEqual(detectMarker(['!major: x', '!feat: y']), 'major');
  // The flow's own commits never trigger a release.
  strictEqual(detectMarker(['chore(release): v0.0.1']), '');
  // A marker has to start the subject, and has to be the whole word.
  strictEqual(detectMarker(['fix: mentions !feat in passing']), '');
  strictEqual(detectMarker(['!feature: not a marker']), '');

  console.log('release-version self-check passed');
}

function main(argv) {
  if (argv.includes('--check')) return selfCheck();

  const arg = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? '' : (argv[index + 1] ?? '');
  };

  const current = arg('--current');
  const subjectsFile = arg('--subjects-file');
  const subjects = subjectsFile
    ? readFileSync(subjectsFile, 'utf8').split('\n')
    : arg('--subject').split('\n');

  const marker = detectMarker(subjects);
  const lines = marker
    ? [
        'release=true',
        `marker=${marker}`,
        `version=${nextVersion(current, marker)}`,
      ]
    : ['release=false'];

  const version = marker ? nextVersion(current, marker) : '';
  if (version) {
    const { channel } = parseVersion(version);
    lines.push(`channel=${channel || 'latest'}`, `prerelease=${channel ? 'true' : 'false'}`);
  }
  console.log(lines.join('\n'));
}

main(process.argv.slice(2));
