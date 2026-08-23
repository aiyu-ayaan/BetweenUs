package com.aatech.betweenus.feature.voice

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The noise gate on the phone.
 *
 * Three things here are wrong in ways nobody hears until it ships, and all
 * three are arithmetic:
 *
 * - **A gate that latches.** Once shut it must still be able to open, which is
 *   the whole reason the level is measured before the attenuation rather than
 *   after it. A gate that reads its own silence never opens again, and the
 *   symptom is a microphone that works for one sentence.
 * - **A ramp that does not arrive.** Too fast is a click, too slow is a
 *   microphone that fades out mid-word, and never reaching the target at all is
 *   a call that gets quieter the longer it goes on.
 * - **A sample read with the wrong sign.** A loud negative sample read as
 *   unsigned is a quiet one, so a gate would sit closed through half of every
 *   waveform.
 */
class MicGateTest {

    /** 16-bit little-endian PCM, the format the capture hook hands over. */
    private fun pcm(vararg samples: Int): ByteBuffer {
        val buffer = ByteBuffer.allocate(samples.size * 2).order(ByteOrder.LITTLE_ENDIAN)
        samples.forEach { buffer.putShort(it.toShort()) }
        buffer.rewind()
        return buffer
    }

    private fun samplesOf(buffer: ByteBuffer, count: Int): List<Int> =
        (0 until count).map { buffer.order(ByteOrder.LITTLE_ENDIAN).getShort(it * 2).toInt() }

    // --- Measuring -----------------------------------------------------------

    @Test
    fun `silence is the floor and an empty buffer is not a crash`() {
        assertEquals(-100.0, MicGate.amplitudeToDb(0.0), 1e-9)
        assertEquals(0.0, MicGate.rootMeanSquare(pcm(0, 0, 0, 0), 8), 1e-9)
        assertEquals(0.0, MicGate.rootMeanSquare(ByteBuffer.allocate(0), 0), 1e-9)
        // A byte count larger than the buffer must read what is there, not off
        // the end of it.
        assertEquals(0.0, MicGate.rootMeanSquare(pcm(0, 0), 4096), 1e-9)
    }

    @Test
    fun `a loud negative sample is as loud as a positive one`() {
        val up = MicGate.rootMeanSquare(pcm(32767, 32767), 4)
        val down = MicGate.rootMeanSquare(pcm(-32767, -32767), 4)
        assertEquals(1.0, up, 1e-4)
        assertEquals(up, down, 1e-6)
    }

    @Test
    fun `full scale is zero dBFS and half amplitude is about six down`() {
        assertEquals(0.0, MicGate.amplitudeToDb(1.0), 1e-6)
        assertEquals(-6.02, MicGate.amplitudeToDb(0.5), 0.01)
    }

    // --- Deciding ------------------------------------------------------------

    @Test
    fun `a voice opens it and a quiet room does not`() {
        val quiet = MicGate.step(MicGate.CLOSED, -70.0, -50.0, 1_000)
        assertFalse(quiet.open)

        val speech = MicGate.step(MicGate.CLOSED, -30.0, -50.0, 1_000)
        assertTrue(speech.open)
    }

    @Test
    fun `it holds through the gaps inside a word`() {
        val open = MicGate.step(MicGate.CLOSED, -30.0, -50.0, 1_000)
        // A stop consonant: silence, well below the threshold, 100 ms later.
        val gap = MicGate.step(open, -90.0, -50.0, 1_100)
        assertTrue("a gate that shuts inside a word chops every sentence", gap.open)
        // Half a second of nothing is the end of the sentence.
        val after = MicGate.step(gap, -90.0, -50.0, 1_500)
        assertFalse(after.open)
    }

    @Test
    fun `hysteresis stops it fluttering on a voice sitting at the threshold`() {
        val open = MicGate.step(MicGate.CLOSED, -49.0, -50.0, 1_000)
        assertTrue(open.open)
        // Past the hold, 3 dB under the threshold: still open, because it is
        // already open. Without this it would chatter once per buffer.
        val under = MicGate.step(open, -53.0, -50.0, 2_000)
        assertTrue(under.open)
        // 10 dB under is past the hysteresis and is genuinely nothing.
        val well = MicGate.step(under, -60.0, -50.0, 2_100)
        assertFalse(well.open)
    }

    @Test
    fun `a closed gate can still open, because the level is read before the gain`() {
        // The failure this guards is the whole reason the gate is not built on
        // the microphone mute: attenuating first would feed the next decision
        // its own silence and the gate would never reopen.
        var state = MicGate.step(MicGate.CLOSED, -90.0, -50.0, 1_000)
        assertFalse(state.open)
        state = MicGate.step(state, -20.0, -50.0, 1_010)
        assertTrue("a gate that cannot reopen is a microphone that works once", state.open)
    }

    // --- Ramping -------------------------------------------------------------

    @Test
    fun `the ramp arrives, and takes about as long as it says`() {
        // 480 samples at 48 kHz is 10 ms, which is two attack windows.
        assertEquals(1.0, MicGate.rampTo(0.0, open = true, samples = 480, sampleRate = 48_000), 1e-9)
        // One 10 ms buffer is a fifteenth of the 150 ms release, so closing
        // takes several buffers rather than snapping.
        val afterOne = MicGate.rampTo(1.0, open = false, samples = 480, sampleRate = 48_000)
        assertTrue("a release that finishes in one buffer is a click", afterOne > 0.8)
        assertTrue(afterOne < 1.0)
    }

    @Test
    fun `the ramp never overshoots in either direction`() {
        assertEquals(1.0, MicGate.rampTo(0.99, open = true, samples = 480, sampleRate = 48_000), 1e-9)
        assertEquals(0.0, MicGate.rampTo(0.001, open = false, samples = 48_000, sampleRate = 48_000), 1e-9)
    }

    @Test
    fun `a nonsense buffer size leaves the gain alone rather than dividing by zero`() {
        assertEquals(0.5, MicGate.rampTo(0.5, open = true, samples = 0, sampleRate = 48_000), 1e-9)
        assertEquals(0.5, MicGate.rampTo(0.5, open = true, samples = 480, sampleRate = 0), 1e-9)
    }

    // --- Applying ------------------------------------------------------------

    @Test
    fun `a fully closed gate writes silence`() {
        val buffer = pcm(20000, -20000, 15000, -15000)
        MicGate.applyRamp(buffer, 8, fromGain = 0.0, toGain = 0.0)
        assertEquals(listOf(0, 0, 0, 0), samplesOf(buffer, 4))
    }

    @Test
    fun `a fully open gate leaves the samples exactly as they were`() {
        val original = listOf(20000, -20000, 15000, -15000)
        val buffer = pcm(*original.toIntArray())
        val ended = MicGate.applyRamp(buffer, 8, fromGain = 1.0, toGain = 1.0)
        assertEquals(1.0, ended, 1e-9)
        assertEquals(original, samplesOf(buffer, 4))
    }

    @Test
    fun `a ramp is applied across the buffer, not in one step at its edge`() {
        // Every sample the same, so any difference in the output is the ramp.
        val buffer = pcm(10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000)
        MicGate.applyRamp(buffer, 16, fromGain = 1.0, toGain = 0.0)
        val out = samplesOf(buffer, 8)

        assertEquals("the first sample is untouched", 10000, out.first())
        assertTrue("the last is nearly silent, was ${out.last()}", out.last() < 2000)
        // Monotonic: a staircase or a jump would be audible as zipper noise.
        for (index in 1 until out.size) {
            assertTrue("sample $index went up during a close", out[index] <= out[index - 1])
        }
    }

    @Test
    fun `a full-scale sample survives unity gain without wrapping`() {
        // Multiplying by exactly one goes through a Double and back; getting
        // the rounding wrong here turns the loudest sample into the quietest,
        // which is a crack on every peak.
        val buffer = pcm(32767, -32768)
        MicGate.applyRamp(buffer, 4, fromGain = 0.999, toGain = 1.0)
        val out = samplesOf(buffer, 2)
        assertTrue("positive peak wrapped: ${out[0]}", out[0] > 32000)
        assertTrue("negative peak wrapped: ${out[1]}", out[1] < -32000)
    }

    @Test
    fun `an empty buffer is not a crash and reports the target gain`() {
        assertEquals(0.5, MicGate.applyRamp(ByteBuffer.allocate(0), 0, 1.0, 0.5), 1e-9)
    }
}
