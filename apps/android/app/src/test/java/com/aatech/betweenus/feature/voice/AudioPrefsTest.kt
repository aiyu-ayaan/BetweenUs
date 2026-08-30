package com.aatech.betweenus.feature.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The two decisions in [AudioPrefs] that nobody can check by looking at a phone.
 *
 * Both are pure functions taking what would otherwise be read out of
 * `SharedPreferences` and off an `AudioManager`, which is the only reason they
 * are testable at all: the object itself needs a `Context`, and a silent
 * failure in either of these looks exactly like the app working.
 *
 * The migration is the more dangerous of the two. A person who turned noise
 * suppression off did it because their microphone sounded wrong with it on;
 * quietly turning it back on during an update is the same bug as never having
 * had the setting.
 */
class AudioPrefsTest {

    @Test
    fun `the old switch carries over to the level that means the same thing`() {
        assertEquals(
            AudioPrefs.NoiseSuppression.STANDARD,
            AudioPrefs.suppressionOf(level = null, legacy = true),
        )
        assertEquals(
            AudioPrefs.NoiseSuppression.OFF,
            AudioPrefs.suppressionOf(level = null, legacy = false),
        )
    }

    @Test
    fun `a phone that has never had either key gets the default`() {
        assertEquals(
            AudioPrefs.NoiseSuppression.STANDARD,
            AudioPrefs.suppressionOf(level = null, legacy = null),
        )
    }

    @Test
    fun `a chosen level outranks whatever the old switch still says`() {
        // The old key is read and never written, so it keeps saying "on" long
        // after somebody has turned suppression off in the new control.
        assertEquals(
            AudioPrefs.NoiseSuppression.OFF,
            AudioPrefs.suppressionOf(level = "OFF", legacy = true),
        )
        assertEquals(
            AudioPrefs.NoiseSuppression.HIGH,
            AudioPrefs.suppressionOf(level = "HIGH", legacy = false),
        )
    }

    @Test
    fun `a level this build cannot read falls back to the migration, not the default`() {
        // A newer build writing a level this one does not know must not turn
        // suppression back on for somebody who had turned it off.
        assertEquals(
            AudioPrefs.NoiseSuppression.OFF,
            AudioPrefs.suppressionOf(level = "AGGRESSIVE", legacy = false),
        )
    }

    @Test
    fun `the earpiece is left to the phone's own cancellers`() {
        val setup = AudioPrefs.hardwareProcessingFor(
            mode = AudioPrefs.Mode.CLEAR,
            echo = true,
            suppression = AudioPrefs.NoiseSuppression.STANDARD,
            loudspeaker = false,
        )
        assertTrue(setup.echoCanceller)
        assertTrue(setup.noiseSuppressor)
    }

    @Test
    fun `the loudspeaker is where WebRTC cancels the echo itself`() {
        // The actual fix. The OEM canceller is tuned for an earpiece and the
        // loudspeaker is what people complain about.
        val setup = AudioPrefs.hardwareProcessingFor(
            mode = AudioPrefs.Mode.CLEAR,
            echo = true,
            suppression = AudioPrefs.NoiseSuppression.STANDARD,
            loudspeaker = true,
        )
        assertFalse(setup.echoCanceller)
    }

    @Test
    fun `high suppression refuses the hardware path on both counts`() {
        val setup = AudioPrefs.hardwareProcessingFor(
            mode = AudioPrefs.Mode.CLEAR,
            echo = true,
            suppression = AudioPrefs.NoiseSuppression.HIGH,
            loudspeaker = false,
        )
        assertFalse(setup.echoCanceller)
        assertFalse(setup.noiseSuppressor)
    }

    @Test
    fun `switching echo cancellation off asks nobody to cancel it`() {
        val setup = AudioPrefs.hardwareProcessingFor(
            mode = AudioPrefs.Mode.CLEAR,
            echo = false,
            suppression = AudioPrefs.NoiseSuppression.STANDARD,
            loudspeaker = false,
        )
        assertFalse(setup.echoCanceller)
    }

    @Test
    fun `suppression off leaves the hardware suppressor alone too`() {
        val setup = AudioPrefs.hardwareProcessingFor(
            mode = AudioPrefs.Mode.CLEAR,
            echo = true,
            suppression = AudioPrefs.NoiseSuppression.OFF,
            loudspeaker = false,
        )
        assertFalse(setup.noiseSuppressor)
    }

    @Test
    fun `high fidelity mode turns every canceller off, as it does the constraints`() {
        val setup = AudioPrefs.hardwareProcessingFor(
            mode = AudioPrefs.Mode.HIFI,
            echo = true,
            suppression = AudioPrefs.NoiseSuppression.STANDARD,
            loudspeaker = false,
        )
        assertFalse(setup.echoCanceller)
        assertFalse(setup.noiseSuppressor)
    }
}
