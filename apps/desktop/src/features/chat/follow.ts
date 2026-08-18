/**
 * Whether the message list is still following the newest message.
 *
 * This used to be one line in the scroll handler: "following" meant the bottom
 * of the content was within a slack of the bottom of the viewport, recomputed
 * on every scroll event. That reads as obviously right and is the bug, because
 * it answers a different question from the one being asked. The question is
 * "has the reader gone somewhere else"; that rule answers "is the bottom of the
 * list near the bottom of the screen", and those two come apart the moment
 * anything moves that the reader did not move.
 *
 * Attachments are exactly that. A picture is ciphertext until it has been
 * fetched and decrypted, so a row is laid out at one height and becomes three
 * hundred pixels taller a moment later - and the bottom of the list is suddenly
 * far away without a single scroll having happened. Same for the viewport
 * itself: a typing indicator appearing, or the composer growing a preview of
 * the photo about to be sent, makes the viewport shorter under a scroll
 * position that has not changed.
 *
 * So following is a latch, and only the reader may release it: it goes off when
 * they scroll up and away, and back on when they come back to the bottom. What
 * the content does underneath them never touches it.
 */

/** The three numbers the rule needs. `HTMLElement` satisfies this. */
export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** How far off the bottom still counts as reading the newest message. */
export const FOLLOW_SLACK_PX = 120;

/**
 * The next state of the latch.
 *
 * `previousTop` is the scroll position at the previous event: scrolling *up* is
 * the one thing content growing underneath cannot do, which is what makes it a
 * usable signal for "the reader went somewhere else".
 */
export function nextFollow(following: boolean, previousTop: number, box: ScrollBox): boolean {
  // At the bottom, however it got there - a fling, a jump, or the list putting
  // itself back after a row grew.
  if (box.scrollHeight - box.scrollTop - box.clientHeight < FOLLOW_SLACK_PX) return true;
  // Away from the bottom because the reader scrolled up.
  if (box.scrollTop < previousTop) return false;
  // Away from the bottom because something grew. Not the reader's doing, so not
  // the reader's decision.
  return following;
}
