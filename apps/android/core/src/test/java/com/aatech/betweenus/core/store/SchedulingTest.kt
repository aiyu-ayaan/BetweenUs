package com.aatech.betweenus.core.store

import com.aatech.betweenus.core.store.Scheduling.Kind
import com.aatech.betweenus.core.store.Scheduling.Preset
import com.aatech.betweenus.core.store.Scheduling.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * Scheduled sends and reminders.
 *
 * The mirror of `apps/desktop/src/services/schedule.check.ts`: two clients must
 * not disagree about what "tomorrow morning" or "late" means.
 */
class SchedulingTest {
    private val zone: ZoneId = ZoneId.of("Europe/Berlin")
    private val minute = 60_000L

    private fun local(y: Int, m: Int, d: Int, h: Int = 0, min: Int = 0): Long =
        LocalDateTime.of(y, m, d, h, min).atZone(zone).toInstant().toEpochMilli()

    /** Wednesday 23 September 2026, 14:07:30. */
    private val now = local(2026, 9, 23, 14, 7) + 30_000

    private fun message(
        id: String = "s1",
        dueAt: Long = now + 10 * minute,
        attempts: Int = 0,
        retryAt: Long? = null,
        error: String? = null,
    ) = Scheduling.Item(
        kind = Kind.MESSAGE, id = id, channelId = "c1", channelName = "general", serverId = "v1",
        dueAt = dueAt, createdAt = now, text = "good morning",
        attempts = attempts, retryAt = retryAt, error = error,
    )

    private fun reminder(dueAt: Long = now + 20 * minute) = Scheduling.Item(
        kind = Kind.REMINDER, id = "r1", channelId = "c1", channelName = "Ada", serverId = null,
        dueAt = dueAt, createdAt = now, messageId = "m1", author = "Ada", excerpt = "the numbers are in",
    )

    @Test
    fun `relative presets round up to the whole minute`() {
        assertEquals(local(2026, 9, 23, 14, 38), Scheduling.resolve(Preset.IN_30_MINUTES, now, zone))
        assertEquals(local(2026, 9, 23, 14, 28), Scheduling.resolve(Preset.IN_20_MINUTES, now, zone))
        assertEquals(local(2026, 9, 23, 15, 8), Scheduling.resolve(Preset.IN_1_HOUR, now, zone))
        assertEquals(local(2026, 9, 23, 17, 8), Scheduling.resolve(Preset.IN_3_HOURS, now, zone))
    }

    @Test
    fun `morning presets are nine on the local clock`() {
        assertEquals(local(2026, 9, 24, 9), Scheduling.resolve(Preset.TOMORROW_MORNING, now, zone))
        assertEquals(
            local(2027, 1, 1, 9),
            Scheduling.resolve(Preset.TOMORROW_MORNING, local(2026, 12, 31, 23, 50), zone),
        )
        assertEquals(local(2026, 9, 28, 9), Scheduling.resolve(Preset.MONDAY_MORNING, now, zone))
        assertEquals(
            local(2026, 10, 5, 9),
            Scheduling.resolve(Preset.MONDAY_MORNING, local(2026, 9, 28, 7), zone),
        )
        assertEquals(
            local(2026, 9, 28, 9),
            Scheduling.resolve(Preset.MONDAY_MORNING, local(2026, 9, 27, 22), zone),
        )
    }

    @Test
    fun `tomorrow morning survives a daylight saving change`() {
        // 2026-10-24 evening to 2026-10-25 is the night Europe falls back.
        val next = Scheduling.resolve(Preset.TOMORROW_MORNING, local(2026, 10, 24, 20), zone)
        assertEquals(local(2026, 10, 25, 9), next)
        val hour = java.time.Instant.ofEpochMilli(next).atZone(zone).hour
        assertEquals(9, hour)
    }

    @Test
    fun `a chosen time has to be one the phone can honour`() {
        assertNull(Scheduling.check(now + 5 * minute, now))
        assertNotNull(Scheduling.check(now + 30_000, now))
        assertNotNull(Scheduling.check(now - minute, now))
        assertNotNull(Scheduling.check(now + 400L * 24 * 60 * minute, now))
    }

    @Test
    fun `where an item stands`() {
        assertEquals(State.WAITING, Scheduling.stateOf(message(), now))
        assertEquals(State.DUE, Scheduling.stateOf(message(dueAt = now), now))
        assertEquals(
            State.DUE,
            Scheduling.stateOf(message(dueAt = now - Scheduling.LATE_GRACE_MS), now),
        )
        assertEquals(
            State.LATE,
            Scheduling.stateOf(message(dueAt = now - Scheduling.LATE_GRACE_MS - 1), now),
        )
        assertEquals(State.RETRYING, Scheduling.stateOf(message(error = "x", retryAt = now + minute), now))
        assertEquals(State.FAILED, Scheduling.stateOf(message(error = "x"), now))
    }

    @Test
    fun `lateness is what a phone that was away reports`() {
        assertFalse(Scheduling.isLate(now, now + 30_000))
        assertTrue(Scheduling.isLate(now, now + 120 * minute))
        assertNull(Scheduling.sentNotice(message(dueAt = now), now + 10_000))
        assertTrue(Scheduling.sentNotice(message(dueAt = now - 180 * minute), now)!!.first.contains("late"))
        assertTrue(Scheduling.reminderNotice(reminder(), now + 300 * minute).first.contains("late"))
        assertFalse(Scheduling.reminderNotice(reminder(), now + 20 * minute).first.contains("late"))
    }

    @Test
    fun `ready is overdue first and never a final failure or a backoff`() {
        val items = listOf(
            message("later", now + 60 * minute),
            message("overdue", now - 180 * minute),
            message("now", now),
            message("failed", now - minute, error = "gone"),
            message("backing-off", now - minute, error = "offline", retryAt = now + minute),
        )
        assertEquals(listOf("overdue", "now"), Scheduling.ready(items, now).map { it.id })
    }

    @Test
    fun `next wake`() {
        assertNull(Scheduling.nextWake(emptyList(), now))
        assertNull(Scheduling.nextWake(listOf(message(error = "gone")), now))
        assertEquals(20_000L, Scheduling.nextWake(listOf(message(dueAt = now + 20_000)), now))
        assertEquals(0L, Scheduling.nextWake(listOf(message(dueAt = now - 1)), now))
    }

    @Test
    fun `failures retry with backoff until the server says no`() {
        assertTrue(Scheduling.worthRetrying(null))
        assertTrue(Scheduling.worthRetrying(503))
        assertFalse(Scheduling.worthRetrying(403))
        assertEquals(30_000L, Scheduling.retryDelayMs(1))
        assertEquals(120_000L, Scheduling.retryDelayMs(3))
        assertEquals(15 * minute, Scheduling.retryDelayMs(30))

        val offline = Scheduling.afterFailure(message(dueAt = now), now, null, "offline")
        assertEquals(1, offline.attempts)
        assertEquals(now + 30_000, offline.retryAt)

        val refused = Scheduling.afterFailure(message(dueAt = now), now, 403, "no")
        assertNull(refused.retryAt)
        assertEquals(State.FAILED, Scheduling.stateOf(refused, now))

        val spent = Scheduling.afterFailure(message(attempts = Scheduling.MAX_ATTEMPTS - 1), now, null, "x")
        assertNull(spent.retryAt)

        val again = Scheduling.sendingNow(refused, now + minute)
        assertEquals(State.DUE, Scheduling.stateOf(again, now + minute))
        assertNull(again.error)
        assertEquals(State.WAITING, Scheduling.stateOf(Scheduling.rescheduled(refused, now + 60 * minute), now))
    }

    @Test
    fun `only text can be scheduled`() {
        assertNull(Scheduling.blocker("hello", 0, 2000))
        assertNotNull(Scheduling.blocker("hello", 1, 2000))
        assertNotNull(Scheduling.blocker("  ", 0, 2000))
        assertNotNull(Scheduling.blocker("x".repeat(2001), 0, 2000))
        assertEquals("one two", Scheduling.excerptOf("  one\n two  "))
    }

    @Test
    fun `what is written to disk reads back, and a bad row is dropped`() {
        val items = listOf(message(error = "x", retryAt = now), reminder())
        assertEquals(items, Scheduling.decode(Scheduling.encode(items)))
        assertTrue(Scheduling.decode(null).isEmpty())
        assertTrue(Scheduling.decode("not json").isEmpty())
        assertEquals(1, Scheduling.decode("""[{"kind":"NOPE"},${Scheduling.encode(listOf(reminder())).trim('[', ']')}]""").size)
    }
}
