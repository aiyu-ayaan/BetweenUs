package com.aatech.betweenus.feature.voice

import android.content.Context
import android.util.DisplayMetrics
import android.view.WindowManager
import kotlin.math.max
import kotlin.math.min
import kotlin.math.round
import kotlin.math.sqrt
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * How much of a screen, and how many bits, a phone sends.
 *
 * The port of the numbers in `apps/desktop/src/services/share-quality.ts`, and
 * the reason they exist is the same: an out-of-the-box WebRTC share is 15 fps
 * at about 3 Mbps, which is a slideshow of a smear. Android's defaults were
 * worse still - the capture was pinned at 1280x720 at 15 fps with no encoding
 * ceiling at all, so a 1080p phone sent a downscaled, slow, thin picture and
 * there was nothing on the receiving end that could put back what was never
 * sent.
 *
 * The ceiling is a ceiling, not a target. A still screen spends a fraction of
 * it and congestion control lowers it the moment the link objects; setting it
 * too high costs nothing on a link that cannot carry it, and setting it too low
 * is a permanently soft picture.
 *
 * The desktop's `detail` profile is what this mirrors: resolution preserved,
 * frames sacrificed, because a share is usually something being read.
 *
 * ponytail: one profile, not the desktop's detail/motion pair. The picker that
 * chooses between them is a desktop affordance and a phone shares its own
 * screen, which is text far more often than it is film. The second profile is
 * the upgrade if anybody wants it.
 */
object ShareQuality {

    /** 1080p worth of pixels, the size every ceiling here is quoted against. */
    private const val REFERENCE_PIXELS = 1920 * 1080

    private const val REFERENCE_BITRATE = 20_000_000
    private const val MIN_BITRATE = 8_000_000
    private const val MAX_BITRATE = 50_000_000

    /**
     * A camera is not a screen: fewer pixels, and nothing to read on it.
     *
     * These mirror `camera-quality.ts` on the desktop, number for number, for
     * the same reason the share's do - a call has both clients in it, and two
     * ladders that disagree is a picture whose quality depends on who is
     * sending it.
     */
    private const val CAMERA_REFERENCE_BITRATE = 4_000_000
    private const val CAMERA_MIN_BITRATE = 600_000
    private const val CAMERA_MAX_BITRATE = 8_000_000

    const val SCREEN_FRAME_RATE = 60
    const val CAMERA_FRAME_RATE = 30

    /**
     * Frame rates a share will hold, best first.
     *
     * The desktop's `FRAME_TIERS` in `share-quality.ts`, number for number, for
     * the reason the bitrate ladder mirrors it: a call has both clients in it,
     * and two ladders that disagree is a picture whose smoothness depends on
     * who is sending it.
     *
     * 24 is the floor because it is the rate film has used for a century. Below
     * it motion stops reading as motion, which is the failure this exists to
     * prevent rather than a milder form of it.
     */
    val FRAME_TIERS = intArrayOf(60, 30, 24)

    /**
     * Bits per pixel per frame an H.264 screen encode needs to look clean.
     *
     * Calibrated rather than derived: 1080p60 that people call good measures
     * around 10 Mbit, and 10e6 / (1920*1080 * 60) is 0.080.
     */
    private const val BITS_PER_PIXEL_FRAME = 0.08

    /** The smallest picture worth giving up a frame rate tier to keep. */
    private const val FLOOR_HEIGHT = 540

    /** What to encode: a frame rate to hold, and the shrink that pays for it. */
    data class Adaptation(val frameRate: Int, val scale: Double)

    /**
     * What to encode, given what the link says it can carry.
     *
     * The other half of a ceiling. Everything else here is decided before the
     * share starts, from the display's size, and none of it can know what the
     * connection turned out to do - so the encoder was handed 1080p60 and a
     * 20 Mbit ceiling, the link delivered 400 kbit, and what happened next was
     * whatever `degradationPreference` said. Under `MAINTAIN_RESOLUTION` that
     * is 1080p at 2 fps: a full-size slideshow, which is not a better failure
     * than a small sharp picture but a worse one.
     *
     * `available` is `availableOutgoingBitrate` from the nominated candidate
     * pair - the congestion controller's own measurement, which was being read
     * and thrown away. Null means nothing has been measured yet, and the answer
     * is then the whole capture at the full rate: the estimator only measures
     * what is actually sent, so a share that starts small reports a small link
     * and never grows out of it.
     */
    fun adapt(captured: Size, ceiling: Int, wantedFrameRate: Int, available: Double?): Adaptation {
        if (available == null || available <= 0.0) {
            return Adaptation(wantedFrameRate, 1.0)
        }

        // The reading, held to this share's own ceiling: an estimate above what
        // the share will ever send is headroom, not permission to send more.
        val budget = min(available, ceiling.toDouble())
        val pixels = max(1, captured.width * captured.height).toDouble()

        // Tiers above what somebody asked for are not on offer: a 30 fps
        // setting is a decision, and a ladder that climbs past it does nothing.
        val ladder = FRAME_TIERS.filter { it <= wantedFrameRate }.ifEmpty { listOf(wantedFrameRate) }

        for ((index, tier) in ladder.withIndex()) {
            val affordable = budget / (tier * BITS_PER_PIXEL_FRAME)
            // Linear on each edge, so the pixel ratio is the square of it.
            val scale = sqrt(pixels / affordable)
            if (scale <= 1.0) return Adaptation(tier, 1.0)

            // The last tier has nothing below it to fall to, so it takes
            // whatever shrink the link demands.
            val last = index == ladder.size - 1
            if (last || captured.height / scale >= FLOOR_HEIGHT) {
                return Adaptation(tier, round(scale * 100) / 100)
            }
        }

        return Adaptation(ladder.last(), 1.0)
    }

    /** Consecutive readings of sustained headroom before a share climbs back up. */
    private const val CLIMB_TICKS = 5

    /**
     * Scale changes smaller than this are not changes.
     *
     * `availableOutgoingBitrate` wobbles by a few percent every second on a link
     * with nothing wrong with it, and re-encoding at 2.9x instead of 3.0x is a
     * keyframe and a visible hitch bought for nothing.
     */
    private const val SCALE_DEADBAND = 0.15

    /**
     * One link's position on the ladder, over time. The desktop's `ShareLadder`.
     *
     * [adapt] answers "what fits right now", which is not "what should change".
     * Applied straight, a per-second reading re-encodes the share every second;
     * applied symmetrically it is worse, because a share dragged down by one bad
     * second reports a smaller estimate, which is a ratchet that only tightens.
     *
     * So the directions are deliberately not symmetric. **Down immediately**: a
     * link that cannot carry the picture is already dropping frames, and waiting
     * to be sure is more seconds of the thing being fixed. **Up slowly**: the
     * estimate rises by probing, so the first rise is the probe, not the link.
     */
    class Ladder {
        var position: Adaptation? = null
            private set
        private var climbing = 0

        /** One reading. Null when nothing should change, which is most ticks. */
        fun step(captured: Size, ceiling: Int, wantedFrameRate: Int, available: Double?): Adaptation? {
            val next = adapt(captured, ceiling, wantedFrameRate, available)
            val now = position
            if (now == null) {
                position = next
                return next
            }

            val delta = next.scale - now.scale
            val worse = next.frameRate < now.frameRate || delta > SCALE_DEADBAND
            val better = next.frameRate > now.frameRate || delta < -SCALE_DEADBAND

            if (worse) {
                climbing = 0
                position = next
                return next
            }
            if (!better) {
                // Inside the deadband: the reading agrees with where the share
                // already is, and agreement is not headroom.
                climbing = 0
                return null
            }
            if (++climbing < CLIMB_TICKS) return null

            climbing = 0
            position = next
            return next
        }

        /** A new capture is a new budget: every rung was arithmetic on the old size. */
        fun reset() {
            position = null
            climbing = 0
        }
    }

    /**
     * The longest edge a phone will capture its own screen at.
     *
     * Not a quality cap so much as an encoder one: a modern phone is taller
     * than 1080p is wide, and asking a mobile encoder for every pixel of it at
     * 60 fps spends the frame budget on rows nobody is looking at. Scaling
     * before capture is free; scaling after it is the thing that looks soft.
     */
    private const val MAX_CAPTURE_EDGE = 1920

    data class Size(val width: Int, val height: Int)

    /**
     * What to hand `ScreenCapturerAndroid`: the display, in its own shape,
     * with the long edge brought down to [MAX_CAPTURE_EDGE] if it is over.
     *
     * Both dimensions are made even. An odd width is a size no H.264 encoder
     * will take, and the failure is a share that produces no frames at all.
     */
    fun captureSize(context: Context): Size {
        val metrics = displayMetrics(context)
        return scaleToFit(metrics.widthPixels, metrics.heightPixels)
    }

    internal fun scaleToFit(width: Int, height: Int): Size {
        val longest = max(width, height)
        val factor = if (longest > MAX_CAPTURE_EDGE) MAX_CAPTURE_EDGE.toDouble() / longest else 1.0
        return Size(even((width * factor).roundToInt()), even((height * factor).roundToInt()))
    }

    /** A ceiling proportional to the pixels actually being sent. */
    fun screenBitrate(size: Size): Int {
        val pixels = max(1, size.width * size.height)
        val scaled = ((pixels.toDouble() / REFERENCE_PIXELS) * REFERENCE_BITRATE).roundToInt()
        return min(MAX_BITRATE, max(MIN_BITRATE, scaled))
    }

    /**
     * A camera ceiling proportional to the pixels actually being sent.
     *
     * This was a flat 5 Mbps for every size, which is wrong in both directions
     * at once: a 360p capture was handed fourteen times the bitrate it can
     * spend, and a 1080p one was capped below what it is worth. The screen's
     * ceiling has scaled with its pixel count since it was written; the camera's
     * simply never did.
     */
    fun cameraBitrate(size: Size): Int {
        val pixels = max(1, size.width * size.height)
        val scaled =
            ((pixels.toDouble() / REFERENCE_PIXELS) * CAMERA_REFERENCE_BITRATE).roundToInt()
        return min(CAMERA_MAX_BITRATE, max(CAMERA_MIN_BITRATE, scaled))
    }

    /**
     * What to ask the camera for.
     *
     * The desktop's four names, deliberately - `CameraQuality` in
     * `camera-quality.ts`. "Set it to 720p" has to mean one thing in a support
     * conversation whichever client somebody is holding, which is the same rule
     * the noise-suppression levels follow.
     */
    enum class CameraQuality { AUTO, P360, P720, P1080 }

    /**
     * `AUTO` is 720p, and for the reason the desktop gives: a phone's front
     * sensor is good at it, and the 1080p mode above it is frequently the same
     * sensor interpolated - twice the bitrate for upscaled noise. The
     * enumerator picks the nearest format the camera really has, so none of
     * these is a demand.
     */
    fun cameraSize(quality: CameraQuality): Size = when (quality) {
        CameraQuality.P360 -> Size(640, 360)
        CameraQuality.P1080 -> Size(1920, 1080)
        else -> Size(1280, 720)
    }

    /**
     * What one video codec is worth on a screen. Higher sorts first.
     *
     * H.264 is the one codec with a hardware encoder on essentially every
     * phone, and hardware is what makes 60 fps possible without the battery
     * paying for it. That much was already asked for - but "H.264" is several
     * codecs wearing one name, and the one a phone offers first is Constrained
     * Baseline: no CABAC, no 8x8 transform, and text that is visibly softer at
     * the same bitrate. High profile is the one worth having, and a preference
     * nobody states is a preference nobody gets. The desktop's
     * `sortPreferredVideoCodecs` makes the same two distinctions.
     *
     * `profile-level-id` is three bytes and the first is the profile: `64` is
     * High, whatever constraint flags and level follow it. Read as the profile
     * rather than matched against `6400` because `640c1f` is High too.
     *
     * `packetization-mode=1` allows a NAL unit to span packets. Mode 0 caps
     * every one of them at the MTU, which at these bitrates is the encoder
     * fragmenting slices for the network's benefit rather than the picture's.
     *
     * A rank, not a filter: everything stays offered, so a phone with no High
     * profile encoder gets whatever it does have rather than a failed share.
     */
    fun codecRank(name: String, parameters: Map<String, String>): Int {
        if (!name.equals("H264", ignoreCase = true)) return 0
        val high = if (parameters["profile-level-id"]?.startsWith("64", ignoreCase = true) == true) 2 else 0
        val whole = if (parameters["packetization-mode"] == "1") 1 else 0
        return 4 + high + whole
    }

    private fun even(value: Int): Int = max(2, value - (value % 2))

    @Suppress("DEPRECATION")
    private fun displayMetrics(context: Context): DisplayMetrics {
        val manager = context.getSystemService(WindowManager::class.java)
        val metrics = DisplayMetrics()
        // The real size, including whatever the system bars are sitting on: a
        // screen share that leaves out the status bar is a screen share of a
        // different screen.
        manager.defaultDisplay.getRealMetrics(metrics)
        return metrics
    }
}
