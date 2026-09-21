/**
 * The two marks that draw as more than a font change: a spoiler, which hides
 * its words until it is clicked, and a fenced code block, which is coloured by
 * the language its fence named.
 *
 * Both are client-only. The body arrives already decrypted and `markup.ts` has
 * already found the marks; nothing here goes near the network, which is the
 * point - a spoiler that asked the server whether it had been revealed would
 * tell the server which messages somebody bothered to open.
 */
import React, { createContext, useCallback, useContext, useMemo, useState, type KeyboardEvent } from 'react';
import { tokenize, type TokenKind } from '../../services/syntax';

interface SpoilerState {
  revealed: boolean;
  reveal: () => void;
}

/**
 * Outside a message - the composer's preview, a check - a spoiler has nobody
 * to remember it for, so it starts hidden and stays that way until clicked.
 */
const SpoilerContext = createContext<SpoilerState | null>(null);

/**
 * Which messages have had their spoilers opened, for as long as this window
 * lives.
 *
 * Kept outside React because the message list unmounts a row that scrolls far
 * enough away, and a spoiler that folded itself back up every time somebody
 * scrolled past it would be clicked a dozen times. Deliberately not written
 * anywhere that outlives the window: coming back tomorrow to a thread you have
 * forgotten, the spoiler should be a spoiler again.
 */
const revealedMessages = new Set<string>();

/**
 * One message's spoilers, revealed together.
 *
 * A message is the unit because it is what somebody decides to read: the
 * second spoiler in a line you have just opened the first of is not a
 * surprise worth a second click.
 */
export function SpoilerScope({
  messageId,
  children,
}: {
  messageId: string;
  children?: React.ReactNode;
}): JSX.Element {
  const [revealed, setRevealed] = useState(() => revealedMessages.has(messageId));
  const reveal = useCallback(() => {
    revealedMessages.add(messageId);
    setRevealed(true);
  }, [messageId]);
  const value = useMemo(() => ({ revealed, reveal }), [revealed, reveal]);
  return <SpoilerContext.Provider value={value}>{children}</SpoilerContext.Provider>;
}

/**
 * The words of a `||spoiler||`.
 *
 * Hidden with `invisible` rather than transparent text, so an emoji or a link
 * inside it is hidden too and cannot be clicked through the cover - and a
 * screen reader hears the label rather than the words it is not meant to have
 * read out yet.
 */
export function Spoiler({ children }: { children?: React.ReactNode }): JSX.Element {
  const scope = useContext(SpoilerContext);
  const [ownRevealed, setOwnRevealed] = useState(false);
  const revealed = scope ? scope.revealed : ownRevealed;

  if (revealed) {
    return <span className="rounded bg-slate-500/20 px-0.5">{children}</span>;
  }

  const reveal = (): void => {
    if (scope) scope.reveal();
    else setOwnRevealed(true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    reveal();
  };

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="Spoiler, press to reveal"
      title="Spoiler - click to reveal"
      onClick={(event) => {
        // The row behind it opens menus and jumps on a click of its own.
        event.stopPropagation();
        reveal();
      }}
      onKeyDown={onKeyDown}
      className="cursor-pointer select-none rounded bg-slate-500 px-0.5 transition-colors hover:bg-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span aria-hidden="true" className="invisible">
        {children}
      </span>
    </span>
  );
}

/**
 * The class each token is coloured with. The colours themselves live in
 * `index.css`, mixed from the theme's own text colour so they read on every
 * one of the light and dark themes without sixteen palettes of their own.
 */
export const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: '',
  keyword: 'syntax-keyword',
  literal: 'syntax-literal',
  string: 'syntax-string',
  number: 'syntax-number',
  comment: 'syntax-comment',
};

/** A fenced block, coloured when its fence named a language this knows. */
export function CodeBlock({ code, lang }: { code: string; lang: string }): JSX.Element {
  const tokens = useMemo(() => tokenize(code, lang), [code, lang]);

  return (
    <pre
      className="my-1 overflow-x-auto rounded-md border border-edge bg-surface-950 px-3 py-2 font-mono text-sm text-slate-100"
      data-lang={lang || undefined}
    >
      <code>
        {tokens.map((token, index) =>
          token.kind === 'plain' ? (
            <React.Fragment key={index}>{token.text}</React.Fragment>
          ) : (
            <span key={index} className={TOKEN_CLASS[token.kind]}>
              {token.text}
            </span>
          ),
        )}
      </code>
    </pre>
  );
}
