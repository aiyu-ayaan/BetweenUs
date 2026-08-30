package com.aatech.betweenus.core.store

import com.aatech.betweenus.core.data.PresenceStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * The line under a name.
 *
 * The mirror of `apps/desktop/src/services/last-seen.check.ts`, case for case:
 * two clients in the same conversation must not disagree about when somebody
 * was last here.
 */
class LastSeenTest {
    /** Saturday 29 August 2026, 15:30. Fixed so a weekday case means something. */
    private val now = LocalDateTime.of(2026, 8, 29, 15, 30)

    /** UTC throughout, so the wire value and the rendered clock are the same. */
    private val zone: ZoneId = ZoneOffset.UTC

    private fun at(y: Int, m: Int, d: Int, h: Int = 12, min: Int = 0): String =
        LocalDateTime.of(y, m, d, h, min).toInstant(ZoneOffset.UTC).toString()

    private fun label(iso: String?) = LastSeen.label(iso, now, zone)

    // --- nothing to say ------------------------------------------------------

    @Test
    fun `never seen draws no line at all`() {
        assertNull(label(null))
        assertNull(label(""))
        assertNull(label("not a date"))
    }

    // --- every line carries the time -----------------------------------------

    @Test
    fun `every line says what time of day it was`() {
        // The whole point of the line: "yesterday" alone does not answer the
        // question anybody actually has about somebody who is not here.
        val moments = listOf(
            at(2026, 8, 29, 9, 14),
            at(2026, 8, 28, 23, 55),
            at(2026, 8, 24, 8, 5),
            at(2026, 8, 22, 19, 7),
            at(2025, 3, 4, 6, 30),
        )
        for (moment in moments) {
            assertTrue(moment, label(moment)?.contains(" at ") == true)
        }
    }

    @Test
    fun `a clock that runs fast does not report the future`() {
        // "last seen in four minutes" is not a sentence; it is clamped to now.
        assertEquals(label(at(2026, 8, 29, 15, 30)), label(at(2026, 8, 29, 15, 34)))
    }

    // --- today and yesterday name themselves ---------------------------------

    @Test
    fun `today and yesterday are named, by the calendar and not by the hour`() {
        assertTrue(label(at(2026, 8, 29, 9, 14))!!.startsWith("last seen today at "))
        assertTrue(label(at(2026, 8, 28, 23, 55))!!.startsWith("last seen yesterday at "))

        // Local midnight, not 24 hours: 00:05 today is today however few
        // minutes ago, and 20:00 last night is yesterday however recently.
        assertTrue(label(at(2026, 8, 29, 0, 5))!!.startsWith("last seen today at "))
        assertTrue(label(at(2026, 8, 28, 20, 0))!!.startsWith("last seen yesterday at "))
    }

    // --- the week just gone, then the date -----------------------------------

    @Test
    fun `a weekday only while it still names one day`() {
        assertTrue(label(at(2026, 8, 24))!!.startsWith("last seen Monday at "))

        // Seven days back is the same weekday as today, so it must not say
        // "Saturday" - that would name two days, one of them a week out.
        val week = label(at(2026, 8, 22))!!
        assertTrue(week, !week.contains("Saturday"))
        assertTrue(week, week.contains("August"))
        assertTrue(week, week.contains(" at "))
    }

    @Test
    fun `the year appears only when it is not this one`() {
        assertTrue(!label(at(2026, 3, 4))!!.contains("2026"))
        assertTrue(label(at(2025, 3, 4))!!.contains("2025"))
    }

    // --- status wins over the timestamp --------------------------------------

    @Test
    fun `somebody who is here is not somebody who was last seen`() {
        assertEquals("online", LastSeen.line(PresenceStatus.ONLINE, at(2026, 8, 24), now, zone))

        // The dot beside the name says idle; the line says whether a message
        // will be read now, and the answer to that is the same as for online.
        assertEquals("online", LastSeen.line(PresenceStatus.IDLE, at(2026, 8, 24), now, zone))
        assertEquals("online", LastSeen.line(PresenceStatus.DND, null, now, zone))
    }

    @Test
    fun `offline falls through to the timestamp, and to nothing without one`() {
        val line = LastSeen.line(PresenceStatus.OFFLINE, at(2026, 8, 28, 23, 55), now, zone)
        assertTrue(line!!.startsWith("last seen yesterday"))
        assertNull(LastSeen.line(PresenceStatus.OFFLINE, null, now, zone))
    }

    @Test
    fun `a heading raises the first letter and changes nothing else`() {
        assertEquals("Online", LastSeen.sentence(PresenceStatus.ONLINE, null, now, zone))
        assertTrue(
            LastSeen.sentence(PresenceStatus.OFFLINE, at(2026, 8, 28), now, zone)!!
                .startsWith("Last seen yesterday"),
        )
    }
}
