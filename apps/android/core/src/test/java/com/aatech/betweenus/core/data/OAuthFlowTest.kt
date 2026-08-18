package com.aatech.betweenus.core.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The challenge this client sends has to be the one the server computes.
 *
 * There is no way to find out at runtime that these two disagree: the sign-in
 * simply fails at the exchange, after the browser round trip, with an error
 * about a sign-in that started somewhere else. So the digest is pinned to a
 * value produced by the server's own `challengeFor`, and if either side changes
 * its encoding this is what says so.
 */
class OAuthFlowTest {
    @Test
    fun `challenge matches the server's digest`() {
        assertEquals(
            "_-BU_nrgy23GXDr5th1SCfQ5hR20PQulmXM33xVGaOs",
            OAuthFlow.challengeFor("a".repeat(64)),
        )
    }

    @Test
    fun `challenge is base64url of the length the server insists on`() {
        val challenge = OAuthFlow.challengeFor("some-verifier")
        assertEquals(43, challenge.length)
        // base64url: no padding, and none of standard base64's + / =
        assertTrue(challenge, Regex("^[A-Za-z0-9_-]{43}$").matches(challenge))
    }
}
