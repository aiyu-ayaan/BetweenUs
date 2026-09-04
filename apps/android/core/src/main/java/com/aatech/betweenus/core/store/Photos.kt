package com.aatech.betweenus.core.store

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

/**
 * A picture on its way out of this phone, normalised so every other client can
 * draw it.
 *
 * It lived inside [Conversation] while an attachment was the only thing that
 * left here as a picture. A moment is the second, it did not go through this,
 * and the result was the bug this file exists to make impossible: photos posted
 * from the phone drew as broken images on the desktop. One rule, one place,
 * both senders.
 */
internal object Photos {

    /** Matches MAX_IMAGE_EDGE in `apps/desktop/src/services/attachments.ts`. */
    private const val MAX_IMAGE_EDGE = 1920

    /** Below this a JPEG is left alone; re-encoding it would only cost quality. */
    private const val KEEP_JPEG_UNDER_BYTES = 512 * 1024

    class Photo(val bytes: ByteArray, val width: Int, val height: Int)

    /**
     * A picture, normalised to JPEG - and HEIC is why this exists.
     *
     * A phone camera writes HEIC by default. This platform decodes it natively,
     * so a photo sent from here looked perfectly fine *here*, and arrived on
     * desktop and web as a broken image: Chromium has never shipped a HEIF
     * decoder. Those clients can now decode one they are given, but a picture
     * no browser can read has no business being sent in the first place, so the
     * sender converts.
     *
     * Everything else a camera or a screenshot produces goes the same way, for
     * the same reason the desktop re-encodes: a 12 megapixel photo is several
     * megabytes of detail nobody will look at in a message list, and fewer
     * megabytes is also a moment that finishes uploading.
     *
     * GIF and SVG are left alone - a bitmap would flatten an animation to its
     * first frame, and rasterise a drawing that was meant to scale.
     *
     * Returns null when there is nothing worth doing, and when anything at all
     * goes wrong: sending the file as it came is better than not sending it. On
     * API 24 to 27, where the platform cannot decode HEIC, that is the path a
     * HEIC takes - and those releases predate the cameras that write one.
     */
    fun asJpeg(bytes: ByteArray, contentType: String): Photo? = try {
        val type = contentType.lowercase()
        val heic = type.startsWith("image/hei")
        val size = pixelSize(bytes)
        val longest = maxOf(size?.first ?: 0, size?.second ?: 0)
        when {
            !type.startsWith("image/") -> null
            type == "image/gif" || type == "image/svg+xml" -> null
            // A small JPEG is already what this would have produced. A HEIC is
            // never that, whatever its size.
            !heic && type == "image/jpeg" && longest <= MAX_IMAGE_EDGE &&
                bytes.size <= KEEP_JPEG_UNDER_BYTES -> null
            else -> encode(bytes, longest)
        }
    } catch (_: Throwable) {
        // OutOfMemoryError included: a photo too big for the heap is still a
        // photo somebody asked to send.
        null
    }

    private fun encode(bytes: ByteArray, longest: Int): Photo? {
        // `inSampleSize` throws whole powers of two away during the decode, so
        // the full-size bitmap never has to exist. It only halves, so it lands
        // at or above the target and the exact fit is done afterwards.
        val options = BitmapFactory.Options().apply {
            var sample = 1
            while (longest > 0 && longest / (sample * 2) >= MAX_IMAGE_EDGE) sample *= 2
            inSampleSize = sample
        }
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
        val upright = upright(decoded, bytes)
        val scale = minOf(1f, MAX_IMAGE_EDGE.toFloat() / maxOf(upright.width, upright.height))
        val scaled = if (scale < 1f) {
            Bitmap.createScaledBitmap(
                upright,
                (upright.width * scale).toInt().coerceAtLeast(1),
                (upright.height * scale).toInt().coerceAtLeast(1),
                true,
            )
        } else {
            upright
        }

        val out = ByteArrayOutputStream(bytes.size / 2 + 1024)
        scaled.compress(Bitmap.CompressFormat.JPEG, 85, out)
        val photo = Photo(out.toByteArray(), scaled.width, scaled.height)
        if (scaled !== upright) scaled.recycle()
        if (upright !== decoded) upright.recycle()
        decoded.recycle()
        return photo
    }

    /**
     * The picture the right way up.
     *
     * A phone stores a photo in the sensor's own orientation and records how to
     * turn it in an EXIF tag, which every viewer honours. Re-encoding drops the
     * tag, so a photo that was upright before the conversion would be on its
     * side after it. The rotation is baked into the pixels instead.
     */
    private fun upright(bitmap: Bitmap, bytes: ByteArray): Bitmap {
        val turn = when (
            runCatching {
                ExifInterface(ByteArrayInputStream(bytes))
                    .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
        ) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> return bitmap
        }
        return Bitmap.createBitmap(
            bitmap,
            0,
            0,
            bitmap.width,
            bitmap.height,
            Matrix().apply { postRotate(turn) },
            true,
        )
    }

    /**
     * A picture's pixel size, recorded in the manifest so the receiver can
     * reserve its space.
     *
     * Every client draws a placeholder while an attachment is still ciphertext,
     * and without a size that placeholder is one line tall and then jumps to
     * three hundred as the picture arrives - which moves every message below it
     * under a scroll that had already finished. The desktop has recorded this
     * since it started shrinking images on the way out; a picture sent from a
     * phone carried nothing, so it was the one that always jumped, on every
     * client including this one.
     *
     * `inJustDecodeBounds` reads the header alone: no pixels are decoded and no
     * bitmap is allocated. It reports -1 for anything it cannot parse, and a
     * size that is not a size is not recorded.
     */
    fun pixelSize(bytes: ByteArray): Pair<Int, Int>? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth > 0 && bounds.outHeight > 0) {
            bounds.outWidth to bounds.outHeight
        } else {
            null
        }
    }.getOrNull()
}
