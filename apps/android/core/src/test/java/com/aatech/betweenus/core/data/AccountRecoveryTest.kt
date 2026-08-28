package com.aatech.betweenus.core.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The three answers a forgotten password can get, and the one way of being
 * wrong about them that matters.
 *
 * `RESET` is the only outcome that puts somebody in front of a new-password
 * form, and it is the one an administrator has to have authorised. So the
 * failure worth proving impossible is a payload this client does not recognise
 * being read *as* `RESET` - a client that guessed that way would offer the form
 * to anybody who could make the server answer something unexpected. Everything
 * unknown reads as `EMAILED`, which shows a sentence and does nothing.
 */
class AccountRecoveryTest {

    @Test
    fun `an administrator's window carries a token`() {
        val answer = ForgotPasswordAnswer.from(
            JSONObject("""{"outcome":"reset","resetToken":"tok_abc"}"""),
        )
        assertEquals(ForgotPasswordOutcome.RESET, answer.outcome)
        assertEquals("tok_abc", answer.resetToken)
    }

    @Test
    fun `a deployment with no mail server says so`() {
        val answer = ForgotPasswordAnswer.from(
            JSONObject("""{"outcome":"unavailable","message":"Ask your administrator."}"""),
        )
        assertEquals(ForgotPasswordOutcome.UNAVAILABLE, answer.outcome)
        assertEquals("Ask your administrator.", answer.message)
        assertNull(answer.resetToken)
    }

    @Test
    fun `an emailed link carries nothing else`() {
        val answer = ForgotPasswordAnswer.from(JSONObject("""{"outcome":"emailed"}"""))
        assertEquals(ForgotPasswordOutcome.EMAILED, answer.outcome)
        assertNull(answer.resetToken)
        assertNull(answer.message)
    }

    @Test
    fun `nothing unrecognised is ever read as an authorised reset`() {
        val nonsense = listOf(
            """{}""",
            """{"outcome":""}""",
            """{"outcome":"RESET"}""",
            """{"outcome":"something-new"}""",
            """{"outcome":null}""",
            // A token with no outcome saying so is not an authorisation.
            """{"resetToken":"tok_abc"}""",
        )
        for (body in nonsense) {
            assertEquals(
                "$body must not read as an authorised reset",
                ForgotPasswordOutcome.EMAILED,
                ForgotPasswordAnswer.from(JSONObject(body)).outcome,
            )
        }
    }

    /**
     * The availability hint may save the sign-up form a round trip; it must
     * never invent a refusal. A missing or malformed field reads as "not
     * available" here, and the screen shows a hint - the registration itself is
     * still gated by the unique index on the server.
     */
    @Test
    fun `username availability parses both answers`() {
        val free = UsernameAvailability.from(
            JSONObject("""{"username":"ada","available":true}"""),
        )
        assertTrue(free.available)
        assertEquals("ada", free.username)
        assertNull(free.reason)

        val taken = UsernameAvailability.from(
            JSONObject("""{"username":"ada","available":false,"reason":"taken"}"""),
        )
        assertEquals(false, taken.available)
        assertEquals("taken", taken.reason)

        val malformed = UsernameAvailability.from(JSONObject("""{"username":"ada"}"""))
        assertEquals(false, malformed.available)
    }

    @Test
    fun `a blocked entry names the person and when`() {
        val entry = BlockedUser.from(
            JSONObject(
                """
                {
                  "user": {
                    "id": "u1",
                    "username": "ada",
                    "displayName": "Ada Lovelace",
                    "avatarUrl": null
                  },
                  "blockedAt": "2026-08-28T10:00:00.000Z"
                }
                """.trimIndent(),
            ),
        )
        assertEquals("u1", entry.user.id)
        assertEquals("Ada Lovelace", entry.user.label)
        assertNull(entry.user.avatarUrl)
        assertEquals("2026-08-28T10:00:00.000Z", entry.blockedAt)
    }
}
