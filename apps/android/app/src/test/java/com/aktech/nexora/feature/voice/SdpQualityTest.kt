package com.aktech.nexora.feature.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the phone says it will accept, which is what decides what it is sent.
 *
 * These are the lines that made a 1080p60 share from the web arrive as 720p30:
 * an H.264 level of 3.1 is a hard ceiling of exactly that, and the sender obeys
 * it. Worth asserting rather than reading, because an SDP is a wall of text
 * where one wrong byte is invisible.
 */
class SdpQualityTest {

    private val offer = listOf(
        "v=0",
        "o=- 1 2 IN IP4 127.0.0.1",
        "s=-",
        "t=0 0",
        "m=audio 9 UDP/TLS/RTP/SAVPF 111",
        "c=IN IP4 0.0.0.0",
        "a=rtpmap:111 opus/48000/2",
        "m=video 9 UDP/TLS/RTP/SAVPF 96 98",
        "c=IN IP4 0.0.0.0",
        "a=rtpmap:96 H264/90000",
        "a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f",
        "a=rtpmap:98 VP8/90000",
    ).joinToString("\r\n") + "\r\n"

    @Test
    fun `the H264 level is raised off its 720p30 ceiling`() {
        val patched = SdpQuality.patch(offer, 20_000_000)

        assertTrue("level not raised: $patched", patched.contains("profile-level-id=420034"))
        assertFalse(patched.contains("profile-level-id=42001f"))
    }

    @Test
    fun `the profile and its constraint flags are left alone`() {
        // 4d = Main, 0x40 constraint flags. Claiming a profile the decoder
        // cannot parse is a stream it cannot decode at all - only the level is
        // being under-claimed, so only the level moves.
        val patched = SdpQuality.raiseH264Level("profile-level-id=4d401f")
        assertEquals("profile-level-id=4d4034", patched)
    }

    @Test
    fun `a level already high enough is not lowered`() {
        assertEquals("profile-level-id=64003c", SdpQuality.raiseH264Level("profile-level-id=64003c"))
    }

    @Test
    fun `bandwidth is stated on the video section and only there`() {
        val patched = SdpQuality.patch(offer, 20_000_000)
        val sections = patched.split(Regex("(?=m=)"))

        val audio = sections.first { it.startsWith("m=audio") }
        val video = sections.first { it.startsWith("m=video") }

        assertTrue(video.contains("b=AS:20000"))
        assertTrue(video.contains("b=TIAS:20000000"))
        assertFalse("audio must not be given a video ceiling", audio.contains("b=AS"))

        // After the connection line, which is where a b= line belongs.
        assertTrue(video.indexOf("c=IN") < video.indexOf("b=AS"))
    }

    @Test
    fun `every video codec gets the start bitrate hint`() {
        val patched = SdpQuality.patch(offer, 20_000_000)

        // H264 already had an fmtp line, so the hints are appended to it.
        assertTrue(patched.contains("profile-level-id=420034;x-google-min-bitrate=5000"))
        // VP8 had none, so one is written.
        assertTrue(patched.contains("a=fmtp:98 x-google-min-bitrate=5000"))
        assertTrue(patched.contains("x-google-start-bitrate=12000"))
        assertTrue(patched.contains("x-google-max-bitrate=20000"))
    }

    @Test
    fun `patching twice does not stack bandwidth lines`() {
        val once = SdpQuality.patch(offer, 20_000_000)
        val twice = SdpQuality.patch(once, 20_000_000)

        assertEquals(1, Regex("b=AS:").findAll(twice).count())
        assertEquals(1, Regex("b=TIAS:").findAll(twice).count())
    }
}
