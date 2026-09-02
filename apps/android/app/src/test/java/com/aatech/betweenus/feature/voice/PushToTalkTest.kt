package com.aatech.betweenus.feature.voice

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The same cases as `apps/desktop/src/services/push-to-talk.check.ts`, plus the
 * one the desktop does not have: an interruption, which on a phone is a real
 * telephone call arriving.
 *
 * Every case here fails silently in the direction that matters. A policy that
 * wrongly *passes* audio is a microphone somebody believes is closed, and
 * nothing on screen distinguishes it from one that is.
 */
class PushToTalkTest {

    @Test
    fun `with the mode off the microphone is simply open`() {
        // What a call did before any of this existed, and what it must still do
        // for everybody who never turns this on.
        assertTrue(PushToTalk.shouldPassAudio(muted = false, held = false, pushToTalk = false, talking = false))
        assertTrue(PushToTalk.shouldPassAudio(muted = false, held = false, pushToTalk = false, talking = true))
    }

    @Test
    fun `with the mode on nothing passes until the control is down`() {
        assertFalse(PushToTalk.shouldPassAudio(muted = false, held = false, pushToTalk = true, talking = false))
        assertTrue(PushToTalk.shouldPassAudio(muted = false, held = false, pushToTalk = true, talking = true))
    }

    @Test
    fun `mute outranks a held control`() {
        // Somebody who muted themselves and then leans on the talk button meant
        // the mute. The opposite reading makes the mute button a suggestion.
        assertFalse(PushToTalk.shouldPassAudio(muted = true, held = false, pushToTalk = true, talking = true))
        assertFalse(PushToTalk.shouldPassAudio(muted = true, held = false, pushToTalk = false, talking = true))
    }

    @Test
    fun `an interruption outranks everything`() {
        // The system took the audio. Nothing this app decides changes that, and
        // pretending otherwise sends silence while drawing a live microphone.
        assertFalse(PushToTalk.shouldPassAudio(muted = false, held = true, pushToTalk = true, talking = true))
        assertFalse(PushToTalk.shouldPassAudio(muted = false, held = true, pushToTalk = false, talking = false))
    }

    @Test
    fun `the far end is told what the capture is doing, not what the button says`() {
        // Push to talk, control up, button not muted: no audio is arriving, so
        // a tile that reads "live" is a tile somebody waits on.
        assertTrue(
            PushToTalk.publishedAsMuted(muted = false, held = false, pushToTalk = true, talking = false),
        )
        assertFalse(
            PushToTalk.publishedAsMuted(muted = false, held = false, pushToTalk = true, talking = true),
        )
        // And with the mode off it is exactly the button, as it always was.
        assertFalse(
            PushToTalk.publishedAsMuted(muted = false, held = false, pushToTalk = false, talking = false),
        )
    }
}
