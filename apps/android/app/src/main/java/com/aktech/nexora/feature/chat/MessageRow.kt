package com.aktech.nexora.feature.chat

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import com.aktech.nexora.core.crypto.E2ee
import com.aktech.nexora.core.data.Endpoint
import com.aktech.nexora.core.data.MessageAttachment
import com.aktech.nexora.core.data.PublicUser
import com.aktech.nexora.core.store.Conversation
import com.aktech.nexora.core.store.ReadableMessage
import com.aktech.nexora.ui.components.Avatar
import com.aktech.nexora.ui.components.Chip
import com.aktech.nexora.ui.components.NexoraIcon
import com.aktech.nexora.ui.components.NexoraIcons
import com.aktech.nexora.ui.theme.Accent
import com.aktech.nexora.ui.theme.Slate100
import com.aktech.nexora.ui.theme.Slate400
import com.aktech.nexora.ui.theme.Slate50
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.Surface700
import com.aktech.nexora.ui.theme.Surface900
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val timeFormat = DateTimeFormatter.ofPattern("HH:mm")

/**
 * One message.
 *
 * Consecutive messages from the same author within five minutes are grouped
 * under one header, the way the desktop groups them - a column of repeated
 * names and avatars is mostly furniture.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageRow(
    readable: ReadableMessage,
    previous: ReadableMessage?,
    self: PublicUser,
    channelId: String,
    onLongPress: () -> Unit,
    onReact: (String) -> Unit,
) {
    val message = readable.message
    val grouped = previous != null &&
        previous.message.author.id == message.author.id &&
        !previous.message.deleted &&
        !message.deleted &&
        withinFiveMinutes(previous.message.createdAt, message.createdAt)

    Column(
        Modifier
            .fillMaxWidth()
            .combinedClickable(onClick = {}, onLongClick = { if (!message.deleted) onLongPress() })
            .padding(horizontal = 12.dp, vertical = if (grouped) 1.dp else 6.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            if (grouped) {
                Spacer(Modifier.width(40.dp))
            } else {
                Avatar(
                    id = message.author.id,
                    label = message.author.label,
                    url = message.author.avatarUrl?.let { Endpoint.absolute(it) },
                    size = 34.dp,
                )
                Spacer(Modifier.width(6.dp))
            }

            Column(Modifier.weight(1f)) {
                if (!grouped) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(
                            text = message.author.label,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = if (message.author.id == self.id) Accent else Slate50,
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = shortTime(message.createdAt),
                            style = MaterialTheme.typography.bodySmall,
                            color = Slate500,
                        )
                        if (message.pinned) {
                            Spacer(Modifier.width(6.dp))
                            NexoraIcon(NexoraIcons.Pin, tint = Slate500, size = 12.dp)
                        }
                    }
                    Spacer(Modifier.height(2.dp))
                }

                when {
                    // The row survives as a tombstone so a conversation reads as
                    // "this was here and is gone" rather than silently
                    // re-flowing around a hole.
                    message.deleted -> Text(
                        text = "Message deleted" +
                            (message.deletedBy?.takeIf { it.id != message.author.id }
                                ?.let { " by ${it.label}" } ?: ""),
                        style = MaterialTheme.typography.bodyMedium,
                        fontStyle = FontStyle.Italic,
                        color = Slate500,
                    )

                    readable.text == E2ee.UNDECRYPTABLE -> Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        NexoraIcon(NexoraIcons.Lock, tint = Slate500, size = 14.dp)
                        Text(
                            text = "Encrypted - no key on this device yet",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Slate500,
                        )
                    }

                    else -> Text(
                        text = readable.text,
                        style = MaterialTheme.typography.bodyLarge,
                        color = Slate100,
                    )
                }

                if (message.editedAt != null && !message.deleted) {
                    Text(
                        text = "edited",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate500,
                    )
                }

                readable.attachments.forEach { attachment ->
                    Spacer(Modifier.height(6.dp))
                    AttachmentCard(channelId, attachment)
                }

                if (message.reactions.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        message.reactions.forEach { reaction ->
                            Chip(
                                text = "${reaction.emoji} ${reaction.userIds.size}",
                                selected = self.id in reaction.userIds,
                                onClick = { onReact(reaction.emoji) },
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * An attachment. The bytes are ciphertext on the server, so an image cannot be
 * handed to an image loader as a URL - it is fetched, opened with the channel
 * key, and decoded here.
 */
@Composable
private fun AttachmentCard(channelId: String, attachment: MessageAttachment) {
    var bytes by remember(attachment.key) { mutableStateOf<ByteArray?>(null) }
    var failed by remember(attachment.key) { mutableStateOf(false) }
    var wanted by remember(attachment.key) { mutableStateOf(attachment.isImage) }

    LaunchedEffect(attachment.key, wanted) {
        if (!wanted || bytes != null) return@LaunchedEffect
        runCatching { Conversation.openAttachment(channelId, attachment) }
            .onSuccess { bytes = it }
            .onFailure { failed = true }
    }

    val image = remember(bytes) {
        bytes?.takeIf { attachment.isImage }
            ?.let { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size) }.getOrNull() }
    }

    Box(
        Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(Surface900)
            .padding(if (image != null) 0.dp else 10.dp),
    ) {
        when {
            image != null -> Image(
                bitmap = image.asImageBitmap(),
                contentDescription = attachment.name,
                contentScale = ContentScale.Fit,
                modifier = Modifier.clip(RoundedCornerShape(10.dp)),
            )

            else -> Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                NexoraIcon(
                    icon = if (attachment.isImage) NexoraIcons.Image else NexoraIcons.File,
                    tint = Slate400,
                )
                Column {
                    Text(
                        text = attachment.name,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Slate100,
                    )
                    Text(
                        text = when {
                            failed -> "Could not be opened"
                            bytes != null -> "Ready · ${readableSize(attachment.size)}"
                            wanted -> "Opening…"
                            else -> "${readableSize(attachment.size)} · tap to decrypt"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate500,
                    )
                }
                if (!wanted) {
                    Box(
                        Modifier
                            .size(36.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(Surface700)
                            .combinedClickable(onClick = { wanted = true }),
                        contentAlignment = Alignment.Center,
                    ) {
                        NexoraIcon(NexoraIcons.Download, tint = Slate400, size = 16.dp)
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
