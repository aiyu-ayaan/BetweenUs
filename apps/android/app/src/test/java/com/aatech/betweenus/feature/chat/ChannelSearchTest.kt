package com.aatech.betweenus.feature.chat

import com.aatech.betweenus.core.data.Message
import com.aatech.betweenus.core.data.MessageBody
import com.aatech.betweenus.core.data.UserSummary
import com.aatech.betweenus.core.store.ReadableMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The same cases as the desktop's `SearchPanel`, which is where the rules were
 * decided: a floor on the term, deleted rows skipped, the newest matches first,
 * and a snippet that contains what was typed.
 *
 * Worth pinning because every one of them fails silently. A search that ranks
 * oldest-first still returns results; one that matches a tombstone offers a jump
 * to a message that is not there; a snippet taken from the front of a long body
 * shows a result with no visible reason for being a result.
 */
class ChannelSearchTest {

    private fun readable(
        id: String,
        text: String,
        deletedAt: String? = null,
    ) = ReadableMessage(
        message = Message(
            id = id,
            channelId = "c1",
            content = "",
            author = UserSummary("ana", "ana", "Ana", null),
            createdAt = "2026-01-01T10:00:00.000Z",
            editedAt = null,
            deletedAt = deletedAt,
            deletedBy = null,
            pinnedAt = null,
            reactions = emptyList(),
        ),
        body = MessageBody(text = text),
    )

    private val history = listOf(
        readable("m1", "shall we ship it on Friday"),
        readable("m2", "the SHIPPING address is wrong"),
        readable("m3", "nothing to do with it"),
        readable("m4", "ship", deletedAt = "2026-01-02T10:00:00.000Z"),
    )

    @Test
    fun `a term shorter than the floor matches nothing at all`() {
        // Not "everything": one character matches most of a channel, and a
        // list of every message is not an answer to a search.
        assertEquals(emptyList<ReadableMessage>(), searchMessages(history, "s"))
        assertEquals(emptyList<ReadableMessage>(), searchMessages(history, ""))
        assertEquals(emptyList<ReadableMessage>(), searchMessages(history, "   "))
    }

    @Test
    fun `matching is case-insensitive and on any part of the word`() {
        assertEquals(
            listOf("m2", "m1"),
            searchMessages(history, "SHIP").map { it.id },
        )
    }

    @Test
    fun `a deleted message never matches`() {
        // Its body is empty and the row is a tombstone; jumping to it lands on
        // "this message was deleted", which is not what was searched for.
        assertTrue(searchMessages(history, "ship").none { it.id == "m4" })
    }

    @Test
    fun `results are newest first, and capped`() {
        val many = (1..150).map { readable("m$it", "ship number $it") }
        val found = searchMessages(many, "ship")
        assertEquals(SEARCH_LIMIT, found.size)
        // The last hundred, newest first - so the most recent match is at the
        // top and the ones dropped are the oldest.
        assertEquals("m150", found.first().id)
        assertEquals("m51", found.last().id)
    }

    @Test
    fun `the snippet contains the term, wherever it is in the body`() {
        val near = "ship it on Friday"
        assertEquals(near, searchSnippet(near, "ship"))

        val far = "x".repeat(300) + "ship it on Friday"
        val snippet = searchSnippet(far, "ship")
        assertTrue("the snippet should carry the term", snippet.contains("ship"))
        assertTrue("a trimmed snippet says it was trimmed", snippet.startsWith("…"))
    }

    @Test
    fun `a term at the very end of a long body still lands inside the snippet`() {
        // The bound that is easy to get wrong: `at + 120` runs past the end.
        val text = "y".repeat(200) + "ship"
        assertTrue(searchSnippet(text, "ship").contains("ship"))
    }
}
