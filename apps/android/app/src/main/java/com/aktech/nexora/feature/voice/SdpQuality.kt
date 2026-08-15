package com.aktech.nexora.feature.voice

import kotlin.math.max
import kotlin.math.roundToInt

/**
 * What the phone tells the other end it is willing to receive.
 *
 * Sending quality is the sender's business; receiving quality is not. Three
 * things in an SDP decide what arrives, and Android's defaults get all three
 * wrong for a screen share:
 *
 * **The H.264 level.** `profile-level-id` ends in a level byte, and a level is
 * a hard ceiling on resolution and frame rate - 3.1, which is what a phone
 * decoder usually advertises, means 1280x720 at 30. The sender obeys it: a
 * desktop sharing 1080p60 to a phone that asked for level 3.1 encodes 720p30
 * and there is nothing on the receiving end that can put back the difference.
 * Every phone shipping an H.264 decoder in the last decade can decode far more
 * than its default answer admits to, so the level is raised to 5.2.
 *
 * **The bandwidth line.** With no `b=AS` the sender is left to guess, and
 * WebRTC's estimator guesses conservatively. Saying the number is what makes
 * the difference between a picture that sharpens over ten seconds and one that
 * starts sharp.
 *
 * **The start bitrate.** Congestion control begins around 300 kbps and ramps
 * slowly, which on a direct peer-to-peer link is caution paid for by every
 * viewer in the first ten seconds. `x-google-start-bitrate` skips the ramp.
 *
 * The same three the desktop patches into its own descriptions - see
 * `patchVideoBandwidth` in `apps/desktop/src/services/share-quality.ts`. The
 * two clients are talking to each other, so what one asks for the other has to
 * be able to say.
 *
 * Pure string work on purpose: this is the part worth testing, and it needs no
 * peer connection to test.
 */
object SdpQuality {

    /**
     * H.264 level 5.2: 4K at 60, far more than anything here sends. The point
     * is to stop the level being the limit; the bitrate ceiling and congestion
     * control are what actually decide.
     */
    private const val TARGET_LEVEL = 0x34

    /** Applies all three to every video section of an SDP. */
    fun patch(sdp: String, maxBitrateBps: Int): String {
        val maxKbps = max(1, (maxBitrateBps / 1000.0).roundToInt())
        val minKbps = max(1000, (maxKbps * 0.25).roundToInt())
        val startKbps = max(minKbps, (maxKbps * 0.6).roundToInt())

        // Split before each m= line, so a section is one media stream and
        // whatever preceded the first one is left alone.
        return sdp.split(Regex("(?=m=)")).joinToString("") { section ->
            if (!section.startsWith("m=video")) {
                section
            } else {
                section
                    .let { bandwidth(it, maxKbps, maxBitrateBps) }
                    .let { bitrateHints(it, minKbps, maxKbps, startKbps) }
                    .let { raiseH264Level(it) }
            }
        }
    }

    /** `b=AS` in kbps and `b=TIAS` in bps, right after the connection line. */
    internal fun bandwidth(section: String, maxKbps: Int, maxBps: Int): String {
        val stripped = section
            .replace(Regex("b=AS:\\d+\\r?\\n", RegexOption.IGNORE_CASE), "")
            .replace(Regex("b=TIAS:\\d+\\r?\\n", RegexOption.IGNORE_CASE), "")

        val lines = "b=AS:$maxKbps\r\nb=TIAS:$maxBps\r\n"
        val connection = Regex("c=IN[^\\r\\n]*\\r?\\n", RegexOption.IGNORE_CASE)
        return if (connection.containsMatchIn(stripped)) {
            connection.spliceFirst(stripped) { "${it.value}$lines" }
        } else {
            Regex("m=video[^\\r\\n]*\\r?\\n").spliceFirst(stripped) { "${it.value}$lines" }
        }
    }

    /** Google's non-standard but universally honoured bitrate hints. */
    internal fun bitrateHints(section: String, minKbps: Int, maxKbps: Int, startKbps: Int): String {
        val hints = "x-google-min-bitrate=$minKbps;" +
            "x-google-max-bitrate=$maxKbps;" +
            "x-google-start-bitrate=$startKbps"

        var patched = section
        for (payload in Regex("^a=rtpmap:(\\d+)\\s+\\S+/90000", RegexOption.MULTILINE)
            .findAll(section)
            .map { it.groupValues[1] }
            .toList()) {
            val fmtp = Regex("^a=fmtp:$payload (.+)$", RegexOption.MULTILINE)
            patched = if (fmtp.containsMatchIn(patched)) {
                fmtp.spliceFirst(patched) { "a=fmtp:$payload ${it.groupValues[1]};$hints" }
            } else {
                Regex("a=rtpmap:$payload[^\\r\\n]*\\r?\\n", RegexOption.MULTILINE)
                    .spliceFirst(patched) { "${it.value}a=fmtp:$payload $hints\r\n" }
            }
        }
        return patched
    }

    /**
     * Replaces the first match with whatever [transform] makes of it.
     *
     * `Regex.replaceFirst` only takes a literal, and `Regex.replace` with a
     * lambda replaces every match - which here would put the bandwidth line
     * after every connection line in the section.
     */
    private fun Regex.spliceFirst(input: String, transform: (MatchResult) -> String): String {
        val match = find(input) ?: return input
        return input.substring(0, match.range.first) +
            transform(match) +
            input.substring(match.range.last + 1)
    }

    /**
     * Raises the level byte of every `profile-level-id`, leaving the profile
     * and its constraint flags alone - those say what the decoder can parse,
     * and claiming a profile it cannot is a stream it cannot decode at all.
     * The level is the only part being under-claimed.
     */
    internal fun raiseH264Level(section: String): String =
        Regex("profile-level-id=([0-9a-fA-F]{6})").replace(section) { match ->
            val id = match.groupValues[1]
            val level = id.substring(4, 6).toInt(16)
            if (level >= TARGET_LEVEL) {
                match.value
            } else {
                "profile-level-id=${id.substring(0, 4)}${"%02x".format(TARGET_LEVEL)}"
            }
        }
}
