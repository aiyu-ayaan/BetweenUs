package com.aktech.nexora.feature.chat

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aktech.nexora.core.crypto.E2ee
import com.aktech.nexora.core.data.Endpoint
import com.aktech.nexora.core.data.MessageAttachment
import com.aktech.nexora.core.data.PublicUser
import com.aktech.nexora.core.store.Conversation
import com.aktech.nexora.core.store.ReadableMessage
import com.aktech.nexora.ui.components.Avatar
import com.aktech.nexora.ui.components.NexoraIcon
import com.aktech.nexora.ui.components.NexoraIcons
import com.aktech.nexora.ui.theme.Accent
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Edge
import com.aktech.nexora.ui.theme.Ground
import com.aktech.nexora.ui.theme.Slate100
import com.aktech.nexora.ui.theme.Slate300
import com.aktech.nexora.ui.theme.Slate400
import com.aktech.nexora.ui.theme.Slate50
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.Surface700
import com.aktech.nexora.ui.theme.Surface800
import com.aktech.nexora.ui.theme.Surface850
import com.aktech.nexora.ui.theme.Surface900
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val timeFormat = DateTimeFormatter.ofPattern("HH:mm")

/**
 * Enhanced chat message row supporting:
 * - Distinct bubbles with sender accents and "YOU" badge
 * - Encrypted inline photo cards with zoomable fullscreen viewer
 * - Encrypted video cards with thumbnail extraction and integrated video player
 * - Document/Audio tiles with download/decrypt actions
 * - Interactive emoji reactions
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageRow(
    readable: ReadableMessage,
    previous: ReadableMessage?,
    self: PublicUser,
    channelId: String,
    highlighted: Boolean = false,
    onLongPress: () -> Unit,
    onOpenQuoted: (String) -> Unit = {},
    onReact: (String) -> Unit,
    onViewImage: (Bitmap, String) -> Unit = { _, _ -> },
    onPlayVideo: (Uri, String) -> Unit = { _, _ -> },
) {
    val message = readable.message
    val isSelf = message.author.id == self.id
    val grouped = previous != null &&
        previous.message.author.id == message.author.id &&
        !previous.message.deleted &&
        !message.deleted &&
        withinFiveMinutes(previous.message.createdAt, message.createdAt)

    Column(
        Modifier
            .fillMaxWidth()
            .background(if (highlighted) Accent.copy(alpha = 0.14f) else Color.Transparent)
            .combinedClickable(
                onClick = {},
                onLongClick = { if (!message.deleted) onLongPress() },
            )
            .padding(
                horizontal = 12.dp,
                vertical = if (grouped) 2.dp else 6.dp,
            ),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
        ) {
            if (grouped) {
                Spacer(Modifier.width(44.dp))
            } else {
                Avatar(
                    id = message.author.id,
                    label = message.author.label,
                    url = message.author.avatarUrl?.let { Endpoint.absolute(it) },
                    size = 36.dp,
                )
                Spacer(Modifier.width(8.dp))
            }

            Column(Modifier.weight(1f)) {
                if (!grouped) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(bottom = 3.dp),
                    ) {
                        Text(
                            text = if (isSelf) "You" else message.author.label,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = if (isSelf) Accent else Slate50,
                        )

                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = shortTime(message.createdAt),
                            style = MaterialTheme.typography.bodySmall,
                            fontSize = 11.sp,
                            color = Slate500,
                        )

                        if (message.pinned) {
                            Spacer(Modifier.width(6.dp))
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(Color(0xFFF59E0B).copy(alpha = 0.15f))
                                    .padding(horizontal = 4.dp, vertical = 1.dp),
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                                ) {
                                    NexoraIcon(
                                        icon = NexoraIcons.Pin,
                                        tint = Color(0xFFF59E0B),
                                        size = 10.dp,
                                    )
                                    Text(
                                        text = "PINNED",
                                        style = MaterialTheme.typography.labelSmall,
                                        fontSize = 9.sp,
                                        color = Color(0xFFF59E0B),
                                        fontWeight = FontWeight.Bold,
                                    )
                                }
                            }
                        }
                    }
                }

                // Message bubble container
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(
                            when {
                                message.deleted -> Surface900.copy(alpha = 0.5f)
                                isSelf -> Color(0xFF191726)
                                else -> Surface900
                            },
                        )
                        .border(
                            width = 1.dp,
                            color = when {
                                message.deleted -> Edge
                                isSelf -> Accent.copy(alpha = 0.24f)
                                else -> Edge
                            },
                            shape = RoundedCornerShape(14.dp),
                        )
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                ) {
                    Column {
                        // The quote belongs to the message, so it sits inside
                        // the bubble and above everything the message says.
                        readable.replyTo?.takeIf { !message.deleted }?.let { reply ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(bottom = 6.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Accent.copy(alpha = 0.08f))
                                    .clickable { onOpenQuoted(reply.id) }
                                    .padding(horizontal = 8.dp, vertical = 5.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                NexoraIcon(NexoraIcons.Reply, tint = Slate500, size = 12.dp)
                                Text(
                                    text = reply.author,
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Accent,
                                )
                                Text(
                                    text = reply.preview.ifBlank { "Sent an attachment" },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = Slate400,
                                    maxLines = 1,
                                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                                )
                            }
                        }

                        when {
                            message.deleted -> Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                NexoraIcon(NexoraIcons.Trash, tint = Slate500, size = 16.dp)
                                Text(
                                    text = "Message deleted" +
                                        (message.deletedBy?.takeIf { it.id != message.author.id }
                                            ?.let { " by ${it.label}" } ?: ""),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = Slate500,
                                )
                            }

                            readable.text == E2ee.UNDECRYPTABLE -> Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                NexoraIcon(NexoraIcons.Lock, tint = Danger, size = 16.dp)
                                Text(
                                    text = "Encrypted - no key on this device yet",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = Slate400,
                                )
                            }

                            else -> {
                                if (readable.text.isNotBlank()) {
                                    Text(
                                        text = readable.text,
                                        style = MaterialTheme.typography.bodyLarge,
                                        color = Slate100,
                                        lineHeight = 22.sp,
                                    )
                                }

                                readable.attachments.forEach { attachment ->
                                    if (readable.text.isNotBlank()) Spacer(Modifier.height(8.dp))
                                    AttachmentCard(channelId, attachment, onViewImage, onPlayVideo)
                                }

                                if (message.editedAt != null) {
                                    Text(
                                        text = "(edited)",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = Slate500,
                                        modifier = Modifier.padding(top = 4.dp),
                                    )
                                }
                            }
                        }
                    }
                }

                // Reactions section
                if (message.reactions.isNotEmpty()) {
                    Spacer(Modifier.height(4.dp))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.padding(top = 2.dp),
                    ) {
                        message.reactions.forEach { reaction ->
                            val reacted = self.id in reaction.userIds
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(if (reacted) Accent.copy(alpha = 0.2f) else Surface800)
                                    .border(
                                        width = 1.dp,
                                        color = if (reacted) Accent else Edge,
                                        shape = RoundedCornerShape(14.dp),
                                    )
                                    .clickable { onReact(reaction.emoji) }
                                    .padding(horizontal = 8.dp, vertical = 4.dp),
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                                ) {
                                    Text(
                                        text = reaction.emoji,
                                        style = MaterialTheme.typography.bodySmall,
                                        fontSize = 13.sp,
                                    )
                                    Text(
                                        text = "${reaction.userIds.size}",
                                        style = MaterialTheme.typography.labelSmall,
                                        fontWeight = FontWeight.Bold,
                                        color = if (reacted) Accent else Slate400,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Modern Attachment Card handling Image, Video, and File attachments with E2EE decryption.
 */
@Composable
private fun AttachmentCard(
    channelId: String,
    attachment: MessageAttachment,
    onViewImage: (Bitmap, String) -> Unit,
    onPlayVideo: (Uri, String) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var bytes by remember(attachment.key) { mutableStateOf<ByteArray?>(null) }
    var failed by remember(attachment.key) { mutableStateOf(false) }
    var decrypting by remember(attachment.key) { mutableStateOf(false) }
    /** Where the decrypted video landed, so the poster and the player share it. */
    var mediaUri by remember(attachment.key) { mutableStateOf<Uri?>(null) }
    var poster by remember(attachment.key) { mutableStateOf<Bitmap?>(null) }

    // Automatically decrypt images and videos so they preview immediately
    LaunchedEffect(attachment.key) {
        if (attachment.isImage || attachment.isVideo) {
            decrypting = true
            runCatching { Conversation.openAttachment(channelId, attachment) }
                .onSuccess { bytes = it }
                .onFailure { failed = true }
            decrypting = false
        }
    }

    // A decrypted video used to stay a grey card with a play button on it, so
    // "the video has arrived" and "the video has not arrived" looked the same.
    LaunchedEffect(bytes) {
        val fetched = bytes ?: return@LaunchedEffect
        if (!attachment.isVideo || mediaUri != null) return@LaunchedEffect
        runCatching {
            val uri = cacheDecryptedMedia(context, fetched, attachment.name)
            mediaUri = uri
            poster = videoPoster(uri, context)
        }
    }

    val imageBitmap = remember(bytes) {
        bytes?.takeIf { attachment.isImage }
            ?.let { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size) }.getOrNull() }
    }

    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Surface850)
            .border(1.dp, Edge, RoundedCornerShape(12.dp)),
    ) {
        when {
            // --- IMAGE ATTACHMENT ---
            attachment.isImage -> {
                if (imageBitmap != null) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 300.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .clickable { onViewImage(imageBitmap, attachment.name) },
                    ) {
                        Image(
                            bitmap = imageBitmap.asImageBitmap(),
                            contentDescription = attachment.name,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 160.dp, max = 300.dp),
                        )

                        // Bottom Gradient metadata bar
                        Box(
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .fillMaxWidth()
                                .background(Color.Black.copy(alpha = 0.6f))
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = attachment.name,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Slate100,
                                    maxLines = 1,
                                    modifier = Modifier.weight(1f),
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    text = readableSize(attachment.size),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Slate400,
                                )
                            }
                        }
                    }
                } else {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        if (decrypting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(24.dp),
                                strokeWidth = 2.dp,
                                color = Accent,
                            )
                        } else {
                            NexoraIcon(NexoraIcons.Image, tint = if (failed) Danger else Accent, size = 24.dp)
                        }

                        Column(Modifier.weight(1f)) {
                            Text(
                                text = attachment.name,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = Slate100,
                            )
                            Text(
                                text = if (failed) "Failed to decrypt photo" else "Decrypting photo · ${readableSize(attachment.size)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = if (failed) Danger else Slate500,
                            )
                        }
                    }
                }
            }

            // --- VIDEO ATTACHMENT ---
            attachment.isVideo -> {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .clickable {
                            val ready = mediaUri
                            val currentBytes = bytes
                            if (ready != null) {
                                onPlayVideo(ready, attachment.name)
                            } else if (currentBytes != null) {
                                val uri = cacheDecryptedMedia(context, currentBytes, attachment.name)
                                mediaUri = uri
                                onPlayVideo(uri, attachment.name)
                            } else {
                                scope.launch {
                                    decrypting = true
                                    runCatching {
                                        val fetched = Conversation.openAttachment(channelId, attachment)
                                        bytes = fetched
                                        val uri = cacheDecryptedMedia(context, fetched, attachment.name)
                                        onPlayVideo(uri, attachment.name)
                                    }.onFailure { failed = true }
                                    decrypting = false
                                }
                            }
                        },
                ) {
                    poster?.let { frame ->
                        Image(
                            bitmap = frame.asImageBitmap(),
                            contentDescription = attachment.name,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 160.dp, max = 300.dp),
                        )
                    }

                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .align(if (poster != null) Alignment.BottomCenter else Alignment.Center)
                            .background(
                                if (poster != null) Color.Black.copy(alpha = 0.55f)
                                else Color(0xFF14121E),
                            )
                            .padding(14.dp),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(48.dp)
                                    .clip(CircleShape)
                                    .background(Accent),
                                contentAlignment = Alignment.Center,
                            ) {
                                if (decrypting) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(24.dp),
                                        strokeWidth = 2.dp,
                                        color = Color.White,
                                    )
                                } else {
                                    NexoraIcon(NexoraIcons.Play, tint = Color.White, size = 24.dp)
                                }
                            }

                            Column(Modifier.weight(1f)) {
                                Text(
                                    text = attachment.name,
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Slate100,
                                    maxLines = 1,
                                )
                                Text(
                                    text = when {
                                        failed -> "Decryption failed"
                                        decrypting -> "Decrypting video…"
                                        bytes != null -> "Video ready · Tap to play (${readableSize(attachment.size)})"
                                        else -> "Video · ${readableSize(attachment.size)}"
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = if (failed) Danger else Slate400,
                                )
                            }
                        }
                    }
                }
            }

            // --- FILE / DOCUMENT / AUDIO ---
            else -> {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(
                                if (attachment.isAudio) Color(0xFFFF9500).copy(alpha = 0.2f)
                                else Color(0xFF5E5CE6).copy(alpha = 0.2f),
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        NexoraIcon(
                            icon = if (attachment.isAudio) NexoraIcons.Speaker else NexoraIcons.File,
                            tint = if (attachment.isAudio) Color(0xFFFF9500) else Color(0xFF5E5CE6),
                            size = 22.dp,
                        )
                    }

                    Column(Modifier.weight(1f)) {
                        Text(
                            text = attachment.name,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = Slate100,
                            maxLines = 1,
                        )
                        Text(
                            text = when {
                                failed -> "Decryption failed"
                                bytes != null -> "Ready · ${readableSize(attachment.size)}"
                                decrypting -> "Decrypting file…"
                                else -> "${readableSize(attachment.size)} · Tap to decrypt"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = if (failed) Danger else Slate500,
                        )
                    }

                    if (decrypting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = Accent,
                        )
                    } else if (bytes == null) {
                        Box(
                            Modifier
                                .size(38.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(Surface700)
                                .clickable {
                                    scope.launch {
                                        decrypting = true
                                        runCatching {
                                            bytes = Conversation.openAttachment(channelId, attachment)
                                        }.onFailure { failed = true }
                                        decrypting = false
                                    }
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            NexoraIcon(NexoraIcons.Download, tint = Slate300, size = 18.dp)
                        }
                    }
                }
            }
        }
    }
}

private fun readableSize(bytes: Long): String = when {
    bytes >= 1024 * 1024 -> "%.1f MB".format(bytes / 1024.0 / 1024.0)
    bytes >= 1024 -> "${bytes / 1024} KB"
    else -> "$bytes B"
}

private fun shortTime(iso: String): String = runCatching {
    Instant.parse(iso).atZone(ZoneId.systemDefault()).format(timeFormat)
}.getOrDefault("")

private fun withinFiveMinutes(earlier: String, later: String): Boolean = runCatching {
    Instant.parse(later).toEpochMilli() - Instant.parse(earlier).toEpochMilli() < 5 * 60 * 1000
}.getOrDefault(false)
