/**
 * Run with `tsx src/services/markup.check.ts`.
 *
 * These are the android `MarkupTest` cases, case for case. The two parsers are
 * separate code and have to stay one behaviour, so a case added on one side
 * belongs on the other - otherwise the same message reads differently
 * depending on which screen it is opened on.
 *
 * The offsets are the part with a bug in it. A style is drawn over indices into
 * the text the parser *returns*, and the marks have been taken out of that text
 * - so every case asserts both halves, because a parser that strips two
 * characters and reports the range it saw before stripping paints the wrong
 * words and looks almost right.
 */
import assert from 'node:assert/strict';
import { continueList, isPlain, parse, type Block, type Span } from './markup';

const one = (text: string): Block => {
  const blocks = parse(text);
  assert.equal(blocks.length, 1, `expected one block from ${JSON.stringify(text)}`);
  return blocks[0]!;
};

const spans = (text: string): Span[] => one(text).spans;

// --- inline marks ---

{
  const block = one('hello there');
  assert.equal(block.kind, 'body');
  assert.equal(block.text, 'hello there');
  assert.deepEqual(block.spans, []);
}

// Bold loses its marks and keeps its range.
{
  const block = one('a **b** c');
  assert.equal(block.text, 'a b c');
  assert.deepEqual(block.spans, [{ start: 2, end: 3, style: 'bold' }]);
}

// Two asterisks are bold, not two italics.
assert.deepEqual(spans('**bold**'), [{ start: 0, end: 4, style: 'bold' }]);

// Italic takes either mark.
assert.deepEqual(spans('*a*'), [{ start: 0, end: 1, style: 'italic' }]);
assert.deepEqual(spans('_a_'), [{ start: 0, end: 1, style: 'italic' }]);

// An identifier is not two italics.
{
  const block = one('call snake_case_name now');
  assert.equal(block.text, 'call snake_case_name now');
  assert.deepEqual(block.spans, []);
}

// Code is literal inside.
{
  const block = one('use `a*b*c` here');
  assert.equal(block.text, 'use a*b*c here');
  assert.deepEqual(block.spans, [{ start: 4, end: 9, style: 'code' }]);
}

// An unmatched mark is just a character.
{
  const block = one('2 * 3 = 6');
  assert.equal(block.text, '2 * 3 = 6');
  assert.deepEqual(block.spans, []);
}

// An empty pair is not a style.
assert.equal(one('****').text, '****');

// A backslash escapes the mark it precedes.
{
  const block = one('a \\*not italic\\* b');
  assert.equal(block.text, 'a *not italic* b');
  assert.deepEqual(block.spans, []);
}

// --- blocks ---

// A fence is its own block and is never parsed inside.
{
  const blocks = parse('before\n```\nval x = *2*\n```\nafter');
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ['body', 'code', 'body'],
  );
  assert.equal(blocks[1]!.text, 'val x = *2*');
  assert.deepEqual(blocks[1]!.spans, []);
}

// An unclosed fence still codes the rest.
{
  const blocks = parse('look\n```\nraw text');
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ['body', 'code'],
  );
  assert.equal(blocks[1]!.text, 'raw text');
}

// Quoted lines group into one block and lose the marker.
{
  const blocks = parse('> one\n> two\nreply');
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ['quote', 'body'],
  );
  assert.equal(blocks[0]!.text, 'one\ntwo');
  assert.equal(blocks[1]!.text, 'reply');
}

// A greater-than inside a line is not a quote.
{
  const block = one('2 > 1');
  assert.equal(block.kind, 'body');
  assert.equal(block.text, '2 > 1');
}

// --- lists ---

// A bullet is its own block and loses its marker.
{
  const blocks = parse('shopping\n- eggs\n- milk');
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ['body', 'bullet', 'bullet'],
  );
  assert.equal(blocks[1]!.text, 'eggs');
  assert.equal(blocks[2]!.text, 'milk');
}

// A bullet still carries its inline styles.
{
  const blocks = parse('- buy **eggs**');
  assert.equal(blocks[0]!.text, 'buy eggs');
  assert.deepEqual(blocks[0]!.spans, [{ start: 4, end: 8, style: 'bold' }]);
}

// A numbered run is renumbered from its first item.
{
  const blocks = parse('1. one\n1. two\n1. three');
  assert.deepEqual(
    blocks.map((block) => block.ordinal),
    [1, 2, 3],
  );
  assert.deepEqual(
    blocks.map((block) => block.text),
    ['one', 'two', 'three'],
  );
}

// A numbered run that starts elsewhere keeps its start.
assert.deepEqual(
  parse('5. five\n6. six').map((block) => block.ordinal),
  [5, 6],
);

// A paragraph between two runs starts the numbering again.
{
  const blocks = parse('1. one\nprose\n1. one again');
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ['number', 'body', 'number'],
  );
  assert.equal(blocks[2]!.ordinal, 1);
}

// A close paren numbers a list too.
assert.equal(one('1) one').kind, 'number');

// A marker glued to its word is a mark, not a list. The space after the marker
// is the whole difference, and it is what keeps every *italic* in the app from
// becoming a bullet.
{
  const block = one('*italic*');
  assert.equal(block.kind, 'body');
  assert.equal(block.text, 'italic');
}

// A hyphen mid-sentence is not a bullet.
{
  const block = one('well - maybe not');
  assert.equal(block.kind, 'body');
  assert.equal(block.text, 'well - maybe not');
}

// A decimal is not a numbered item.
{
  const block = one('3.14 is pi');
  assert.equal(block.kind, 'body');
  assert.equal(block.text, '3.14 is pi');
}

// A list marker inside a fence is left alone.
{
  const blocks = parse('```\n- not a bullet\n```');
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ['code'],
  );
  assert.equal(blocks[0]!.text, '- not a bullet');
}

// --- isPlain ---

// isPlain may be pessimistic; it must never be optimistic.
for (const text of [
  'hello',
  'a b c',
  '2 > 1 yes',
  'https://example.com/a_b',
  '- a bullet',
  '1. an item',
  '1) an item',
  'well - maybe not',
  '3.14 is pi',
]) {
  if (!isPlain(text)) continue;
  const blocks = parse(text);
  assert.ok(
    blocks.length === 1 &&
      blocks[0]!.kind === 'body' &&
      blocks[0]!.text === text &&
      blocks[0]!.spans.length === 0,
    `said plain but changed: ${text}`,
  );
}

// A shortcode survives the parse, so the emoji splitter still sees it.
assert.equal(one('hi :wave: there').text, 'hi :wave: there');

// --- continueList ---

// Nothing to continue outside a list: the box behaves as it always did.
assert.equal(continueList('just words', 10), null);
// A marker with nothing after it is not a list yet.
assert.equal(continueList('-', 1), null);

// A bullet offers the next bullet.
assert.deepEqual(continueList('- eggs', 6), { text: '- eggs\n- ', caret: 9 });

// The exact marker is kept, character and spacing and indent alike.
assert.deepEqual(continueList('* eggs', 6), { text: '* eggs\n* ', caret: 9 });
assert.deepEqual(continueList('  + eggs', 8), { text: '  + eggs\n  + ', caret: 13 });

// A numbered item offers the one after it, keeping the separator it was
// written with.
assert.deepEqual(continueList('1. one', 6), { text: '1. one\n2. ', caret: 10 });
assert.deepEqual(continueList('3) three', 8), { text: '3) three\n4) ', caret: 12 });

// An empty item ends the list rather than offering another one - otherwise the
// only way out is to delete a marker nobody typed.
assert.deepEqual(continueList('- eggs\n- ', 9), { text: '- eggs\n', caret: 7 });
assert.deepEqual(continueList('1. one\n2. ', 10), { text: '1. one\n', caret: 7 });

// Only the line the caret is on counts, not the whole box.
assert.deepEqual(continueList('prose\n- eggs', 12), { text: 'prose\n- eggs\n- ', caret: 15 });
// The caret in prose under a list is an ordinary newline.
assert.equal(continueList('- eggs\nprose', 12), null);

// A caret in the middle of an item splits it and carries the list on.
assert.deepEqual(continueList('- eggsmilk', 6), { text: '- eggs\n- milk', caret: 9 });

console.log('markup.check.ts ok');
