package com.aatech.betweenus.feature.status

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Duration
import java.time.Instant

/** The boundaries of [statusAge], and the clock that runs fast. */
class StatusAgeTest {

    private val now: Instant = Instant.parse("2026-09-03T12:00:00Z")

    private fun ago(duration: Duration): String = now.minus(duration).toString()

    @Test
    fun `the first minute is just now`() {
        assertEquals("just now", statusAge(ago(Duration.ZERO), now))
        assertEquals("just now", statusAge(ago(Duration.ofSeconds(59)), now))
    }

    @Test
    fun `minutes, then hours`() {
        assertEquals("1m ago", statusAge(ago(Duration.ofMinutes(1)), now))
        assertEquals("59m ago", statusAge(ago(Duration.ofMinutes(59)), now))
        assertEquals("1h ago", statusAge(ago(Duration.ofHours(1)), now))
        assertEquals("23h ago", statusAge(ago(Duration.ofHours(23)), now))
    }

    @Test
    fun `a phone clock behind the server reads as just now, never as negative`() {
        assertEquals("just now", statusAge(now.plusSeconds(5).toString(), now))
    }

    @Test
    fun `something that is not a timestamp draws nothing`() {
        assertEquals("", statusAge("not a date", now))
    }
}
