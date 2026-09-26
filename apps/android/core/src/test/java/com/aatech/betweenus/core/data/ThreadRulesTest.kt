package com.aatech.betweenus.core.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * The same cases as `apps/desktop/src/features/chat/thread.check.ts`.
 */
class ThreadRulesTest {
    private val now = Instant.parse("2026-09-22T12:00:00.000Z")
    private fun ago(seconds: Long): String = now.minusSeconds(seconds).toString()

    @Test
    fun `no thread means no chip`() {
        assertNull(ThreadRules.chipLabel(null, now))
        assertNull(ThreadRules.chipLabel(ThreadSummary(0, null), now))
    }

    @Test
    fun `the chip counts and dates the replies`() {
        assertEquals(
            "1 reply · last reply 5m ago",
            ThreadRules.chipLabel(ThreadSummary(1, ago(300)), now),
        )
        assertEquals(
            "12 replies · last reply 3h ago",
            ThreadRules.chipLabel(ThreadSummary(12, ago(3 * 3600)), now),
        )
        assertEquals("2 replies", ThreadRules.chipLabel(ThreadSummary(2, null), now))
    }

    @Test
    fun `ages read like the desktop`() {
        assertEquals("just now", ThreadRules.age(ago(10), now))
        assertEquals("just now", ThreadRules.age(ago(-5), now))
        assertEquals("2d ago", ThreadRules.age(ago(2 * 86_400), now))
        assertEquals("", ThreadRules.age("not a date", now))
    }

    @Test
    fun `a thread reply and its summary survive the cache`() {
        val author = UserSummary("u1", "ada", "Ada", null)
        val reply = Message(
            id = "m2",
            channelId = "c1",
            content = "sealed",
            author = author,
            createdAt = "2026-09-22T11:00:00.000Z",
            editedAt = null,
            deletedAt = null,
            deletedBy = null,
            pinnedAt = null,
            reactions = emptyList(),
            threadRootId = "m1",
        )
        val back = Message.from(reply.toJson())
        assertTrue(back.isThreadReply)
        assertEquals("m1", back.threadRootId)

        val root = reply.copy(id = "m1", threadRootId = null, thread = ThreadSummary(3, "2026-09-22T11:30:00.000Z"))
        val rootBack = Message.from(root.toJson())
        assertFalse(rootBack.isThreadReply)
        assertEquals(ThreadSummary(3, "2026-09-22T11:30:00.000Z"), rootBack.thread)

        // A row from a server that has never heard of threads.
        val old = Message.from(reply.toJson().apply { remove("threadRootId") })
        assertFalse(old.isThreadReply)
        assertNull(old.thread)
    }

    @Test
    fun `the unread badge is for a followed thread with something new`() {
        assertNull(ThreadRules.unreadBadge(null))
        assertNull(ThreadRules.unreadBadge(0))
        assertEquals("4", ThreadRules.unreadBadge(4))
        assertEquals("99+", ThreadRules.unreadBadge(250))
    }

    @Test
    fun `the toggle says what tapping it would do`() {
        assertEquals("Unfollow", ThreadRules.followLabel(true))
        assertEquals("Follow", ThreadRules.followLabel(false))
    }

    @Test
    fun `a root is recognised by its words, then its file, then its file count`() {
        assertEquals("Original message deleted", ThreadRules.rootPreview(true, "hi", listOf("a.png")))
        assertEquals("hi", ThreadRules.rootPreview(false, "  hi ", listOf("a.png")))
        assertEquals("a.png", ThreadRules.rootPreview(false, "", listOf("a.png")))
        assertEquals("Attachment", ThreadRules.rootPreview(false, " ", listOf("")))
        assertEquals("2 attachments", ThreadRules.rootPreview(false, "", listOf("a", "b")))
        assertEquals("Empty message", ThreadRules.rootPreview(false, "", emptyList()))
    }

    @Test
    fun `a list is one server's, or the direct messages' at home`() {
        assertTrue(ThreadRules.inScope("s1", "s1"))
        assertFalse(ThreadRules.inScope("s2", "s1"))
        assertTrue(ThreadRules.inScope(null, null))
        assertFalse(ThreadRules.inScope("s1", null))
        assertFalse(ThreadRules.inScope(null, "s1"))
    }

    @Test
    fun `an unfollowed thread drops out and the order holds`() {
        assertEquals(
            listOf("c", "a"),
            ThreadRules.stillFollowed(listOf("c", "b", "a"), setOf("a", "c")),
        )
    }

    @Test
    fun `a follow state reads off the wire`() {
        val state = ThreadFollowState.from(
            org.json.JSONObject()
                .put("rootId", "r1")
                .put("channelId", "c1")
                .put("serverId", org.json.JSONObject.NULL)
                .put("following", true)
                .put("unreadCount", 3),
        )
        assertEquals("r1", state.rootId)
        assertNull(state.serverId)
        assertTrue(state.following)
        assertEquals(3, state.unreadCount)
    }
}
