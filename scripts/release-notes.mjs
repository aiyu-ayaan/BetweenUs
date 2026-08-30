#!/usr/bin/env node
// Builds the CHANGELOG entry for a release out of the commits behind it.
//
// One section per kind of change, in the order a reader cares about them:
// breaking first, then what is new, then what is fixed, then the rest. A
// commit's kind comes from its release marker if it has one and from its
// conventional-commit type if it does not, so `!feat: X` and `feat: X` land in
// the same place - the marker says "release now", the type says "this is a
// feature", and most commits only ever say the second.
//
// The subject is cleaned before it is printed: the marker and the type prefix
// are scaffolding for the tooling, not something anybody wants to read in a
// release note.
//
// Usage:
//   node scripts/release-notes.mjs --version 0.0.1 --subjects-file subjects.txt \
//     [--previous 0.0.0] [--repository owner/name] [--date 2026-08-21]
//   node scripts/release-notes.mjs --check     # self-check, no arguments

import { strictEqual, ok as assertOk } from 'node:assert';
import { readFileSync } from 'node:fs';

/** A commit the release flow wrote itself never appears in its own notes. */
const NOISE = [
  /^\s*chore\(release\):/i,
  /^\s*Merge (pull request|branch|remote-tracking)/i,
  /^\s*docs\(changelog\):/i,
];

// The scope is part of what gets stripped: `!feat(chat): x` is a marker with a
// scope, and leaving `(chat):` at the front of the note helps nobody.
const MARKER = /^\s*!(major|feat|fix|stable|alpha|beta|patch)(?![a-z0-9])(?:\([^)]*\))?[:\s-]*/i;
const TYPE = /^(feat|fix|chore|docs|refactor|perf|test|build|ci|style|revert)(\([^)]*\))?(!)?:\s*/i;

// The platforms a release builds, in the order the table lists them, and what
// to call them in front of a reader.
const TARGET_LABELS = [
  ['docker', 'Server images'],
  ['desktop', 'Desktop (Windows)'],
  ['android', 'Android'],
];

const SECTIONS = [
  ['breaking', '### ⚠ Breaking changes'],
  ['features', '### Features'],
  ['fixes', '### Bug fixes'],
  ['other', '### Other changes'],
];

/** Which section a subject belongs in. */
export function classify(subject) {
  const marker = MARKER.exec(subject);
  const kind = marker?.[1]?.toLowerCase();
  if (kind === 'major') return 'breaking';
  // `!` after the type is the conventional-commit way to say breaking, and it
  // outranks the type itself: `feat(api)!: drop v1` is a breaking change first.
  const type = TYPE.exec(subject.replace(MARKER, ''));
  if (type?.[3] === '!' || /\bBREAKING[ -]CHANGE\b/.test(subject)) return 'breaking';
  if (kind === 'feat') return 'features';
  if (kind === 'fix') return 'fixes';
  if (type) {
    const name = type[1].toLowerCase();
    if (name === 'feat') return 'features';
    if (name === 'fix') return 'fixes';
  }
  return 'other';
}

/** The subject with the tooling stripped off and a capital at the front. */
export function clean(subject) {
  const text = subject.replace(MARKER, '').replace(TYPE, '').trim().replace(/\.+$/, '');
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * The what-was-built table. `targets` is what this release rebuilt;
 * everything else was carried forward from `carriedFrom`, the last release
 * that has the artifact.
 */
export function artifacts({ targets, carriedFrom, repository } = {}) {
  if (!targets || targets.length === 0) return '';
  const link = (version) =>
    repository
      ? `[v${version}](https://github.com/${repository}/releases/tag/v${version})`
      : `v${version}`;

  const rows = TARGET_LABELS.map(([target, label]) => {
    if (targets.includes(target)) return `| ${label} | Built here |`;
    // Without a version to carry from there is nothing to say but the truth.
    const from = carriedFrom ? `Carried forward from ${link(carriedFrom)}` : 'Not in this release';
    return `| ${label} | ${from} |`;
  });

  return ['### Artifacts', '', '| Platform | This release |', '| --- | --- |', ...rows].join('\n');
}

export function notes(subjects, { version, previous, repository, date, targets, carriedFrom } = {}) {
  const kept = subjects
    .map((subject) => subject.trim())
    .filter((subject) => subject && !NOISE.some((pattern) => pattern.test(subject)));

  const grouped = new Map(SECTIONS.map(([key]) => [key, []]));
  for (const subject of kept) {
    const line = clean(subject);
    const bucket = grouped.get(classify(subject));
    // The same subject twice - a cherry-pick, a revert and its re-land - is one
    // line, not two identical ones.
    if (line && !bucket.includes(line)) bucket.push(line);
  }

  const compare =
    repository && previous
      ? `https://github.com/${repository}/compare/v${previous}...v${version}`
      : '';
  const heading = compare ? `## [${version}](${compare})` : `## ${version}`;
  const stamp = date ?? new Date().toISOString().slice(0, 10);

  let body = '';
  for (const [key, title] of SECTIONS) {
    const items = grouped.get(key);
    if (items.length === 0) continue;
    body += `${title}\n\n${items.map((item) => `* ${item}`).join('\n')}\n\n`;
  }
  if (!body) body = `### Notes\n\n* Release ${version}\n\n`;

  const table = artifacts({ targets, carriedFrom, repository });
  if (table) body += `${table}\n`;

  return { heading: `${heading} (${stamp})`, body: body.trimEnd() };
}

/** Puts a new entry at the top of an existing CHANGELOG, below its title. */
export function insert(changelog, entry) {
  const block = `${entry.heading}\n\n${entry.body}\n`;
  if (changelog.includes(entry.heading)) return changelog;
  const title = '# Changelog\n\n';
  return changelog.startsWith(title)
    ? changelog.replace(title, `${title}${block}\n`)
    : `${title}${block}\n${changelog}`;
}

/** The section for one version, for a GitHub Release body. */
export function section(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^##\\s*\\[?${escaped}\\]?.*?(?=^##\\s|$(?![\\s\\S]))`, 'ms').exec(
    changelog,
  );
  if (!match) return '';
  const [, ...rest] = match[0].trim().split('\n');
  return rest.join('\n').trim();
}

function selfCheck() {
  strictEqual(classify('!major: drop the v1 API'), 'breaking');
  strictEqual(classify('feat(api)!: drop the v1 API'), 'breaking');
  strictEqual(classify('!feat: a new thing'), 'features');
  strictEqual(classify('feat(chat): a new thing'), 'features');
  strictEqual(classify('!fix: a broken thing'), 'fixes');
  strictEqual(classify('fix: a broken thing'), 'fixes');
  strictEqual(classify('docs: a written thing'), 'other');
  strictEqual(classify('something with no prefix'), 'other');
  // The marker says "release now", not what kind of change it is.
  strictEqual(classify('!alpha: fix(voice): a broken thing'), 'fixes');

  strictEqual(clean('!feat(chat): add pinning.'), 'Add pinning');
  strictEqual(clean('fix: the thing'), 'The thing');
  strictEqual(clean('!patch(desktop): rebuild the installer'), 'Rebuild the installer');
  // The marker says "rebuild now", not what kind of change it is.
  strictEqual(classify('!patch: fix(desktop): the installer'), 'fixes');

  const entry = notes(
    [
      '!feat(chat): add pinning',
      'fix(voice): stop the echo',
      'chore(release): v0.0.1',
      'Merge pull request #3 from x',
      'docs: explain it',
      'feat(api)!: drop v1',
      'fix(voice): stop the echo',
    ],
    { version: '0.1.0', previous: '0.0.1', repository: 'a/b', date: '2026-08-21' },
  );
  assertOk(entry.heading.includes('compare/v0.0.1...v0.1.0'), 'links the comparison');
  assertOk(entry.heading.endsWith('(2026-08-21)'), 'carries the date');
  assertOk(entry.body.includes('* Drop v1'), 'breaking listed');
  assertOk(entry.body.includes('* Add pinning'), 'feature listed');
  assertOk(entry.body.includes('* Stop the echo'), 'fix listed');
  assertOk(entry.body.includes('* Explain it'), 'other listed');
  assertOk(!entry.body.includes('v0.0.1\n'), 'the release commit is not a note');
  assertOk(!entry.body.includes('Merge pull request'), 'the merge commit is not a note');
  strictEqual(entry.body.match(/Stop the echo/g).length, 1, 'a repeated subject is one line');
  assertOk(
    entry.body.indexOf('Breaking') < entry.body.indexOf('Features'),
    'breaking comes first',
  );

  // The artifacts table says what was rebuilt and where the rest came from.
  const partial = notes(['!alpha(android): x'], {
    version: '0.0.7-alpha.1',
    repository: 'a/b',
    targets: ['android'],
    carriedFrom: '0.0.6',
  });
  assertOk(partial.body.includes('| Android | Built here |'), 'the built platform says so');
  assertOk(
    partial.body.includes('| Desktop (Windows) | Carried forward from [v0.0.6](https://github.com/a/b/releases/tag/v0.0.6) |'),
    'a skipped platform names and links where its artifacts came from',
  );
  assertOk(partial.body.includes('| Server images | Carried forward'), 'server images too');
  // A first release has nothing to carry from, and says that rather than
  // linking a tag that does not exist.
  assertOk(
    notes(['!alpha(android): x'], { version: '0.0.1-alpha.1', targets: ['android'] }).body.includes(
      '| Desktop (Windows) | Not in this release |',
    ),
    'no previous release means no carry-forward claim',
  );
  // No table at all when nobody said what was built - the old shape.
  assertOk(!notes(['fix: x'], { version: '1.0.0' }).body.includes('### Artifacts'));
  // The table is readable back out for the GitHub Release body.
  assertOk(
    section(insert('# Changelog\n\n', partial), '0.0.7-alpha.1').includes('| Android | Built here |'),
    'the table survives the round trip through the CHANGELOG',
  );

  // A release with nothing to say still says something.
  assertOk(notes(['chore(release): v1'], { version: '1.0.0' }).body.includes('Release 1.0.0'));

  const changelog = insert('# Changelog\n\n## 0.0.1 (2026-01-01)\n\n### Notes\n\n* old\n', entry);
  assertOk(changelog.indexOf('0.1.0') < changelog.indexOf('0.0.1'), 'newest first');
  strictEqual(insert(changelog, entry), changelog, 'inserting twice changes nothing');
  assertOk(section(changelog, '0.1.0').includes('Add pinning'), 'the section is readable back');
  assertOk(!section(changelog, '0.1.0').includes('old'), 'and stops at the next version');
  assertOk(section(changelog, '0.0.1').includes('* old'), 'including the last one');
  strictEqual(section(changelog, '9.9.9'), '', 'a version with no section is empty');

  console.log('release-notes self-check passed');
}

function main(argv) {
  if (argv.includes('--check')) return selfCheck();

  const arg = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? '' : (argv[index + 1] ?? '');
  };

  const subjectsFile = arg('--subjects-file');
  const subjects = subjectsFile
    ? readFileSync(subjectsFile, 'utf8').split('\n')
    : arg('--subject').split('\n');

  const entry = notes(subjects, {
    version: arg('--version'),
    previous: arg('--previous') || undefined,
    repository: arg('--repository') || undefined,
    date: arg('--date') || undefined,
    targets: arg('--targets') ? arg('--targets').split(',').filter(Boolean) : undefined,
    carriedFrom: arg('--carried-from') || undefined,
  });

  const path = arg('--changelog') || 'CHANGELOG.md';

  // Reads one version's notes back out, for a GitHub Release body. Deliberately
  // the file rather than the commits: what ships as the note is what was
  // reviewed on the release PR, edits included.
  if (argv.includes('--section')) {
    console.log(section(readFileSync(path, 'utf8'), arg('--version')));
    return;
  }

  if (argv.includes('--body-only')) {
    console.log(entry.body);
    return;
  }

  let existing = '';
  try {
    existing = readFileSync(path, 'utf8');
  } catch {
    existing = '# Changelog\n\n';
  }
  process.stdout.write(insert(existing, entry));
}

main(process.argv.slice(2));
