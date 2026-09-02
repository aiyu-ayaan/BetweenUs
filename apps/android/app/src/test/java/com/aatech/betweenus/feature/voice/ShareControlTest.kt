package com.aatech.betweenus.feature.voice

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Who is allowed to hand this phone a mouse, and who is not.
 *
 * The rule worth asserting is the one that is invisible when it breaks: a
 * `grant` is only meaningful from the peer that was actually asked. Without
 * that check, anybody in the call could send an unsolicited "yes" and this
 * client would start sending mouse events at them - not a security hole in the
 * usual sense, since it is their own machine that would be driven, but a
 * client doing something nobody asked for and nothing on screen explaining it.
 */
class ShareControlTest {

    private val sent = mutableListOf<Pair<String, JSONObject>>()

    @Before
    fun attach() {
        sent.clear()
        ShareControl.attach { peerId, envelope -> sent += peerId to envelope }
    }

    @After
    fun detach() = ShareControl.detach()

    private fun message(index: Int): JSONObject = sent[index].second.getJSONObject("message")

    @Test
    fun `asking names the peer and carries the desktop's topic`() {
        ShareControl.ask("alice")
        assertEquals("alice", ShareControl.asking.value)
        assertEquals("alice", sent[0].first)
        assertEquals(ShareControl.TOPIC, sent[0].second.getString("topic"))
        assertEquals("ask", message(0).getString("k"))
    }

    @Test
    fun `a grant from the peer that was asked starts the drive`() {
        ShareControl.ask("alice")
        ShareControl.receive("alice", JSONObject().put("k", "grant"))
        assertEquals("alice", ShareControl.driving.value)
        assertNull(ShareControl.asking.value)
    }

    @Test
    fun `a grant from somebody who was never asked is ignored`() {
        ShareControl.ask("alice")
        ShareControl.receive("mallory", JSONObject().put("k", "grant"))
        assertNull(ShareControl.driving.value)
        // And the real request is still outstanding rather than cancelled by it.
        assertEquals("alice", ShareControl.asking.value)
    }

    @Test
    fun `a refusal from a third party does not cancel the real request either`() {
        ShareControl.ask("alice")
        ShareControl.receive("mallory", JSONObject().put("k", "deny").put("why", "no"))
        assertEquals("alice", ShareControl.asking.value)
        assertNull(ShareControl.refusal.value)
    }

    @Test
    fun `a refusal carries its reason, and a blank one still says something`() {
        ShareControl.ask("alice")
        ShareControl.receive("alice", JSONObject().put("k", "deny").put("why", "Sharing a window"))
        assertEquals("Sharing a window", ShareControl.refusal.value)
        assertNull(ShareControl.asking.value)

        ShareControl.ask("alice")
        ShareControl.receive("alice", JSONObject().put("k", "deny"))
        assertEquals("They said no", ShareControl.refusal.value)
    }

    @Test
    fun `the sharer taking it back ends the drive`() {
        ShareControl.ask("alice")
        ShareControl.receive("alice", JSONObject().put("k", "grant"))
        ShareControl.receive("alice", JSONObject().put("k", "revoke"))
        assertNull(ShareControl.driving.value)
    }

    @Test
    fun `somebody asking to drive this phone is told why not`() {
        ShareControl.receive("alice", JSONObject().put("k", "ask"))
        assertEquals("alice", sent[0].first)
        assertEquals("deny", message(0).getString("k"))
        assertTrue(message(0).getString("why").isNotBlank())
    }

    @Test
    fun `input aimed at this phone is dropped rather than answered`() {
        ShareControl.receive("alice", JSONObject().put("k", "m").put("a", "down"))
        ShareControl.receive("alice", JSONObject().put("k", "key").put("a", "down"))
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `nothing is sent while nothing is being driven`() {
        // A stray touch after the drive ended must not reach anybody's machine.
        ShareControl.sendMouse("down", 0.5f, 0.5f, button = "left")
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `coordinates are fractions, and are clamped to the picture`() {
        ShareControl.ask("alice")
        ShareControl.receive("alice", JSONObject().put("k", "grant"))
        sent.clear()
        ShareControl.sendMouse("down", -0.5f, 2f, button = "left")
        val move = message(0)
        assertEquals(0.0, move.getDouble("x"), 0.0001)
        assertEquals(1.0, move.getDouble("y"), 0.0001)
        assertEquals("left", move.getString("b"))
    }
}
