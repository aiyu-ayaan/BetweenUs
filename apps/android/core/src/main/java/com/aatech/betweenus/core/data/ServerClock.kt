package com.aatech.betweenus.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.abs

/**
 * What time the *server* thinks it is, and what to do when this phone
 * disagrees.
 *
 * A device clock belongs to whoever holds the device. It drifts on its own, and
 * it can be set to any value at all in Settings - which is the part that
 * matters. Anything that expires (a one-time message, an invite, a grant, a
 * session) must therefore be decided by a clock its owner cannot move:
 *
 * - **Enforcement is the server's, always.** Nothing this app believes about
 *   the time is allowed to grant access to anything. The services already work
 *   this way - `resolveRemoteAccess` compares a grant's `expiresAt` to the
 *   database's clock, refresh tokens and password resets to the auth service's
 *   - and any expiry added later belongs there too, not here. Winding a phone
 *   forward or back must not change what the server hands over.
 * - **What the app shows is the server's clock too.** That is what this is for:
 *   a countdown, an "Expired" label, a "Today" divider on yesterday's messages.
 *   A wrong phone clock cannot open anything, but it can quietly lie to the
 *   person reading, and a chat that says a message arrives tomorrow reads as
 *   broken software rather than as a wrong clock.
 *
 * The offset is learned for free: every HTTP response carries a `Date` header,
 * so [Http] hands one sample per request to [sample] and the estimate is NTP's
 * - the server stamped that header somewhere between the request leaving and
 * the response arriving, so the midpoint of the round trip is the best guess
 * available, and the least-delayed sample is the one to believe.
 *
 * The desktop's `services/server-clock.ts` is this file, case for case.
 */
object ServerClock {

    /**
     * How wrong a phone clock has to be before the person is told: five
     * minutes. Below it nothing on screen misleads - a bubble a few seconds out
     * is still under the right day - and above it the day dividers start naming
     * the wrong day, which is worth a line at the top of the conversation.
     */
    const val WARNING_MS = 5 * 60 * 1000L

    /** How many measurements are kept when picking the least-delayed one. */
    const val SAMPLES = 8

    /** One round trip: when it left, when it came back, and the server's stamp. */
    data class Sample(val sentAtMs: Long, val receivedAtMs: Long, val serverMs: Long)

    private val samples = ArrayDeque<Sample>()

    private val _offsetMs = MutableStateFlow(0L)

    /**
     * Server time minus this phone's, in milliseconds. Zero until measured.
     *
     * A flow because the banner is drawn from it: the first reply of a session
     * is what turns a wrong clock from unknown into known, and that arrives
     * after the screen already exists.
     */
    val offsetMs: StateFlow<Long> = _offsetMs.asStateFlow()

    /** The server's clock, as best this phone can tell. Never used to *decide*. */
    fun nowMs(): Long = System.currentTimeMillis() + _offsetMs.value

    /** Today, on the server's clock, in the reader's own zone. */
    fun today(): LocalDate =
        Instant.ofEpochMilli(nowMs()).atZone(ZoneId.systemDefault()).toLocalDate()

    /** Whether a measured offset is wrong enough to say so. */
    fun isWrong(offsetMs: Long = _offsetMs.value): Boolean = abs(offsetMs) >= WARNING_MS

    /**
     * The banner's words: which way the phone is out, and roughly how far.
     * "About 4320 minutes" is not a sentence, so the unit grows with the gap.
     */
    fun wording(offsetMs: Long): String {
        val minutes = Math.round(abs(offsetMs) / 60_000.0)
        val amount = when {
            minutes >= 2880 -> "${Math.round(minutes / 1440.0)} days"
            minutes >= 120 -> "${Math.round(minutes / 60.0)} hours"
            else -> "$minutes minutes"
        }
        val direction = if (offsetMs < 0) "ahead of" else "behind"
        return "This phone's clock is about $amount $direction the server's. " +
            "Times and dates on messages will look wrong until it is corrected."
    }

    /**
     * One measurement, from a response that has already arrived.
     *
     * A missing or unparseable header teaches nothing rather than something
     * wrong: a proxy that strips `Date`, or writes nonsense into it, must not
     * be able to move this client's idea of the time.
     */
    fun sample(sentAtMs: Long, receivedAtMs: Long, serverMs: Long?) {
        if (serverMs == null || serverMs <= 0L) return
        synchronized(samples) {
            samples.addLast(Sample(sentAtMs, receivedAtMs, serverMs))
            while (samples.size > SAMPLES) samples.removeFirst()
            _offsetMs.value = bestOffset(samples.toList())
        }
    }

    /** Forget everything measured - a different deployment is a different clock. */
    fun reset() {
        synchronized(samples) {
            samples.clear()
            _offsetMs.value = 0L
        }
    }
}

/**
 * How far this phone's clock is behind the server's, from one measurement.
 *
 * The server stamped the response somewhere between the request leaving and the
 * reply arriving. With no way to know where in that window, the midpoint is the
 * estimate - which is exactly NTP's, and is wrong by at most half the asymmetry
 * of the round trip.
 */
fun offsetOf(sample: ServerClock.Sample): Long =
    sample.serverMs + (sample.receivedAtMs - sample.sentAtMs) / 2 - sample.receivedAtMs

/**
 * The best offset out of several measurements: the one from the fastest round
 * trip.
 *
 * Not the average. A slow round trip is slow because something queued, and a
 * queue is almost never symmetric - so a delayed sample is not noisier than a
 * fast one, it is *biased*, and averaging spreads that bias over the answer.
 * NTP picks the same way, for the same reason.
 */
fun bestOffset(samples: List<ServerClock.Sample>): Long {
    val best = samples.minByOrNull { it.receivedAtMs - it.sentAtMs } ?: return 0L
    return offsetOf(best)
}
