#!/usr/bin/env node
// What each shipped client artifact weighs, and whether it has drifted.
//
//   node scripts/artifact-size.mjs            # measure what is built, print the matrix
//   node scripts/artifact-size.mjs --budget   # the same, but exit 1 on anything over
//   node scripts/artifact-size.mjs --check    # self-check, builds nothing
//
// WHY THIS EXISTS
//
// Every megabyte here is downloaded by somebody on their data, and an
// application grows by a little at a time - a dependency here, an asset there -
// so nobody ever notices the commit that did it. A number written down once in
// a release note is a number nobody compares against. The budgets below are
// the comparison, and they are deliberately in this file rather than in the
// documentation: a budget somebody has to remember to look up is a budget that
// is already stale.
//
// WHAT IT DOES NOT DO
//
// It measures what is on disk and never builds anything. An artifact that has
// not been built is reported as absent and is not an error - `pnpm check` runs
// on machines that have never packaged the desktop client, and failing there
// would teach everybody to skip the check. `--budget` is the mode with teeth
// and belongs in release CI, after the artifacts exist.
//
// WHY `--check` MEASURES NOTHING
//
// It is the self-check every script in this folder carries, and it holds the
// pure helpers - the formatting, the ABI naming, the over/under verdict. Those
// are the parts that can be wrong silently; a file size cannot.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const MiB = 1024 * 1024;

/**
 * What each artifact is allowed to weigh, in bytes.
 *
 * Set from a measured build plus room to grow, never from a guess: a budget
 * below what already ships fails on the first run and gets raised to whatever
 * was measured, which is how a budget stops meaning anything. Raising one is a
 * deliberate act and belongs in the commit that needed the room, with the
 * reason in the message.
 *
 * The desktop installer is the number that matters most - it is the one thing
 * every Windows user downloads in full.
 */
const BUDGETS = {
  // Measured at 85.0 MiB with the locale strip and LZMA `maximum` in place,
  // down from 92.8. Electron is ~200 MB of Chromium before this repository
  // writes a line, so the installer will never be small - what this number is
  // for is noticing the day it jumps.
  'desktop/installer': 90 * MiB,
  'desktop/unpacked': 310 * MiB,
  // 2.9 MiB today. The loosest budget here on purpose: this is the one figure
  // that grows with features rather than with toolchains, and a renderer that
  // has put on a megabyte of product is not a regression.
  'desktop/renderer': 4 * MiB,
  // Measured on the R8 + resource-shrunk release build: 14.5, 9.9, 15.2, 15.8
  // and 44.5 MiB. The headroom is deliberately small - these have been at this
  // size for a while, and a budget that allows another 30 MB is one that never
  // fires.
  'android/arm64-v8a': 18 * MiB,
  'android/armeabi-v7a': 13 * MiB,
  'android/x86': 19 * MiB,
  'android/x86_64': 19 * MiB,
  'android/universal': 52 * MiB,
};

/** Human-readable, and stable enough to diff two runs by eye. */
export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MiB) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / MiB).toFixed(1)} MiB`;
}

/**
 * The ABI an APK filename names.
 *
 * AGP writes `app-<abi>-release.apk`, and `app-release.apk` when splits are
 * off. The second shape is the universal one by definition - there is only one
 * APK and it carries every ABI - so it is named rather than skipped.
 *
 * `-unsigned` is the half that is easy to miss. The release build signs only
 * when the environment carried a keystore, so CI produces `app-arm64-v8a-
 * release.apk` and every developer machine produces `app-arm64-v8a-release-
 * unsigned.apk`. A matcher that knew only the signed shape would find no
 * Android artifacts at all locally and report a clean pass, which is worse
 * than having no check: a budget that silently measures nothing still prints
 * a table saying everything is fine.
 */
export function abiOf(filename) {
  const match = /^app-(?:(.+)-)?release(?:-unsigned)?\.apk$/.exec(filename);
  if (!match) return null;
  return match[1] ?? 'universal';
}

/** Over budget, or not. An absent budget is not a pass - it is unbudgeted. */
export function verdict(bytes, budget) {
  if (budget == null) return 'unbudgeted';
  return bytes > budget ? 'over' : 'ok';
}

/** Every byte under a directory, following subdirectories, ignoring nothing. */
function dirSize(path) {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    // A symlink is counted as the link rather than followed: electron ships
    // none on Windows, and following one would double-count on the platforms
    // that do.
    if (entry.isDirectory()) total += dirSize(child);
    else if (entry.isFile()) total += statSync(child).size;
  }
  return total;
}

/** The artifacts that exist right now, as `{ id, bytes }`. */
function measure() {
  const found = [];

  const releaseDir = join(ROOT, 'apps/desktop/release');
  if (existsSync(releaseDir)) {
    // The installer is matched by shape rather than by version, so this keeps
    // working across every release without being told the number.
    const installer = readdirSync(releaseDir).find((f) => /-Setup\.exe$/.test(f));
    if (installer) {
      found.push({ id: 'desktop/installer', bytes: statSync(join(releaseDir, installer)).size, note: installer });
    }
    const unpacked = join(releaseDir, 'win-unpacked');
    if (existsSync(unpacked)) found.push({ id: 'desktop/unpacked', bytes: dirSize(unpacked) });
  }

  // The renderer bundle: what Vite emitted, which is the half of the desktop
  // size that this repository actually writes. Electron is the other half and
  // is not ours to shrink.
  const assets = join(ROOT, 'apps/desktop/dist/assets');
  if (existsSync(assets)) found.push({ id: 'desktop/renderer', bytes: dirSize(assets) });

  const apkDir = join(ROOT, 'apps/android/app/build/outputs/apk/release');
  if (existsSync(apkDir)) {
    for (const file of readdirSync(apkDir).filter((f) => f.endsWith('.apk')).sort()) {
      const abi = abiOf(file);
      if (abi) found.push({ id: `android/${abi}`, bytes: statSync(join(apkDir, file)).size, note: file });
    }
  }

  return found;
}

function report(enforce) {
  const found = measure();
  if (found.length === 0) {
    console.log('No artifacts built. Package the desktop client or run `pnpm android assembleRelease` first.');
    return 0;
  }

  const rows = found.map((item) => {
    const budget = BUDGETS[item.id];
    return { ...item, budget, state: verdict(item.bytes, budget) };
  });

  const width = Math.max(...rows.map((r) => r.id.length), 'Artifact'.length);
  console.log(`| ${'Artifact'.padEnd(width)} | Size      | Budget    | |`);
  console.log(`| ${'-'.repeat(width)} | --------- | --------- | - |`);
  for (const row of rows) {
    const mark = row.state === 'over' ? 'OVER' : row.state === 'unbudgeted' ? '-' : 'ok';
    console.log(
      `| ${row.id.padEnd(width)} | ${formatSize(row.bytes).padStart(9)} | ` +
        `${(row.budget == null ? '-' : formatSize(row.budget)).padStart(9)} | ${mark} |`,
    );
  }

  const over = rows.filter((r) => r.state === 'over');
  const missing = Object.keys(BUDGETS).filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) console.log(`\nNot built, not measured: ${missing.join(', ')}`);

  if (over.length === 0) return 0;
  for (const row of over) {
    console.error(`\n${row.id} is ${formatSize(row.bytes)}, over its ${formatSize(row.budget)} budget.`);
  }
  // Without --budget this is a report, and a report that exits non-zero is one
  // nobody runs twice.
  return enforce ? 1 : 0;
}

function selfCheck() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  assert(formatSize(512) === '512 B', 'bytes below a kibibyte are plain bytes');
  assert(formatSize(2048) === '2.0 KiB', 'kibibytes carry one decimal');
  assert(formatSize(97347724) === '92.8 MiB', 'the alpha.27 installer reads as 92.8 MiB');

  assert(abiOf('app-arm64-v8a-release.apk') === 'arm64-v8a', 'the ABI comes out of the name');
  assert(abiOf('app-universal-release.apk') === 'universal', 'universal is named like any other split');
  // Splits off: one APK, every ABI in it. Reported rather than dropped, which
  // is what a `null` here would have done.
  assert(abiOf('app-release.apk') === 'universal', 'an unsplit APK is the universal one');
  assert(abiOf('app-arm64-v8a-debug.apk') === null, 'a debug APK is not a release artifact');
  // The shape every machine without a keystore produces. Missing this read as
  // "no Android artifacts built" and passed, which is the failure this check
  // exists to make impossible.
  assert(abiOf('app-arm64-v8a-release-unsigned.apk') === 'arm64-v8a', 'an unsigned split still names its ABI');
  assert(abiOf('app-release-unsigned.apk') === 'universal', 'an unsigned unsplit APK is the universal one');

  assert(verdict(10, 20) === 'ok', 'under budget passes');
  assert(verdict(30, 20) === 'over', 'over budget fails');
  // Equal is not over: a budget set to exactly what shipped must not fail the
  // build that produced it.
  assert(verdict(20, 20) === 'ok', 'exactly at budget passes');
  assert(verdict(10, undefined) === 'unbudgeted', 'an unbudgeted artifact is not silently a pass');

  console.log('artifact-size self-check passed');
  return 0;
}

const argv = process.argv.slice(2);
process.exit(argv.includes('--check') ? selfCheck() : report(argv.includes('--budget')));
