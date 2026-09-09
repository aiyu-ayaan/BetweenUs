package com.aatech.betweenus.feature.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The camera's size ladder and its bitrate ceiling.
 *
 * Both used to be one number each - 1080p asked for on every phone, and a flat
 * 5 Mbps published whatever came back. That is wrong in two directions at once
 * and neither is visible on the phone doing it: the sender sees its own
 * preview, and only the other end sees the picture that was actually sent.
 *
 * These are the desktop's numbers, and they have to stay the desktop's numbers.
 * A call has both clients in it, and two ladders that disagree is a quality
 * that depends on who is holding which device - see `camera-quality.check.ts`,
 * which asserts the same values on the other side.
 */
class CameraQualityTest {

    private fun size(width: Int, height: Int) = ShareQuality.Size(width, height)

    @Test
    fun `the reference size gets the reference bitrate`() {
        assertEquals(4_000_000, ShareQuality.cameraBitrate(size(1920, 1080)))
    }

    @Test
    fun `the ceiling follows the pixel count`() {
        val fhd = ShareQuality.cameraBitrate(size(1920, 1080))
        val hd = ShareQuality.cameraBitrate(size(1280, 720))
        val sd = ShareQuality.cameraBitrate(size(640, 360))

        // The guarded bug is the flat number this replaced: a 360p capture
        // handed many times the bitrate it can spend, and a 1080p one capped
        // below what it is worth.
        assertTrue("$hd should be under $fhd", hd < fhd)
        assertTrue("$sd should be under $hd", sd < hd)
    }

    @Test
    fun `both ends of the ceiling hold`() {
        // A postage stamp must not fall to a bitrate that makes a face blocky.
        assertEquals(600_000, ShareQuality.cameraBitrate(size(2, 2)))
        // And a camera claiming an absurd size must not be handed a ceiling no
        // mobile encoder will honour.
        assertEquals(8_000_000, ShareQuality.cameraBitrate(size(7680, 4320)))
    }

    @Test
    fun `a camera is worth far less per pixel than a screen`() {
        // If this ever inverts, one of the two reference numbers has been
        // edited without the other. A face is the easiest thing an encoder is
        // handed; a screen of small text is the hardest.
        val camera = ShareQuality.cameraBitrate(size(1920, 1080))
        val screen = ShareQuality.screenBitrate(size(1920, 1080))
        assertTrue("$camera should be well under $screen", camera < screen)
    }

    @Test
    fun `the ladder is the desktop's, name for name`() {
        assertEquals(size(640, 360), ShareQuality.cameraSize(ShareQuality.CameraQuality.P360))
        assertEquals(size(1280, 720), ShareQuality.cameraSize(ShareQuality.CameraQuality.P720))
        assertEquals(size(1920, 1080), ShareQuality.cameraSize(ShareQuality.CameraQuality.P1080))
    }

    @Test
    fun `automatic is 720p rather than the largest on offer`() {
        // A phone's front sensor is good at 720p and frequently interpolates
        // the 1080p mode above it - twice the bitrate for upscaled noise. The
        // desktop resolves `auto` to the same size for the same reason.
        assertEquals(
            size(1280, 720),
            ShareQuality.cameraSize(ShareQuality.CameraQuality.AUTO),
        )
    }
}
