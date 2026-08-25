package com.aatech.betweenus.feature.chat

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
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
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.input.pointer.changedToUpIgnoreConsumed
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aatech.betweenus.core.crypto.E2ee
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import coil.compose.AsyncImage
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.ChannelReadReceipt
import com.aatech.betweenus.core.data.CustomEmoji
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.LinkPreview
import com.aatech.betweenus.core.data.Markup
import com.aatech.betweenus.core.data.MessageAttachment
import com.aatech.betweenus.core.data.MessageCustomEmoji
import com.aatech.betweenus.core.data.PublicUser
import com.aatech.betweenus.core.store.Conversation
import com.aatech.betweenus.core.store.ReadableMessage
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.ui.components.Avatar
import com.aatech.betweenus.ui.components.tintFor
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.theme.Accent
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Edge
import java.util.concurrent.ConcurrentHashMap
import java.util.regex.Pattern
import com.aatech.betweenus.ui.theme.Ground
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate300
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate50
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.Surface700
import com.aatech.betweenus.ui.theme.Surface800
import com.aatech.betweenus.ui.theme.Surface850
import com.aatech.betweenus.ui.theme.Surface900
import com.aatech.betweenus.ui.theme.Surface950
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val timeFormat = DateTimeFormatter.ofPattern("HH:mm")

/**
 * One message, drawn the way every phone messenger draws one.
 *
 * A bubble is as wide as what is in it and no wider than 78% of the screen;
 * yours sit against the right edge and everybody else's against the left, so
 * *who said this* is answered by the shape of the screen before a word is read.
 * The rest follows from that:
 *
 * - The name and the time move **inside** the bubble - the name at the top in
 *   the sender's own colour, the time in the bottom corner - because a bubble
 *   that hugs its text has no margin left to hang them in.
 * - The name is only drawn for other people, and only on the first message of
 *   a run. Yours is never drawn: the side of the screen already said it.
 * - The tail is the one square corner, top-outer, on the first bubble of a
 *   run. A continuation has four round corners, which is what makes a run read
 *   as one person talking rather than a stack of cards.
 * - Reactions and read receipts hang off the bubble's own edge rather than the
 *   screen's.
 *
 * It also carries the encrypted photo, video and document cards, and the
 * swipe-to-reply gesture - see the note on that below.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageRow(
    readable: ReadableMessage,
    previous: ReadableMessage?,
    self: PublicUser,
    channelId: String,
    highlighted: Boolean = false,
    /** Who has read this far. Empty for anything but your own newest messages. */
    receipts: List<ChannelReadReceipt> = emptyList(),
    onLongPress: () -> Unit,
    /** Swiping the row rightwards answers it, the way every phone chat does. */
    onReply: () -> Unit = {},
    onOpenSeenBy: () -> Unit = {},
    onOpenQuoted: (String) -> Unit = {},
    onReact: (String) -> Unit,
    onViewImage: (Bitmap, String) -> Unit = { _, _ -> },
    onPlayVideo: (Uri, String) -> Unit = { _, _ -> },
) {
    val message = readable.message
    val isSelf = message.author.id == self.id

    /**
     * Whether this message needs a face beside it.
     *
     * Not for your own - the side of the screen it is on already says who said
     * it - and not in a direct message, where there are two people and one of
     * them is you. A channel is the only place a face answers a question.
     */
    val showAvatar = !isSelf && remember(channelId) {
        Workspace.directChannel(channelId) == null
    }
    val grouped = previous != null &&
        previous.message.author.id == message.author.id &&
        !previous.message.deleted &&
        !message.deleted &&
        withinFiveMinutes(previous.message.createdAt, message.createdAt)

    /**
     * Swipe-to-reply.
     *
     * Right to left only, and only far enough to be deliberate: a phone list
     * scrolls vertically, so a horizontal drag is unambiguous, while a swipe
     * that fired on any movement at all would answer messages by accident.
     *
     * Left to right is the drawer's: `ModalNavigationDrawer` claims a
     * left-to-right drag anywhere in its content by default, and this row used
     * to claim the same direction for reply. The two fought over identical
     * gestures - a reply swipe would sometimes cross the drawer's own open
     * threshold first and pull the drawer out instead of answering. Splitting
     * by direction instead of fighting over one gives each gesture the whole
     * screen and its own, unambiguous meaning.
     *
     * The release is a Material 3 expressive spring rather than a linear slide
     * back - the row overshoots and settles, which is what makes the gesture
     * feel answered rather than merely undone.
     *
     * **A 48dp gutter down the left is left alone.** A left-to-right drag
     * starting there is the drawer's classic edge-open gesture; the row leaves
     * it untouched so the drawer sees it uninterrupted.
     *
     * **Nothing is consumed until the gesture has been claimed**, and that is
     * the whole reason this is written by hand rather than with
     * `detectHorizontalDragGestures`. That detector consumes the event that
     * crosses the touch slop *before* it reports where the finger landed, so
     * any guard reading the start position reads it after the drag has already
     * been taken off the drawer's draggable above. Both gestures lost: nothing
     * opened and nothing replied.
     *
     * **A drag has to be horizontal to count.** Slop alone is not enough - a
     * thumb travelling up the screen drifts sideways as it goes, crosses the
     * horizontal slop somewhere in the middle of a scroll, and the list would
     * lurch into reply mode. So the claim is made on the shape of the drag: it
     * has to be going sideways at least twice as fast as it is going up or
     * down, and once it is clearly vertical the row lets go for good and the
     * list keeps it.
     */
    /** The time, the pin and "edited": present, and never the loudest thing. */
    val footnote = when {
        message.deleted -> MaterialTheme.colorScheme.onSurfaceVariant
        isSelf -> MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val haptics = LocalHapticFeedback.current
    val slide = remember(message.id) { Animatable(0f) }
    /** How far it has to go to count, and how far it will go at all. */
    val threshold = with(density) { 64.dp.toPx() }
    val limit = with(density) { 88.dp.toPx() }
    /** True once this drag has passed the threshold, so the buzz happens once. */
    var armed by remember(message.id) { mutableStateOf(false) }
    val settle = spring<Float>(
        dampingRatio = Spring.DampingRatioMediumBouncy,
        stiffness = Spring.StiffnessLow,
    )

    // The 78% cap needs a number to be 78% of, and this is the only place
    // that knows how wide the conversation is.
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val widest = maxWidth * 0.78f
        // The reply mark underneath, fading in with the drag. Nothing is drawn
        // at rest, which is the point: the gesture costs the row no furniture.
        val progress = (-slide.value / threshold).coerceIn(0f, 1f)
        if (progress > 0f) {
            Box(
                modifier = Modifier
                    .matchParentSize()
                    .padding(end = 14.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                BetweenUsIcon(
                    icon = BetweenUsIcons.Reply,
                    tint = MaterialTheme.colorScheme.primary.copy(alpha = progress),
                    size = (14 + 6 * progress).dp,
                )
            }
        }

    Column(
        Modifier
            .fillMaxWidth()
            .offset { IntOffset(slide.value.roundToInt(), 0) }
            .pointerInput(message.id, message.deleted) {
                if (message.deleted) return@pointerInput
                val slop = viewConfiguration.touchSlop
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    // A drag starting in the left gutter is the drawer's
                    // classic edge-open swipe. Leave without touching
                    // anything, so the drag reaches the draggable above.
                    if (down.position.x < DRAWER_GUTTER.toPx()) return@awaitEachGesture

                    var travelX = 0f
                    var travelY = 0f
                    var claimed = false
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull { it.id == down.id } ?: break
                        if (change.changedToUpIgnoreConsumed()) break
                        // Somebody above took it - the list, scrolling. It is
                        // theirs now and this row has nothing to undo, because
                        // it never moved.
                        if (!claimed && change.isConsumed) break

                        val delta = change.positionChange()
                        travelX += delta.x
                        travelY += delta.y

                        if (!claimed) {
                            // Clearly vertical: hand it over and stay out of
                            // the way for the rest of this gesture.
                            if (abs(travelY) > slop && abs(travelY) >= abs(travelX)) break
                            // Clearly a leftward swipe: past the slop, and
                            // going sideways at least twice as fast as it is
                            // going up or down.
                            claimed = travelX < -slop && -travelX > abs(travelY) * 2f
                            if (!claimed) continue
                        }

                        val next = (slide.value + delta.x).coerceIn(-limit, 0f)
                        if (next != slide.value) change.consume()
                        if (!armed && next <= -threshold) {
                            armed = true
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        }
                        scope.launch { slide.snapTo(next) }
                    }

                    if (claimed) {
                        val fired = slide.value <= -threshold
                        armed = false
                        scope.launch { slide.animateTo(0f, settle) }
                        if (fired) onReply()
                    }
                }
            }
            .background(
                if (highlighted) {
                    MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)
                } else {
                    Color.Transparent
                },
            )
            .combinedClickable(
                onClick = {},
                onLongClick = { if (!message.deleted) onLongPress() },
            )
            .padding(
                horizontal = 10.dp,
                vertical = if (grouped) 1.dp else 5.dp,
            ),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            // Yours to the right, everybody else's to the left. This one line
            // is most of what makes a conversation readable at a glance.
            horizontalArrangement = if (isSelf) Arrangement.End else Arrangement.Start,
            verticalAlignment = Alignment.Top,
        ) {
            // Your own face is not news, and a direct message has only two
            // people in it - so the avatar is for other people in a channel,
            // once per run, and nowhere else.
            if (showAvatar) {
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
            }

            Column(horizontalAlignment = if (isSelf) Alignment.End else Alignment.Start) {
                // The bubble.
                //
                // The tail is the one square corner, on the outer top edge of
                // the first message of a run - left for somebody else, right
                // for you. A continuation has four round corners, and that is
                // what makes a run read as one person talking rather than as a
                // stack of separate cards.
                //
                // Tone rather than an outline: your words are the primary
                // container and everyone else's the surface. That is a stronger
                // separation than a 1dp border ever was, and one that survives
                // a screen in sunlight.
                val bubble = RoundedCornerShape(
                    topStart = if (!isSelf && !grouped) 4.dp else 18.dp,
                    topEnd = if (isSelf && !grouped) 4.dp else 18.dp,
                    bottomStart = 18.dp,
                    bottomEnd = 18.dp,
                )
                Box(
                    modifier = Modifier
                        // Wide enough for what is in it, and never wider than
                        // this: a bubble that reaches both edges of the screen
                        // stops looking like something somebody said.
                        .widthIn(max = widest)
                        .clip(bubble)
                        .background(
                            when {
                                message.deleted -> MaterialTheme.colorScheme.surfaceContainer
                                isSelf -> MaterialTheme.colorScheme.primaryContainer
                                else -> MaterialTheme.colorScheme.surfaceContainerHigh
                            },
                        )
                        .padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 6.dp),
                ) {
                    Column {
                        // Who is speaking, in their own colour - the same hash
                        // the avatar is tinted with, so the name and the face
                        // agree without either being told about the other.
                        // Once per run, and never for you: the side of the
                        // screen your bubble is on already said that.
                        if (!isSelf && !grouped) {
                            Text(
                                text = message.author.label,
                                style = MaterialTheme.typography.labelLargeEmphasized,
                                color = tintFor(message.author.id),
                                maxLines = 1,
                                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                                modifier = Modifier.padding(bottom = 2.dp),
                            )
                        }
                        // The quote belongs to the message, so it sits inside
                        // the bubble and above everything the message says.
                        readable.replyTo?.takeIf { !message.deleted }?.let { reply ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(bottom = 6.dp)
                                    .clip(MaterialTheme.shapes.small)
                                    .background(MaterialTheme.colorScheme.surfaceContainerLowest.copy(alpha = 0.5f))
                                    .clickable { onOpenQuoted(reply.id) }
                                    .padding(horizontal = 8.dp, vertical = 5.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                BetweenUsIcon(
                                    BetweenUsIcons.Reply,
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    size = 12.dp,
                                )
                                Text(
                                    text = reply.author,
                                    style = MaterialTheme.typography.labelSmallEmphasized,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                                Text(
                                    text = reply.preview.ifBlank { "Sent an attachment" },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
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
                                BetweenUsIcon(
                                    BetweenUsIcons.Trash,
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    size = 16.dp,
                                )
                                Text(
                                    text = "Message deleted" +
                                        (message.deletedBy?.takeIf { it.id != message.author.id }
                                            ?.let { " by ${it.label}" } ?: ""),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }

                            readable.text == E2ee.UNDECRYPTABLE -> Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                BetweenUsIcon(
                                    BetweenUsIcons.Lock,
                                    tint = MaterialTheme.colorScheme.error,
                                    size = 16.dp,
                                )
                                // One word, because it is drawn once per
                                // message. Why, and what to do about it, is
                                // said once for the channel - see ChatScreen.
                                Text(
                                    text = "Encrypted",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }

                            else -> {
                                if (readable.text.isNotBlank()) {
                                    MessageText(readable)
                                    val urls = remember(readable.text) { extractUrls(readable.text) }
                                    urls.forEach { url ->
                                        LinkPreviewCard(url)
                                    }
                                }

                                // Two or more photos are an album rather than
                                // two attachments that happen to be pictures.
                                val photos = readable.attachments.filter { it.isImage }
                                val album = if (photos.size > 1) photos else emptyList()
                                if (album.isNotEmpty()) {
                                    if (readable.text.isNotBlank()) Spacer(Modifier.height(8.dp))
                                    PhotoGrid(channelId, album, onViewImage)
                                }

                                readable.attachments.filterNot { it in album }.forEach { attachment ->
                                    if (readable.text.isNotBlank() || album.isNotEmpty()) {
                                        Spacer(Modifier.height(8.dp))
                                    }
                                    AttachmentCard(channelId, attachment, onViewImage, onPlayVideo)
                                }
                            }
                        }

                        // The footer, in the corner of the bubble: when it was
                        // said, whether it has been changed since, and whether
                        // it is pinned. Inside, because a bubble that hugs its
                        // own text has no margin left to hang them in.
                        Row(
                            modifier = Modifier
                                .align(Alignment.End)
                                .padding(top = 2.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            if (message.pinned) {
                                BetweenUsIcon(
                                    icon = BetweenUsIcons.Pin,
                                    tint = footnote,
                                    size = 11.dp,
                                    contentDescription = "Pinned",
                                )
                            }
                            if (message.editedAt != null) {
                                Text(
                                    text = "edited",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = footnote,
                                )
                            }
                            Text(
                                text = shortTime(message.createdAt),
                                style = MaterialTheme.typography.labelSmall,
                                color = footnote,
                            )
                        }
                    }
                }

                // Reactions section
                if (message.reactions.isNotEmpty()) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        modifier = Modifier
                            .widthIn(max = widest)
                            // Pulled up under the bubble's edge rather than
                            // spaced away from it: a reaction belongs to the
                            // message, and a gap makes it look like a reply.
                            .offset(y = (-4).dp),
                    ) {
                        message.reactions.forEach { reaction ->
                            val reacted = self.id in reaction.userIds
                            Box(
                                modifier = Modifier
                                    // A reaction you are part of is filled;
                                    // one you are not is a quiet container. No
                                    // outline on either: at this size a border
                                    // is most of what you see.
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(
                                        if (reacted) {
                                            MaterialTheme.colorScheme.tertiaryContainer
                                        } else {
                                            MaterialTheme.colorScheme.surfaceContainerHighest
                                        },
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
                                        style = MaterialTheme.typography.labelMediumEmphasized,
                                        color = if (reacted) {
                                            MaterialTheme.colorScheme.onTertiaryContainer
                                        } else {
                                            MaterialTheme.colorScheme.onSurfaceVariant
                                        },
                                    )
                                }
                            }
                        }
                    }
                }

                // Only ever under your own message, and only once each reader
                // has got this far - see `Receipts.anchorReceipts`.
                SeenByRow(receipts, onOpenSeenBy)
            }
        }
    }
    }
}

/**
 * More than one photo in a message is one tiled block, not one card each.
 *
 * The shapes are the ones every phone messenger settled on: two side by side,
 * three as a tall one beside two stacked, and past that a two-column grid with
 * an odd last picture across the bottom. Laid out one under another instead,
 * three photos from a phone camera were half a screen of scrolling for a single
 * message.
 *
 * Every photo is drawn, rather than four and a "+n": the viewer opens one
 * bitmap, so a picture that has no tile has no way to be opened at all.
 */
@Composable
private fun PhotoGrid(
    channelId: String,
    photos: List<MessageAttachment>,
    onViewImage: (Bitmap, String) -> Unit,
) {
    val gap = 2.dp

    Column(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)),
        verticalArrangement = Arrangement.spacedBy(gap),
    ) {
        when {
            photos.size == 2 -> Row(
                modifier = Modifier.fillMaxWidth().height(150.dp),
                horizontalArrangement = Arrangement.spacedBy(gap),
            ) {
                photos.forEach {
                    PhotoTile(channelId, it, onViewImage, Modifier.weight(1f).fillMaxHeight())
                }
            }

            photos.size == 3 -> Row(
                modifier = Modifier.fillMaxWidth().height(220.dp),
                horizontalArrangement = Arrangement.spacedBy(gap),
            ) {
                PhotoTile(channelId, photos[0], onViewImage, Modifier.weight(1f).fillMaxHeight())
                Column(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    verticalArrangement = Arrangement.spacedBy(gap),
                ) {
                    PhotoTile(channelId, photos[1], onViewImage, Modifier.weight(1f).fillMaxWidth())
                    PhotoTile(channelId, photos[2], onViewImage, Modifier.weight(1f).fillMaxWidth())
                }
            }

            else -> {
                photos.chunked(2).forEach { pair ->
                    Row(
                        modifier = Modifier.fillMaxWidth().height(150.dp),
                        horizontalArrangement = Arrangement.spacedBy(gap),
                    ) {
                        // An odd last picture is alone in its row, so its
                        // weight is the whole width rather than half of one.
                        pair.forEach {
                            PhotoTile(channelId, it, onViewImage, Modifier.weight(1f).fillMaxHeight())
                        }
                    }
                }
            }
        }
    }
}

/**
 * One picture in an album: cropped to its cell, because a grid of photos laid
 * out at their own aspect ratios is not a grid.
 */
@Composable
private fun PhotoTile(
    channelId: String,
    attachment: MessageAttachment,
    onViewImage: (Bitmap, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Seeded from the cache for the same reason the single-photo card is: a row
    // that has scrolled past and come back has already paid for the decode.
    var bitmap by remember(attachment.key) { mutableStateOf(MediaCache.bitmap(attachment.key)) }
    var failed by remember(attachment.key) { mutableStateOf(false) }

    LaunchedEffect(attachment.key) {
        if (bitmap != null) return@LaunchedEffect
        val fetched = runCatching { Conversation.openAttachment(channelId, attachment) }
            .onFailure { failed = true }
            .getOrNull() ?: return@LaunchedEffect
        bitmap = decodeDownsampled(fetched, MAX_DECODE_EDGE_PX)
            ?.also { MediaCache.putBitmap(attachment.key, it) }
    }

    val shown = bitmap
    Box(
        modifier = modifier.background(MaterialTheme.colorScheme.surfaceContainerLow),
        contentAlignment = Alignment.Center,
    ) {
        if (shown != null) {
            Image(
                bitmap = shown.asImageBitmap(),
                contentDescription = attachment.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxSize()
                    .clickable { onViewImage(shown, attachment.name) },
            )
        } else if (failed) {
            BetweenUsIcon(
                BetweenUsIcons.Image,
                tint = MaterialTheme.colorScheme.error,
                size = 20.dp,
            )
        } else {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.primary,
            )
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
            .clip(MaterialTheme.shapes.large)
            .background(MaterialTheme.colorScheme.surfaceContainerLow),
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
                                color = MaterialTheme.colorScheme.primary,
                            )
                        } else {
                            BetweenUsIcon(
                                BetweenUsIcons.Image,
                                tint = if (failed) {
                                    MaterialTheme.colorScheme.error
                                } else {
                                    MaterialTheme.colorScheme.primary
                                },
                                size = 24.dp,
                            )
                        }

                        Column(Modifier.weight(1f)) {
                            Text(
                                text = attachment.name,
                                style = MaterialTheme.typography.bodyMediumEmphasized,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                text = if (failed) "Failed to decrypt photo" else "Decrypting photo · ${readableSize(attachment.size)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = if (failed) {
                                    MaterialTheme.colorScheme.error
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                },
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
                                    BetweenUsIcon(BetweenUsIcons.Play, tint = Color.White, size = 24.dp)
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
                        BetweenUsIcon(
                            icon = if (attachment.isAudio) BetweenUsIcons.Speaker else BetweenUsIcons.File,
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
                            BetweenUsIcon(BetweenUsIcons.Download, tint = Slate300, size = 18.dp)
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
private val URL_REGEX = Pattern.compile("(https?://[^\\s<>\"]+)", Pattern.CASE_INSENSITIVE)

private fun AnnotatedString.Builder.appendWithLinks(text: String) {
    val matcher = URL_REGEX.matcher(text)
    var lastIndex = 0
    while (matcher.find()) {
        val start = matcher.start()
        val end = matcher.end()
        val url = matcher.group()

        if (start > lastIndex) {
            append(text.substring(lastIndex, start))
        }

        pushStringAnnotation(tag = "URL", annotation = url)
        pushStyle(
            SpanStyle(
                color = Accent,
                textDecoration = TextDecoration.Underline,
                fontWeight = FontWeight.Medium,
            ),
        )
        append(url)
        pop()
        pop()

        lastIndex = end
    }
    if (lastIndex < text.length) {
        append(text.substring(lastIndex))
    }
}

private fun extractUrls(text: String): List<String> {
    val matcher = URL_REGEX.matcher(text)
    val list = mutableListOf<String>()
    while (matcher.find()) {
        val url = matcher.group()
        if (url !in list) list.add(url)
        if (list.size >= 2) break
    }
    return list
}

private val previewCache = ConcurrentHashMap<String, LinkPreview?>()

@Composable
private fun LinkPreviewCard(url: String) {
    val uriHandler = LocalUriHandler.current
    var preview by remember(url) { mutableStateOf(previewCache[url]) }

    LaunchedEffect(url) {
        if (previewCache.containsKey(url)) {
            preview = previewCache[url]
            return@LaunchedEffect
        }
        val fetched = BetweenUsApi.unfurl(url)
        previewCache[url] = fetched
        preview = fetched
    }

    val item = preview ?: return
    if (item.title.isNullOrBlank() && item.description.isNullOrBlank() && item.image.isNullOrBlank()) {
        return
    }

    val domain = remember(item.url) {
        runCatching { java.net.URI(item.url).host ?: item.url }.getOrDefault(item.url)
    }

    Spacer(Modifier.height(6.dp))
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(topStart = 4.dp, bottomStart = 4.dp, topEnd = 12.dp, bottomEnd = 12.dp))
            .background(Surface900)
            .border(1.dp, Edge, RoundedCornerShape(topStart = 4.dp, bottomStart = 4.dp, topEnd = 12.dp, bottomEnd = 12.dp))
            .drawBehind {
                drawRect(
                    color = Accent,
                    topLeft = Offset.Zero,
                    size = Size(4.dp.toPx(), size.height),
                )
            }
            .clickable {
                runCatching { uriHandler.openUri(item.url) }
            }
            .padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 10.dp),
    ) {
        // Site name / domain row
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (!item.favicon.isNullOrBlank()) {
                AsyncImage(
                    model = item.favicon,
                    contentDescription = null,
                    modifier = Modifier
                        .size(14.dp)
                        .clip(RoundedCornerShape(2.dp)),
                    contentScale = ContentScale.Fit,
                )
            }
            Text(
                text = item.siteName ?: domain,
                style = MaterialTheme.typography.labelSmall,
                color = Slate400,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        // Title
        val title = item.title
        if (!title.isNullOrBlank()) {
            Spacer(Modifier.height(4.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                color = Accent,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }

        // Description
        val description = item.description
        if (!description.isNullOrBlank()) {
            Spacer(Modifier.height(4.dp))
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = Slate300,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                lineHeight = 16.sp,
            )
        }

        // Preview Image
        val image = item.image
        if (!image.isNullOrBlank()) {
            Spacer(Modifier.height(8.dp))
            AsyncImage(
                model = image,
                contentDescription = item.title ?: "Link preview",
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 180.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Surface950)
                    .border(1.dp, Edge, RoundedCornerShape(8.dp)),
            )
        }
    }
}

/**
 * A message's words: the markdown-ish marks, the custom emoji and the links,
 * in that order and for a reason. `Markup` takes the marks out of the text, so
 * every span it reports is an index into what comes back; the emoji splitter
 * then runs over that same string and appends each shortcode as its own
 * alternate text, which is the same length as the source - so the offsets
 * still line up when the styles are laid over the finished string.
 */
@Composable
private fun MessageText(readable: ReadableMessage) {
    val blocks = remember(readable.id, readable.text) { Markup.parse(readable.text) }

    if (blocks.size == 1 && blocks[0].kind == Markup.Kind.Body) {
        MarkupBody(blocks[0], readable.body.emoji)
        return
    }

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        blocks.forEach { block ->
            when (block.kind) {
                Markup.Kind.Body -> MarkupBody(block, readable.body.emoji)
                Markup.Kind.Quote -> Row(modifier = Modifier.height(IntrinsicSize.Min)) {
                    Box(
                        modifier = Modifier
                            .width(3.dp)
                            .fillMaxHeight()
                            .clip(RoundedCornerShape(2.dp))
                            .background(Edge),
                    )
                    Spacer(Modifier.width(8.dp))
                    MarkupBody(block, readable.body.emoji, dim = true)
                }
                Markup.Kind.Code -> Text(
                    text = block.text,
                    style = MaterialTheme.typography.bodyMedium,
                    fontFamily = FontFamily.Monospace,
                    color = Slate100,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(6.dp))
                        .background(Surface950)
                        .border(1.dp, Edge, RoundedCornerShape(6.dp))
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                )
                // The marker sits in a gutter of its own so a wrapped item
                // lines up under its own first word rather than under the
                // bullet - which is the only thing that makes a list of long
                // items readable as a list.
                Markup.Kind.Bullet -> MarkupItem("•", block, readable.body.emoji)
                Markup.Kind.Number -> MarkupItem("${block.ordinal}.", block, readable.body.emoji)
            }
        }
    }
}

/** One list item: its marker in a fixed gutter, its words hanging beside it. */
@Composable
private fun MarkupItem(
    marker: String,
    block: Markup.Block,
    emoji: List<MessageCustomEmoji>,
) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = marker,
            style = MaterialTheme.typography.bodyLarge,
            color = Slate400,
            textAlign = TextAlign.End,
            modifier = Modifier
                .widthIn(min = 20.dp)
                .padding(end = 8.dp),
        )
        MarkupBody(block, emoji)
    }
}

private fun Markup.Style.span(): SpanStyle = when (this) {
    Markup.Style.Bold -> SpanStyle(fontWeight = FontWeight.Bold)
    Markup.Style.Italic -> SpanStyle(fontStyle = FontStyle.Italic)
    Markup.Style.Strike -> SpanStyle(textDecoration = TextDecoration.LineThrough)
    Markup.Style.Code -> SpanStyle(fontFamily = FontFamily.Monospace, background = Surface950)
}

@Composable
private fun MarkupBody(
    block: Markup.Block,
    emoji: List<MessageCustomEmoji>,
    dim: Boolean = false,
) {
    val uriHandler = LocalUriHandler.current
    val pieces = remember(block.text, emoji) { CustomEmoji.split(block.text, emoji) }

    val large = block.spans.isEmpty() && CustomEmoji.isOnlyEmoji(pieces)
    val size = if (large) 40.sp else 22.sp
    val inline = mutableMapOf<String, InlineTextContent>()

    val annotated = buildAnnotatedString {
        pieces.forEachIndexed { index, piece ->
            when (piece) {
                is CustomEmoji.Piece.Text -> appendWithLinks(piece.text)
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
                    // message copies what was typed rather than a blank - and
                    // so the offsets below still mean what they meant.
                    appendInlineContent(id, ":${piece.emoji.name}:")
                }
            }
        }
        block.spans.forEach { span ->
            // Clamped, because a style is only as trustworthy as the string it
            // was measured against and this one has been rebuilt.
            val from = span.start.coerceIn(0, length)
            val to = span.end.coerceIn(from, length)
            if (to > from) addStyle(span.style.span(), from, to)
        }
    }

    var layoutResult by remember { mutableStateOf<TextLayoutResult?>(null) }

    Text(
        text = annotated,
        style = MaterialTheme.typography.bodyLarge,
        color = if (dim) Slate400 else Slate100,
        lineHeight = if (large) 44.sp else 22.sp,
        inlineContent = inline,
        onTextLayout = { layoutResult = it },
        modifier = Modifier.pointerInput(annotated) {
            detectTapGestures { pos ->
                layoutResult?.let { layout ->
                    val offset = layout.getOffsetForPosition(pos)
                    annotated.getStringAnnotations(tag = "URL", start = offset, end = offset)
                        .firstOrNull()?.let { annotation ->
                            runCatching { uriHandler.openUri(annotation.item) }
                        }
                }
            }
        },
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
 * The strip down the left of a message row that belongs to the navigation
 * drawer rather than to the reply swipe.
 *
 * Fixed rather than a fraction of the row: a fraction was measured against the
 * width of the screen, so once messages became bubbles a third of a phone was
 * most of an incoming bubble and swiping the message you are reading opened the
 * drawer. 48dp is the standard minimum touch target - wide enough to find
 * without aiming, narrow enough to stay in the avatar gutter.
 */
private val DRAWER_GUTTER = 48.dp

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
