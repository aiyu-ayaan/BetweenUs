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
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.buildAnnotatedString
import coil.compose.AsyncImage
import com.aktech.nexora.core.data.CustomEmoji
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
import kotlin.math.max
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
                                    MessageText(readable)
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
    var mediaUri by remember(attachment.key) { mutableStateOf(MediaCache.video(attachment.key)) }
    var poster by remember(attachment.key) { mutableStateOf(MediaCache.poster(attachment.key)) }

    /**
     * The decoded picture, once there is one.
     *
     * State rather than `remember { decode }`, and that is the whole point: a
     * `remember` block runs during composition, on the UI thread. A photo from
     * a phone is four thousand pixels wide, so every one of them was tens of
     * milliseconds of decoding in the middle of a frame - which is what the
     * list stuttering while pictures arrive actually was.
     *
     * Seeded from the cache, because a row that has been on screen before has
     * already paid for all of this once. Reading a decoded bitmap out of a map
     * is not a decode, so doing it during composition is free.
     */
    var imageBitmap by remember(attachment.key) { mutableStateOf(MediaCache.bitmap(attachment.key)) }

    /**
     * Images and videos decrypt themselves, so they preview without being asked.
     *
     * Only once, though. A `LazyColumn` disposes a row as it leaves the screen
     * and composes a fresh one when it comes back, so without this check
     * scrolling a picture off the top and back downloaded it, decrypted it and
     * decoded it all over again - and the row that was a photo a second ago was
     * a spinner again. Whatever the cache already holds is what this row draws.
     */
    LaunchedEffect(attachment.key) {
        if (!attachment.isImage && !attachment.isVideo) return@LaunchedEffect
        if (imageBitmap != null || mediaUri != null) return@LaunchedEffect
        decrypting = true
        runCatching { Conversation.openAttachment(channelId, attachment) }
            .onSuccess { bytes = it }
            .onFailure { failed = true }
        decrypting = false
    }

    // A decrypted video used to stay a grey card with a play button on it, so
    // "the video has arrived" and "the video has not arrived" looked the same.
    LaunchedEffect(bytes) {
        val fetched = bytes ?: return@LaunchedEffect
        if (!attachment.isVideo || mediaUri != null) return@LaunchedEffect
        // `LaunchedEffect` runs its body on the main dispatcher, so this used to
        // write thirty megabytes of video to disk on the UI thread - which is a
        // frozen list for as long as it takes, at exactly the moment the list is
        // trying to scroll to the message that carried it.
        val uri = withContext(Dispatchers.IO) {
            runCatching { cacheDecryptedMedia(context, fetched, attachment.name) }.getOrNull()
        } ?: return@LaunchedEffect
        mediaUri = uri
        MediaCache.putVideo(attachment.key, uri)
        // A new file every time it is written, so writing it once per scroll
        // past was also thirty megabytes of cache directory per scroll past.
        poster = videoPoster(uri, context)?.also { MediaCache.putPoster(attachment.key, it) }
    }

    LaunchedEffect(bytes) {
        val fetched = bytes?.takeIf { attachment.isImage } ?: return@LaunchedEffect
        if (imageBitmap != null) return@LaunchedEffect
        imageBitmap = decodeDownsampled(fetched, MAX_DECODE_EDGE_PX)
            ?.also { MediaCache.putBitmap(attachment.key, it) }
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
                // A local binding rather than the state itself: a delegated
                // property cannot be smart-cast, and this is read three times.
                val shown = imageBitmap
                if (shown != null) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 300.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .clickable { onViewImage(shown, attachment.name) },
                    ) {
                        Image(
                            bitmap = shown.asImageBitmap(),
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
                            // The space the picture will take, taken now.
                            //
                            // The manifest carries the pixel size the sender
                            // recorded, so the row can be its final height
                            // before a single byte is decoded. Without it the
                            // row is one line tall and then jumps to three
                            // hundred, which moves every message below it -
                            // under a scroll that had already finished.
                            .then(reservedHeight(attachment))
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
                                        // The cache may hold the file from an
                                        // earlier scroll past, with no bytes in
                                        // this row at all - it is still ready.
                                        mediaUri != null || bytes != null ->
                                            "Video ready · Tap to play (${readableSize(attachment.size)})"
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

/**
 * A message's words, with its custom emoji drawn in line.
 *
 * Compose's `InlineTextContent` is what makes this one paragraph rather than a
 * row of alternating text and images: the emoji wrap with the words, which is
 * the whole point of an emoji being in a sentence. Each one is keyed by its
 * position, because the same emoji twice in a message needs two slots.
 *
 * The pictures come from the message rather than from this phone's copy of the
 * server's list - see `CustomEmoji`.
 *
 * ponytail: a GIF shows its first frame. Animating one needs Coil's
 * `coil-gif` artifact and its decoder registered, which is one dependency line
 * and is on the open list; the desktop animates because a browser `<img>` does
 * it for free.
 */
@Composable
private fun MessageText(readable: ReadableMessage) {
    val pieces = remember(readable.id, readable.text) {
        CustomEmoji.split(readable.text, readable.body.emoji)
    }

    if (pieces.none { it is CustomEmoji.Piece.Emoji }) {
        Text(
            text = readable.text,
            style = MaterialTheme.typography.bodyLarge,
            color = Slate100,
            lineHeight = 22.sp,
        )
        return
    }

    val large = CustomEmoji.isOnlyEmoji(pieces)
    val size = if (large) 40.sp else 22.sp
    val inline = mutableMapOf<String, InlineTextContent>()

    val annotated = buildAnnotatedString {
        pieces.forEachIndexed { index, piece ->
            when (piece) {
                is CustomEmoji.Piece.Text -> append(piece.text)
                is CustomEmoji.Piece.Emoji -> {
                    val id = "emoji-$index"
                    inline[id] = InlineTextContent(
                        Placeholder(size, size, PlaceholderVerticalAlign.TextCenter),
                    ) {
                        AsyncImage(
                            model = Endpoint.absolute(piece.emoji.url),
                            contentDescription = ":${piece.emoji.name}:",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                    // The alternative text is the shortcode, so copying the
                    // message copies what was typed rather than a blank.
                    appendInlineContent(id, ":${piece.emoji.name}:")
                }
            }
        }
    }

    Text(
        text = annotated,
        inlineContent = inline,
        style = MaterialTheme.typography.bodyLarge,
        color = Slate100,
        lineHeight = if (large) 44.sp else 22.sp,
    )
}

/**
 * The longest edge a picture in the message list is decoded to.
 *
 * A card is at most 300dp tall and as wide as the screen, so anything past
 * about a thousand pixels is memory and decode time spent on detail no phone
 * shows. The full-size original is still what the viewer opens, decoded once
 * when it is asked for rather than once per row on the way past.
 */
private const val MAX_DECODE_EDGE_PX = 1080

/**
 * How much to shrink a picture by while decoding it.
 *
 * `inSampleSize` has to be a power of two - the decoder rounds down to one
 * anyway - and the answer is the largest that still leaves the longest edge at
 * or above the target, so the result is never softer than what is drawn.
 *
 * Pure, and tested: an off-by-one here is either a blurry picture or a decode
 * that saves nothing, and both look like somebody else's bug.
 */
internal fun sampleSizeFor(width: Int, height: Int, targetPx: Int): Int {
    if (width <= 0 || height <= 0 || targetPx <= 0) return 1
    var sample = 1
    while (max(width, height) / (sample * 2) >= targetPx) sample *= 2
    return sample
}

/** Decodes off the UI thread, at the size it will actually be drawn. */
private suspend fun decodeDownsampled(bytes: ByteArray, targetPx: Int): Bitmap? =
    withContext(Dispatchers.Default) {
        runCatching {
            // Bounds first: the size has to be known before the sample size
            // can be chosen, and reading them decodes no pixels at all.
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)

            val options = BitmapFactory.Options().apply {
                inSampleSize = sampleSizeFor(bounds.outWidth, bounds.outHeight, targetPx)
            }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        }.getOrNull()
    }

/**
 * The height a picture is going to need, before it has been decoded.
 *
 * Nothing when the sender recorded no size - a GIF is never re-encoded, so it
 * has none - and in that case the row grows as it always did. The ratio is
 * clamped: a panorama would otherwise be a sliver and a phone screenshot would
 * be taller than the screen.
 */
@Composable
private fun reservedHeight(attachment: MessageAttachment): Modifier {
    val width = attachment.width ?: return Modifier
    val height = attachment.height ?: return Modifier
    if (width <= 0 || height <= 0) return Modifier
    return Modifier.aspectRatio((width.toFloat() / height).coerceIn(0.6f, 2.5f))
}
