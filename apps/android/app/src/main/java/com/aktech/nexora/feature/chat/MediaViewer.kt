package com.aktech.nexora.feature.chat

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.widget.MediaController
import android.widget.Toast
import android.widget.VideoView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import com.aktech.nexora.ui.components.NexoraIcon
import com.aktech.nexora.ui.components.NexoraIcons
import com.aktech.nexora.ui.theme.Accent
import com.aktech.nexora.ui.theme.Slate100
import com.aktech.nexora.ui.theme.Slate300
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.StatusOnline
import com.aktech.nexora.ui.theme.Surface850
import com.aktech.nexora.ui.theme.Surface900
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

/**
 * Fullscreen Interactive Image Viewer modal with pinch-to-zoom, pan, save to Pictures/Nexora album, and share.
 */
@Composable
fun ImageViewerDialog(
    bitmap: Bitmap,
    title: String,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var scale by remember { mutableFloatStateOf(1f) }
    var offsetX by remember { mutableFloatStateOf(0f) }
    var offsetY by remember { mutableFloatStateOf(0f) }
    var saving by remember { mutableStateOf(false) }
    var savedMessage by remember { mutableStateOf<String?>(null) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.96f)),
        ) {
            // Main Zoomable Image View
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(Unit) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            scale = (scale * zoom).coerceIn(1f, 5f)
                            if (scale > 1f) {
                                val maxOffsetX = (size.width * (scale - 1)) / 2
                                val maxOffsetY = (size.height * (scale - 1)) / 2
                                offsetX = (offsetX + pan.x * scale).coerceIn(-maxOffsetX, maxOffsetX)
                                offsetY = (offsetY + pan.y * scale).coerceIn(-maxOffsetY, maxOffsetY)
                            } else {
                                offsetX = 0f
                                offsetY = 0f
                            }
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                Image(
                    bitmap = bitmap.asImageBitmap(),
                    contentDescription = title,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer(
                            scaleX = scale,
                            scaleY = scale,
                            translationX = offsetX,
                            translationY = offsetY,
                        ),
                )
            }

            // Top Header Bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.TopCenter)
                    .background(Color.Black.copy(alpha = 0.6f))
                    .statusBarsPadding()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.weight(1f),
                ) {
                    Box(
                        modifier = Modifier
                            .size(38.dp)
                            .clip(CircleShape)
                            .background(Surface900)
                            .clickable(onClick = onDismiss),
                        contentAlignment = Alignment.Center,
                    ) {
                        NexoraIcon(NexoraIcons.X, tint = Slate100, size = 18.dp)
                    }

                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleMedium,
                        color = Slate100,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    // Save to Pictures/Nexora button
                    Box(
                        modifier = Modifier
                            .size(38.dp)
                            .clip(CircleShape)
                            .background(Surface900)
                            .clickable(enabled = !saving) {
                                scope.launch {
                                    saving = true
                                    val uri = saveImageToStorage(context, bitmap, title)
                                    saving = false
                                    if (uri != null) {
                                        savedMessage = "Saved to Pictures/Nexora"
                                        Toast.makeText(context, "Saved to Pictures/Nexora", Toast.LENGTH_SHORT).show()
                                    } else {
                                        Toast.makeText(context, "Failed to save image", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (saving) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = Accent)
                        } else {
                            NexoraIcon(NexoraIcons.Download, tint = if (savedMessage != null) StatusOnline else Accent, size = 18.dp)
                        }
                    }

                    // Share button
                    Box(
                        modifier = Modifier
                            .size(38.dp)
                            .clip(CircleShape)
                            .background(Surface900)
                            .clickable { shareBitmap(context, bitmap, title) },
                        contentAlignment = Alignment.Center,
                    ) {
                        NexoraIcon(NexoraIcons.ScreenShare, tint = Slate300, size = 18.dp)
                    }
                }
            }

            // Bottom Saved confirmation banner or Reset Zoom hint
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(bottom = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                savedMessage?.let { msg ->
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(20.dp))
                            .background(Surface900.copy(alpha = 0.9f))
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            NexoraIcon(NexoraIcons.Check, tint = StatusOnline, size = 16.dp)
                            Text(
                                text = msg,
                                style = MaterialTheme.typography.labelSmall,
                                color = Slate100,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }

                if (scale > 1.2f) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(20.dp))
                            .background(Surface900.copy(alpha = 0.8f))
                            .clickable {
                                scale = 1f
                                offsetX = 0f
                                offsetY = 0f
                            }
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                    ) {
                        Text(
                            text = "Reset Zoom (${(scale * 100).toInt()}%)",
                            style = MaterialTheme.typography.labelSmall,
                            color = Accent,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    }
}

/**
 * In-App Fullscreen Video Player Dialog with playback controls and save to Movies/Nexora.
 */
@Composable
fun VideoPlayerDialog(
    videoUri: Uri,
    title: String,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var isReady by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            AndroidView(
                factory = { ctx ->
                    VideoView(ctx).apply {
                        val controller = MediaController(ctx)
                        controller.setAnchorView(this)
                        setMediaController(controller)
                        setVideoURI(videoUri)
                        setOnPreparedListener { mp ->
                            isReady = true
                            mp.isLooping = true
                            start()
                        }
                        setOnErrorListener { _, _, _ ->
                            onDismiss()
                            true
                        }
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )

            if (!isReady) {
                CircularProgressIndicator(color = Accent)
            }

            // Top Header Bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.TopCenter)
                    .background(Color.Black.copy(alpha = 0.6f))
                    .statusBarsPadding()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.weight(1f),
                ) {
                    Box(
                        modifier = Modifier
                            .size(38.dp)
                            .clip(CircleShape)
                            .background(Surface900)
                            .clickable(onClick = onDismiss),
                        contentAlignment = Alignment.Center,
                    ) {
                        NexoraIcon(NexoraIcons.X, tint = Slate100, size = 18.dp)
                    }

                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleMedium,
                        color = Slate100,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    // Save to Movies/Nexora button
                    Box(
                        modifier = Modifier
                            .size(38.dp)
                            .clip(CircleShape)
                            .background(Surface900)
                            .clickable(enabled = !saving) {
                                scope.launch {
                                    saving = true
                                    val bytes = runCatching {
                                        context.contentResolver.openInputStream(videoUri)?.use { it.readBytes() }
                                    }.getOrNull()
                                    if (bytes != null) {
                                        val uri = saveMediaToStorage(context, bytes, title, "video/mp4")
                                        if (uri != null) {
                                            Toast.makeText(context, "Saved to Movies/Nexora", Toast.LENGTH_SHORT).show()
                                        } else {
                                            Toast.makeText(context, "Failed to save video", Toast.LENGTH_SHORT).show()
                                        }
                                    }
                                    saving = false
                                }
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (saving) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = Accent)
                        } else {
                            NexoraIcon(NexoraIcons.Download, tint = Accent, size = 18.dp)
                        }
                    }

                    // External player button
                    Box(
                        modifier = Modifier
                            .size(38.dp)
                            .clip(CircleShape)
                            .background(Surface900)
                            .clickable { openExternalPlayer(context, videoUri) },
                        contentAlignment = Alignment.Center,
                    ) {
                        NexoraIcon(NexoraIcons.ScreenShare, tint = Slate300, size = 18.dp)
                    }
                }
            }
        }
    }
}

/**
 * Saves an image to the device gallery under Pictures/Nexora album.
 */
suspend fun saveImageToStorage(
    context: Context,
    bitmap: Bitmap,
    fileName: String = "Nexora_${System.currentTimeMillis()}.jpg",
): Uri? = withContext(Dispatchers.IO) {
    runCatching {
        val resolver = context.contentResolver
        val safeName = if (fileName.endsWith(".jpg", true) || fileName.endsWith(".png", true)) {
            fileName
        } else {
            "$fileName.jpg"
        }

        val contentValues = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, safeName)
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Nexora")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
        }

        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)
            ?: error("Could not insert image into MediaStore")

        resolver.openOutputStream(uri)?.use { stream ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 95, stream)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            contentValues.clear()
            contentValues.put(MediaStore.Images.Media.IS_PENDING, 0)
            resolver.update(uri, contentValues, null, null)
        }

        uri
    }.getOrNull()
}

/**
 * Saves decrypted media bytes (video, audio, image, document) to public storage under Pictures/Nexora,
 * Movies/Nexora, or Download/Nexora.
 */
suspend fun saveMediaToStorage(
    context: Context,
    bytes: ByteArray,
    name: String,
    contentType: String,
): Uri? = withContext(Dispatchers.IO) {
    runCatching {
        val resolver = context.contentResolver
        val isVideo = contentType.startsWith("video/")
        val isImage = contentType.startsWith("image/")
        val isAudio = contentType.startsWith("audio/")

        val (collection, relativeDir, mime) = when {
            isImage -> Triple(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                "Pictures/Nexora",
                contentType.ifBlank { "image/jpeg" },
            )
            isVideo -> Triple(
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                "Movies/Nexora",
                contentType.ifBlank { "video/mp4" },
            )
            isAudio -> Triple(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                "Music/Nexora",
                contentType.ifBlank { "audio/mpeg" },
            )
            else -> Triple(
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) MediaStore.Downloads.EXTERNAL_CONTENT_URI
                else MediaStore.Files.getContentUri("external"),
                "Download/Nexora",
                contentType.ifBlank { "application/octet-stream" },
            )
        }

        val contentValues = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.MediaColumns.RELATIVE_PATH, relativeDir)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
        }

        val uri = resolver.insert(collection, contentValues) ?: error("Failed to insert media row")

        resolver.openOutputStream(uri)?.use { stream ->
            stream.write(bytes)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            contentValues.clear()
            contentValues.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, contentValues, null, null)
        }

        uri
    }.getOrNull()
}

/**
 * Saves decrypted bytes into app cache and returns a content Uri through FileProvider.
 */
fun cacheDecryptedMedia(context: Context, bytes: ByteArray, fileName: String): Uri {
    val directory = File(context.cacheDir, "media").apply { mkdirs() }
    val safeName = fileName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
    val file = File(directory, "${System.currentTimeMillis()}_$safeName")
    FileOutputStream(file).use { it.write(bytes) }
    return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
}

/**
 * The first frame of a video, for the card in the message list.
 *
 * A decrypted video used to be a grey rectangle with a play button: the bytes
 * were already on the device and the picture was still a tap away. The
 * retriever wants a file rather than a byte array, which is the same file the
 * player is handed when the tap does come.
 */
suspend fun videoPoster(uri: Uri, context: Context): Bitmap? = withContext(Dispatchers.IO) {
    runCatching {
        MediaMetadataRetriever().use { retriever ->
            retriever.setDataSource(context, uri)
            // A frame a moment in, not frame zero: a video that fades in from
            // black has a first frame that is black.
            retriever.getFrameAtTime(500_000) ?: retriever.frameAtTime
        }
    }.getOrNull()
}

private fun shareBitmap(context: Context, bitmap: Bitmap, title: String) {
    runCatching {
        val directory = File(context.cacheDir, "media").apply { mkdirs() }
        val file = File(directory, "shared_${System.currentTimeMillis()}.jpg")
        FileOutputStream(file).use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 95, out)
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "image/jpeg"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "Share $title"))
    }
}

private fun openExternalPlayer(context: Context, videoUri: Uri) {
    runCatching {
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(videoUri, "video/*")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "Play video with"))
    }
}
