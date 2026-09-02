/**
 * The keyboard shortcuts this client actually has.
 *
 * One list, in one place, for two readers: the sheet that shows them to a
 * person, and whoever adds the next one. A shortcut whose only record is the
 * `keydown` handler that implements it is a shortcut nobody finds - which is
 * how a desktop app ends up with bindings its own users have never pressed.
 *
 * The list is deliberately honest about how short it is. `Ctrl+K` was for a
 * long time the only global binding in the app, on the reasoning that
 * everything else is reachable from it; that is a defensible position for
 * navigation and not one for the rest, and this file is where the argument gets
 * had from now on rather than in a component.
 */

export interface Shortcut {
  /** The keys, already written the way they are read: `Ctrl K`, `Shift ?`. */
  keys: string[];
  what: string;
  /** Where it works. Shown so a binding that is not global does not look broken. */
  where: 'Anywhere' | 'In a conversation' | 'In a call';
}

/**
 * `Ctrl` on Windows and Linux, `⌘` on a Mac.
 *
 * Both are accepted by every handler - the check is `ctrlKey || metaKey` - so
 * this only decides which one to *print*. Getting it backwards is the kind of
 * detail that makes a shortcut sheet feel written by somebody who does not use
 * the platform.
 */
export function commandKey(platform: string = navigator?.platform ?? ''): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘' : 'Ctrl';
}

export function shortcuts(command: string = commandKey()): Shortcut[] {
  return [
    {
      keys: [command, 'K'],
      what: 'Go to a server, channel or conversation',
      where: 'Anywhere',
    },
    {
      keys: ['?'],
      what: 'Show this list',
      where: 'Anywhere',
    },
    {
      keys: [command, 'F'],
      what: 'Search this conversation',
      where: 'In a conversation',
    },
    {
      keys: ['Enter'],
      what: 'Send',
      where: 'In a conversation',
    },
    {
      keys: ['Shift', 'Enter'],
      what: 'A new line, without sending',
      where: 'In a conversation',
    },
    {
      keys: ['F'],
      what: 'Full screen, and back',
      where: 'In a call',
    },
    {
      keys: ['Esc'],
      what: 'Close whatever is open',
      where: 'Anywhere',
    },
  ];
}

/**
 * Whether a keystroke is somebody typing rather than reaching for a shortcut.
 *
 * The rule every unmodified binding needs and the one that is easy to get
 * wrong: `F` toggles full screen in a call, and without this it also does so
 * in the middle of a word. `contentEditable` counts, because a rich composer is
 * not an `<input>`.
 *
 * A binding with a modifier does not ask - `Ctrl+K` while typing is a person
 * who wants the switcher - which is why this takes the event rather than only
 * the target.
 */
export function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
}

/**
 * Whether this event should open the shortcut sheet.
 *
 * `?` is `Shift+/` on most layouts and its own key on others, so the character
 * is what is read rather than a key code. Never while typing: a question mark
 * in a message is a question mark.
 */
export function opensShortcutSheet(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (isTyping(event.target)) return false;
  return event.key === '?';
}
