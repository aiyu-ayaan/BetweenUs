/**
 * Self-check for the mark: `tsx src/components/brand-mark.check.ts`.
 *
 * The mark is drawn in three places that cannot import one another - this
 * module, and the boot splash inlined in the desktop and web index.html files,
 * which has to paint before any script has loaded. design/brand/build.py writes
 * all of them; this catches a hand edit to one, or a run that skipped one.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MARK_LEFT, MARK_LEFT_SMALL, MARK_RIGHT, MARK_RIGHT_SMALL } from './brand-mark';

for (const page of ['../../index.html', '../../../web/index.html']) {
  const html = readFileSync(fileURLToPath(new URL(page, import.meta.url)), 'utf8');
  const block = /<!-- brand:mark -->(.*?)<!-- \/brand:mark -->/s.exec(html)?.[1] ?? '';
  assert.ok(block.includes(`d="${MARK_LEFT}"`), `${page}: the boot splash's left face is not the mark's`);
  assert.ok(block.includes(`d="${MARK_RIGHT}"`), `${page}: the boot splash's right face is not the mark's`);
}

// Each half is one closed shape: a profile and the arc of the disc behind it.
for (const d of [MARK_LEFT, MARK_RIGHT, MARK_LEFT_SMALL, MARK_RIGHT_SMALL]) {
  assert.match(d, /^M[^MZ]*A[^MZ]*Z$/, 'a face should be a single closed path');
}

console.log('brand-mark.check.ts passed');
