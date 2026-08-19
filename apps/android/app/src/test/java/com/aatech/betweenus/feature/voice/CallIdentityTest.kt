package com.aatech.betweenus.feature.voice

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CallIdentityTest {

    @Test
    fun `exactly one end of a pair is polite`() {
        val ids = listOf(
            "0d2f8c1e-0000-4000-8000-000000000001",
            "9a7b6c5d-0000-4000-8000-000000000002",
            "f1e2d3c4-0000-4000-8000-000000000003",
        )
        for (a in ids) {
            for (b in ids) {
                if (a == b) continue
                assertTrue(
                    "$a and $b agreed about who yields",
                    CallIdentity.polite(a, b) != CallIdentity.polite(b, a),
                )
            }
        }
    }

    @Test
    fun `a new socket is a new identity`() {
        assertTrue(CallIdentity.changed("old-peer-id", "new-peer-id"))
    }

    @Test
    fun `the same identity announced twice is not a change`() {
        assertFalse(CallIdentity.changed("peer-id", "peer-id"))
    }

    @Test
    fun `the first identity of a call is not a change`() {
        assertFalse(CallIdentity.changed(null, "peer-id"))
    }

    @Test
    fun `an empty peer id is never treated as a new identity`() {
        // `optString` on a missing key is "", and "" is not an identity to
        // rebuild a call around.
        assertFalse(CallIdentity.changed("peer-id", ""))
    }
}
