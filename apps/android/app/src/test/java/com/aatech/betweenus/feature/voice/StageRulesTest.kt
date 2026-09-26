package com.aatech.betweenus.feature.voice

import com.aatech.betweenus.feature.voice.StageRules.Declared
import com.aatech.betweenus.feature.voice.StageRules.Seat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Who is on the stage, how long a pin lives, and who a share is encoded for.
 *
 * The hero rule is shared with the web client (`stage-order.ts`), where it is
 * checked by `stage-order.check.ts`; this is the phone's copy of that check.
 * "It keeps swapping the person who is talking" is invisible in a screenshot
 * and obvious in a call, so it is pinned down here instead.
 */
class StageRulesTest {

    private val alice = Seat(peerId = "p-alice", userId = "u-alice", hasPicture = false)
    private val bob = Seat(peerId = "p-bob", userId = "u-bob", hasPicture = true)
    private val carol = Seat(peerId = "p-carol", userId = "u-carol", hasPicture = false)
    private val seats = listOf(alice, bob, carol)

    // --- the hero ---

    @Test
    fun `a pin wins over the last speaker`() {
        assertEquals("p-carol", StageRules.hero(seats, pinned = "p-carol", lastSpeaker = "p-alice"))
    }

    @Test
    fun `pinning yourself puts your own tile on the stage`() {
        assertNull(StageRules.hero(seats, pinned = StageRules.SELF, lastSpeaker = "p-alice"))
    }

    @Test
    fun `with nobody pinned the last speaker keeps the stage`() {
        assertEquals("p-alice", StageRules.hero(seats, pinned = null, lastSpeaker = "p-alice"))
    }

    @Test
    fun `a pin on somebody not here falls back to the last speaker`() {
        assertEquals("p-alice", StageRules.hero(seats, pinned = "p-gone", lastSpeaker = "p-alice"))
    }

    @Test
    fun `before anybody speaks the first picture leads, then anybody`() {
        assertEquals("p-bob", StageRules.hero(seats, pinned = null, lastSpeaker = null))
        assertEquals("p-alice", StageRules.hero(listOf(alice, carol), pinned = null, lastSpeaker = null))
        // A last speaker who left is no speaker.
        assertEquals("p-bob", StageRules.hero(seats, pinned = null, lastSpeaker = "p-gone"))
    }

    @Test
    fun `alone in the call the stage is yours`() {
        assertNull(StageRules.hero(emptyList(), pinned = null, lastSpeaker = null))
    }

    // --- the pin, across leaving and coming back ---

    private val pinOnBob = StagePin(channelId = "call-1", peerId = "p-bob", userId = "u-bob")

    @Test
    fun `a pin resolves only in its own call`() {
        assertEquals("p-bob", StageRules.resolvePin(pinOnBob, "call-1", seats))
        assertNull(StageRules.resolvePin(pinOnBob, "call-2", seats))
        assertNull(StageRules.resolvePin(pinOnBob, null, seats))
        assertNull(StageRules.resolvePin(null, "call-1", seats))
    }

    @Test
    fun `a pin follows the person to a new peer id after a reconnect`() {
        val rejoined = listOf(alice, bob.copy(peerId = "p-bob-2"))
        assertEquals("p-bob-2", StageRules.resolvePin(pinOnBob, "call-1", rejoined))
    }

    @Test
    fun `a pin on somebody not back yet resolves to nobody, and is kept`() {
        assertNull(StageRules.resolvePin(pinOnBob, "call-1", listOf(alice)))
        // Nothing but their leaving the call drops it.
        assertEquals(pinOnBob, StageRules.pinAfterLeft(pinOnBob, alice, listOf(bob, carol)))
        assertNull(StageRules.pinAfterLeft(pinOnBob, bob, listOf(alice, carol)))
    }

    @Test
    fun `a pin that followed them to a new peer id goes when that one leaves`() {
        val bobAgain = bob.copy(peerId = "p-bob-2")
        assertNull(StageRules.pinAfterLeft(pinOnBob, bobAgain, listOf(alice)))
        // Unless another of their devices is still in the call.
        val bobPhone = bob.copy(peerId = "p-bob-phone")
        assertEquals(pinOnBob, StageRules.pinAfterLeft(pinOnBob, bobAgain, listOf(alice, bobPhone)))
        // A pin on yourself is not somebody else's to take away.
        val self = StagePin("call-1", StageRules.SELF, null)
        assertEquals(self, StageRules.pinAfterLeft(self, bob, emptyList()))
    }

    @Test
    fun `a self pin resolves in its call whoever is there`() {
        val self = StagePin("call-1", StageRules.SELF, null)
        assertEquals(StageRules.SELF, StageRules.resolvePin(self, "call-1", emptyList()))
    }

    @Test
    fun `the call ending clears the pin, and nothing short of that does`() {
        // Leaving while others stay: kept for the rejoin.
        assertEquals(pinOnBob, StageRules.pinAfterRoster(pinOnBob, "call-1", listOf("me", "u-bob"), listOf("u-bob")))
        // A different call emptying.
        assertEquals(pinOnBob, StageRules.pinAfterRoster(pinOnBob, "call-2", listOf("x"), emptyList()))
        // A roster first heard empty says nothing about a call.
        assertEquals(pinOnBob, StageRules.pinAfterRoster(pinOnBob, "call-1", emptyList(), emptyList()))
        // Somebody to nobody: the call is over.
        assertNull(StageRules.pinAfterRoster(pinOnBob, "call-1", listOf("u-bob"), emptyList()))
    }

    // --- joining a share ---

    @Test
    fun `a joined share is dropped when it stops`() {
        assertEquals("p-bob", StageRules.watchingAfter("p-bob", listOf("p-bob")))
        assertNull(StageRules.watchingAfter("p-bob", listOf("p-alice")))
        assertNull(StageRules.watchingAfter(null, listOf("p-bob")))
    }

    @Test
    fun `a peer is encoded for only once it has joined this share`() {
        assertTrue(StageRules.joinedShare(Declared.Peer("me"), "me"))
        assertFalse(StageRules.joinedShare(Declared.Peer("someone-else"), "me"))
        assertFalse(StageRules.joinedShare(Declared.Nobody, "me"))
        // A client that has never said shows every share, so it is encoded for.
        assertTrue(StageRules.joinedShare(Declared.Unsaid, "me"))
        // Before this client knows its own id nobody can have joined it.
        assertFalse(StageRules.joinedShare(Declared.Peer("me"), null))
    }
}
