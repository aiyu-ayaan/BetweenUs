package com.aatech.betweenus.feature.notifications

import com.aatech.betweenus.core.data.NotificationPreferences
import com.aatech.betweenus.core.data.PublicUser
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalTime

/**
 * The two gates a server cannot answer, and the two that are easy to get
 * backwards: a quiet-hours window that wraps midnight, and what counts as a
 * mention of me.
 */
class PushGateTest {

    private fun preferences(start: Int?, end: Int?) = NotificationPreferences(
        enabled = true,
        quietStartMinute = start,
        quietEndMinute = end,
        mutedChannelIds = emptyList(),
        mutedUserIds = emptyList(),
    )

    private val self = PublicUser(
        id = "u1",
        email = "ada@example.com",
        username = "ada",
        displayName = "Ada Lovelace",
        avatarUrl = null,
        role = "USER",
    )

    @Test
    fun `no window means never quiet`() {
        assertFalse(PushGate.quiet(preferences(null, null), LocalTime.of(3, 0)))
        assertFalse(PushGate.quiet(null, LocalTime.of(3, 0)))
        // Half a window is not a window: one end alone says nothing.
        assertFalse(PushGate.quiet(preferences(1320, null), LocalTime.of(23, 0)))
    }

    @Test
    fun `an ordinary window covers its own hours only`() {
        val nine_to_five = preferences(9 * 60, 17 * 60)
        assertTrue(PushGate.quiet(nine_to_five, LocalTime.of(12, 0)))
        assertFalse(PushGate.quiet(nine_to_five, LocalTime.of(8, 59)))
        assertFalse(PushGate.quiet(nine_to_five, LocalTime.of(20, 0)))
        // The start is inside and the end is not, so two windows meeting at an
        // hour do not both claim it.
        assertTrue(PushGate.quiet(nine_to_five, LocalTime.of(9, 0)))
        assertFalse(PushGate.quiet(nine_to_five, LocalTime.of(17, 0)))
    }

    @Test
    fun `a window may wrap midnight`() {
        // 22:00 to 08:00, which is the one people actually set.
        val night = preferences(22 * 60, 8 * 60)
        assertTrue(PushGate.quiet(night, LocalTime.of(23, 30)))
        assertTrue(PushGate.quiet(night, LocalTime.of(0, 1)))
        assertTrue(PushGate.quiet(night, LocalTime.of(7, 59)))
        assertFalse(PushGate.quiet(night, LocalTime.of(8, 0)))
        assertFalse(PushGate.quiet(night, LocalTime.of(13, 0)))
    }

    @Test
    fun `a mention is my name, not a word containing it`() {
        assertTrue(PushGate.mentions("morning @ada, ready?", self))
        assertTrue(PushGate.mentions("@Ada Lovelace can you look", self))
        assertTrue(PushGate.mentions("@everyone standup in five", self))
        assertTrue(PushGate.mentions("@here quick one", self))
        assertFalse(PushGate.mentions("ada said the same thing", self))
        assertFalse(PushGate.mentions("ask @adam about it", self))
    }

    @Test
    fun `suppresses push when the exact channel is open in the foreground`() {
        val server1General = "chan_server1_general"
        val server2General = "chan_server2_general"
        val server1Random = "chan_server1_random"

        // Server 1 general is open in foreground: suppress push for server 1 general
        assertTrue(
            PushGate.shouldSuppress(
                channelId = server1General,
                isForeground = true,
                visibleChannelId = server1General,
            )
        )

        // Server 1 general is open in foreground: DO NOT suppress push for server 2 general
        assertFalse(
            PushGate.shouldSuppress(
                channelId = server2General,
                isForeground = true,
                visibleChannelId = server1General,
            )
        )

        // Server 1 general is open in foreground: DO NOT suppress push for server 1 random
        assertFalse(
            PushGate.shouldSuppress(
                channelId = server1Random,
                isForeground = true,
                visibleChannelId = server1General,
            )
        )

        // App is in background: DO NOT suppress push even if visibleChannelId matches
        assertFalse(
            PushGate.shouldSuppress(
                channelId = server1General,
                isForeground = false,
                visibleChannelId = server1General,
            )
        )

        // No channel is open (e.g., friends tab, drawer): DO NOT suppress
        assertFalse(
            PushGate.shouldSuppress(
                channelId = server1General,
                isForeground = true,
                visibleChannelId = null,
            )
        )
    }
}

