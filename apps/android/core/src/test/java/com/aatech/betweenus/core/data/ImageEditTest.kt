package com.aatech.betweenus.core.data

import com.aatech.betweenus.core.data.ImageEdit.Edit
import com.aatech.betweenus.core.data.ImageEdit.Size
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The property worth guarding is that the frame is always covered: a scale or a
 * clamp wrong by a pixel is an avatar with a sliver of nothing down one side,
 * and it only shows on the pictures whose aspect ratio happens to hit it.
 *
 * Mirrors `apps/desktop/src/services/image-edit.check.ts`. The two clients frame
 * the same photograph and have to agree about what "the frame" means.
 */
class ImageEditTest {

    private val square = Size(512f, 512f)
    private val wide = Size(4000f, 3000f)
    private val tall = Size(1080f, 1920f)
    private val frame = Size(300f, 300f)
    private val banner = Size(320f, 180f)

    @Test
    fun `quarter turns wrap both ways`() {
        assertEquals(90, ImageEdit.rotate(0, 1))
        assertEquals(0, ImageEdit.rotate(270, 1))
        assertEquals(270, ImageEdit.rotate(0, -1))
        assertEquals(0, ImageEdit.rotate(180, 2))
    }

    @Test
    fun `turning swaps the shown size only on the quarter turns`() {
        assertTrue(ImageEdit.isSideways(90))
        assertTrue(ImageEdit.isSideways(270))
        assertFalse(ImageEdit.isSideways(180))
        assertEquals(Size(3000f, 4000f), ImageEdit.turned(wide, 90))
        assertEquals(wide, ImageEdit.turned(wide, 180))
    }

    @Test
    fun `cover scale covers the frame and has nothing to spare`() {
        for (image in listOf(square, wide, tall, Size(40f, 900f))) {
            for (box in listOf(frame, banner, Size(200f, 400f))) {
                for (rotation in listOf(0, 90, 180, 270)) {
                    val scale = ImageEdit.coverScale(image, box, rotation)
                    val shown = ImageEdit.turned(image, rotation)
                    assertTrue("covers width", shown.width * scale >= box.width - 1e-3f)
                    assertTrue("covers height", shown.height * scale >= box.height - 1e-3f)
                    val slack = minOf(
                        shown.width * scale - box.width,
                        shown.height * scale - box.height,
                    )
                    assertTrue("no scale to spare", slack < 1e-2f)
                }
            }
        }
    }

    @Test
    fun `a square in a square has nowhere to go`() {
        assertEquals(Size(0f, 0f), ImageEdit.panRange(square, frame, ImageEdit.NONE))
        assertEquals(
            ImageEdit.NONE,
            ImageEdit.clamp(square, frame, Edit(offsetX = 90f, offsetY = -90f)),
        )
    }

    @Test
    fun `a wide picture slides sideways, and up once it is turned`() {
        val flat = ImageEdit.panRange(wide, frame, ImageEdit.NONE)
        assertTrue(flat.width > 0f)
        assertEquals(0f, flat.height, 0f)

        val turned = ImageEdit.panRange(wide, frame, Edit(rotation = 90))
        assertEquals(0f, turned.width, 0f)
        assertTrue(turned.height > 0f)
    }

    @Test
    fun `zoom is clamped at both ends`() {
        assertEquals(1f, ImageEdit.clamp(square, frame, Edit(zoom = 0.2f)).zoom, 0f)
        assertEquals(ImageEdit.MAX_ZOOM, ImageEdit.clamp(square, frame, Edit(zoom = 99f)).zoom, 0f)
    }

    @Test
    fun `zooming in gives the picture somewhere to go, and the clamp keeps it there`() {
        val zoomed = ImageEdit.clamp(square, frame, Edit(zoom = 2f, offsetX = 10_000f))
        assertEquals(2f, zoomed.zoom, 0f)
        assertTrue(zoomed.offsetX > 0f)
        assertEquals(ImageEdit.panRange(square, frame, zoomed).width, zoomed.offsetX, 1e-3f)
    }

    @Test
    fun `a degenerate picture does not produce a NaN that would blank the canvas`() {
        assertEquals(1f, ImageEdit.coverScale(Size(0f, 0f), frame, 0), 0f)
    }

    @Test
    fun `the output is the crop in source pixels, never upscaled`() {
        // A 512 square framed square at zoom 1: the whole picture, capped only
        // by the ceiling when the ceiling is smaller than the source.
        assertEquals(Size(512f, 512f), ImageEdit.outputSize(square, frame, ImageEdit.NONE, 2048))
        assertEquals(Size(256f, 256f), ImageEdit.outputSize(square, frame, ImageEdit.NONE, 256))
        // Zoomed to 2, half as much of the picture is in the frame.
        assertEquals(
            Size(256f, 256f),
            ImageEdit.outputSize(square, frame, Edit(zoom = 2f), 2048),
        )
    }

    @Test
    fun `an untouched edit is recognised as one`() {
        assertTrue(ImageEdit.isUnedited(ImageEdit.NONE))
        assertFalse(ImageEdit.isUnedited(Edit(rotation = 90)))
        assertFalse(ImageEdit.isUnedited(Edit(offsetX = 1f)))
    }
}
