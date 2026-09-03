package com.aatech.betweenus.feature.status

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import com.aatech.betweenus.core.data.STATUS_BACKGROUNDS
import com.aatech.betweenus.core.data.STATUS_CAPTION_MAX_LENGTH
import com.aatech.betweenus.core.data.STATUS_VIDEO_MAX_MS
import com.aatech.betweenus.core.data.StatusKind
import com.aatech.betweenus.core.store.Statuses
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.StatusComposerDoor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Posting a status: a picture, a video, or words on a colour.
 *
 * Three kinds behind one screen rather than three screens, because they are the
 * same act - the only thing that differs is what gets attached. The text kind
 * is the default precisely because it needs no camera and no file; making it a
 * mode of the picture composer would bury the one people use most.
 *
 * Nothing is uploaded until Post: the preview is the picked `Uri`, so choosing
 * a file and changing your mind costs nothing and leaves nothing on the server.
 * That is also why posting sends the bytes and the caption in one request.
 *
 * The port of `apps/desktop/src/features/status/StatusComposer.tsx`.
 */
@Composable
fun StatusComposerHost() {
    if (!StatusComposerDoor.open) return
    Dialog(
        onDismissRequest = { StatusComposerDoor.close() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        StatusComposerScreen(onClose = { StatusComposerDoor.close() })
    }
}

@Composable
private fun StatusComposerScreen(onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var picked by remember { mutableStateOf<Uri?>(null) }
    var pickedKind by remember { mutableStateOf(StatusKind.TEXT) }
    var durationMs by remember { mutableStateOf<Long?>(null) }
    var text by remember { mutableStateOf("") }
    var caption by remember { mutableStateOf("") }
    var background by remember { mutableStateOf(STATUS_BACKGROUNDS.first()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val photo = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            picked = uri
            pickedKind = StatusKind.PHOTO
            durationMs = null
        }
    }
    val video = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            picked = uri
            pickedKind = StatusKind.VIDEO
        }
    }

    // Measured once, off the main thread, and clamped rather than cut: the file
    // goes up whole and the player stops at the cap. See STATUS_VIDEO_MAX_MS.
    LaunchedEffect(picked, pickedKind) {
        val uri = picked
        durationMs = if (uri != null && pickedKind == StatusKind.VIDEO) {
            videoDuration(context, uri).coerceAtMost(STATUS_VIDEO_MAX_MS)
        } else {
            null
        }
    }

    val ready = if (picked != null) true else text.isNotBlank()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(if (picked != null) Color.Black else colourOf(background))
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(
                icon = BetweenUsIcons.X,
                contentDescription = "Cancel",
                onClick = onClose,
                tint = Color.White,
            )
            Text(
                text = "Add to status",
                style = MaterialTheme.typography.titleMedium,
                color = Color.White,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
            TextButton(
                enabled = ready && !busy,
                onClick = {
                    busy = true
                    error = null
                    scope.launch {
                        val result = runCatching {
                            val uri = picked
                            if (uri == null) {
                                Statuses.post(
                                    kind = StatusKind.TEXT,
                                    caption = text.trim(),
                                    background = background,
                                )
                            } else {
                                val bytes = readBytes(context, uri)
                                Statuses.post(
                                    kind = pickedKind,
                                    caption = caption.trim().ifBlank { null },
                                    durationMs = durationMs,
                                    media = bytes,
                                    mediaContentType = context.contentResolver.getType(uri),
                                )
                            }
                        }
                        busy = false
                        result
                            .onSuccess { onClose() }
                            .onFailure { error = it.message ?: "That could not be posted" }
                    }
                },
            ) {
                Text(if (busy) "Posting…" else "Post", color = Color.White)
            }
        }

        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            val uri = picked
            when {
                uri != null && pickedKind == StatusKind.PHOTO -> AsyncImage(
                    model = uri,
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize(),
                )

                uri != null -> AsyncImage(
                    // A video's own first frame, which is what Coil pulls from a
                    // video Uri. A player here would be a second player to keep
                    // in step with the one in the viewer, for a preview.
                    model = uri,
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize(),
                )

                else -> BasicTextField(
                    value = text,
                    onValueChange = { if (it.length <= STATUS_CAPTION_MAX_LENGTH) text = it },
                    textStyle = MaterialTheme.typography.headlineSmall.copy(
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                    ),
                    cursorBrush = SolidColor(Color.White),
                    decorationBox = { field ->
                        Box(contentAlignment = Alignment.Center) {
                            if (text.isEmpty()) {
                                Text(
                                    text = "Type a status",
                                    style = MaterialTheme.typography.headlineSmall,
                                    color = Color.White.copy(alpha = 0.6f),
                                    textAlign = TextAlign.Center,
                                )
                            }
                            field()
                        }
                    },
                    modifier = Modifier.fillMaxWidth().padding(32.dp),
                )
            }
        }

        error?.let {
            Notice(message = it, tone = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp))
        }

        if (picked != null) {
            BasicTextField(
                value = caption,
                onValueChange = { if (it.length <= STATUS_CAPTION_MAX_LENGTH) caption = it },
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = Color.White),
                cursorBrush = SolidColor(Color.White),
                decorationBox = { field ->
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(28.dp))
                            .background(Color.White.copy(alpha = 0.12f))
                            .padding(horizontal = 18.dp, vertical = 14.dp),
                    ) {
                        if (caption.isEmpty()) {
                            Text(
                                text = "Add a caption…",
                                style = MaterialTheme.typography.bodyLarge,
                                color = Color.White.copy(alpha = 0.6f),
                            )
                        }
                        field()
                    }
                },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            )
            Box(Modifier.fillMaxWidth().padding(bottom = 12.dp), contentAlignment = Alignment.Center) {
                Chip(text = "Choose something else", onClick = { picked = null })
            }
        } else {
            // The palette, then the three kinds. A fixed set of colours rather
            // than a picker: every one of these is legible under white text, and
            // a picker is how you get white on yellow.
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                STATUS_BACKGROUNDS.forEach { colour ->
                    Box(
                        modifier = Modifier
                            .padding(horizontal = 5.dp)
                            .size(28.dp)
                            .clip(CircleShape)
                            .background(colourOf(colour))
                            .border(
                                width = if (colour == background) 2.dp else 0.dp,
                                color = if (colour == background) Color.White else Color.Transparent,
                                shape = CircleShape,
                            )
                            .clickable { background = colour },
                    )
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth().padding(bottom = 20.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                Chip(
                    text = "Photo",
                    onClick = {
                        photo.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                        )
                    },
                )
                Spacer(Modifier.size(10.dp))
                Chip(
                    text = "Video",
                    onClick = {
                        video.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly),
                        )
                    },
                )
                Spacer(Modifier.size(10.dp))
                Chip(text = "Text", selected = true)
            }
        }
        Spacer(Modifier.height(4.dp))
    }
}

private suspend fun readBytes(context: Context, uri: Uri): ByteArray =
    withContext(Dispatchers.IO) {
        context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            ?: throw IllegalStateException("That file could not be read")
    }

/**
 * How long a picked video runs.
 *
 * A file that will not report its length is treated as the cap rather than as
 * a failure, so a clip whose metadata is missing still posts.
 */
private suspend fun videoDuration(context: Context, uri: Uri): Long =
    withContext(Dispatchers.IO) {
        runCatching {
            MediaMetadataRetriever().use { retriever ->
                retriever.setDataSource(context, uri)
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                    ?.toLongOrNull()
                    ?: STATUS_VIDEO_MAX_MS
            }
        }.getOrDefault(STATUS_VIDEO_MAX_MS)
    }
