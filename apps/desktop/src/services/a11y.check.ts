import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The mechanically checkable half of the screen-reader pass.
 *
 * Two rules, both of which fail silently and invisibly on a screen: a button
 * that is only a picture has no name to read out, and a caret with a caption
 * needs the caption to be the caret's name rather than a paragraph somewhere
 * near it. This file holds the first, which is the one that recurs - the
 * second is judgement and stays with a person.
 *
 * ## Why the rule is narrow
 *
 * It flags a `<button>` whose entire content is a single `<SomethingIcon />`
 * and which carries no `aria-label`, `aria-labelledby` or `title`. That misses
 * a button whose content is an icon *and* a decorative span; it also never
 * fires on a button whose label is wrong, only on one that has none. Both are
 * deliberate. A check with false positives is one somebody relaxes the first
 * time it blocks them, and this rule has none: an icon alone is unreadable,
 * always, with no case where it is fine.
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const src = join(here, '..');

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (entry === 'node_modules') return [];
    if (statSync(path).isDirectory()) return walk(path);
    return entry.endsWith('.tsx') ? [path] : [];
  });
}

/**
 * `<button ...>` through to its `</button>`, non-greedy so a run of buttons is
 * a run of matches rather than one that swallows the lot. Nested buttons are
 * invalid HTML, so non-greedy is exactly right here.
 */
const BUTTON = /<button\b([\s\S]*?)>([\s\S]*?)<\/button>/g;

/** The whole content is one icon element and nothing else. */
const ICON_ONLY = /^\{?\s*<[A-Z][A-Za-z0-9]*Icon\b[^>]*\/>\s*\}?$/;

const NAMED = /\baria-label\b|\baria-labelledby\b|\btitle=/;

const unnamed: string[] = [];
for (const path of walk(src)) {
  const source = readFileSync(path, 'utf8');
  for (const match of source.matchAll(BUTTON)) {
    const [, attributes = '', content = ''] = match;
    // JSX comments are not a name, and a stripped comment must not turn a
    // labelled button into an unlabelled one - so they go before the test.
    const body = content.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').trim();
    if (!ICON_ONLY.test(body)) continue;
    if (NAMED.test(attributes)) continue;

    const line = source.slice(0, match.index).split('\n').length;
    unnamed.push(`${path.slice(src.length + 1)}:${line}  ${body}`);
  }
}

assert.deepEqual(
  unnamed,
  [],
  `a button that is only a picture has no name for a screen reader to read:\n  ${unnamed.join('\n  ')}`,
);

// --- every modal actually holds the keyboard ---------------------------------

/**
 * `aria-modal="true"` is a promise that everything behind the dialog is inert.
 * The attribute is a hint to assistive technology and does nothing to the Tab
 * key, so the promise is kept by `useFocusTrap` and by nothing else - which
 * means a dialog written next month with the attribute and without the ref
 * makes exactly the silent promise all twenty-two of these used to make.
 *
 * Matched on the opening tag rather than per file: two of these components hold
 * three dialogs each, and one trapped dialog in a file says nothing about the
 * other two.
 */
const MODAL_TAG = /<(?:div|section|aside)\b[^>]*aria-modal="true"[^>]*>/g;

const untrapped: string[] = [];
let modals = 0;
for (const path of walk(src)) {
  const source = readFileSync(path, 'utf8');
  for (const match of source.matchAll(MODAL_TAG)) {
    modals += 1;
    if (/\bref=\{/.test(match[0])) continue;
    const line = source.slice(0, match.index).split('\n').length;
    untrapped.push(`${path.slice(src.length + 1)}:${line}`);
  }
}

assert.deepEqual(
  untrapped,
  [],
  `aria-modal="true" with no useFocusTrap ref - Tab walks straight out:\n  ${untrapped.join('\n  ')}`,
);

// A rule over an empty set passes forever and proves nothing: if `aria-modal`
// were renamed, or the tag shape changed, the loop above would find no dialogs
// and report success.
assert.ok(modals >= 20, `found ${modals} modals to check, expected the client's ~22`);

// --- the rule catches what it claims to --------------------------------------

// A check whose only evidence is that it passed today is one nobody can tell
// from a check that matches nothing at all.
{
  const sample = `
    <button type="button" onClick={x}><PinIcon className="h-4 w-4" /></button>
    <button type="button" aria-label="Pin" onClick={x}><PinIcon className="h-4" /></button>
    <button type="button" onClick={x}>Save</button>
    <button type="button" onClick={x}><PinIcon /> Pin</button>
  `;
  const flagged = [...sample.matchAll(BUTTON)].filter(
    ([, attributes = '', content = '']) =>
      ICON_ONLY.test(content.trim()) && !NAMED.test(attributes),
  );
  assert.equal(flagged.length, 1, 'exactly the unlabelled icon-only button');
  assert.match(flagged[0]![2]!, /PinIcon/);
}

console.log('a11y.check.ts ok');
