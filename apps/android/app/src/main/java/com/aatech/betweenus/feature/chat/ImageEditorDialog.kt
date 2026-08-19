package com.aatech.betweenus.feature.chat

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aatech.betweenus.core.data.ImageEdit
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.Surface950
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Crop and rotate a picture before it is sent or stored.
 *
 * The port of `apps/desktop/src/components/ImageEditor.tsx`, and the arithmetic
 * that makes the written file match what was framed is shared with it through
 * [ImageEdit] - which is the only part worth being careful about, and the only
 * part that is tested.
 *
 * Drag to move, pinch or drag the slider to zoom, two buttons to turn. The
 * frame is the crop: what is inside it when Done is pressed is what gets
 * written, to a file in the cache that the caller then treats like any other
 * picked file.
 */
@Composable
fun ImageEditorDialog(
    source: Uri,
    title: String,
    /** Width over height. 1 for an avatar; the picture's own when null. */
    aspect: Float? = null,
    /** The longest edge of the written file. Never upscales past the source. */
    maxOutputEdge: Int = 2048,
    onCancel: () -> Unit,
    onDone: (Uri) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current

    var bitmap by remember(source) { mutableStateOf<Bitmap?>(null) }
    var failure by remember(source) { mutableStateOf<String?>(null) }
    var edit by remember(source) { mutableStateOf(ImageEdit.NONE) }
    var busy by remember(source) { mutableStateOf(false) }

    /**
     * The crop box, in device pixels. Measured where it is drawn and held here
     * because Done needs it too: the frame *is* the crop, so writing the file
     * without it would be writing a different picture from the one on screen.
     */
    var frame by remember(source) { mutableStateOf(ImageEdit.Size(1f, 1f)) }

    LaunchedEffect(source) {
        // Downsampled: the editor never needs more pixels than the screen can
        // show, and a 50 megapixel photo decoded whole is an out-of-memory
        // crash on the phones most likely to have taken one. The crop is
        // written from this same bitmap, so the ceiling is deliberately
        // generous rather than screen-sized.
        bitmap = decodeForEditing(context, source)
        if (bitmap == null) failure = "That file could not be read as a picture"
    }

    Dialog(
        onDismissRequest = { if (!busy) onCancel() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .background(Surface950)
                .statusBarsPadding()
                .navigationBarsPadding(),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconAction(BetweenUsIcons.X, "Cancel", { if (!busy) onCancel() })
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall,
                    color = Slate100,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).padding(start = 6.dp),
                )
            }

            BoxWithConstraints(
                modifier = Modifier.weight(1f).fillMaxWidth().background(Color.Black),
                contentAlignment = Alignment.Center,
            ) {
                val picture = bitmap
                if (picture == null) {
                    if (failure == null) {
                        CircularProgressIndicator(Modifier.size(28.dp))
                    }
                } else {
                    // The frame is the largest box of the wanted shape that fits
                    // the space, in device pixels - the same unit every offset
                    // and every scale in ImageEdit is measured in.
                    val boxWidth = with(density) { maxWidth.toPx() } * 0.92f
                    val boxHeight = with(density) { maxHeight.toPx() } * 0.92f
                    val ratio = aspect ?: (picture.width.toFloat() / picture.height)
                    val measured = fit(boxWidth, boxHeight, ratio)
                    // After composition rather than during it: writing state
                    // while composing the same subtree is how a recomposition
                    // loop starts, and this one settles on the first pass.
                    SideEffect { if (measured != frame) frame = measured }

                    Box(
                        modifier = Modifier
                            .size(
                                width = with(density) { frame.width.toDp() },
                                height = with(density) { frame.height.toDp() },
                            )
                            .background(Color.Black)
                            .pointerInput(picture, frame, edit.rotation) {
                                detectTransformGestures { _, pan, zoom, _ ->
                                    edit = ImageEdit.clamp(
                                        image = picture.size(),
                                        frame = frame,
                                        edit = edit.copy(
                                            zoom = edit.zoom * zoom,
                                            offsetX = edit.offsetX + pan.x,
                                            offsetY = edit.offsetY + pan.y,
                                        ),
                                    )
                                }
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        val scale =
                            ImageEdit.coverScale(picture.size(), frame, edit.rotation) * edit.zoom
                        androidx.compose.foundation.Image(
                            bitmap = picture.asImageBitmap(),
                            contentDescription = title,
                            contentScale = ContentScale.None,
                            modifier = Modifier
                                .size(
                                    width = with(density) { picture.width.toFloat().toDp() },
                                    height = with(density) { picture.height.toFloat().toDp() },
                                )
                                .graphicsLayer(
                                    // Compose applies rotation and scale about
                                    // the centre and then translates, which is
                                    // the order ImageEdit.drawEdit replays.
                                    rotationZ = edit.rotation.toFloat(),
                                    scaleX = scale,
                                    scaleY = scale,
                                    translationX = edit.offsetX,
                                    translationY = edit.offsetY,
                                    clip = false,
                                ),
                        )
                    }
                }
            }

            failure?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = Danger,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                )
            }

            val picture = bitmap
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                IconAction(BetweenUsIcons.RotateLeft, "Rotate left", {
                    if (!busy) edit = ImageEdit.Edit(rotation = ImageEdit.rotate(edit.rotation, -1))
                })
                Slider(
                    value = edit.zoom,
                    onValueChange = { zoom ->
                        val shown = picture ?: return@Slider
                        // Clamped through the same function the gesture uses:
                        // zooming out has to pull the picture back over the
                        // frame, or the edge it was dragged past stays showing.
                        edit = ImageEdit.clamp(shown.size(), frame, edit.copy(zoom = zoom))
                    },
                    valueRange = 1f..ImageEdit.MAX_ZOOM,
                    enabled = !busy && picture != null,
                    modifier = Modifier.weight(1f),
                )
                IconAction(BetweenUsIcons.RotateRight, "Rotate right", {
                    if (!busy) edit = ImageEdit.Edit(rotation = ImageEdit.rotate(edit.rotation, 1))
                })
            }

            Row(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Drag to move, pinch to zoom",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate500,
                    modifier = Modifier.weight(1f),
                )
                Chip(text = "Cancel", onClick = { if (!busy) onCancel() })
                Chip(
                    text = if (busy) "Working…" else "Done",
                    onClick = {
                        val picked = bitmap ?: return@Chip
                        if (busy) return@Chip
                        busy = true
                        scope.launch {
                            val written = runCatching {
                                writeEdited(context, picked, frame, edit, maxOutputEdge)
                            }
                            busy = false
                            written.getOrNull()?.let(onDone)
                                ?: run { failure = "That picture could not be written" }
                        }
                    },
                )
            }
        }
    }
}

private fun Bitmap.size() = ImageEdit.Size(width.toFloat(), height.toFloat())

/** The largest box of the given shape that fits inside the space. */
private fun fit(width: Float, height: Float, ratio: Float): ImageEdit.Size =
    if (width / height > ratio) ImageEdit.Size(height * ratio, height)
    else ImageEdit.Size(width, width / ratio)

/** Big enough to crop from, small enough not to be an out-of-memory crash. */
private const val MAX_EDIT_EDGE_PX = 2560

private suspend fun decodeForEditing(context: Context, uri: Uri): Bitmap? =
    withContext(Dispatchers.IO) {
        runCatching {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.contentResolver.openInputStream(uri)?.use {
                BitmapFactory.decodeStream(it, null, bounds)
            }
            val options = BitmapFactory.Options().apply {
                inSampleSize = sampleSizeFor(bounds.outWidth, bounds.outHeight, MAX_EDIT_EDGE_PX)
            }
            context.contentResolver.openInputStream(uri)?.use {
                BitmapFactory.decodeStream(it, null, options)
            }
        }.getOrNull()
    }

private suspend fun writeEdited(
    context: Context,
    source: Bitmap,
    frame: ImageEdit.Size,
    edit: ImageEdit.Edit,
    maxOutputEdge: Int,
): Uri = withContext(Dispatchers.IO) {
    val output = ImageEdit.outputSize(source.size(), frame, edit, maxOutputEdge)
    val cropped = ImageEdit.drawEdit(source, frame, output, edit)
    val directory = File(context.cacheDir, "edited").apply { mkdirs() }
    val file = File(directory, "edited-${System.currentTimeMillis()}.jpg")
    file.outputStream().use { cropped.compress(Bitmap.CompressFormat.JPEG, 92, it) }
    cropped.recycle()
    androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.files", file)
}
