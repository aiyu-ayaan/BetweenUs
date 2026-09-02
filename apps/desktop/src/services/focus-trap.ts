/**
 * Keeping the keyboard inside a dialog, and putting it back afterwards.
 *
 * Twenty-two things in this client say `aria-modal="true"`, which is a promise
 * that everything behind them is inert. Nothing was enforcing it. Tab walked
 * straight out of an open dialog into the conversation underneath, focus was
 * never moved *into* the dialog when it opened, and closing one left the
 * keyboard wherever it happened to be rather than on the control that opened
 * it. Somebody using a mouse sees none of this; somebody using a screen reader
 * is told the page is blocked and then handed the page.
 *
 * ## The three things, and why each is separate
 *
 * **In on open.** A dialog nobody's focus is in is a dialog a screen reader
 * does not announce, and one Escape cannot reach if the handler is scoped.
 *
 * **Held while open.** This is the half `aria-modal` claims and cannot deliver;
 * the attribute is a hint to assistive technology and does nothing to the Tab
 * key.
 *
 * **Back on close.** The most-skipped of the three and the most disorienting
 * without: closing a dialog opened from a toolbar drops the keyboard at the top
 * of the document, so the next Tab starts the journey again.
 *
 * ## What this deliberately is not
 *
 * Not `inert` on the rest of the document, and not a rewrite onto the native
 * `<dialog showModal()>`, which would give all of this for free. Both are the
 * right answer for a client being written now; both are a change to
 * twenty-two components rather than one line added to each, and the trap is
 * what makes the claim already on those components true.
 */
import { useEffect, useRef, type RefObject } from 'react';

/**
 * Everything the Tab key can land on, in the order it would.
 *
 * `disabled` is excluded by the selector; `tabindex="-1"` is excluded because
 * it means "focusable but not tabbable", which is precisely the set Tab skips.
 * Anything not being rendered is dropped by the size test - a hidden panel
 * inside an open dialog would otherwise be a stop on a tour of nothing.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function focusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.offsetWidth > 0 || element.offsetHeight > 0 || element === document.activeElement,
  );
}

/**
 * Attach the returned ref to the element carrying `aria-modal="true"`.
 *
 * One hook and one `ref=` per dialog, which is the whole cost. `a11y.check.ts`
 * holds the pairing, because a dialog added next month with the attribute and
 * without the ref makes exactly the same silent promise these did.
 *
 * `active` is for the two panels that stay mounted while they are shut - the
 * mobile navigation drawer and the details sheet, which slide rather than
 * unmount. A trap that ran on those would hold the keyboard inside a drawer
 * nobody has opened. They also need `closedPanelProps`; the trap is only half
 * of what a still-mounted dialog gets wrong.
 */
export function useFocusTrap<T extends HTMLElement>(active = true): RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container || !active) return;

    // Where the keyboard was, so it can be put back. Read before anything is
    // focused, or the answer is the dialog itself.
    const returnTo = document.activeElement as HTMLElement | null;

    // A dialog with nothing focusable in it still has to be able to hold the
    // keyboard, or the trap has nowhere to send it.
    if (!container.hasAttribute('tabindex')) container.tabIndex = -1;

    if (!container.contains(document.activeElement)) {
      (focusable(container)[0] ?? container).focus();
    }

    /**
     * On the document and in the capture phase, not on the container: focus
     * that has already escaped - by a click on the page behind, or by a Tab
     * that got out before this mounted - would never reach a listener scoped to
     * the container, which is the one case the trap exists for.
     */
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const items = focusable(container);
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const focused = document.activeElement;
      const outside = !container.contains(focused);

      if (event.shiftKey ? focused === first || outside : focused === last || outside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // Only if it is still on the page. A dialog that closed because the row
      // that opened it was deleted has nothing to go back to, and focusing a
      // detached element silently drops the keyboard on `<body>`.
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [active]);

  return ref;
}

/**
 * What a dialog that stays in the DOM while it is shut has to say about itself.
 *
 * Two panels here slide off screen with `translate-x-full pointer-events-none`
 * rather than unmounting, and both kept `role="dialog"` and
 * `aria-modal="true"` the whole time - so a screen reader on a phone was told a
 * modal dialog was open, always, and every control inside a closed drawer was
 * still a Tab stop. `pointer-events-none` stops a mouse; it does nothing to a
 * keyboard.
 *
 * `inert` is the attribute that means both at once: out of the accessibility
 * tree and out of the focus order. It is not in React 18's typings, which is
 * why this is spread rather than written inline, and it is passed as `''`
 * because that is how a bare HTML boolean attribute is written.
 */
export function closedPanelProps(open: boolean): Record<string, unknown> {
  return open ? {} : { inert: '', 'aria-hidden': true };
}
