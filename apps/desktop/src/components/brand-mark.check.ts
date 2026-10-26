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
import {
  MARK_BOWL,
  MARK_BOWL_SMALL,
  MARK_DOTS,
  MARK_STEM,
  MARK_STEM_SMALL,
  MARK_TAIL,
  MARK_TAIL_SMALL,
} from './brand-mark';

for (const page of ['../../index.html', '../../../web/index.html']) {
  const html = readFileSync(fileURLToPath(new URL(page, import.meta.url)), 'utf8');
  const block = /<!-- brand:mark -->(.*?)<!-- \/brand:mark -->/s.exec(html)?.[1] ?? '';
  for (const [part, d] of [['stem', MARK_STEM], ['tail', MARK_TAIL], ['bowl', MARK_BOWL]] as const) {
    assert.ok(block.includes(`class="${part}" d="${d}"`), `${page}: the boot splash's ${part} is not the mark's`);
  }
  assert.equal(block.match(/<circle /g)?.length, MARK_DOTS.length, `${page}: the boot splash should have the typing dots`);
}

// The stem and the tail are one closed shape each; the bowl is two, a ring.
for (const d of [MARK_STEM, MARK_TAIL, MARK_STEM_SMALL, MARK_TAIL_SMALL]) {
  assert.match(d, /^M[^MZ]*Z$/, 'a part should be a single closed path');
}
for (const d of [MARK_BOWL, MARK_BOWL_SMALL]) {
  assert.match(d, /^M[^MZ]*ZM[^MZ]*Z$/, 'the bowl should be an outer circle and a counter');
}

console.log('brand-mark.check.ts passed');
