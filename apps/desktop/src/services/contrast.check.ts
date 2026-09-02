import assert from 'node:assert/strict';
import { THEMES } from '../stores/theme';
import {
  AA_LARGE_TEXT,
  AA_NORMAL_TEXT,
  CHECKED_PAIRS,
  auditTheme,
  contrastRatio,
  luminance,
  parseRgb,
  ratioOf,
  type ContrastFinding,
} from './contrast';

// --- the maths ---------------------------------------------------------------

assert.deepEqual(parseRgb('124 92 255'), [124, 92, 255]);
assert.deepEqual(parseRgb('  6   7  10 '), [6, 7, 10], 'whitespace is not significant');
assert.equal(parseRgb('rgba(255, 255, 255, 0.07)'), null, 'an rgba string is not a triple');
assert.equal(parseRgb('1 2'), null);
assert.equal(parseRgb('1 2 300'), null, 'a channel out of range is not a colour');

assert.equal(Math.round(luminance([0, 0, 0]) * 1000), 0, 'black has no luminance');
assert.equal(Math.round(luminance([255, 255, 255]) * 1000), 1000, 'white is 1');

// The two anchors every implementation agrees on.
assert.equal(Math.round(contrastRatio([0, 0, 0], [255, 255, 255])), 21);
assert.equal(contrastRatio([128, 128, 128], [128, 128, 128]), 1, 'a colour on itself is 1:1');

// Order does not matter: the formula sorts the two by luminance itself.
assert.equal(
  contrastRatio([0, 0, 0], [255, 255, 255]),
  contrastRatio([255, 255, 255], [0, 0, 0]),
);

// Gamma is the point of `linear()`. Mid-grey on white is *not* the ~2:1 a naive
// average of the stored bytes would give; it is closer to 4. Getting this wrong
// is how hint text passes a check it should fail.
{
  const midGreyOnWhite = contrastRatio([128, 128, 128], [255, 255, 255]);
  assert.ok(
    midGreyOnWhite > 3.9 && midGreyOnWhite < 4.1,
    `mid-grey on white should be about 4:1, got ${midGreyOnWhite}`,
  );
}

assert.equal(ratioOf('0 0 0', '255 255 255'), 21);
assert.equal(ratioOf('rgba(0,0,0,1)', '255 255 255'), null, 'unmeasurable is null, not a guess');

// --- the bar -----------------------------------------------------------------

assert.equal(AA_NORMAL_TEXT, 4.5);
assert.equal(AA_LARGE_TEXT, 3);
assert.ok(CHECKED_PAIRS.length > 0);
assert.ok(
  CHECKED_PAIRS.every((pair) => pair.minimum === AA_NORMAL_TEXT || pair.minimum === AA_LARGE_TEXT),
  'every pair is held to one of the two WCAG AA bars, not to a number invented for it',
);

// --- the auditor itself ------------------------------------------------------

{
  // Black on black: every pair fails, and the report says which and by how much.
  const findings = auditTheme('void', {
    '--color-ground': '0 0 0',
    '--color-surface-900': '0 0 0',
    '--color-surface-800': '0 0 0',
    '--color-slate-100': '0 0 0',
    '--color-slate-400': '0 0 0',
    '--color-accent': '0 0 0',
  });
  assert.equal(findings.length, CHECKED_PAIRS.length, 'nothing readable is nothing passing');
  assert.ok(findings.every((finding) => finding.ratio === 1));
  assert.equal(findings[0]?.theme, 'void');
}

{
  // A colour the parser cannot read is skipped rather than reported as a
  // failure. `--color-edge` is an rgba string, and calling it a contrast
  // failure would be inventing a number for it.
  const findings = auditTheme('partial', {
    '--color-surface-900': 'rgba(255, 255, 255, 0.07)',
    '--color-slate-100': '255 255 255',
  });
  assert.equal(findings.length, 0);
}

{
  // A missing key is not a failure either: a theme that does not define a
  // surface has nothing drawn on it.
  assert.deepEqual(auditTheme('empty', {}), []);
}

// --- every theme the app ships ----------------------------------------------
//
// The reason this file exists. Sixteen hand-written ramps had never been
// measured, and measuring them found eighteen failures across eleven of them -
// every one in the hint ramp, plus one accent, and none in body text. That is
// the shape the module comment predicts: `slate-400` is chosen to recede, and
// receding has a floor.
//
// Left here so the next theme, or the next tweak to an existing one, cannot
// quietly go under that floor again.

{
  const failures: ContrastFinding[] = [];
  for (const theme of Object.values(THEMES)) {
    failures.push(...auditTheme(theme.name, theme.colors));
  }

  const report = failures
    .map((f) => `  ${f.theme}: ${f.what} is ${f.ratio}:1, needs ${f.minimum}:1`)
    .join('\n');

  assert.deepEqual(failures, [], `themes below WCAG AA:\n${report}`);

  // A guard on the guard: if the pairs or the themes were ever emptied, the
  // assertion above would pass by measuring nothing at all.
  assert.ok(Object.keys(THEMES).length >= 16, 'every shipped theme is audited');
  assert.equal(CHECKED_PAIRS.length, 6);
}

console.log(`contrast.check.ts ok - ${Object.keys(THEMES).length} themes, ${CHECKED_PAIRS.length} pairs each`);
