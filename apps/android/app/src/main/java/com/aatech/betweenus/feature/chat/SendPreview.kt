package com.aatech.betweenus.feature.chat

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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.theme.Accent
import com.aatech.betweenus.ui.theme.Edge
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.Surface800
import com.aatech.betweenus.ui.theme.Surface900
import com.aatech.betweenus.ui.theme.Surface950

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
 * picker just handed back. Sending hands the batch to [Outbox], which does the
 * reading, sealing and uploading under a foreground service - so this screen
 * closes at once and never has to show a spinner of its own.
 *
 * Everything picked comes through here, a PDF as much as a photo. A file with
 * nothing to look at gets a card with its name on it, because the question the
 * screen asks - "is this the one you meant?" - is the same question either way,
 * and it used to be asked of pictures only while a document was uploaded the
 * instant it was picked.
 */
@Composable
fun SendPreviewDialog(
    items: List<PickedPreview>,
    caption: String,
    onCaption: (String) -> Unit,
    onRemove: (PickedPreview) -> Unit,
    /** A picture that came back from the crop screen, in place of the original. */
    onReplace: (PickedPreview, PickedPreview) -> Unit,
    onAdd: () -> Unit,
    /** Whether these files are being sent as a one-time message. */
    viewOnce: Boolean,
    onViewOnce: (Boolean) -> Unit,
    onCancel: () -> Unit,
    onSend: () -> Unit,
) {
    if (items.isEmpty()) return
    var at by remember(items.size) { mutableStateOf(0) }
    val index = at.coerceIn(0, items.lastIndex)
    val current = items[index]
    var cropping by remember { mutableStateOf(false) }

    if (cropping && current.isImage) {
        ImageEditorDialog(
            source = current.uri,
            title = current.name,
            onCancel = { cropping = false },
            onDone = { edited ->
                cropping = false
                // The editor always writes a JPEG, so the name follows: a file
                // that lies about its type confuses every client that opens it.
                onReplace(
                    current,
                    PickedPreview(
                        uri = edited,
                        name = current.name.substringBeforeLast('.', current.name) + ".jpg",
                        contentType = "image/jpeg",
                    ),
                )
            },
        )
    }

    Dialog(
        onDismissRequest = onCancel,
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
                IconAction(BetweenUsIcons.X, "Back to the message box", onCancel)
                Column(Modifier.weight(1f).padding(start = 6.dp)) {
                    Text(
                        text = if (items.size == 1) current.name else "${items.size} files",
                        style = MaterialTheme.typography.titleSmall,
                        color = Slate100,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = "Encrypted before it leaves this phone",
                        style = MaterialTheme.typography.bodySmall,
                        fontSize = 11.sp,
                        color = Slate500,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (current.isImage) {
                    IconAction(BetweenUsIcons.Crop, "Crop and rotate", { cropping = true })
                }
                IconAction(BetweenUsIcons.Paperclip, "Add another file", onAdd)
                IconAction(BetweenUsIcons.Trash, "Remove this one", { onRemove(current) })
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

                    current.isImage -> AsyncImage(
                        model = current.uri,
                        contentDescription = current.name,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize(),
                    )

                    // A spreadsheet has nothing to look at. It still has a name
                    // and a type, which is the whole of what can be checked
                    // about it before it goes.
                    else -> Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(32.dp),
                    ) {
                        BetweenUsIcon(BetweenUsIcons.File, tint = Slate400, size = 48.dp)
                        Spacer(Modifier.height(12.dp))
                        Text(
                            text = current.name,
                            style = MaterialTheme.typography.titleSmall,
                            color = Slate100,
                            textAlign = TextAlign.Center,
                        )
                        Text(
                            text = current.contentType,
                            style = MaterialTheme.typography.bodySmall,
                            color = Slate500,
                        )
                    }
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
                            when {
                                item.isVideo ->
                                    BetweenUsIcon(BetweenUsIcons.Play, tint = Slate400, size = 20.dp)

                                item.isImage -> AsyncImage(
                                    model = item.uri,
                                    contentDescription = item.name,
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.fillMaxSize(),
                                )

                                else ->
                                    BetweenUsIcon(BetweenUsIcons.File, tint = Slate400, size = 20.dp)
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
                        textStyle = TextStyle(color = Slate100, fontSize = 16.sp),
                        cursorBrush = SolidColor(Accent),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                // This is the screen where somebody actually looks at the
                // photo they are about to send, so it is the screen where they
                // decide it is one they would rather did not stay anywhere.
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .clip(CircleShape)
                        .background(if (viewOnce) Accent.copy(alpha = 0.18f) else Surface800)
                        .clickable { onViewOnce(!viewOnce) },
                    contentAlignment = Alignment.Center,
                ) {
                    BetweenUsIcon(
                        BetweenUsIcons.OneTime,
                        contentDescription = if (viewOnce) {
                            "One-time is on"
                        } else {
                            "Send as a one-time message"
                        },
                        tint = if (viewOnce) Accent else Slate400,
                        size = 20.dp,
                    )
                }

                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .clip(CircleShape)
                        .background(Accent)
                        .clickable { onSend() },
                    contentAlignment = Alignment.Center,
                ) {
                    // No spinner. Sending is a hand-off to [Outbox] that
                    // returns at once, and the progress lives in the ongoing
                    // notification and the bar above the conversation.
                    BetweenUsIcon(BetweenUsIcons.Send, tint = Color.White, size = 20.dp)
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
}
