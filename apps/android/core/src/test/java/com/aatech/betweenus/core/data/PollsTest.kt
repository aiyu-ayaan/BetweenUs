package com.aatech.betweenus.core.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the poll composer lets through, and what it seals. The same cases as
 * the desktop's `polls.check.ts` for `readyPoll`.
 */
class PollsTest {

    private fun refused(result: PollReady) = (result as PollReady.Refused).reason

    @Test
    fun `a question and two options are ready, trimmed, with empty rows dropped`() {
        assertEquals(
            PollReady.Ok("Lunch?", listOf("Pizza", "Soup")),
            Polls.ready("  Lunch? ", listOf(" Pizza ", "", "Soup", "   ")),
        )
    }

    @Test
    fun `no question, one option, too many options and duplicates are refused`() {
        assertEquals("Ask a question", refused(Polls.ready("  ", listOf("a", "b"))))
        assertEquals("Give at least 2 options", refused(Polls.ready("Q", listOf("a", ""))))
        assertEquals(
            "A poll has at most 10 options",
            refused(Polls.ready("Q", (1..11).map { "o$it" })),
        )
        assertEquals("Two options say the same thing", refused(Polls.ready("Q", listOf("Yes", "yes "))))
    }

    @Test
    fun `the word limits are the desktop's`() {
        assertTrue(Polls.ready("q".repeat(301), listOf("a", "b")) is PollReady.Refused)
        assertTrue(Polls.ready("q".repeat(300), listOf("a", "b")) is PollReady.Ok)
        assertTrue(Polls.ready("Q", listOf("a".repeat(81), "b")) is PollReady.Refused)
    }

    @Test
    fun `the durations are exactly the ones the server takes`() {
        assertEquals(listOf(null, 3600, 86400, 259200, 604800), Polls.DURATIONS.map { it.seconds })
    }

    @Test
    fun `the settings carry numbers only and an open-ended poll sends an explicit null`() {
        val json = PollSettings(optionCount = 3, multiChoice = true, durationSeconds = null).toJson()
        assertEquals(setOf("optionCount", "multiChoice", "durationSeconds"), json.keys().asSequence().toSet())
        assertEquals(3, json.getInt("optionCount"))
        assertTrue(json.getBoolean("multiChoice"))
        assertTrue(json.isNull("durationSeconds"))
        assertEquals(86400, PollSettings(2, false, 86400).toJson().getInt("durationSeconds"))
    }

    @Test
    fun `the labels ride inside the sealed body beside the question`() {
        val body = MessageBody(text = "Lunch?", pollOptions = listOf("Pizza", "Soup"))
        val decoded = MessageBody.decode(body.encode())
        assertEquals("Lunch?", decoded.text)
        assertEquals(listOf("Pizza", "Soup"), decoded.pollOptions)
    }
}
