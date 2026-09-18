package com.aatech.betweenus.feature.voice

import android.content.Context
import android.util.DisplayMetrics
import android.view.WindowManager
import kotlin.math.max
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
     * Frame rates a share will hold, best first. The desktop's `FRAME_TIERS`.
     *
     * 24 is the floor because it is the rate film has used for a century: below
     * it motion stops reading as motion.
     */
    val FRAME_TIERS = intArrayOf(60, 30, 24)

    /**
     * The frame rate below which a share has stopped being a share.
     *
     * Not a target - a target would be read off a quiet screen and acted on.
     * This is the threshold for "the encoder wanted to send more and could not",
     * and it is only ever consulted alongside a `bandwidth` limitation.
     */
    private const val COLLAPSED_FPS = 20.0

    /**
     * The resolution steps the ladder walks, as `scaleResolutionDownBy`.
     *
     * Discrete and coarse on purpose: a continuous scale recomputed per tick is
     * a keyframe per tick. 1080p through these is 1080p, 720p, 540p, 360p.
     */
    private val SCALE_STEPS = doubleArrayOf(1.0, 1.5, 2.0, 3.0)

    /**
     * Readings before the ladder moves, in each direction.
     *
     * Down needs fewer than up. A collapsed share is already unwatchable, so
     * waiting is more of the bug; a recovered one has to prove it, because the
     * estimate rises by probing and the first good reading is the probe.
     */
    private const val SHRINK_TICKS = 2
    private const val CLIMB_TICKS = 6

    /** What the sender says about itself, per tick. See [Ladder.step]. */
    data class Reading(val limitedBy: String?, val framesPerSecond: Double?)

    /**
     * Whether a reading is evidence that the link cannot carry the picture.
     *
     * Both halves are required and that is the entire point, and it is the
     * lesson of getting this wrong: the first version of the ladder budgeted a
     * resolution against `availableOutgoingBitrate`, which is an *estimate* that
     * only grows by probing with real traffic. A screen nobody is touching
     * sends a few kbps, so the estimate sits at its starting value, the budget
     * shrinks the picture, and a smaller picture sends even less - a ratchet
     * with no way out. On a loopback link, where capacity is effectively
     * infinite, it still shrank the share.
     *
     * `bandwidth` alone is reported transiently on shares that are completely
     * fine. A low frame rate alone is the normal state of a still screen, since
     * a capturer only emits a frame when pixels change - 4 fps at 5 kbps is a
     * correct answer, not a fault. Only together are they the encoder saying it
     * wanted to send more and could not.
     */
    fun isStarved(reading: Reading): Boolean {
        if (reading.limitedBy != "bandwidth") return false
        val fps = reading.framesPerSecond ?: return false
        return fps < COLLAPSED_FPS
    }

    /**
     * Whether a reading is evidence that the *encoder*, not the link, cannot
     * keep up - a software codec asked for more pixels than the CPU can turn
     * into frames sixty times a second. The desktop's `isCpuStarved`: the
     * opposite fix from [isStarved], because a share holds its pixels and
     * gives up frames instead - see [Ladder].
     */
    fun isCpuStarved(reading: Reading): Boolean {
        if (reading.limitedBy != "cpu") return false
        val fps = reading.framesPerSecond ?: return false
        return fps < COLLAPSED_FPS
    }

    /**
     * One link's position on the ladder, over time. The desktop's `ShareLadder`.
     *
     * Two independent axes. [SCALE_STEPS] is spent only on `bandwidth`
     * evidence, [FRAME_TIERS] only on `cpu` evidence - `MAINTAIN_RESOLUTION`
     * is what keeps WebRTC's own adapter off resolution, and the frame rate is
     * this ladder's own to spend, not WebRTC's. A reading only ever reports one
     * `limitedBy` at a time, so the two axes never move on the same tick for
     * the same reason - it is not the two-scalers-on-one-picture bug, because
     * each scaler owns a resource the other never touches.
     */
    class Ladder {
        private var step = 0
        private var frameStep = 0
        private var starved = 0
        private var healthy = 0
        private var cpuStarved = 0
        private var cpuHealthy = 0

        /** The scale to publish at. 1.0 while nothing has gone wrong. */
        val scale: Double get() = SCALE_STEPS[step]

        /** The frame rate to publish at. [SCREEN_FRAME_RATE] while nothing has gone wrong. */
        val frameRate: Int get() = FRAME_TIERS[frameStep]

        /** True when the share should be re-published, which is only on a real move. */
        fun step(reading: Reading): Boolean {
            if (isStarved(reading)) {
                healthy = 0
                if (++starved < SHRINK_TICKS) return false
                starved = 0
                if (step >= SCALE_STEPS.size - 1) return false
                step += 1
                return true
            }

            if (isCpuStarved(reading)) {
                cpuHealthy = 0
                if (++cpuStarved < SHRINK_TICKS) return false
                cpuStarved = 0
                if (frameStep >= FRAME_TIERS.size - 1) return false
                frameStep += 1
                return true
            }

            starved = 0
            cpuStarved = 0

            var moved = false

            // Nothing to climb back from, which is the ordinary case: the ladder
            // spends almost every call at the top doing nothing.
            if (step != 0) {
                // A quiet share is not a recovered one, but it is not a reason
                // to stay shrunk either - there is no evidence left that the
                // link is the problem, and the only way to find out is a
                // bigger picture.
                if (++healthy >= CLIMB_TICKS) {
                    healthy = 0
                    step -= 1
                    moved = true
                }
            } else {
                healthy = 0
            }

            if (frameStep != 0) {
                if (++cpuHealthy >= CLIMB_TICKS) {
                    cpuHealthy = 0
                    frameStep -= 1
                    moved = true
                }
            } else {
                cpuHealthy = 0
            }

            return moved
        }

        /** A new capture starts at the top; nothing is known about it yet. */
        fun reset() {
            step = 0
            frameStep = 0
            starved = 0
            healthy = 0
            cpuStarved = 0
            cpuHealthy = 0
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
     * What somebody has decided the default capture is too much for - a
     * struggling connection, a weak encoder, or just a preference for
     * reliable over sharp. The desktop's `maxHeight` override, as a picker
     * rather than a number: three answers cover it, and the display's own
     * shape means a "1080p" choice on a phone is a ceiling on the long edge,
     * the same as it is on a monitor.
     *
     * This spends bits *before* the encoder ever sees a frame, which is a
     * cheaper and more reliable fix for a choppy share than anything the
     * ladder can do after the fact: fewer pixels is less to encode every
     * frame and less to fit down the link, so the ladder finds less to
     * struggle with in the first place. The receiving end draws whatever
     * arrives stretched to fill its own view - the same free upscale a
     * smaller video file already gets when played larger than it was
     * recorded - so a smaller capture is not a smaller picture for whoever
     * is watching, only a lighter one to produce and carry.
     */
    enum class ScreenQuality { AUTO, P1080, P720 }

    /** The long-edge ceiling for one choice. `AUTO` is today's [MAX_CAPTURE_EDGE]. */
    private fun captureEdgeFor(quality: ScreenQuality): Int = when (quality) {
        ScreenQuality.AUTO -> MAX_CAPTURE_EDGE
        ScreenQuality.P1080 -> 1080
        ScreenQuality.P720 -> 720
    }

    /**
     * What to hand `ScreenCapturerAndroid`: the display, in its own shape,
     * with the long edge brought down to [quality]'s ceiling if it is over.
     *
     * Both dimensions are made even. An odd width is a size no H.264 encoder
     * will take, and the failure is a share that produces no frames at all.
     */
    fun captureSize(context: Context, quality: ScreenQuality = ScreenQuality.AUTO): Size {
        val metrics = displayMetrics(context)
        return scaleToFit(metrics.widthPixels, metrics.heightPixels, captureEdgeFor(quality))
    }

    internal fun scaleToFit(width: Int, height: Int, edge: Int = MAX_CAPTURE_EDGE): Size {
        val longest = max(width, height)
        val factor = if (longest > edge) edge.toDouble() / longest else 1.0
        return Size(even((width * factor).roundToInt()), even((height * factor).roundToInt()))
    }

    /** A ceiling proportional to the pixels actually being sent. */
    fun screenBitrate(size: Size): Int {
        val pixels = max(1, size.width * size.height)
        val scaled = ((pixels.toDouble() / REFERENCE_PIXELS) * REFERENCE_BITRATE).roundToInt()
        return min(MAX_BITRATE, max(MIN_BITRATE, scaled))
    }

    /**
     * The most a share may ask for when TURN is in the path. The desktop's
     * `RELAY_MAX_BITRATE`: a relayed pair costs the relay twice its bitrate,
     * and a relay is a small VM rather than a fabric - pointing this phone's
     * full 50 Mbps ceiling at one produces loss, not 50 Mbps.
     */
    const val RELAY_MAX_BITRATE = 8_000_000

    /** Never raises anything: a manual ceiling below the relay limit stays put. */
    fun ceilingFor(bitrate: Int, relayed: Boolean): Int =
        if (relayed) min(bitrate, RELAY_MAX_BITRATE) else bitrate

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
