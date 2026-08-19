package com.aatech.betweenus.core.data

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The geometry behind the crop-and-rotate screen.
 *
 * The port of `apps/desktop/src/services/image-edit.ts`, and it has to be a
 * faithful one for the same reason the preview and the written file have to
 * agree: the editor draws the picture with one transform and then reproduces
 * exactly that drawing on a canvas. The transform, in the one order both use:
 *
 *     translate(offsetX, offsetY)  scale(coverScale * zoom)  rotate(rotation)
 *
 * applied about the centre of a frame the picture is centred in. Compose's
 * `graphicsLayer` applies translation after scale and rotation about the
 * element's centre, and [drawEdit] issues the matching matrix operations, so
 * the same three numbers mean the same thing to both.
 *
 * Everything but [drawEdit] is pure, and `ImageEditTest` is what proves the
 * frame is always covered - the property that decides whether a crop can show
 * blank paper down one edge.
 */
object ImageEdit {

    /** How far a picture may be zoomed in. Past this a photo is showing its pixels. */
    const val MAX_ZOOM = 5f

    data class Size(val width: Float, val height: Float)

    /**
     * @param rotation quarter turns only, in degrees. A free angle would need a
     *   crop box that is not the frame.
     * @param zoom multiplies [coverScale]; 1 is "just covers the frame".
     * @param offsetX where the picture's centre sits, in frame pixels.
     */
    data class Edit(
        val rotation: Int = 0,
        val zoom: Float = 1f,
        val offsetX: Float = 0f,
        val offsetY: Float = 0f,
    )

    val NONE = Edit()

    fun rotate(rotation: Int, quarterTurns: Int): Int =
        (((rotation / 90 + quarterTurns) % 4) + 4) % 4 * 90

    /** True when the picture's width and height swap places on screen. */
    fun isSideways(rotation: Int): Boolean = rotation == 90 || rotation == 270

    /** The picture's size once it has been turned, before any scaling. */
    fun turned(image: Size, rotation: Int): Size =
        if (isSideways(rotation)) Size(image.height, image.width) else image

    /**
     * The smallest scale that leaves no gap between the picture and the frame.
     *
     * Cover, not contain: a crop that can show the page behind it is a crop
     * that will, and letterboxing an avatar is not something anybody asked for.
     */
    fun coverScale(image: Size, frame: Size, rotation: Int): Float {
        val shown = turned(image, rotation)
        if (shown.width <= 0f || shown.height <= 0f) return 1f
        return max(frame.width / shown.width, frame.height / shown.height)
    }

    /**
     * How far the centre may travel before an edge comes into the frame.
     *
     * Zero when the picture is exactly the size of the frame, which is the
     * normal case at zoom 1 on one of the two axes - so a picture at zoom 1 is
     * not draggable in the direction it already fits, and that is correct
     * rather than a stuck gesture.
     */
    fun panRange(image: Size, frame: Size, edit: Edit): Size {
        val shown = turned(image, edit.rotation)
        val scale = coverScale(image, frame, edit.rotation) * edit.zoom
        return Size(
            width = max(0f, (shown.width * scale - frame.width) / 2f),
            height = max(0f, (shown.height * scale - frame.height) / 2f),
        )
    }

    /** Holds the picture against the frame, whatever the gesture asked for. */
    fun clamp(image: Size, frame: Size, edit: Edit): Edit {
        val zoom = edit.zoom.coerceIn(1f, MAX_ZOOM)
        val range = panRange(image, frame, edit.copy(zoom = zoom))
        return Edit(
            rotation = edit.rotation,
            zoom = zoom,
            // `+ 0f` normalises the negative zero a clamp against a zero
            // range produces. It draws identically and compares as equal to
            // zero, but it reads as "-0.0" everywhere it is printed, which is a
            // confusing thing to find in a log.
            offsetX = edit.offsetX.coerceIn(-range.width, range.width) + 0f,
            offsetY = edit.offsetY.coerceIn(-range.height, range.height) + 0f,
        )
    }

    /** True when the edit would change nothing, so the original file can be kept. */
    fun isUnedited(edit: Edit): Boolean =
        edit.rotation == 0 && edit.zoom == 1f && edit.offsetX == 0f && edit.offsetY == 0f

    /**
     * What the frame covers, in the source's own pixels, capped at [maxEdge].
     *
     * Capping by the crop rather than by the ceiling matters: upscaling a small
     * picture to 2048 makes a bigger file of exactly the same detail.
     */
    fun outputSize(image: Size, frame: Size, edit: Edit, maxEdge: Int): Size {
        val scale = coverScale(image, frame, edit.rotation) * edit.zoom
        val cropped = Size(frame.width / scale, frame.height / scale)
        val shrink = min(1f, maxEdge / max(cropped.width, cropped.height))
        return Size(
            width = max(1f, (cropped.width * shrink).roundToInt().toFloat()),
            height = max(1f, (cropped.height * shrink).roundToInt().toFloat()),
        )
    }

    /**
     * Renders the framed part of [source] at [output] pixels.
     *
     * The transform is the preview's, with one extra scale in front of it that
     * turns frame pixels into output pixels - so a 300px preview and a 1024px
     * result are the same picture, and whoever framed it is not surprised.
     */
    fun drawEdit(source: Bitmap, frame: Size, output: Size, edit: Edit): Bitmap {
        val result = Bitmap.createBitmap(
            output.width.toInt(),
            output.height.toInt(),
            Bitmap.Config.ARGB_8888,
        )
        val scale = coverScale(Size(source.width.toFloat(), source.height.toFloat()), frame, edit.rotation) *
            edit.zoom

        val matrix = Matrix()
        // `post` appends, so this reads top-down in the order the bitmap is
        // actually put through: centre it, turn it, scale it, move it, and then
        // map frame pixels onto output pixels. The same order as the CSS
        // transform and the Compose layer, which is what makes the three agree.
        matrix.postTranslate(-source.width / 2f, -source.height / 2f)
        matrix.postRotate(edit.rotation.toFloat())
        matrix.postScale(scale, scale)
        matrix.postTranslate(edit.offsetX, edit.offsetY)
        matrix.postScale(output.width / frame.width, output.height / frame.height)
        matrix.postTranslate(output.width / 2f, output.height / 2f)

        Canvas(result).drawBitmap(source, matrix, Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
        return result
    }
}
