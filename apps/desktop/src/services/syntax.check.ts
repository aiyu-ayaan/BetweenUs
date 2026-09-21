/**
 * Run with `tsx src/services/syntax.check.ts`.
 *
 * These are the android `SyntaxTest` cases, case for case. The two lexers are
 * separate code and have to stay one behaviour, so a case added on one side
 * belongs on the other.
 *
 * Every case also checks the one property the renderer depends on: the tokens
 * joined back together are the code that went in, character for character.
 */
import assert from 'node:assert/strict';
import { knowsLanguage, tokenize, type Token, type TokenKind } from './syntax';

const lex = (code: string, lang: string): Token[] => {
  const tokens = tokenize(code, lang);
  assert.equal(tokens.map((token) => token.text).join(''), code, `tokens of ${JSON.stringify(code)} lost text`);
  return tokens;
};

/** Just the coloured tokens, which is what a case is ever about. */
const coloured = (code: string, lang: string): Array<[TokenKind, string]> =>
  lex(code, lang)
    .filter((token) => token.kind !== 'plain')
    .map((token) => [token.kind, token.text]);

// No language, or one it does not know, is one plain token.
assert.deepEqual(lex("it's fine", ''), [{ text: "it's fine", kind: 'plain' }]);
assert.deepEqual(lex('x = 1', 'brainfuck'), [{ text: 'x = 1', kind: 'plain' }]);
assert.deepEqual(lex('', 'ts'), []);
assert.equal(knowsLanguage('TS'), true);
assert.equal(knowsLanguage('cobol'), false);

// The basics, in the language most snippets are.
assert.deepEqual(coloured('const a = "hi"; // note\nreturn null;', 'ts'), [
  ['keyword', 'const'],
  ['string', '"hi"'],
  ['comment', '// note'],
  ['keyword', 'return'],
  ['literal', 'null'],
]);

// A keyword inside an identifier is not one, and a string keeps its escapes.
assert.deepEqual(coloured('constant = "a\\"b"', 'js'), [['string', '"a\\"b"']]);

// Numbers, but not the digits at the end of a name; a minus is not a word.
assert.deepEqual(coloured('x1 = 0xFF + 2.5e3 - i-1', 'js'), [
  ['number', '0xFF'],
  ['number', '2.5e3'],
  ['number', '1'],
]);

// A block comment runs across lines; an unclosed one runs to the end.
assert.deepEqual(coloured('a /* b\nc */ d', 'c'), [['comment', '/* b\nc */']]);
assert.deepEqual(coloured('a /* b', 'c'), [['comment', '/* b']]);

// A stray quote colours its line, not the rest of the block.
assert.deepEqual(coloured('"open\nif', 'java'), [
  ['string', '"open'],
  ['keyword', 'if'],
]);

// Python: `#` comments, triple quotes across lines, its own literals.
assert.deepEqual(coloured('def f():\n    """doc\n    more"""\n    return None  # done', 'python'), [
  ['keyword', 'def'],
  ['string', '"""doc\n    more"""'],
  ['keyword', 'return'],
  ['literal', 'None'],
  ['comment', '# done'],
]);

// Shell: `#` is a comment only where a word could start.
assert.deepEqual(coloured('echo $# # count', 'bash'), [
  ['keyword', 'echo'],
  ['comment', '# count'],
]);

// SQL keywords are any case.
assert.deepEqual(coloured("SELECT * FROM t WHERE a = 'x' -- why", 'sql'), [
  ['keyword', 'SELECT'],
  ['keyword', 'FROM'],
  ['keyword', 'WHERE'],
  ['string', "'x'"],
  ['comment', '-- why'],
]);

// CSS: hyphenated words stay whole, units stay on their number.
assert.deepEqual(coloured('@media (x) { a { font-size: 12px !important } }', 'css'), [
  ['keyword', '@media'],
  ['number', '12px'],
  ['keyword', '!important'],
]);

// Kotlin keywords, and a template string with an apostrophe in a comment.
assert.deepEqual(coloured("fun main() { val s = \"x\" } // it's", 'kotlin'), [
  ['keyword', 'fun'],
  ['keyword', 'val'],
  ['string', '"x"'],
  ['comment', "// it's"],
]);

// JSON: strings, numbers, literals, nothing else.
assert.deepEqual(coloured('{"a": [1, true, null]}', 'json'), [
  ['string', '"a"'],
  ['number', '1'],
  ['literal', 'true'],
  ['literal', 'null'],
]);

// Neighbouring plain characters are one token.
assert.deepEqual(lex('();', 'ts'), [{ text: '();', kind: 'plain' }]);

console.log('syntax.check.ts ok');
