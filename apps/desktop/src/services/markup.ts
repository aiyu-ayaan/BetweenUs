/**
 * The markdown-ish shape of a message body.
 *
 * `message-body.ts` decides what a message *is* - words, attachments and the
 * quote above a reply. This decides how the words read: the small set of marks
 * every chat app has trained people to type, and nothing else. There is no link
 * syntax, because a bare URL is already a link on every client; no headings,
 * because a heading in a chat line is shouting; and no images, because an
 * attachment is not a body.
 *
 * Pure and offset-exact, which is the whole reason it is here rather than in
 * the renderer: the marks are *removed* from the text, so every span is an
 * index into the text that comes out, and the emoji splitter runs over that
 * same string afterwards. A parser that left the asterisks in would need no
 * offsets at all - and would draw them.
 *
 * Line for line the android client's `Markup.kt`. Changing one changes both,
 * or the same message reads differently on two screens.
 */

export type Style = 'bold' | 'italic' | 'strike' | 'code';

/** A style over `[start, end)` of the block's own text. */
export interface Span {
  start: number;
  end: number;
  style: Style;
}

export type Kind = 'body' | 'quote' | 'code' | 'bullet' | 'number';

/**
 * One block of a message.
 *
 * A list is not a block: every item is its own, and a run of them next to each
 * other is what a list *is*. That keeps this list flat - no tree, no nesting -
 * which is the whole of what a chat line needs and a fraction of what a
 * document parser would cost.
 *
 * `ordinal` is the number a `number` item is drawn with, and zero for
 * everything else.
 */
export interface Block {
  kind: Kind;
  text: string;
  spans: Span[];
  ordinal: number;
}

interface Delimiter {
  token: string;
  style: Style;
}

// Longest first: `**` has to be tried before `*` or every bold is two italics
// with nothing between them.
const DELIMITERS: Delimiter[] = [
  { token: '**', style: 'bold' },
  { token: '~~', style: 'strike' },
  { token: '*', style: 'italic' },
  { token: '_', style: 'italic' },
  { token: '`', style: 'code' },
];

const ESCAPABLE = '*_~`\\>';

/**
 * A list marker, and the space after it.
 *
 * The space is what keeps `*bold*` from being a bullet: a marker glued to its
 * word is a mark, and a marker standing off from it is a list. The indent is
 * bounded at three so a deliberately indented line stays prose.
 */
const BULLET = /^ {0,3}[-*+] +(.*)$/;
const NUMBER = /^ {0,3}(\d{1,9})[.)] +(.*)$/;

export function parse(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let i = 0;

  let pending: string[] = [];
  let pendingQuote = false;

  const flush = (): void => {
    if (pending.length === 0) return;
    blocks.push(inline(pending.join('\n'), pendingQuote ? 'quote' : 'body'));
    pending = [];
    pendingQuote = false;
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.trimStart().startsWith('```')) {
      flush();
      const fence: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trimStart().startsWith('```')) {
        fence.push(lines[i] ?? '');
        i++;
      }
      // An unclosed fence is still a code block. Somebody who opened one and
      // hit send meant the rest to be code; drawing it as prose with three
      // backticks in front of it helps nobody.
      if (i < lines.length) i++;
      blocks.push({ kind: 'code', text: trimNewlines(fence.join('\n')), spans: [], ordinal: 0 });
      continue;
    }

    // A list item is its own block, so it ends whatever paragraph was being
    // gathered. Bullets first: `1.` cannot start with `-`, but a bullet line
    // can perfectly well contain a number.
    const bullet = BULLET.exec(line);
    if (bullet) {
      flush();
      blocks.push(inline(bullet[1] ?? '', 'bullet'));
      i++;
      continue;
    }

    const numbered = NUMBER.exec(line);
    if (numbered) {
      flush();
      // The run is renumbered from whatever the first item said, so the
      // `1. 1. 1.` everybody types comes out 1, 2, 3 - and a list that
      // deliberately starts at 5 still starts at 5.
      const previous = blocks[blocks.length - 1];
      const ordinal =
        previous && previous.kind === 'number'
          ? previous.ordinal + 1
          : Number.parseInt(numbered[1] ?? '1', 10) || 1;
      blocks.push(inline(numbered[2] ?? '', 'number', ordinal));
      i++;
      continue;
    }

    const quoted = line.startsWith('> ') || line === '>';
    const body = quoted ? line.replace(/^>( )?/, '') : line;

    // A run of lines is one block only while they agree about being quoted;
    // the marker changing is a new block.
    if (pending.length > 0 && quoted !== pendingQuote) flush();
    pendingQuote = quoted;
    pending.push(body);
    i++;
  }
  flush();

  return blocks;
}

/** `trim('\n')`, which JavaScript has no single call for. */
function trimNewlines(text: string): string {
  return text.replace(/^\n+/, '').replace(/\n+$/, '');
}

function inline(source: string, kind: Kind, ordinal = 0): Block {
  const out = { text: '' };
  const spans: Span[] = [];
  scan(source, out, spans);
  return { kind, text: out.text, spans, ordinal };
}

/**
 * `out` is a holder rather than a plain string because a span's offsets are
 * measured against everything written so far, including by the recursive call
 * that handles a nested style - so the writer has to be shared, not copied.
 */
function scan(source: string, out: { text: string }, spans: Span[]): void {
  let i = 0;

  while (i < source.length) {
    const c = source[i] ?? '';

    if (c === '\\' && i + 1 < source.length && ESCAPABLE.includes(source[i + 1] ?? '')) {
      out.text += source[i + 1] ?? '';
      i += 2;
      continue;
    }

    const opener = openerAt(source, i);
    if (opener) {
      const from = i + opener.token.length;
      const close = source.indexOf(opener.token, from);
      if (close > from) {
        const start = out.text.length;
        const content = source.slice(from, close);
        // Code is literal: a backtick span is where somebody puts the
        // asterisks they do not want eaten.
        if (opener.style === 'code') out.text += content;
        else scan(content, out, spans);
        spans.push({ start, end: out.text.length, style: opener.style });
        i = close + opener.token.length;
        continue;
      }
    }

    out.text += c;
    i++;
  }
}

function openerAt(source: string, at: number): Delimiter | null {
  for (const delimiter of DELIMITERS) {
    if (!source.startsWith(delimiter.token, at)) continue;
    // `snake_case_names` are not two italics. An underscore only opens when it
    // is not glued to a word on its left, which is the rule that keeps
    // identifiers readable without a backtick round them.
    if (delimiter.token === '_' && at > 0 && /[\p{L}\p{N}]/u.test(source[at - 1] ?? '')) continue;
    return delimiter;
  }
  return null;
}

/** Whether anything at all would be drawn differently. Saves a rebuild. */
export function isPlain(text: string): boolean {
  if (/[*_~`\\]/.test(text)) return false;
  return text
    .split('\n')
    .every((line) => !(line.startsWith('> ') || line === '>' || BULLET.test(line) || NUMBER.test(line)));
}
