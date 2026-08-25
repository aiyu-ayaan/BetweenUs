package com.aatech.betweenus.core.data

import kotlinx.coroutines.CancellationException
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * The one rule that decides whether somebody is put back on a login form.
 *
 * Every case here was a real sign-out: a phone that opened the app before the
 * server was up, one that woke in a tunnel, and an activity recreated mid
 * restore, which arrived as `CancellationException` and read as a failed
 * sign-in - "Job was cancelled" over a session that was never questioned.
 */
class SessionRuleTest {

    @Test
    fun `a refused credential ends the session`() {
        assertTrue(endsSession(ApiError("UNAUTHORIZED", "Token expired", 401)))
    }

    @Test
    fun `an unreachable server does not`() {
        assertFalse(endsSession(IOException("Could not reach betweenus.example")))
    }

    @Test
    fun `a gateway that has not finished starting does not`() {
        assertFalse(endsSession(ApiError("BAD_GATEWAY", "Bad gateway", 502)))
    }

    @Test
    fun `a cancelled coroutine does not`() {
        assertFalse(endsSession(CancellationException("Job was cancelled")))
    }
}
