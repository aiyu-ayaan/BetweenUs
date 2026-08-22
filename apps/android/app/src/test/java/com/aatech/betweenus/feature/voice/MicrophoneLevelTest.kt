package com.aatech.betweenus.feature.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The microphone level behind the green ring around your own tile.
 *
 * It is a hand-rolled pass over a byte array with an endianness and a sign in
 * it, which is the shape of thing that is silently wrong: a level that never
 * reaches the threshold is a ring that never lights, and one that never leaves
 * it is a ring that never goes out. Neither looks like a bug, they both look
 * like the feature not working.
 */
class MicrophoneLevelTest {

    /** 16-bit little-endian PCM, the format the device module hands over. */
    private fun pcm(vararg samples: Int): ByteArray {
        val bytes = ByteArray(samples.size * 2)
        samples.forEachIndexed { index, sample ->
            bytes[index * 2] = (sample and 0xFF).toByte()
            bytes[index * 2 + 1] = ((sample shr 8) and 0xFF).toByte()
        }
        return bytes
    }

    @Test
    fun `silence is zero, and an empty buffer is not a crash`() {
        assertEquals(0.0, VoiceEngine.rootMeanSquare(pcm(0, 0, 0, 0)), 1e-9)
        assertEquals(0.0, VoiceEngine.rootMeanSquare(ByteArray(0)), 1e-9)
        // An odd byte count cannot happen and must not read off the end.
        assertEquals(0.0, VoiceEngine.rootMeanSquare(ByteArray(1)), 1e-9)
    }

    @Test
    fun `full scale is one, in both directions`() {
        assertEquals(1.0, VoiceEngine.rootMeanSquare(pcm(32767, 32767)), 1e-4)
        // Negative samples must square to the same thing. Reading the high byte
        // as unsigned would make a loud negative sample read as a quiet one.
        assertEquals(1.0, VoiceEngine.rootMeanSquare(pcm(-32767, -32767)), 1e-4)
        assertEquals(1.0, VoiceEngine.rootMeanSquare(pcm(32767, -32767)), 1e-4)
    }

    @Test
    fun `a voice crosses the threshold and a quiet room does not`() {
        // -40 dBFS is the bar every remote tile is judged by; a normal speaking
        // level sits well above it.
        val speech = VoiceEngine.rootMeanSquare(pcm(3000, -3200, 2800, -2900))
        val room = VoiceEngine.rootMeanSquare(pcm(30, -25, 18, -22))
        assertTrue("speech should register, was $speech", speech >= 0.01)
        assertTrue("a quiet room should not, was $room", room < 0.01)
    }

    @Test
    fun `the level is a mean, not a peak`() {
        // One loud sample in a buffer of silence is a click, not a voice.
        val click = VoiceEngine.rootMeanSquare(pcm(32767) + ByteArray(998))
        assertTrue("a single spike should stay low, was $click", click < 0.1)
    }
}
