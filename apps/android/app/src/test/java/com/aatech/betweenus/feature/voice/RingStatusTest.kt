package com.aatech.betweenus.feature.voice

import com.aatech.betweenus.core.store.OutgoingRing
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.RingState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** What a caller reads about their ring, and which ring it is about. */
class RingStatusTest {

    @Test
    fun `the three outcomes read differently`() {
        assertEquals("Ringing Ana…", RingStatus.text(RingState.RINGING, "Ana"))
        assertEquals("Ana declined the call", RingStatus.text(RingState.DECLINED, "Ana"))
        assertEquals("Ana didn't answer", RingStatus.text(RingState.UNANSWERED, "Ana"))
    }

    @Test
    fun `a name that did not resolve is not left blank`() {
        assertEquals("They declined the call", RingStatus.text(RingState.DECLINED, "  "))
    }

    @Test
    fun `ringing again is offered only once the ring is over`() {
        assertFalse(RingStatus.canRingAgain(RingState.RINGING))
        assertTrue(RingStatus.canRingAgain(RingState.DECLINED))
        assertTrue(RingStatus.canRingAgain(RingState.UNANSWERED))
    }

    @Test
    fun `a ring is only shown in the call it was sent for`() {
        val ring = OutgoingRing("c1", "u2", "Ana", RingState.RINGING)
        assertEquals(ring, RingStatus.showsFor(ring, "c1"))
        assertNull(RingStatus.showsFor(ring, "c2"))
        assertNull(RingStatus.showsFor(ring, null))
        assertNull(RingStatus.showsFor(null, "c1"))
    }

    @Test
    fun `the wire states map and answered clears the line`() {
        Presence.clearOutgoingRing()
        Presence.applyRingState("c1", "u2", "Ana", "ringing")
        assertEquals(RingState.RINGING, Presence.outgoingRing.value?.state)

        Presence.applyRingState("c1", "u2", "Ana", "declined")
        assertEquals(RingState.DECLINED, Presence.outgoingRing.value?.state)

        Presence.applyRingState("c1", "u2", "Ana", "unanswered")
        assertEquals(RingState.UNANSWERED, Presence.outgoingRing.value?.state)

        // Somebody else joining is not the person who was rung.
        Presence.applyRingState("c1", "u3", "Cy", "answered")
        assertEquals(RingState.UNANSWERED, Presence.outgoingRing.value?.state)

        Presence.applyRingState("c1", "u2", "Ana", "answered")
        assertNull(Presence.outgoingRing.value)

        // A state this client has never heard of draws nothing rather than the wrong thing.
        Presence.applyRingState("c1", "u2", "Ana", "teleported")
        assertNull(Presence.outgoingRing.value)
    }
}
