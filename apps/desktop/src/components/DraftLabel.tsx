/**
 * The quiet "Draft" beside a channel or conversation with unsent text in it.
 *
 * Deliberately smaller and greyer than an unread badge, and drawn only where
 * there is no badge: a draft is a note to self, not something asking for
 * attention - and unread messages are the better reason to open the channel.
 */
export function DraftLabel(): JSX.Element {
  return (
    <span className="ms-auto shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
      Draft
      <span className="sr-only"> unsent message</span>
    </span>
  );
}
