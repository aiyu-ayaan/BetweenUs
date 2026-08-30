package com.aatech.betweenus.feature.voice

import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * What the call is actually doing, in numbers.
 *
 * A port of `apps/desktop/src/services/call-stats.ts`, arithmetic for
 * arithmetic - and a port rather than a second design because the two clients
 * are in the same call and must not disagree about what 5% loss is. Its
 * self-check mirrors `call-stats.check.ts` for the same reason `ImageEditTest`
 * mirrors `image-edit.check.ts`.
 *
 * Until this existed on a phone, "it looks bad" and "the link is bad" were the
 * same sentence, and the phone was the client with no way to tell them apart:
 * a desktop can at least be asked to open `chrome://webrtc-internals`.
 *
 * The arithmetic is here and pure; the sampling is in [VoiceEngine], which is
 * the only thing holding a peer connection to ask.
 */

/** One `getStats` sample of one peer connection, already reduced to numbers. */
data class LinkSample(
    val at: Long,
    /** Bytes this peer has sent us, ever, per kind. */
    val inboundAudioBytes: Long = 0,
    val inboundVideoBytes: Long = 0,
    /** Bytes we have sent them, ever. */
    val outboundAudioBytes: Long = 0,
    val outboundVideoBytes: Long = 0,
    /** Packets they sent that never arrived, and the ones that did. */
    val packetsLost: Long = 0,
    val packetsReceived: Long = 0,
    /** Round trip on the selected candidate pair, in seconds, when known. */
    val roundTripSeconds: Double? = null,
    /** The screen or camera as it arrives, when one does. */
    val frameWidth: Int? = null,
    val frameHeight: Int? = null,
    val framesPerSecond: Double? = null,
    /**
     * Whether this link has a path at all: ICE settled and DTLS came up.
     *
     * Distinct from every byte counter above, which cannot tell "connected and
     * saying nothing" from "never connected" - both read as a still counter.
     */
    val connected: Boolean = true,
    /**
     * "direct" or "relay" once ICE has settled on a pair, null before that.
     *
     * Costs an operator nothing when it is direct and relay bandwidth when it
     * is not, and nowhere else can see which: the server is not in the path.
     */
    val transport: String? = null,
)

/** What a person is shown about one other person in the call. */
data class LinkStats(
    val peerId: String,
    val name: String,
    /** Null until there are two samples to compare. */
    val downKbps: Int? = null,
    val upKbps: Int? = null,
    /** Percentage of their packets that never arrived, over the whole call. */
    val lossPercent: Double? = null,
    val roundTripMs: Int? = null,
    val frameWidth: Int? = null,
    val frameHeight: Int? = null,
    val framesPerSecond: Int? = null,
    /** False when we are sending them no audio at all - see [notBeingHeard]. */
    val sendingAudio: Boolean = true,
    /** False while this link has no path at all - see [notBeingHeard]. */
    val connected: Boolean = true,
)

object CallStats {

    /**
     * Kilobits per second between two samples.
     *
     * Null rather than zero when there is nothing to compare, because "no
     * reading yet" and "nothing is flowing" are the two answers this is asked
     * for, and showing 0 kbps for the first second of every call is how a
     * healthy call gets reported as broken.
     */
    fun kbpsBetween(bytesNow: Long, bytesBefore: Long, msElapsed: Long): Int? {
        if (msElapsed <= 0) return null
        val bytes = bytesNow - bytesBefore
        // A counter that went backwards is a connection that was rebuilt
        // underneath us; the next sample will be right and this one is not
        // worth guessing at.
        if (bytes < 0) return null
        return ((bytes * 8).toDouble() / msElapsed).roundToInt()
    }

    /** Share of their packets that never arrived, as a percentage. */
    fun lossPercent(lost: Long, received: Long): Double? {
        val total = lost + received
        if (total <= 0) return null
        return (lost.toDouble() / total * 1000).roundToLong() / 10.0
    }

    /**
     * "Your microphone is not being heard."
     *
     * The one warning worth interrupting somebody for. It is true when this
     * client believes it is sending audio and the bytes on the wire say
     * otherwise for long enough that it cannot be a pause.
     *
     * Deliberately not derived from "am I speaking": somebody silent for ten
     * seconds is still being heard, and a microphone muted at the OS level
     * sends comfort noise rather than nothing at all. What this catches is the
     * capture that failed, the device that was unplugged, and the sender that
     * was never attached.
     *
     * And deliberately only over links that have a path. A connection that
     * never came up carries nothing in either direction, so the best microphone
     * in the world reads as silent on it, and "nobody can hear you, try another
     * input" is then the wrong answer to a call that had simply failed to
     * connect - prominent, actionable, and impossible to act on successfully.
     */
    fun notBeingHeard(
        intendsToSend: Boolean,
        stats: List<LinkStats>,
        quietSamples: Int,
        requiredSamples: Int = 3,
    ): Boolean {
        if (!intendsToSend) return false
        if (quietSamples < requiredSamples) return false
        // Nobody to be heard by: an empty call, or one where no link has a
        // path. Neither is evidence about the microphone.
        val reachable = stats.filter { it.connected }
        if (reachable.isEmpty()) return false
        return reachable.none { it.sendingAudio }
    }

    /**
     * A short sentence about the link, or null when there is nothing worth
     * saying.
     *
     * One threshold per problem, chosen where a person would notice: 5% loss is
     * where speech starts breaking up, and 300 ms round trip is where a
     * conversation starts talking over itself.
     */
    fun healthWarning(stats: List<LinkStats>): String? {
        val lossy = stats.filter { (it.lossPercent ?: 0.0) >= 5 }
        if (lossy.isNotEmpty()) {
            val worst = lossy.maxOf { it.lossPercent ?: 0.0 }
            return if (lossy.size == 1) {
                "Losing ${trim(worst)}% of the packets from ${lossy[0].name}"
            } else {
                "Losing packets from ${lossy.size} people - up to ${trim(worst)}%"
            }
        }

        val slow = stats.filter { (it.roundTripMs ?: 0) >= 300 }
        if (slow.isNotEmpty()) {
            val worst = slow.maxOf { it.roundTripMs ?: 0 }
            return "Round trip of $worst ms - expect to talk over each other"
        }

        return null
    }

    /** Turns two samples into what the panel shows. */
    fun toStats(
        peerId: String,
        name: String,
        now: LinkSample,
        before: LinkSample?,
    ): LinkStats {
        val elapsed = if (before != null) now.at - before.at else 0L

        return LinkStats(
            peerId = peerId,
            name = name,
            downKbps = before?.let {
                kbpsBetween(
                    now.inboundAudioBytes + now.inboundVideoBytes,
                    it.inboundAudioBytes + it.inboundVideoBytes,
                    elapsed,
                )
            },
            upKbps = before?.let {
                kbpsBetween(
                    now.outboundAudioBytes + now.outboundVideoBytes,
                    it.outboundAudioBytes + it.outboundVideoBytes,
                    elapsed,
                )
            },
            lossPercent = lossPercent(now.packetsLost, now.packetsReceived),
            roundTripMs = now.roundTripSeconds?.let { (it * 1000).roundToInt() },
            frameWidth = now.frameWidth,
            frameHeight = now.frameHeight,
            framesPerSecond = now.framesPerSecond?.roundToInt(),
            // Any movement at all counts. Opus sends a few hundred bytes a
            // second even through silence, so a sender that is attached and
            // working is never still.
            sendingAudio = if (before != null) {
                now.outboundAudioBytes > before.outboundAudioBytes
            } else {
                true
            },
            connected = now.connected,
        )
    }

    /**
     * Kilobits until it is silly, then megabits. A share is megabits.
     *
     * The same two words the desktop panel uses, because the same person reads
     * both and a number that changes units between clients is a number they
     * have to think about.
     */
    fun rate(kbps: Int?): String = when {
        kbps == null -> "—"
        kbps < 1000 -> "$kbps kbps"
        else -> "${"%.1f".format(kbps / 1000.0)} Mbps"
    }

    /** `0.8`, not `0.8000000000000001`; and `5`, not `5.0`. */
    private fun trim(value: Double): String =
        if (value == value.toLong().toDouble()) value.toLong().toString() else value.toString()

    /** The frame line, when a picture is arriving at all. */
    fun resolution(link: LinkStats): String? {
        val width = link.frameWidth ?: return null
        val height = link.frameHeight ?: return null
        if (width <= 0 || height <= 0) return null
        val rate = link.framesPerSecond?.takeIf { it > 0 }?.let { " @ $it" } ?: ""
        return "$width×$height$rate"
    }

    /** Where a number stops being fine and starts being the reason for the panel. */
    fun lossTone(percent: Double?): Tone = when {
        percent == null -> Tone.PLAIN
        percent >= 5 -> Tone.BAD
        percent >= 1 -> Tone.WARN
        else -> Tone.PLAIN
    }

    fun roundTripTone(ms: Int?): Tone = when {
        ms == null -> Tone.PLAIN
        ms >= 300 -> Tone.BAD
        ms >= 150 -> Tone.WARN
        else -> Tone.PLAIN
    }

    enum class Tone { PLAIN, WARN, BAD }

    /**
     * The biggest picture arriving on this connection, which is the share when
     * there is one and the camera otherwise - the number somebody actually
     * wants when they ask why it looks soft.
     */
    fun larger(
        current: Triple<Int?, Int?, Double?>,
        width: Int,
        height: Int,
        rate: Double,
    ): Triple<Int?, Int?, Double?> {
        val area = width.toLong() * height.toLong()
        val best = (current.first ?: 0).toLong() * (current.second ?: 0).toLong()
        if (area <= best) return current
        return Triple(
            width.takeIf { it > 0 },
            height.takeIf { it > 0 },
            rate.takeIf { it > 0 },
        )
    }
}
