package com.aatech.betweenus.core.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same cases as `apps/desktop/src/features/chat/blocked-runs.check.ts`. */
class BlockedRunsTest {
    private fun say(id: String, author: String, kind: String = Message.KIND_USER) = Message(
        id = id,
        channelId = "c1",
        kind = kind,
        content = "",
        author = UserSummary(author, author, author, null),
        createdAt = "2026-09-26T10:00:00.000Z",
        editedAt = null,
        deletedAt = null,
        deletedBy = null,
        pinnedAt = null,
        reactions = emptyList(),
    )

    private val blocked = setOf("mallory")

    @Test
    fun `nobody blocked folds nothing`() {
        assertTrue(BlockedRuns.of(listOf(say("1", "mallory")), emptySet()).isEmpty())
    }

    @Test
    fun `one row per run, broken by somebody else`() {
        val runs = BlockedRuns.of(
            listOf(
                say("1", "alice"),
                say("2", "mallory"),
                say("3", "mallory"),
                say("4", "alice"),
                say("5", "mallory"),
            ),
            blocked,
        )
        assertFalse("1" in runs)
        assertEquals(BlockedRuns.Run("2", 2), runs["2"])
        assertEquals(runs["2"], runs["3"])
        assertEquals(BlockedRuns.Run("5", 1), runs["5"])
    }

    @Test
    fun `webhooks and arrivals never fold and break a run`() {
        val runs = BlockedRuns.of(
            listOf(
                say("a", "mallory"),
                say("b", "mallory", Message.KIND_WEBHOOK),
                say("c", "mallory", Message.KIND_MEMBER_JOIN),
                say("d", "mallory"),
            ),
            blocked,
        )
        assertFalse("b" in runs)
        assertFalse("c" in runs)
        assertEquals(BlockedRuns.Run("a", 1), runs["a"])
        assertEquals(BlockedRuns.Run("d", 1), runs["d"])
    }

    @Test
    fun `a run that grows keeps its head, so a reveal holds`() {
        val runs = BlockedRuns.of(listOf(say("5", "mallory"), say("6", "mallory")), blocked)
        assertEquals(BlockedRuns.Run("5", 2), runs["6"])
    }

    @Test
    fun `the label counts`() {
        assertEquals("Blocked message", BlockedRuns.label(1))
        assertEquals("3 blocked messages", BlockedRuns.label(3))
    }
}
