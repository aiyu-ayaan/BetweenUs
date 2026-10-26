package com.aatech.betweenus.feature.notifications

import android.app.NotificationManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * Why a perfectly delivered push can still not ring, in the order somebody
 * should fix it. Getting the order wrong sends them to a settings screen that
 * changes nothing.
 */
class CallAlertsTest {

    private val high = NotificationManager.IMPORTANCE_HIGH

    @Test
    fun `a phone set up properly rings`() {
        assertEquals(CallAlertHealth.OK, CallAlerts.healthOf(true, high, true))
    }

    @Test
    fun `a channel that does not exist yet is not a problem`() {
        // It is created at the moment it is needed, with the right importance.
        assertEquals(CallAlertHealth.OK, CallAlerts.healthOf(true, null, true))
    }

    @Test
    fun `everything off outranks the channel`() {
        assertEquals(
            CallAlertHealth.NOTIFICATIONS_OFF,
            CallAlerts.healthOf(false, NotificationManager.IMPORTANCE_NONE, false),
        )
    }

    @Test
    fun `a channel switched off is told apart from one turned down`() {
        assertEquals(
            CallAlertHealth.CHANNEL_OFF,
            CallAlerts.healthOf(true, NotificationManager.IMPORTANCE_NONE, true),
        )
        for (quiet in listOf(
            NotificationManager.IMPORTANCE_MIN,
            NotificationManager.IMPORTANCE_LOW,
            NotificationManager.IMPORTANCE_DEFAULT,
        )) {
            assertEquals(CallAlertHealth.CHANNEL_QUIET, CallAlerts.healthOf(true, quiet, true))
        }
    }

    @Test
    fun `full screen is the last thing to blame`() {
        assertEquals(CallAlertHealth.NO_FULL_SCREEN, CallAlerts.healthOf(true, high, false))
        // A quiet channel is the better thing to fix first: it silences the ring
        // on a phone that is in somebody's hand, which full screen does not.
        assertEquals(
            CallAlertHealth.CHANNEL_QUIET,
            CallAlerts.healthOf(true, NotificationManager.IMPORTANCE_DEFAULT, false),
        )
    }

    @Test
    fun `every problem has its own words`() {
        val sentences = CallAlertHealth.entries.map { CallAlerts.describe(it) }
        assertEquals(sentences.size, sentences.toSet().size)
        assertNotEquals("", sentences.first())
    }
}
