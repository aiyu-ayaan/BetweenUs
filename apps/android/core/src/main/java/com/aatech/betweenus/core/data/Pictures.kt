package com.aatech.betweenus.core.data

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.ByteArrayOutputStream

/**
 * Pictures that are stored in the clear: avatars, server icons and emoji.
 *
 * These are not attachments and are not encrypted - a member list has to draw
 * them for people who hold no channel key, and an emoji is drawn by an image
 * tag a hundred times a screen. So the client hands over exactly what it wants
 * every other client to fetch: a square, cropped from the middle, small enough
 * that a grid of them is cheap.
 *
 * PNG rather than JPEG, unlike an attachment. Half the point of an emoji is the
 * part of it that is not there, and JPEG has no alpha channel: a transparent
 * corner would come back as a white one. The port of `preparePicture` in
 * `services/attachments.ts`, which uses WebP for the same reason.
 */
object Pictures {
    /** Above this the server refuses an emoji, and it is drawn at 22 pixels. */
    const val MAX_EMOJI_BYTES = 256 * 1024

    /**
     * A GIF or an animated WebP is stored exactly as it came.
     *
     * Re-encoding one through a bitmap keeps its first frame and throws the
     * rest away, which is the whole of what somebody uploading an animated
     * emoji is asking for. A still WebP is treated as animated too: telling the
     * two apart means parsing the container, and the cost of being wrong is
     * only that a small file is not made smaller.
     */
    fun isAnimated(contentType: String): Boolean =
        contentType == "image/gif" || contentType == "image/webp"

    /** How big an avatar or a server icon is stored. The desktop's number. */
    const val PICTURE_EDGE = 512

    /**
     * A square, centre-cropped and scaled to [edge].
     *
     * PNG by default, which is what an emoji wants: lossless at 128 pixels and
     * alpha that nothing can argue with. An avatar is four times that edge and
     * a photograph rather than a drawing, so it is asked for as WebP, which is
     * what the desktop stores and is a quarter of the size at this scale.
     *
     * Returns null when the bytes are not a picture this device can decode, in
     * which case the caller has nothing to upload and should say so.
     */
    @Suppress("DEPRECATION")
    fun square(
        bytes: ByteArray,
        edge: Int = 128,
        // `WEBP` is deprecated in favour of `WEBP_LOSSY`, which arrived in API
        // 30. This module still supports 24, and the deprecated constant is the
        // same encoder.
        format: Bitmap.CompressFormat = Bitmap.CompressFormat.PNG,
    ): ByteArray? = try {
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        if (decoded == null) {
            null
        } else {
            val side = minOf(decoded.width, decoded.height)
            val cropped = Bitmap.createBitmap(
                decoded,
                (decoded.width - side) / 2,
                (decoded.height - side) / 2,
                side,
                side,
            )
            val scaled = Bitmap.createScaledBitmap(cropped, minOf(edge, side), minOf(edge, side), true)

            val out = ByteArrayOutputStream()
            scaled.compress(format, if (format == Bitmap.CompressFormat.PNG) 100 else 90, out)
            if (scaled !== cropped) scaled.recycle()
            if (cropped !== decoded) cropped.recycle()
            decoded.recycle()
            out.toByteArray()
        }
    } catch (_: Throwable) {
        null
    }
}
