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

    /**
     * The followed replies waiting in one scope - a server, or (null) the
     * direct messages - for the drawer's and home's entry to the list. Roots
     * whose scope is not known yet count for nothing rather than for
     * everywhere.
     */
    fun scopeUnread(
        unread: Map<String, Int>,
        scopes: Map<String, String?>,
        scopeServerId: String?,
    ): Int = unread.entries.sumOf { (root, count) ->
        if (count > 0 && root in scopes && inScope(scopes[root], scopeServerId)) count else 0
    }

    /**
     * Whether a thread on screen should tell the server it has been read: only
     * with something unread, while the app is in front (a thread left open
     * behind the lock screen is not being read), and with no such write
     * already on its way.
     */
    fun shouldMarkSeen(unread: Int?, appVisible: Boolean, inFlight: Boolean): Boolean =
        (unread ?: 0) > 0 && appVisible && !inFlight

    /** The toggle's words. */
    fun followLabel(following: Boolean): String = if (following) "Unfollow" else "Follow"

    /**
     * A line to recognise a followed thread's root by: what was said, else the
     * file, else how many files. Desktop's `preview` in FollowedThreadsPanel.
     */
    fun rootPreview(deleted: Boolean, text: String, attachmentNames: List<String>): String = when {
        deleted -> "Original message deleted"
        text.isNotBlank() -> text.trim()
        attachmentNames.size == 1 -> attachmentNames[0].ifBlank { "Attachment" }
        attachmentNames.size > 1 -> "${attachmentNames.size} attachments"
        else -> "Empty message"
    }

    /**
     * Whether a followed thread belongs to the list on screen: a server's, or -
     * at home, where the server cannot filter for "no server" - the direct
     * messages'.
     */
    fun inScope(threadServerId: String?, scopeServerId: String?): Boolean =
        threadServerId == scopeServerId

    /**
     * The rows still followed, in the order they arrived in. Unfollowed
     * elsewhere drops out at once; the order is the server's as of the load.
     */
    fun stillFollowed(rootIds: List<String>, following: Set<String>): List<String> =
        rootIds.filter { it in following }

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
