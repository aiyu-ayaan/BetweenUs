/**
 * Mention query extraction for composer autocompletion.
 *
 * Detects whether the caret in a message composer is currently situated at or
 * within an `@mention` query, extracting the typed search term and the start
 * index of the `@` token.
 */

export interface MentionQuery {
  /** The text typed after '@' up to the caret. Can be empty when caret is immediately after '@'. */
  term: string;
  /** 0-based character index where the '@' character begins. */
  start: number;
}

/** Allowed characters in mention usernames / handles: letters, digits, underscores, dots, and hyphens. */
const VALID_TERM_PATTERN = /^[a-z0-9_.-]*$/i;

/**
 * Inspects `text` at cursor position `caret` to determine if a mention is being typed.
 *
 * Scans backward from `caret` in `text` to find the nearest `@`.
 * The character immediately before `@` must be start-of-string or whitespace (`/\s/`).
 * If it is alphanumeric or punctuation (e.g. `test@example.com`), returns `null`.
 *
 * If `term` contains whitespace or invalid characters, returns `null`.
 * Otherwise returns `{ term, start }`.
 */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  if (typeof text !== 'string' || caret <= 0 || caret > text.length) {
    return null;
  }

  const preceding = text.slice(0, caret);
  const at = preceding.lastIndexOf('@');
  if (at === -1) {
    return null;
  }

  // The character immediately before `@` must be start-of-string or whitespace.
  if (at > 0) {
    const charBefore = text[at - 1];
    if (!charBefore || !/\s/.test(charBefore)) {
      return null;
    }
  }

  const term = preceding.slice(at + 1);

  // If term contains whitespace or newline, it is not a valid mention query.
  if (/\s/.test(term)) {
    return null;
  }

  // Term must consist only of allowed username characters.
  if (!VALID_TERM_PATTERN.test(term)) {
    return null;
  }

  return {
    term,
    start: at,
  };
}
