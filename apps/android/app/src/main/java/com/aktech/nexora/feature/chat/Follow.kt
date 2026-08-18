package com.aktech.nexora.feature.chat

/**
 * Whether the message list is still following the conversation.
 *
 * This used to be a `derivedStateOf` over the layout: following meant the last
 * message's bottom was within a slack of the bottom of the viewport, recomputed
 * every time anything moved. That reads as obviously right and is the bug,
 * because it answers a different question from the one being asked. The
 * question is "has the reader gone somewhere else"; that rule answers "is the
 * end of the list near the bottom of the screen", and the two come apart the
 * moment something moves that the reader did not move.
 *
 * With end-to-end encryption something always does. A picture is ciphertext
 * until it has been fetched and decrypted, so its row is laid out at one height
 * and becomes three hundred dp taller a moment later. That pushes the last
 * message below the viewport - so the old rule decided the reader had scrolled
 * away, and the correction that exists precisely to handle growth read the flag
 * it had just turned off and did nothing. The list stopped wherever the growth
 * left it, which is what "the chat does not open at the bottom" was.
 *
 * So following is a latch, and only the reader may release it. The desktop's
 * `follow.ts` is the same rule against a scroll position; this is it against a
 * `LazyListState`, and the two agree case for case.
 */

/** How far off the bottom still counts as reading the newest message, in pixels. */
internal const val FOLLOW_SLACK_PX = 120

/**
 * The next state of the latch.
 *
 * `scrolledUp` is the reader's own doing - content growing underneath can push
 * the end of the list away, but it cannot move the list *up* - which is what
 * makes it the one usable signal for "they went somewhere else".
 */
internal fun nextFollow(following: Boolean, scrolledUp: Boolean, gapPx: Int): Boolean = when {
    // At the end, however it got there: a fling, a jump, or the list putting
    // itself back after a row grew.
    gapPx < FOLLOW_SLACK_PX -> true
    // Away from the end because the reader scrolled up.
    scrolledUp -> false
    // Away from the end because something grew. Not the reader's doing, so not
    // the reader's decision.
    else -> following
}

/**
 * How far the bottom of the newest message is past the bottom of the viewport.
 *
 * `Int.MAX_VALUE` when the newest message is not on screen at all: there is no
 * measuring a row that has not been laid out, and "somewhere above" is as far
 * from the end as it needs to be.
 */
internal fun bottomGap(
    lastVisibleIndex: Int,
    lastVisibleBottom: Int,
    totalItems: Int,
    viewportEnd: Int,
): Int = if (lastVisibleIndex < totalItems - 1) Int.MAX_VALUE else lastVisibleBottom - viewportEnd

/**
 * Whether the list moved towards the start of the conversation.
 *
 * A `LazyListState` has no absolute scroll offset - it has the first visible
 * item and how far into it the viewport begins - so "up" is those two read in
 * order, the way a page number and a line number are.
 */
internal fun scrolledUp(previous: Pair<Int, Int>, current: Pair<Int, Int>): Boolean =
    current.first < previous.first ||
        (current.first == previous.first && current.second < previous.second)
