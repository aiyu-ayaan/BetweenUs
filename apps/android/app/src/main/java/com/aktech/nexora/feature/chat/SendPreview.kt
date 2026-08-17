package com.aktech.nexora.feature.chat

import android.net.Uri
import android.widget.MediaController
import android.widget.VideoView
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import com.aktech.nexora.ui.components.IconAction
import com.aktech.nexora.ui.components.NexoraIcon
import com.aktech.nexora.ui.components.NexoraIcons
import com.aktech.nexora.ui.theme.Accent
import com.aktech.nexora.ui.theme.Edge
import com.aktech.nexora.ui.theme.Slate100
import com.aktech.nexora.ui.theme.Slate400
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.Surface800
import com.aktech.nexora.ui.theme.Surface900
import com.aktech.nexora.ui.theme.Surface950

/**
 * What you are about to send, before you send it.
 *
 * The port of `apps/desktop/src/features/chat/SendPreview.tsx`. Pictures and
 * video used to be uploaded the instant they were picked and named on a chip,
 * which is the one moment nobody can check what they actually chose - and
 * picking the wrong photo out of a roll of near-identical ones is the most
 * ordinary mistake there is.
 *
 * Nothing here is encrypted or uploaded yet: these are local content URIs the
 * picker just handed back. Sending is what reads, seals and uploads them.
 */
@Composable
fun SendPreviewDialog(
    items: List<PickedPreview>,
    caption: String,
    busy: Boolean,
    note: String?,
    onCaption: (String) -> Unit,
    onRemove: (PickedPreview) -> Unit,
    onAdd: () -> Unit,
    onCancel: () -> Unit,
    onSend: () -> Unit,
) {
    if (items.isEmpty()) return
    var at by remember(items.size) { mutableStateOf(0) }
    val index = at.coerceIn(0, items.lastIndex)
    val current = items[index]

    Dialog(
        onDismissRequest = { if (!busy) onCancel() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .background(Surface950)
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 6.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconAction(NexoraIcons.X, "Back to the message box", { if (!busy) onCancel() })
                Column(Modifier.weight(1f).padding(start = 6.dp)) {
                    Text(
                        text = if (items.size == 1) current.name else "${items.size} files",
                        style = MaterialTheme.typography.titleSmall,
                        color = Slate100,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = note ?: "Encrypted before it leaves this phone",
                        style = MaterialTheme.typography.bodySmall,
                        fontSize = 11.sp,
                        color = Slate500,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                IconAction(NexoraIcons.Paperclip, "Add another file", { if (!busy) onAdd() })
                IconAction(NexoraIcons.Trash, "Remove this one", { if (!busy) onRemove(current) })
            }

            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(Color.Black),
                contentAlignment = Alignment.Center,
            ) {
                when {
                    current.isVideo -> AndroidView(
                        factory = { ctx ->
                            VideoView(ctx).apply {
                                val controller = MediaController(ctx)
                                controller.setAnchorView(this)
                                setMediaController(controller)
                                setVideoURI(current.uri)
                                // Paused on the first frame: this is a check of
                                // what was picked, not a screening of it.
                                setOnPreparedListener { seekTo(1) }
                            }
                        },
                        // A new pick is a new video; without this the view keeps
                        // playing whatever it was given first.
                        update = { it.setVideoURI(current.uri) },
                        modifier = Modifier.fillMaxSize(),
                    )

                    else -> AsyncImage(
                        model = current.uri,
                        contentDescription = current.name,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }

            if (items.size > 1) {
                LazyRow(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Surface900)
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(items, key = { it.uri.toString() }) { item ->
                        Box(
                            modifier = Modifier
                                .size(56.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(Surface800)
                                .border(
                                    width = if (item == current) 2.dp else 1.dp,
                                    color = if (item == current) Accent else Edge,
                                    shape = RoundedCornerShape(8.dp),
                                )
                                .clickable { at = items.indexOf(item) },
                            contentAlignment = Alignment.Center,
                        ) {
                            if (item.isVideo) {
                                NexoraIcon(NexoraIcons.Play, tint = Slate400, size = 20.dp)
                            } else {
                                AsyncImage(
                                    model = item.uri,
                                    contentDescription = item.name,
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.fillMaxSize(),
                                )
                            }
                        }
                    }
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Surface950)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(22.dp))
                        .background(Surface800)
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                ) {
                    if (caption.isEmpty()) {
                        Text(
                            text = "Add a caption…",
                            style = MaterialTheme.typography.bodyLarge,
                            color = Slate500,
                        )
                    }
                    BasicTextField(
                        value = caption,
                        onValueChange = onCaption,
                        enabled = !busy,
                        textStyle = TextStyle(color = Slate100, fontSize = 16.sp),
                        cursorBrush = SolidColor(Accent),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .clip(CircleShape)
                        .background(if (busy) Surface800 else Accent)
                        .clickable(enabled = !busy) { onSend() },
                    contentAlignment = Alignment.Center,
                ) {
                    if (busy) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = Accent,
                        )
                    } else {
                        NexoraIcon(NexoraIcons.Send, tint = Color.White, size = 20.dp)
                    }
                }
            }

            Spacer(Modifier.height(4.dp))
        }
    }
}

/** One thing the picker handed back, before anything has been read off disk. */
data class PickedPreview(val uri: Uri, val name: String, val contentType: String) {
    val isVideo: Boolean get() = contentType.startsWith("video/")
    val isImage: Boolean get() = contentType.startsWith("image/")

    /** True for what this screen can show rather than only name. */
    val isPreviewable: Boolean get() = isVideo || isImage
}
