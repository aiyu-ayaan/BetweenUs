package com.aatech.betweenus.feature.voice

/**
 * Talk while a control is held.
 *
 * The gate ([MicGate]) answers "is somebody making a noise". This answers a
 * different question - "do you mean to be heard" - and no threshold gets there:
 * a bus, a television and somebody else's conversation are all above any level
 * that still passes a quiet voice.
 *
 * ## Why this is a button and not a key
 *
 * The desktop's version is a held key, listened for on the window
 * (`apps/desktop/src/services/push-to-talk.ts`). A phone has no key to hold, so
 * the port is a control held with a thumb: press to open, release to close. The
 * policy underneath is the same one and is written here so that both clients
 * can be checked against the same cases.
 *
 * The failure this is shaped around is the same on both: a microphone that
 * opens and is never told to close. On the desktop that is a key released while
 * another window has focus; here it is the call screen going away, or a
 * gesture the system cancels mid-press. Every one of those closes it, because a
 * push-to-talk that can stick open is worse than none at all - somebody trusts
 * it and is heard.
 */
object PushToTalk {

    /**
     * Whether the microphone should be passing audio right now.
     *
     * Four inputs and they are four different questions, which is why this is
     * not one flag:
     *
     * - [muted] is the button: whether this client means to be in the call at
     *   all. It outranks everything, including a held control - somebody who
     *   muted themselves and then leans on the talk button meant the mute.
     * - [held] is an interruption ([VoiceEngine.Interruption.HOLD]): the system
     *   took the audio. Nothing this app decides can override that.
     * - [pushToTalk] is the mode. Off, and the microphone is open, which is
     *   what a call did before any of this existed.
     * - [talking] is the control being down, and only matters in that mode.
     */
    fun shouldPassAudio(
        muted: Boolean,
        held: Boolean,
        pushToTalk: Boolean,
        talking: Boolean,
    ): Boolean {
        if (muted || held) return false
        return if (pushToTalk) talking else true
    }

    /**
     * What the far end is told, which is not the same question.
     *
     * A push-to-talk client between sentences is muted in every sense the
     * person listening cares about: no audio is arriving, and a tile that says
     * otherwise is a tile somebody waits on. So the media state carries the
     * same answer the capture does rather than only the button's.
     *
     * The alternative - publishing the button alone - is what makes a
     * push-to-talk participant look permanently live in the roster while saying
     * nothing, which reads as a broken microphone rather than as a released
     * key.
     */
    fun publishedAsMuted(
        muted: Boolean,
        held: Boolean,
        pushToTalk: Boolean,
        talking: Boolean,
    ): Boolean = !shouldPassAudio(muted, held, pushToTalk, talking)
}
