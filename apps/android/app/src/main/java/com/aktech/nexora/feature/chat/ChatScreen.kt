package com.aktech.nexora.feature.chat

import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aktech.nexora.core.data.MessageAttachment
import com.aktech.nexora.core.data.MessageReply
import com.aktech.nexora.core.data.PublicUser
import com.aktech.nexora.core.store.Conversation
import com.aktech.nexora.core.store.Presence
import com.aktech.nexora.core.store.ReadableMessage
import com.aktech.nexora.core.store.Workspace
import com.aktech.nexora.ui.components.EmptyState
import com.aktech.nexora.ui.components.IconAction
import com.aktech.nexora.ui.components.NexoraIcon
import com.aktech.nexora.ui.components.NexoraIcons
import com.aktech.nexora.ui.components.Notice
import com.aktech.nexora.ui.components.StatusDot
import com.aktech.nexora.ui.theme.Accent
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Edge
import com.aktech.nexora.ui.theme.Ground
import com.aktech.nexora.ui.theme.Slate100
import com.aktech.nexora.ui.theme.Slate400
import com.aktech.nexora.ui.theme.Slate50
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.Surface850
import com.aktech.nexora.ui.theme.Surface900
import com.aktech.nexora.ui.theme.Surface950
import kotlinx.coroutines.launch

/**
 * Modern, polished chat screen with interactive media previews,
 * fullscreen image zoom viewer, integrated video player dialog, and WhatsApp-style attachment sheet.
 */
@Composable
fun ChatScreen(
    channelId: String,
    self: PublicUser,
    onOpenMenu: () -> Unit,
    onOpenMembers: () -> Unit,
    onStartCall: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val listState = rememberLazyListState()

    val everything by Conversation.messages.collectAsState()
    val loading by Conversation.loading.collectAsState()
    val typingByChannel by Presence.typing.collectAsState()

    val messages = everything[channelId].orEmpty()
    val channel = Workspace.channel(channelId)
    val direct = Workspace.directChannel(channelId)
    val title = channel?.name ?: direct?.participant?.label ?: "Conversation"
    val busy = channelId in loading

    var acting by remember { mutableStateOf<ReadableMessage?>(null) }
    var editing by remember { mutableStateOf<ReadableMessage?>(null) }
    var replyingTo by remember(channelId) { mutableStateOf<MessageReply?>(null) }
    /** A quoted message that has just been jumped to, flashed so it is findable. */
    var highlighted by remember { mutableStateOf<String?>(null) }
    var showPins by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var pending by remember { mutableStateOf<List<MessageAttachment>>(emptyList()) }
    var uploading by remember { mutableStateOf(false) }
    var showAttachmentSheet by remember { mutableStateOf(false) }
    /**
     * Media that has been picked but not yet looked at. Nothing is read off
     * disk, encrypted or uploaded until the preview is sent from - which is the
     * whole point of it.
     */
    var previewing by remember { mutableStateOf<List<PickedPreview>>(emptyList()) }
    var previewCaption by remember { mutableStateOf("") }

    // Media Viewer dialog states
    var viewingImage by remember { mutableStateOf<Pair<Bitmap, String>?>(null) }
    var playingVideo by remember { mutableStateOf<Pair<Uri, String>?>(null) }

    // Quick Camera capture
    var photoUri by remember { mutableStateOf<Uri?>(null) }
    val cameraCaptureLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.TakePicture(),
    ) { taken ->
        if (taken && photoUri != null) {
            // Straight to the preview: a photo just taken is the one most worth
            // looking at before it goes anywhere.
            scope.launch { previewing = previewing + describePicked(context, photoUri!!) }
        }
    }

    val cameraPermission = com.aktech.nexora.feature.settings.rememberPermission(
        com.aktech.nexora.feature.settings.NexoraPermissions.CAMERA,
    ) {
        photoUri = cameraTarget(context).also { cameraCaptureLauncher.launch(it) }
    }

    DisposableEffect(channelId) {
        Conversation.open(channelId)
        onDispose { Conversation.close(channelId) }
    }

    /**
     * Whether the view is pinned to the newest message.
     *
     * It stops being pinned the moment somebody scrolls up to read something,
     * because dragging them back down every time a message arrives is worse
     * than not following at all. The slack is because "at the bottom" is never
     * exact: a row that grew by a pixel, or a fling still settling, must not
     * count as scrolling away.
     */
    val following by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull() ?: return@derivedStateOf true
            last.index >= info.totalItemsCount - 1 &&
                last.offset + last.size <= info.viewportEndOffset + FOLLOW_SLACK_PX
        }
    }

    // Opening a channel starts at the newest message, without an animation - a
    // conversation you have just walked into has no "before" to scroll from.
    // Keyed on whether there are messages at all, so the first page landing
    // fires it once.
    LaunchedEffect(channelId, messages.isNotEmpty()) {
        if (messages.isNotEmpty()) listState.scrollToItem(messages.lastIndex, SCROLL_PAST_END)
    }

    // A message arrived. Keyed on the newest id rather than the count, because
    // switching between two channels holding the same number of messages
    // changes neither - which is why the list used to open somewhere in the
    // middle of a conversation it had never shown before.
    val newest = messages.lastOrNull()?.id
    LaunchedEffect(newest) {
        if (newest != null && following) {
            listState.animateScrollToItem(messages.lastIndex, SCROLL_PAST_END)
        }
    }

    /**
     * Rows grow after they have been laid out.
     *
     * A picture decodes, a video's first frame arrives, and the row that was
     * one line tall becomes three hundred - under a scroll that had already
     * finished. The desktop answers this with a ResizeObserver; this is the
     * same idea with the tools Compose has: watch the total height of what is
     * on screen, and while the view is pinned, put it back on the bottom.
     */
    LaunchedEffect(listState) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.sumOf { it.size } }
            .collect {
                if (following && messages.isNotEmpty()) {
                    listState.scrollToItem(messages.lastIndex, SCROLL_PAST_END)
                }
            }
    }

    // The flash marks where the jump landed, then gets out of the way.
    LaunchedEffect(highlighted) {
        if (highlighted != null) {
            kotlinx.coroutines.delay(2000)
            highlighted = null
        }
    }

    LaunchedEffect(listState.firstVisibleItemIndex) {
        if (listState.firstVisibleItemIndex <= 1 && messages.isNotEmpty()) {
            Conversation.loadOlder(channelId)
        }
    }

    /** Reads, seals, uploads and sends whatever the preview is holding. */
    fun sendPreviewed() {
        val chosen = previewing
        if (chosen.isEmpty() || uploading) return
        scope.launch {
            uploading = true
            failure = runCatching {
                val uploaded = chosen.map { item ->
                    val picked = readPicked(context, item.uri)
                    require(picked.bytes.size <= MAX_ATTACHMENT_BYTES) {
                        "${picked.name} is larger than 25 MB"
                    }
                    Conversation.uploadAttachment(
                        channelId = channelId,
                        name = picked.name,
                        contentType = picked.contentType,
                        bytes = picked.bytes,
                    )
                }
                Conversation.send(channelId, previewCaption.trim(), pending + uploaded, replyingTo)
                pending = emptyList()
                replyingTo = null
                previewing = emptyList()
                previewCaption = ""
                null
            }.exceptionOrNull()?.message
            uploading = false
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Ground)
            .systemBarsPadding()
            .imePadding(),
    ) {
        // --- Elevated Header App Bar ---
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Surface950)
                .padding(horizontal = 6.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(NexoraIcons.LayoutSidebar, "Open the channel list", onOpenMenu)

            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(Surface850)
                    .border(1.dp, Edge, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                NexoraIcon(
                    icon = if (direct != null) NexoraIcons.User else NexoraIcons.Hash,
                    tint = if (direct != null) Accent else Slate400,
                    size = 18.dp,
                )
            }

            Column(
                Modifier
                    .weight(1f)
                    .padding(start = 10.dp),
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = Slate50,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (direct != null) {
                    Text(
                        text = "Encrypted direct message",
                        style = MaterialTheme.typography.bodySmall,
                        fontSize = 11.sp,
                        color = Slate500,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                } else if (!channel?.topic.isNullOrBlank()) {
                    Text(
                        text = channel!!.topic!!,
                        style = MaterialTheme.typography.bodySmall,
                        fontSize = 11.sp,
                        color = Slate500,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            IconAction(NexoraIcons.Pin, "Pinned messages", { showPins = true })
            IconAction(NexoraIcons.Phone, "Start a call", onStartCall)
            IconAction(NexoraIcons.Users, "Members", onOpenMembers)
        }

        HorizontalDivider(color = Edge)

        if (busy && messages.isEmpty()) {
            LinearProgressIndicator(Modifier.fillMaxWidth(), color = Accent)
        }

        // --- Message History List ---
        Box(Modifier.weight(1f)) {
            if (messages.isEmpty() && !busy) {
                EmptyState(
                    icon = NexoraIcons.Message,
                    title = "Nothing here yet",
                    detail = "Messages in this channel are end-to-end encrypted. Say something or share a photo to start!",
                    modifier = Modifier.align(Alignment.Center),
                )
            }

            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 10.dp),
            ) {
                items(messages, key = { it.id }) { readable ->
                    val index = messages.indexOf(readable)
                    val previous = messages.getOrNull(index - 1)
                    MessageRow(
                        readable = readable,
                        previous = previous,
                        self = self,
                        channelId = channelId,
                        highlighted = highlighted == readable.id,
                        onLongPress = { acting = readable },
                        onOpenQuoted = { quotedId ->
                            val at = messages.indexOfFirst { it.id == quotedId }
                            // Not on this device yet: the quote carries enough
                            // to read, which is why it carries it at all.
                            if (at >= 0) {
                                scope.launch { listState.animateScrollToItem(at) }
                                highlighted = quotedId
                            }
                        },
                        onReact = { emoji ->
                            scope.launch {
                                failure = runCatching { Conversation.react(readable.message, emoji) }
                                    .exceptionOrNull()?.message
                            }
                        },
                        onViewImage = { bmp, name ->
                            viewingImage = bmp to name
                        },
                        onPlayVideo = { uri, name ->
                            playingVideo = uri to name
                        },
                    )
                }
            }
        }

        // --- Typing Indicator ---
        val typing = typingByChannel[channelId].orEmpty().filter { it != self.username }
        if (typing.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(6.dp)
                        .clip(CircleShape)
                        .background(Accent),
                )
                Text(
                    text = when (typing.size) {
                        1 -> "${typing.first()} is typing…"
                        else -> "${typing.size} people are typing…"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    fontSize = 12.sp,
                    color = Slate400,
                )
            }
        }

        failure?.let {
            Notice(it, Danger, Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
        }

        // --- Composer Input Well ---
        Composer(
            channelId = channelId,
            editing = editing,
            replyingTo = replyingTo,
            attachments = pending,
            uploading = uploading,
            onCancelEdit = { editing = null },
            onCancelReply = { replyingTo = null },
            onRemoveAttachment = { pending = pending - it },
            onPickFile = { showAttachmentSheet = true },
            onCameraClick = { cameraPermission.request() },
            onSend = { text ->
                scope.launch {
                    val target = editing
                    failure = runCatching {
                        if (target != null) {
                            Conversation.edit(target.message, text)
                            editing = null
                        } else {
                            Conversation.send(channelId, text, pending, replyingTo)
                            pending = emptyList()
                            replyingTo = null
                        }
                        null
                    }.exceptionOrNull()?.message
                }
            },
        )
    }

    // --- Attachment Modal Bottom Sheet ---
    if (showAttachmentSheet) {
        AttachmentSheet(
            onDismiss = { showAttachmentSheet = false },
            onPicked = { uris ->
                scope.launch {
                    val described = uris.map { describePicked(context, it) }
                    // Photos and video are looked at first; a spreadsheet has
                    // nothing to look at, so it uploads as it always did.
                    val (media, documents) = described.partition { it.isPreviewable }
                    previewing = previewing + media
                    if (documents.isNotEmpty()) {
                        uploading = true
                        failure = runCatching {
                            documents.forEach { item ->
                                val picked = readPicked(context, item.uri)
                                require(picked.bytes.size <= MAX_ATTACHMENT_BYTES) {
                                    "${picked.name} is larger than 25 MB"
                                }
                                pending = pending + Conversation.uploadAttachment(
                                    channelId = channelId,
                                    name = picked.name,
                                    contentType = picked.contentType,
                                    bytes = picked.bytes,
                                )
                            }
                            null
                        }.exceptionOrNull()?.message
                        uploading = false
                    }
                }
            },
        )
    }

    // --- What is about to be sent ---
    SendPreviewDialog(
        items = previewing,
        caption = previewCaption,
        busy = uploading,
        note = if (uploading) "Encrypting and uploading…" else null,
        onCaption = { previewCaption = it },
        onRemove = { previewing = previewing - it },
        onAdd = { showAttachmentSheet = true },
        onCancel = {
            previewing = emptyList()
            previewCaption = ""
        },
        onSend = { sendPreviewed() },
    )

    // --- Fullscreen Interactive Image Viewer ---
    viewingImage?.let { (bitmap, title) ->
        ImageViewerDialog(
            bitmap = bitmap,
            title = title,
            onDismiss = { viewingImage = null },
        )
    }

    // --- Integrated Video Player Dialog ---
    playingVideo?.let { (videoUri, title) ->
        VideoPlayerDialog(
            videoUri = videoUri,
            title = title,
            onDismiss = { playingVideo = null },
        )
    }

    // --- Message Context Actions Sheet ---
    acting?.let { readable ->
        MessageActionsSheet(
            readable = readable,
            self = self,
            canModerate = Workspace.server(channel?.serverId)?.can("DELETE_MESSAGE") == true,
            onDismiss = { acting = null },
            onReply = { replyingTo = readable.quote(); acting = null },
            onEdit = { editing = readable; acting = null },
            onDelete = {
                scope.launch {
                    failure = runCatching { Conversation.delete(readable.message) }
                        .exceptionOrNull()?.message
                }
                acting = null
            },
            onPin = {
                scope.launch {
                    failure = runCatching {
                        Conversation.pin(readable.message, !readable.message.pinned)
                    }.exceptionOrNull()?.message
                }
                acting = null
            },
            onReact = { emoji ->
                scope.launch {
                    failure = runCatching { Conversation.react(readable.message, emoji) }
                        .exceptionOrNull()?.message
                }
                acting = null
            },
        )
    }

    if (showPins) {
        PinnedSheet(channelId = channelId, self = self, onDismiss = { showPins = false })
    }
}

const val MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/** How far off the bottom still counts as reading the newest message, in pixels. */
private const val FOLLOW_SLACK_PX = 120

/**
 * An offset far past the end of any row.
 *
 * `scrollToItem` puts the item's *start* at the top of the viewport, which for
 * a tall last message leaves its bottom off screen. A huge offset is clamped to
 * the maximum scroll instead, which is exactly "the bottom of the list" and
 * needs no measuring.
 */
private const val SCROLL_PAST_END = 100_000
