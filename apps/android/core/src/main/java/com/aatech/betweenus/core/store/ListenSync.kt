package com.aatech.betweenus.core.store

import kotlin.math.abs

/**
 * Keeping this phone's player in step with the rest of the call.
 *
 * The Kotlin half of `apps/desktop/src/services/listen-sync.ts`, and the
 * numbers are that file's rather than new ones: two clients correcting on
 * different tolerances is two clients that disagree about whether they are in
 * step, which is worse than either tolerance alone.
 *
 * The gateway says where a track was and when. Turning that into "seek to here,
 * now" needs two things, and only one of them lives here.
 *
 * **A shared clock** is [ServerClock]'s job, already measured for message
 * timestamps and reused rather than measured a second time. Two devices' clocks
 * differ by whatever their time daemons last settled on - milliseconds usually,
 * seconds sometimes, and on a phone that has been in a drawer, whatever it
 * likes until the next sync. A session trusting `System.currentTimeMillis()`
 * would be exactly as far out of step as the clocks are, and nobody could tell
 * why.
 *
 * **A tolerance** is this file's. A player is not an oscillator: it buffers, it
 * rebuffers, and it decodes at whatever rate the phone manages. Correcting
 * every few milliseconds of that means seeking constantly, and a seek is a gap
 * in the music - the cure far worse than the disease.
 *
 * What this deliberately does not do is nudge the playback rate to close small
 * gaps smoothly. It is the textbook answer and it does not work here for the
 * same reason it does not work on the desktop: the YouTube embed quantises rate
 * to the values in its own menu, so a request for 1.04 is refused or rounded to
 * 1.25, which is a chipmunk rather than a correction.
 */
object ListenSync {

    /**
     * How far out a player may drift before it is pulled back.
     *
     * A second and a half, the desktop's number. Below that everybody is
     * listening to the same thing and the difference is smaller than the gap
     * between two speakers in one room; above it, somebody says "this bit" and
     * the other person heard it already. Tightening it does not make the
     * feature better - it makes it seek every few minutes, which is the one
     * thing unambiguously worse than being slightly out.
     */
    const val DRIFT_TOLERANCE_MS = 1_500L

    /** How often a client checks itself against the shared position. */
    const val DRIFT_CHECK_MS = 5_000L

    /**
     * How far a *paused* player may be out, which is far less.
     *
     * Nothing is moving, so there is no tolerance to spend: two people staring
     * at a stopped track that reads different numbers is the most obviously
     * broken this can look.
     */
    const val PAUSED_TOLERANCE_MS = 250L

    /**
     * How far this player is from where the call says it should be.
     *
     * Positive means behind: the rest of the call has heard something this
     * player has not reached yet.
     */
    fun driftOf(session: ListenSession, serverNowMs: Long, actualMs: Long): Long =
        listenPositionAt(session, serverNowMs) - actualMs

    /**
     * Where to seek to, or null to leave the player alone.
     *
     * The target is read at the moment of the decision rather than reused from
     * the drift measurement, because a seek is not instant and the track keeps
     * moving while it happens - seeking to where the call *was* is how a
     * correction lands a fraction behind and immediately needs another.
     */
    fun correction(session: ListenSession, serverNowMs: Long, actualMs: Long): Long? {
        if (session.paused) {
            val target = session.positionMs
            return if (abs(target - actualMs) > PAUSED_TOLERANCE_MS) target else null
        }
        val drift = driftOf(session, serverNowMs, actualMs)
        if (abs(drift) <= DRIFT_TOLERANCE_MS) return null
        return listenPositionAt(session, serverNowMs)
    }
}
