import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOCALES,
  asLocale,
  direction,
  loadCatalogue,
  locale,
  preferredLocale,
  setLocale,
  t,
} from './i18n';

// --- which way a locale runs -------------------------------------------------

assert.equal(direction('en'), 'ltr');
assert.equal(direction('ar'), 'rtl');
assert.equal(direction('he'), 'rtl');

// A locale from a newer build, or a corrupted preference, is left-to-right
// rather than an exception. Nothing about a language is worth failing to draw
// the app over.
assert.equal(direction('kl'), 'ltr');
assert.equal(direction(''), 'ltr');

assert.equal(asLocale('ar'), 'ar');
assert.equal(asLocale('kl'), 'en');
assert.equal(asLocale(undefined), 'en');
assert.equal(asLocale(7), 'en');

// Every entry declares a direction, and at least one of each exists - a table
// where everything is `ltr` is one where the rtl half was never filled in.
assert.ok(LOCALES.some((entry) => entry.direction === 'rtl'));
assert.ok(LOCALES.some((entry) => entry.direction === 'ltr'));
for (const entry of LOCALES) {
  assert.equal(entry.direction, direction(entry.id), `${entry.id} agrees with direction()`);
  assert.ok(entry.label.length > 0, `${entry.id} is called something`);
}

// --- what the machine asks for ----------------------------------------------

// The primary subtag, not the whole tag: a client that ignored `ar-EG` because
// it only knows `ar` would be ignoring the point of the tag.
assert.equal(preferredLocale(['ar-EG', 'en-US']), 'ar');
assert.equal(preferredLocale(['AR']), 'ar');
assert.equal(preferredLocale(['fr-CA', 'he-IL']), 'he', 'the first *known* one wins');
assert.equal(preferredLocale(['fr-CA']), 'en');
assert.equal(preferredLocale([]), 'en');

// --- the document is pointed, and told what language it is -------------------

{
  const root = { lang: '', dir: '' };
  setLocale('ar', root);
  assert.equal(root.dir, 'rtl');
  // `lang` as well as `dir`. A screen reader picks its voice from `lang`, so an
  // Arabic interface tagged `en` is read aloud by an English synthesiser.
  assert.equal(root.lang, 'ar');
  assert.equal(locale(), 'ar');

  setLocale('en', root);
  assert.equal(root.dir, 'ltr');
  assert.equal(root.lang, 'en');
}

// --- the words ---------------------------------------------------------------

// English is the argument, not a lookup: a catalogue nobody has written yet
// renders exactly what the component would have rendered anyway. This is the
// property that makes extracting fifty screens survivable - no step of it can
// put a bare key on somebody's screen.
assert.equal(t('members.empty.title', 'Nobody here yet'), 'Nobody here yet');

loadCatalogue('ar', { 'members.empty.title': 'لا أحد هنا بعد' });
setLocale('ar');
assert.equal(t('members.empty.title', 'Nobody here yet'), 'لا أحد هنا بعد');
assert.equal(t('members.empty.hint', 'Invite somebody'), 'Invite somebody', 'untranslated falls back');
setLocale('en');
assert.equal(t('members.empty.title', 'Nobody here yet'), 'Nobody here yet');

// Named placeholders, because a translator reorders a sentence and cannot
// reorder `%s`.
assert.equal(t('x', 'Members — {count}', { count: 12 }), 'Members — 12');
assert.equal(t('x', '{a} and {b}', { a: 'one', b: 'two' }), 'one and two');
assert.equal(t('x', '{a} then {a}', { a: 'again' }), 'again then again');

// A placeholder with no variable is left standing rather than blanked. An empty
// gap says nothing about what went wrong; a literal `{count}` names it.
assert.equal(t('x', 'Members — {count}', {}), 'Members — {count}');
assert.equal(t('x', 'Members — {count}'), 'Members — {count}');

// --- the layout is written in logical properties -----------------------------

/**
 * `dir="rtl"` flips a layout only if the layout was written in terms of start
 * and end. One physical margin added later is a row that stays put inside a
 * right-to-left screen, and nothing warns anybody - so this is the half of the
 * groundwork that has to be held by a check rather than by a memory.
 *
 * Tokens rather than a parse, and the value pattern is what makes that safe: a
 * Tailwind scale value starts with a digit or a bracket, or is one of a short
 * list of words. The first version of this matched any word after the dash and
 * reported seventeen offences, every one of them the word "right-hand" or
 * "right-click" in a sentence.
 */
const VALUE = String.raw`(?:\d[\w./]*|\[[^\]\s]+\]|auto|full|px|screen|min|max|fit)(?![\w-])`;
const BEFORE = String.raw`(?<=[\s"'\`{])`;

function utility(prefix: string): RegExp {
  return new RegExp(`${BEFORE}-?${prefix}-${VALUE}`, 'g');
}

const FORBIDDEN: Array<{ pattern: RegExp; instead: string }> = [
  { pattern: utility('ml'), instead: 'ms-' },
  { pattern: utility('mr'), instead: 'me-' },
  { pattern: utility('pl'), instead: 'ps-' },
  { pattern: utility('pr'), instead: 'pe-' },
  { pattern: /(?<=[\s"'`{])text-left(?![\w-])/g, instead: 'text-start' },
  { pattern: /(?<=[\s"'`{])text-right(?![\w-])/g, instead: 'text-end' },
  { pattern: /(?<=[\s"'`{])border-l(?![\w-])/g, instead: 'border-s' },
  { pattern: /(?<=[\s"'`{])border-r(?![\w-])/g, instead: 'border-e' },
  { pattern: utility('border-l'), instead: 'border-s-' },
  { pattern: utility('border-r'), instead: 'border-e-' },
  { pattern: utility('rounded-tl'), instead: 'rounded-ss-' },
  { pattern: utility('rounded-tr'), instead: 'rounded-se-' },
  { pattern: utility('rounded-bl'), instead: 'rounded-es-' },
  { pattern: utility('rounded-br'), instead: 'rounded-ee-' },
  { pattern: utility('rounded-l'), instead: 'rounded-s-' },
  { pattern: utility('rounded-r'), instead: 'rounded-e-' },
  // Positional. `left-1/2` and `right-1/2` are exempt below.
  { pattern: utility('left'), instead: 'start-' },
  { pattern: utility('right'), instead: 'end-' },
];

/**
 * `left-1/2` paired with `-translate-x-1/2` is how a thing is centred, and it
 * is direction-neutral: `start-1/2` would move with the flip while the
 * translate did not, so the exemption is the correct answer rather than a
 * grandfathered one.
 */
const EXEMPT = new Set(['left-1/2', 'right-1/2']);

const here = fileURLToPath(new URL('.', import.meta.url));
const src = join(here, '..');

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (entry === 'node_modules') return [];
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

const offences: string[] = [];
for (const path of walk(src)) {
  // Both of these files discuss the patterns in prose, in backticks, which is
  // the one place a physical class name is the correct thing to write.
  if (path.endsWith('i18n.check.ts') || path.endsWith('i18n.ts')) continue;
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const { pattern, instead } of FORBIDDEN) {
      for (const match of line.match(pattern) ?? []) {
        if (EXEMPT.has(match)) continue;
        offences.push(`${path.slice(src.length + 1)}:${index + 1}  ${match}  ->  ${instead}`);
      }
    }
  });
}

assert.deepEqual(
  offences,
  [],
  `physical direction utilities do not flip under dir="rtl":\n  ${offences.join('\n  ')}`,
);

console.log('i18n.check.ts ok');
