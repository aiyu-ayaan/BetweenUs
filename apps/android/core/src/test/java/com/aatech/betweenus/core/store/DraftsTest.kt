package com.aatech.betweenus.core.store

import com.aatech.betweenus.core.data.MessageReply
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The same cases as `apps/desktop/src/services/drafts.check.ts` for what is
 * pure: what counts as a draft, and what survives a round trip to disk.
 */
class DraftsTest {
    private val reply = MessageReply("m1", "Ayaan", "see you at eight")

    @Test
    fun nothingIsNotADraft() {
        assertNull(Drafts.kept("", null))
        // A space bar pressed in passing must not earn a label.
        assertNull(Drafts.kept("  \n ", null))
    }

    @Test
    fun textIsKeptExactlyAsTyped() {
        assertEquals(Draft("  hi  ", null), Drafts.kept("  hi  ", null))
    }

    @Test
    fun aReplyWithNoWordsIsStillADraft() {
        assertEquals(Draft("", reply), Drafts.kept("", reply))
    }

    @Test
    fun roundTripsThroughDisk() {
        val drafts = mapOf(
            "a" to Draft("from yesterday", reply),
            "b" to Draft("no reply", null),
        )
        assertEquals(drafts, Drafts.decode(Drafts.encode(drafts)))
    }

    @Test
    fun unreadableOrEmptyRowsAreDroppedNotThrown() {
        assertEquals(emptyMap<String, Draft>(), Drafts.decode("not json"))
        val stored = """{"a":{"text":"   ","replyTo":null},"b":{"text":"kept"}}"""
        assertEquals(mapOf("b" to Draft("kept", null)), Drafts.decode(stored))
    }
}
