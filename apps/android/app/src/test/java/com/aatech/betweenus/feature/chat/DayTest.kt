package com.aatech.betweenus.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.Locale

/**
 * The message list's date dividers.
 *
 * The desktop's `day.check.ts` holds the same cases. If one of these ever has
 * to change, so does that one.
 */
class DayTest {

    private val today = LocalDate.of(2026, 8, 29) // Saturday

    /** A local timestamp, so the cases read as the reader's own clock does. */
    private fun at(y: Int, m: Int, d: Int, h: Int = 12, min: Int = 0): String =
        LocalDateTime.of(y, m, d, h, min).atZone(ZoneId.systemDefault()).toInstant().toString()

    @Test
    fun `the two days that get names`() {
        assertEquals("Today", dayLabel(at(2026, 8, 29, 9, 14), today))
        // Just past midnight is still today, wherever the server put it.
        assertEquals("Today", dayLabel(at(2026, 8, 29, 0, 5), today))
        assertEquals("Yesterday", dayLabel(at(2026, 8, 28, 23, 55), today))
    }

    @Test
    fun `a weekday for the week just gone`() {
        assertEquals("Monday", dayLabel(at(2026, 8, 24), today))
        assertEquals("Sunday", dayLabel(at(2026, 8, 23), today))
    }

    @Test
    fun `and the date once a weekday would name two days`() {
        val week = dayLabel(at(2026, 8, 22), today)
        assertFalse("a week back must not read as a weekday", week.contains("Saturday"))
        assertTrue(week.contains("2026"))
        assertTrue(dayLabel(at(2025, 3, 4), today).contains("2025"))
    }

    @Test
    fun `where the dividers go`() {
        assertTrue(sameDay(at(2026, 8, 29, 0, 1), at(2026, 8, 29, 23, 59)))
        // Two minutes apart either side of midnight: one run of messages to the
        // grouping rule, two days to the reader, and the divider says so.
        assertFalse(sameDay(at(2026, 8, 28, 23, 59), at(2026, 8, 29, 0, 1)))
    }

    @Test
    fun `the clock follows the device, not the locale`() {
        // The device's *Use 24-hour format* switch decides, whatever the locale
        // would have picked on its own: a reader whose phone says 14:32
        // everywhere else must not be shown 2:32 PM here, or the other way
        // round. The pattern is the locale's way of writing the one it is told.
        val us = Locale.US
        assertTrue(clockPattern(is24Hour = true, locale = us).contains("H"))
        assertFalse(clockPattern(is24Hour = true, locale = us).contains("a"))
        assertTrue(clockPattern(is24Hour = false, locale = us).contains("h"))
        assertTrue(clockPattern(is24Hour = false, locale = us).contains("a"))
        // A locale that is 24-hour by habit still answers the switch.
        val de = Locale.GERMANY
        assertTrue(clockPattern(is24Hour = false, locale = de).contains("h"))
        assertTrue(clockPattern(is24Hour = true, locale = de).contains("H"))
        // Minutes, always.
        assertTrue(clockPattern(is24Hour = true, locale = us).contains("mm"))
    }

    @Test
    fun `nonsense is not a day`() {
        assertEquals("", dayLabel("not a timestamp", today))
        assertFalse(sameDay("not a timestamp", at(2026, 8, 29)))
    }
}
