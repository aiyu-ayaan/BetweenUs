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

    /** A camera is not a screen: fewer pixels, and nothing to read on it. */
    private const val CAMERA_BITRATE = 5_000_000

    const val SCREEN_FRAME_RATE = 60
    const val CAMERA_FRAME_RATE = 30

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

    fun cameraBitrate(): Int = CAMERA_BITRATE

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
