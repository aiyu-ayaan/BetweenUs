package com.aatech.betweenus.core.data

import java.time.Duration
import java.time.Instant

/**
 * The small rules a thread is drawn by, kept out of the composables so they can
 * be asserted on without a screen.
 *
 * The port of `apps/desktop/src/features/chat/thread.ts`; if one changes, so
 * does the other.
 */
object ThreadRules {
    /**
     * "N replies · last reply X ago", or null when there is no thread to point
     * at. A summary that counts nothing is a thread with nothing left to open,
     * and a "0 replies" chip is a button to an empty screen.
     */
    fun chipLabel(summary: ThreadSummary?, now: Instant = Instant.now()): String? {
        if (summary == null || summary.replyCount <= 0) return null
        val count = if (summary.replyCount == 1) "1 reply" else "${summary.replyCount} replies"
        val at = summary.lastReplyAt ?: return count
        val age = age(at, now)
        return if (age.isEmpty()) count else "$count · last reply $age"
    }

    /**
     * What the chip's unread badge says for a followed thread, or null for no
     * badge. Capped, because it sits in a chip. Desktop's `threadUnreadBadge`.
     */
    fun unreadBadge(unread: Int?): String? = when {
        unread == null || unread <= 0 -> null
        unread > 99 -> "99+"
        else -> unread.toString()
    }

    /** "just now", "5m ago", "3h ago", "2d ago" - short, because it sits in a chip. */
    fun age(iso: String, now: Instant = Instant.now()): String {
        val at = runCatching { Instant.parse(iso) }.getOrNull() ?: return ""
        val elapsed = Duration.between(at, now)
        // A phone clock a little behind the server's puts a fresh reply in the
        // future. "just now" is the honest answer; "-1m ago" is not.
        if (elapsed.toMinutes() < 1) return "just now"
        if (elapsed.toHours() < 1) return "${elapsed.toMinutes()}m ago"
        if (elapsed.toDays() < 1) return "${elapsed.toHours()}h ago"
        return "${elapsed.toDays()}d ago"
    }
}
