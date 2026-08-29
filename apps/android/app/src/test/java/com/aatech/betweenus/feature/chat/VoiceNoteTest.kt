package com.aatech.betweenus.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The waveform arithmetic, which fails silently in three different ways.
 *
 * A wrong bucket count draws a message at the wrong width. A missing normalise
 * draws a quiet recording as silence. A missing floor draws a pause as a hole,
 * which reads as a damaged file rather than as somebody drawing breath.
 *
 * The counts here also have to agree with `VOICE_WAVEFORM_BARS` in
 * `packages/shared-types` and with the desktop's `toWaveform`, or the same
 * message is a different shape on a phone than on a laptop - and a waveform
 * that differs between devices is one nobody can trust as a position.
 */
class VoiceNoteTest {

    @Test
    fun `every message is the same number of bars`() {
        val short = VoiceNote.toWaveform(listOf(0.1f, 0.9f))
        val long = VoiceNote.toWaveform(List(3000) { (it % 7) / 7f })

        assertEquals(VoiceNote.WAVEFORM_BARS, short.size)
        assertEquals(VoiceNote.WAVEFORM_BARS, long.size)
        // Nothing measured draws nothing, and the player falls back to its
        // placeholder rather than to a row of zero-height bars.
        assertTrue(VoiceNote.toWaveform(emptyList()).isEmpty())
    }

    @Test
    fun `the same shape at any volume is the same waveform`() {
        // Input gain differs by an order of magnitude between phones. A
        // waveform is read as a shape, never as a measurement, so a quiet
        // recording has to look like a recording rather than like silence.
        val quiet = VoiceNote.toWaveform(listOf(0.001f, 0.002f, 0.004f, 0.002f), bars = 4)
        val loud = VoiceNote.toWaveform(listOf(0.25f, 0.5f, 1f, 0.5f), bars = 4)

        assertEquals(quiet.size, loud.size)
        quiet.indices.forEach { at ->
            assertEquals(loud[at], quiet[at], 0.0001f)
        }
        assertEquals(1f, loud.max(), 0.0001f)
    }

    @Test
    fun `a pause is a line and not a hole`() {
        val gap = VoiceNote.toWaveform(listOf(1f, 0f, 0f, 1f), bars = 4)

        assertTrue("silence is still drawn", gap.min() > 0f)
        assertTrue("and is still visibly quieter than speech", gap.min() < 0.2f)
    }

    @Test
    fun `silence throughout is a flat line rather than a divide by zero`() {
        val silent = VoiceNote.toWaveform(listOf(0f, 0f, 0f), bars = 4)

        assertEquals(4, silent.size)
        assertTrue(silent.all { it.isFinite() && it > 0f })
    }

    @Test
    fun `bars stay inside the range the renderer scales against`() {
        val bars = VoiceNote.toWaveform(List(500) { (it % 13) / 13f })

        assertTrue(bars.all { it > 0f && it <= 1f })
    }

    @Test
    fun `the counter agrees with the minimum length under it`() {
        assertEquals("0:00", VoiceNote.formatDuration(0f))
        assertEquals("0:09", VoiceNote.formatDuration(9f))
        assertEquals("1:09", VoiceNote.formatDuration(69f))
        assertEquals("10:00", VoiceNote.formatDuration(600f))
        // Part-seconds round down, so the counter never reads 0:01 for a
        // recording MIN_SECONDS would refuse to send.
        assertEquals("0:00", VoiceNote.formatDuration(0.9f))
        assertEquals("0:00", VoiceNote.formatDuration(-5f))
    }
}
