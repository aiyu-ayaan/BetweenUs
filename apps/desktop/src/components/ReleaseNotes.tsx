/**
 * A GitHub release body, drawn.
 *
 * The notes are markdown - `### Features` and a list under it, `**bold**`, a
 * fenced block of shell - and until this they were dropped into a `<pre>`-ish
 * paragraph, hashes, asterisks, backticks and all. Which is exactly the shape
 * that makes somebody stop reading the thing telling them what changed.
 *
 * It is the message parser, not a second one: `parseNotes` is `parse` with
 * headings switched on, because a heading in a chat line is shouting and a
 * release note is nothing but headings. What is not shared is the drawing -
 * the message list lays custom emoji and link previews over its runs, and none
 * of that belongs in a changelog.
 *
 * Android draws the same blocks in `feature/update/ReleaseNotes.kt`. Changing
 * one changes both, or the same release reads differently on two screens.
 */
import { parseNotes, styleRuns, type Block, type Run } from '../services/markup';

export function ReleaseNotes({ text }: { text: string }): JSX.Element | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  return (
    <div className="space-y-1.5 text-sm text-slate-300">
      {group(blocks(trimmed)).map((run, index) =>
        run.kind === 'list' ? (
          <List key={index} items={run.blocks} />
        ) : (
          <Piece key={index} block={run.blocks[0]!} />
        ),
      )}
    </div>
  );
}

/**
 * `parseNotes` treats a blank line as a paragraph break, so nothing empty
 * should come back. This is the belt to that pair of braces: a block with
 * nothing in it draws as an empty paragraph on top of the spacing this already
 * has, and a release note has a blank line under every heading.
 */
function blocks(text: string): Block[] {
  return parseNotes(text).filter((block) => block.kind !== 'body' || block.text.trim() !== '');
}

/**
 * Consecutive list items are one list. The parser keeps its blocks flat -
 * each item its own - and turning a run of them back into a `<ul>` is the
 * renderer's job, the same way the message list does it.
 */
function group(blocks: Block[]): Array<{ kind: 'list' | 'one'; blocks: Block[] }> {
  const groups: Array<{ kind: 'list' | 'one'; blocks: Block[] }> = [];
  for (const block of blocks) {
    const isItem = block.kind === 'bullet' || block.kind === 'number';
    const open = groups[groups.length - 1];
    if (isItem && open?.kind === 'list' && open.blocks[0]!.kind === block.kind) {
      open.blocks.push(block);
    } else {
      groups.push({ kind: isItem ? 'list' : 'one', blocks: [block] });
    }
  }
  return groups;
}

function List({ items }: { items: Block[] }): JSX.Element {
  const numbered = items[0]!.kind === 'number';
  const Tag = numbered ? 'ol' : 'ul';

  // The marker sits in a gutter of its own rather than inline, so a wrapped
  // item lines up under its own first word instead of under the bullet.
  return (
    <Tag className="space-y-0.5">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2">
          <span aria-hidden="true" className="w-4 shrink-0 text-right text-slate-500">
            {numbered ? `${item.ordinal}.` : '•'}
          </span>
          <span className="min-w-0 flex-1">
            <Inline block={item} />
          </span>
        </li>
      ))}
    </Tag>
  );
}

/**
 * Two sizes of heading, not six. A release note's own `##` and `###` are the
 * only levels that appear, and a changelog in a settings panel is not a
 * document that needs an outline - it needs the sections to be findable.
 */
const HEADING_CLASS: Record<number, string> = {
  1: 'mt-3 text-base font-semibold text-slate-100',
  2: 'mt-3 text-sm font-semibold text-slate-100',
};

function Piece({ block }: { block: Block }): JSX.Element {
  if (block.kind === 'heading') {
    const Tag = block.ordinal <= 2 ? 'h3' : 'h4';
    return (
      <Tag className={`${HEADING_CLASS[Math.min(block.ordinal, 2)]} first:mt-0`}>
        <Inline block={block} />
      </Tag>
    );
  }

  if (block.kind === 'code') {
    return (
      <pre className="overflow-x-auto rounded-md border border-edge bg-surface-950 px-3 py-2 font-mono text-xs text-slate-100">
        <code>{block.text}</code>
      </pre>
    );
  }

  if (block.kind === 'quote') {
    return (
      <blockquote className="whitespace-pre-wrap break-words border-l-[3px] border-edge pl-2.5 text-slate-400">
        <Inline block={block} />
      </blockquote>
    );
  }

  return (
    <p className="whitespace-pre-wrap break-words">
      <Inline block={block} />
    </p>
  );
}

/** A block's words, with its styles laid over them. */
function Inline({ block }: { block: Block }): JSX.Element {
  return (
    <>
      {styleRuns(block.text, block.spans).map((run, index) => (
        <Styled key={index} run={run} />
      ))}
    </>
  );
}

function Styled({ run }: { run: Run }): JSX.Element {
  let node: JSX.Element = run.styles.includes('code') ? (
    <code className="rounded bg-surface-950 px-1 py-0.5 font-mono text-[0.9em]">{run.text}</code>
  ) : (
    <>{run.text}</>
  );

  if (run.styles.includes('strike')) node = <del>{node}</del>;
  if (run.styles.includes('italic')) node = <em>{node}</em>;
  if (run.styles.includes('bold')) node = <strong className="font-semibold text-slate-100">{node}</strong>;
  return node;
}
