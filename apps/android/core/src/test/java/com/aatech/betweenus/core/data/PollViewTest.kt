package com.aatech.betweenus.core.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The poll card's numbers and the poll body encoding, checked against the
 * desktop's `polls.check.ts` and `message-body.check.ts` case for case.
 */
class PollViewTest {

    private val now = java.time.Instant.parse("2026-09-22T12:00:00.000Z").toEpochMilli()

    private val poll = MessagePoll(
        optionCount = 3,
        multiChoice = true,
        closesAt = null,
        closedAt = null,
        closedBy = null,
        tallies = listOf(
            PollTally(0, listOf("me", "ada")),
            PollTally(1, listOf("me")),
            PollTally(2, emptyList()),
        ),
    )

    @Test
    fun `percent is of people, not of ballots`() {
        val view = poll.view(listOf("Pizza", "Ramen", "Salad"), "me", now)
        assertEquals(2, view.voters)
        assertEquals(listOf(100, 50, 0), view.bars.map { it.percent })
        assertEquals(listOf(true, true, false), view.bars.map { it.mine })
        assertEquals(listOf(0, 1), view.mine)
    }

    @Test
    fun `no votes is no division by zero`() {
        val view = poll.copy(tallies = emptyList()).view(listOf("a", "b", "c"), "me", now)
        assertTrue(view.bars.all { it.percent == 0 && it.count == 0 })
    }

    @Test
    fun `a missing label is named rather than dropped`() {
        assertEquals("Option 3", poll.view(listOf("Pizza"), "me", now).bars[2].label)
    }

    @Test
    fun `tapping moves a single-choice vote and toggles a multi-choice one`() {
        fun single(mine: List<Int>) = PollView(emptyList(), 0, false, false, mine)
        fun multi(mine: List<Int>) = PollView(emptyList(), 0, false, true, mine)
        assertEquals(listOf(1), single(emptyList()).ballotAfter(1))
        assertEquals(listOf(2), single(listOf(1)).ballotAfter(2))
        assertEquals(emptyList<Int>(), single(listOf(1)).ballotAfter(1))
        assertEquals(listOf(0, 2), multi(listOf(2)).ballotAfter(0))
        assertEquals(listOf(0), multi(listOf(0, 2)).ballotAfter(2))
    }

    @Test
    fun `an explicit close and a passed closesAt both close it`() {
        assertFalse(poll.isClosed(now))
        assertTrue(poll.copy(closedAt = "2026-09-22T11:00:00.000Z").isClosed(now))
        assertTrue(poll.copy(closesAt = "2026-09-22T11:59:00.000Z").isClosed(now))
        assertFalse(poll.copy(closesAt = "2026-09-22T12:00:01.000Z").isClosed(now))
    }

    @Test
    fun `a poll body round-trips and its question is the text`() {
        val body = MessageBody("Lunch?", pollOptions = listOf("Pizza", "Ramen"))
        val encoded = body.encode()
        assertTrue(encoded.startsWith("\u0000"))
        assertEquals(body, MessageBody.decode(encoded))
    }

    @Test
    fun `a damaged label list is dropped rather than drawn under the wrong words`() {
        for (options in listOf("[\"one\"]", "\"ab\"", "[" + List(11) { "\"x\"" }.joinToString(",") + "]")) {
            val raw = "${MessageBody.BODY_MARKER}{\"text\":\"q\",\"attachments\":[],\"poll\":{\"options\":$options}}"
            assertNull(options, MessageBody.decode(raw).pollOptions)
        }
    }

    @Test
    fun `the referee's wire shape parses into a message`() {
        val json = org.json.JSONObject(
            """{"optionCount":2,"multiChoice":false,"closesAt":null,"closedAt":null,"closedBy":null,
               "tallies":[{"option":0,"userIds":["ada"]},{"option":1,"userIds":[]}]}""",
        )
        val parsed = MessagePoll.from(json)
        assertEquals(2, parsed.optionCount)
        assertEquals(listOf("ada"), parsed.tallies[0].userIds)
        assertNull(parsed.closedAt)
    }
}
