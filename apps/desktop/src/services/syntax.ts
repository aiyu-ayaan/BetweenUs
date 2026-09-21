/**
 * Colour for a fenced code block, by the language its fence named.
 *
 * Deliberately a lexer and not a parser: it knows what a comment, a string, a
 * number and a keyword look like in a couple of dozen languages, and nothing
 * about what the code means. That is the whole of what a snippet in a chat
 * needs - somebody pasting twenty lines wants to see where the string ends,
 * not a type-checked AST - and it keeps the cost to one small file instead of
 * a highlighting library and its grammar bundle on both clients.
 *
 * A fence with no language, or one this does not know, comes back as one
 * plain token and is drawn monospace and uncoloured. Guessing the language of
 * an untagged block is how a sentence with an apostrophe in it gets painted
 * as a string to the end of the line.
 *
 * Pure, and line for line the android client's `Syntax.kt`. Changing one
 * changes both, or the same snippet is coloured differently on two screens.
 */

export type TokenKind = 'plain' | 'keyword' | 'literal' | 'string' | 'number' | 'comment';

export interface Token {
  text: string;
  kind: TokenKind;
}

interface Grammar {
  keywords: ReadonlySet<string>;
  /** `true`, `null`, `None` - values rather than words of the language. */
  literals: ReadonlySet<string>;
  lineComments: readonly string[];
  blockComment: readonly [string, string] | null;
  /** Characters that open a string, each closed by itself. */
  quotes: string;
  /** Python's and Kotlin's `"""`, which may run across lines. */
  tripleQuotes: boolean;
  /** SQL does not care how a keyword is spelled; everybody else does. */
  caseInsensitive: boolean;
}

const words = (list: string): ReadonlySet<string> => new Set(list.split(' '));

const C_LIKE_LITERALS = words('true false null');

const JS: Grammar = {
  keywords: words(
    'abstract as async await break case catch class const continue debugger declare default delete do else enum export extends finally for from function get if implements import in instanceof interface let new of private protected public readonly return set static super switch this throw try type typeof var void while with yield',
  ),
  literals: words('true false null undefined NaN Infinity'),
  lineComments: ['//'],
  blockComment: ['/*', '*/'],
  quotes: '"\'`',
  tripleQuotes: false,
  caseInsensitive: false,
};

const PYTHON: Grammar = {
  keywords: words(
    'and as assert async await break class continue def del elif else except finally for from global if import in is lambda match case nonlocal not or pass raise return try while with yield self',
  ),
  literals: words('True False None'),
  lineComments: ['#'],
  blockComment: null,
  quotes: '"\'',
  tripleQuotes: true,
  caseInsensitive: false,
};

const KOTLIN: Grammar = {
  keywords: words(
    'abstract annotation as break by catch class companion const constructor continue data do else enum external final finally for fun get if import in init inline interface internal is lateinit object open operator out override package private protected public return sealed set super suspend this throw try typealias val var vararg when where while',
  ),
  literals: C_LIKE_LITERALS,
  lineComments: ['//'],
  blockComment: ['/*', '*/'],
  quotes: '"\'',
  tripleQuotes: true,
  caseInsensitive: false,
};

const JAVA: Grammar = {
  keywords: words(
    'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public record return short static super switch synchronized this throw throws transient try var void volatile while',
  ),
  literals: C_LIKE_LITERALS,
  lineComments: ['//'],
  blockComment: ['/*', '*/'],
  quotes: '"\'',
  tripleQuotes: false,
  caseInsensitive: false,
};

const C: Grammar = {
  keywords: words(
    'auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern float for friend goto if inline int long namespace new operator private protected public register return short signed sizeof static struct switch template this throw try typedef typename union unsigned using virtual void volatile while #include #define #ifdef #ifndef #endif #pragma',
  ),
  literals: words('true false NULL nullptr'),
  lineComments: ['//'],
  blockComment: ['/*', '*/'],
  quotes: '"\'',
  tripleQuotes: false,
  caseInsensitive: false,
};

const CSHARP: Grammar = {
  keywords: words(
    'abstract as async await base bool break byte case catch char class const continue decimal default delegate do double else enum event explicit extern finally fixed float for foreach get if implicit in int interface internal is lock long namespace new object operator out override params private protected public readonly record ref return sealed set short static string struct switch this throw try typeof uint ulong using var virtual void volatile while',
  ),
  literals: C_LIKE_LITERALS,
  lineComments: ['//'],
  blockComment: ['/*', '*/'],
  quotes: '"\'',
  tripleQuotes: false,
  caseInsensitive: false,
};

const GO: Grammar = {
  keywords: words(
    'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
  ),
  literals: words('true false nil iota'),
  lineComments: ['//'],
  blockComment: ['/*', '*/'],
  quotes: '"\'`',
  tripleQuotes: false,
  caseInsensitive: false,
};

const RUST: Grammar = {
  keywords: words(
    'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while',
  ),
  literals: words('true false None Some Ok Err'),
  lineComments: ['//'],
  blockComment: ['/*', '*/'],
  // A single quote is a lifetime as often as a char, and a lifetime has no
  // closing quote - so only double quotes open a string here.
  quotes: '"',
  tripleQuotes: false,
  caseInsensitive: false,
};

const SWIFT: Grammar = {
  keywords: words(
    'as associatedtype break case catch class continue default defer do else enum extension fallthrough for func guard if import in init inout internal is let private protocol public repeat rethrows return self static struct subscript super switch throw throws try typealias var where while',
  ),
  literals: words('true false nil'),
  lineComments: ['//'],
  blockComment: ['/*', '*/'],
  quotes: '"',
  tripleQuotes: true,
  caseInsensitive: false,
};

const SHELL: Grammar = {
  keywords: words(
    'if then else elif fi for while until do done case esac in function return local export readonly unset shift exit break continue source alias sudo echo cd',
  ),
  literals: words('true false'),
  lineComments: ['#'],
  blockComment: null,
  quotes: '"\'',
  tripleQuotes: false,
  caseInsensitive: false,
};

const SQL: Grammar = {
  keywords: words(
    'select from where and or not insert into values update set delete create alter drop table index view join inner left right outer full on as group by order having limit offset distinct union all exists in is like between case when then else end primary key foreign references default unique returning with begin commit rollback',
  ),
  literals: words('null true false'),
  lineComments: ['--'],
  blockComment: ['/*', '*/'],
  quotes: '"\'',
  tripleQuotes: false,
  caseInsensitive: true,
};

const JSON_GRAMMAR: Grammar = {
  keywords: words(''),
  literals: C_LIKE_LITERALS,
  lineComments: [],
  blockComment: null,
  quotes: '"',
  tripleQuotes: false,
  caseInsensitive: false,
};

const YAML: Grammar = {
  keywords: words(''),
  literals: words('true false null yes no on off'),
  lineComments: ['#'],
  blockComment: null,
  quotes: '"\'',
  tripleQuotes: false,
  caseInsensitive: false,
};

const CSS: Grammar = {
  keywords: words('@media @import @keyframes @font-face @supports @layer @apply !important'),
  literals: words(''),
  lineComments: [],
  blockComment: ['/*', '*/'],
  quotes: '"\'',
  tripleQuotes: false,
  caseInsensitive: false,
};

const MARKUP: Grammar = {
  keywords: words(''),
  literals: words(''),
  lineComments: [],
  blockComment: ['<!--', '-->'],
  // Double quotes only: an apostrophe in the text between two tags is far
  // more common than an attribute in single quotes.
  quotes: '"',
  tripleQuotes: false,
  caseInsensitive: false,
};

/** Every name a fence might use, pointed at the grammar it means. */
const GRAMMARS: ReadonlyMap<string, Grammar> = new Map<string, Grammar>([
  ...['js', 'javascript', 'jsx', 'mjs', 'cjs', 'ts', 'typescript', 'tsx'].map((name): [string, Grammar] => [name, JS]),
  ...['py', 'python', 'python3'].map((name): [string, Grammar] => [name, PYTHON]),
  ...['kt', 'kts', 'kotlin'].map((name): [string, Grammar] => [name, KOTLIN]),
  ...['java'].map((name): [string, Grammar] => [name, JAVA]),
  ...['c', 'h', 'cpp', 'c++', 'cc', 'hpp', 'cxx'].map((name): [string, Grammar] => [name, C]),
  ...['cs', 'csharp', 'c#'].map((name): [string, Grammar] => [name, CSHARP]),
  ...['go', 'golang'].map((name): [string, Grammar] => [name, GO]),
  ...['rs', 'rust'].map((name): [string, Grammar] => [name, RUST]),
  ...['swift'].map((name): [string, Grammar] => [name, SWIFT]),
  ...['sh', 'bash', 'shell', 'zsh', 'console', 'shellscript'].map((name): [string, Grammar] => [name, SHELL]),
  ...['sql', 'postgres', 'postgresql', 'mysql', 'sqlite'].map((name): [string, Grammar] => [name, SQL]),
  ...['json', 'jsonc', 'json5'].map((name): [string, Grammar] => [name, JSON_GRAMMAR]),
  ...['yaml', 'yml'].map((name): [string, Grammar] => [name, YAML]),
  ...['css', 'scss', 'less'].map((name): [string, Grammar] => [name, CSS]),
  ...['html', 'xml', 'svg', 'vue'].map((name): [string, Grammar] => [name, MARKUP]),
]);

/** Whether a fence's language is one this colours. */
export function knowsLanguage(lang: string): boolean {
  return GRAMMARS.has(lang.toLowerCase());
}

const NUMBER = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z%]*/;

/** `@media`, `#include` and `!important` are words too, in their languages. */
const isWordStart = (c: string): boolean => /[A-Za-z_$@#!]/.test(c);
const isWordPart = (c: string): boolean => /[A-Za-z0-9_$]/.test(c);

/**
 * `code` cut into coloured tokens. Joined back together the tokens are always
 * exactly `code`, character for character - the renderer draws them in order
 * and nothing else, so a token that dropped or doubled a character would be
 * a snippet that no longer says what was sent.
 */
export function tokenize(code: string, lang: string): Token[] {
  const grammar = GRAMMARS.get(lang.toLowerCase());
  if (!grammar || code.length === 0) return code.length === 0 ? [] : [{ text: code, kind: 'plain' }];

  const out: Token[] = [];
  const push = (text: string, kind: TokenKind): void => {
    const last = out[out.length - 1];
    // Neighbouring plain text is one token, so a line of punctuation is one
    // node to draw rather than forty.
    if (last && last.kind === kind && kind === 'plain') last.text += text;
    else out.push({ text, kind });
  };

  let i = 0;
  while (i < code.length) {
    const c = code[i] ?? '';
    const before = i > 0 ? (code[i - 1] ?? '') : '';

    const line = grammar.lineComments.find(
      // `#` is a comment only where a word could start. `$#` and `${#x}` in a
      // shell script, or `a#b` anywhere, are not.
      (token) => code.startsWith(token, i) && (token !== '#' || before === '' || /\s/.test(before)),
    );
    if (line !== undefined) {
      const end = code.indexOf('\n', i);
      const stop = end === -1 ? code.length : end;
      push(code.slice(i, stop), 'comment');
      i = stop;
      continue;
    }

    if (grammar.blockComment && code.startsWith(grammar.blockComment[0], i)) {
      const close = code.indexOf(grammar.blockComment[1], i + grammar.blockComment[0].length);
      const stop = close === -1 ? code.length : close + grammar.blockComment[1].length;
      push(code.slice(i, stop), 'comment');
      i = stop;
      continue;
    }

    if (grammar.quotes.includes(c)) {
      const triple = c + c + c;
      if (grammar.tripleQuotes && c !== '`' && code.startsWith(triple, i)) {
        const close = code.indexOf(triple, i + 3);
        const stop = close === -1 ? code.length : close + 3;
        push(code.slice(i, stop), 'string');
        i = stop;
        continue;
      }
      // A backtick string may run across lines; the others end at the line,
      // so one stray quote colours a line rather than the rest of the block.
      let j = i + 1;
      while (j < code.length) {
        const d = code[j] ?? '';
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (d === c) {
          j++;
          break;
        }
        if (d === '\n' && c !== '`') break;
        j++;
      }
      const stop = Math.min(j, code.length);
      push(code.slice(i, stop), 'string');
      i = stop;
      continue;
    }

    if (/\d/.test(c) && !isWordPart(before)) {
      const match = NUMBER.exec(code.slice(i));
      if (match) {
        push(match[0], 'number');
        i += match[0].length;
        continue;
      }
    }

    if (isWordStart(c) && !isWordPart(before)) {
      let j = i + 1;
      // A hyphen joins a word only when a letter follows it, which keeps
      // `font-size` and `@font-face` whole and leaves `i-1` a subtraction.
      while (
        j < code.length &&
        (isWordPart(code[j] ?? '') || (code[j] === '-' && /[A-Za-z]/.test(code[j + 1] ?? '')))
      ) {
        j++;
      }
      const word = code.slice(i, j);
      const key = grammar.caseInsensitive ? word.toLowerCase() : word;
      const kind: TokenKind = grammar.keywords.has(key)
        ? 'keyword'
        : grammar.literals.has(key)
          ? 'literal'
          : 'plain';
      push(word, kind);
      i = j;
      continue;
    }

    push(c, 'plain');
    i++;
  }

  return out;
}
