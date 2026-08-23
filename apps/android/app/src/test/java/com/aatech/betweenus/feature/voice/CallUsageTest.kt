package com.aatech.betweenus.feature.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * What this client tells the call log a call cost.
 *
 * Nothing on the server can check any of it - it is not in the media path - so
 * the only thing keeping the log honest is that this arithmetic is right and
 * that it matches the desktop's, which writes rows into the same table.
 */
class CallUsageTest {

    private fun sample(
        inboundAudioBytes: Long = 0,
        inboundVideoBytes: Long = 0,
        outboundAudioBytes: Long = 0,
        outboundVideoBytes: Long = 0,
        packetsLost: Long = 0,
        packetsReceived: Long = 0,
        roundTripSeconds: Double? = null,
        transport: String? = null,
    ) = LinkSample(
        at = 0,
        inboundAudioBytes = inboundAudioBytes,
        inboundVideoBytes = inboundVideoBytes,
        outboundAudioBytes = outboundAudioBytes,
        outboundVideoBytes = outboundVideoBytes,
        packetsLost = packetsLost,
        packetsReceived = packetsReceived,
        roundTripSeconds = roundTripSeconds,
        transport = transport,
    )

    @Test
    fun `a reading becomes one link's figures`() {
        val usage = CallUsage.of(
            "u1",
            "ayaan",
            sample(
                inboundAudioBytes = 100,
                inboundVideoBytes = 900,
                outboundAudioBytes = 50,
                outboundVideoBytes = 450,
                packetsLost = 3,
                packetsReceived = 297,
                roundTripSeconds = 0.042,
                transport = "relay",
            ),
        )

        assertEquals(1000, usage.bytesReceived)
        assertEquals(500, usage.bytesSent)
        assertEquals(42, usage.roundTripMs)
        assertEquals("relay", usage.transport)
    }

    @Test
    fun `a link nothing was ever known about reports no round trip`() {
        assertNull(CallUsage.of("u1", "ayaan", sample()).roundTripMs)
    }

    @Test
    fun `the totals are the sum of the links`() {
        val event = CallUsage.leaveEvent(
            listOf(
                CallUsage.of("u1", "one", sample(inboundAudioBytes = 10, outboundAudioBytes = 5)),
                CallUsage.of("u2", "two", sample(inboundVideoBytes = 90, outboundVideoBytes = 45)),
            ),
        )

        assertEquals("leave", event.getString("type"))
        assertEquals(100L, event.getLong("bytesReceived"))
        assertEquals(50L, event.getLong("bytesSent"))
        assertEquals(150L, event.getLong("bytes"))
        assertEquals(2, event.getJSONArray("links").length())
    }

    @Test
    fun `a call nobody measured says so rather than saying zero links`() {
        val event = CallUsage.leaveEvent(emptyList())
        assertEquals(0L, event.getLong("bytes"))
        assertEquals(0, event.getJSONArray("links").length())
    }

    @Test
    fun `a relay at either end is a relayed call`() {
        assertEquals("relay", CallUsage.transportOf("host", "relay"))
        assertEquals("relay", CallUsage.transportOf("relay", "srflx"))
        assertEquals("direct", CallUsage.transportOf("srflx", "prflx"))
        // Not knowing is not the same answer as knowing it was direct.
        assertNull(CallUsage.transportOf(null, "host"))
        assertNull(CallUsage.transportOf("host", ""))
    }
}
