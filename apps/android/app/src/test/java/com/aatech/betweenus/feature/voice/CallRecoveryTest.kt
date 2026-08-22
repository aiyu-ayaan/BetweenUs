package com.aatech.betweenus.feature.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The policy behind a link that has stopped carrying media.
 *
 * Both directions fail invisibly. Giving up too early is a call that ends
 * itself while somebody is still talking; giving up too late is a frozen tile
 * with a hopeful spinner on it for a minute, which is the version people call
 * broken. Neither shows up as a crash, so the arithmetic is worth pinning.
 */
class CallRecoveryTest {

    @Test
    fun `only the impolite side restarts ICE`() {
        // A restart has to become an offer to do anything, and only the
        // impolite side offers. The polite side asking for one is a recovery
        // attempt that never happens.
        assertTrue(CallRecovery.restarts(polite = false))
        assertFalse(CallRecovery.restarts(polite = true))
    }

    @Test
    fun `the first attempt is immediate and later ones back off`() {
        assertEquals(0L, CallRecovery.backoffMs(1))
        assertTrue(CallRecovery.backoffMs(2) > CallRecovery.backoffMs(1))
        assertTrue(CallRecovery.backoffMs(3) > CallRecovery.backoffMs(2))
        // Capped rather than doubling forever, or the last attempt lands after
        // the deadline has already given up.
        assertEquals(CallRecovery.backoffMs(4), CallRecovery.backoffMs(9))
    }

    @Test
    fun `every attempt fits inside the deadline`() {
        // Each round costs its backoff plus the grace period spent waiting to
        // see whether the restart took. If the budget did not fit, the attempt
        // count would be decoration and only the clock would ever fire.
        val budget = (1..CallRecovery.MAX_ATTEMPTS).sumOf {
            CallRecovery.backoffMs(it) + CallRecovery.GRACE_MS
        }
        assertTrue(
            "attempts cost ${budget}ms against a ${CallRecovery.DEADLINE_MS}ms deadline",
            budget <= CallRecovery.DEADLINE_MS,
        )
    }

    @Test
    fun `a link is given up on by attempts or by the clock, whichever comes first`() {
        assertFalse(CallRecovery.spent(attempts = 0, downForMs = 0))
        assertFalse(CallRecovery.spent(attempts = 1, downForMs = 5_000))

        // Failing fast and repeatedly.
        assertTrue(CallRecovery.spent(CallRecovery.MAX_ATTEMPTS, 1_000))
        // Failing slowly, or never reporting a failure at all and just sitting
        // in DISCONNECTED - which is the case the attempt count cannot see.
        assertTrue(CallRecovery.spent(attempts = 0, downForMs = CallRecovery.DEADLINE_MS))
    }

    @Test
    fun `the call outlives one link, and being alone outlives both`() {
        // A single bad link must not end a call that is otherwise fine, so the
        // whole-call deadlines are the longer ones.
        assertTrue(CallRecovery.SIGNALLING_DEADLINE_MS > CallRecovery.DEADLINE_MS)
        assertTrue(CallRecovery.ALONE_MS > CallRecovery.SIGNALLING_DEADLINE_MS)
    }

    @Test
    fun `a handover is given time to fix itself before anything is renegotiated`() {
        // Non-zero, or a lost packet on a wifi-to-mobile handover costs a
        // renegotiation over the network that is currently bad.
        assertTrue(CallRecovery.GRACE_MS > 0)
        // And short enough that a real failure is not sat on.
        assertTrue(CallRecovery.GRACE_MS < CallRecovery.DEADLINE_MS / 4)
    }
}
