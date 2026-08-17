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

    // Media Viewer dialog states
    var viewingImage by remember { mutableStateOf<Pair<Bitmap, String>?>(null) }
    var playingVideo by remember { mutableStateOf<Pair<Uri, String>?>(null) }

    // Quick Camera capture
    var photoUri by remember { mutableStateOf<Uri?>(null) }
    val cameraCaptureLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.TakePicture(),
    ) { taken ->
        if (taken && photoUri != null) {
            scope.launch {
                uploading = true
                failure = runCatching {
                    val picked = readPicked(context, photoUri!!)
                    val uploaded = Conversation.uploadAttachment(
                        channelId = channelId,
                        name = picked.name,
                        contentType = picked.contentType,
                        bytes = picked.bytes,
                    )
                    pending = pending + uploaded
                    null
                }.exceptionOrNull()?.message
                uploading = false
            }
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

    val atBottom by remember {
        derivedStateOf {
            listState.firstVisibleItemIndex + listState.layoutInfo.visibleItemsInfo.size >= messages.size - 1
        }
    }
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty() && atBottom) listState.animateScrollToItem(messages.lastIndex)
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
                    uploading = true
                    failure = runCatching {
                        uris.forEach { uri ->
                            val picked = readPicked(context, uri)
                            require(picked.bytes.size <= MAX_ATTACHMENT_BYTES) {
                                "${picked.name} is larger than 25 MB"
                            }
                            val uploaded = Conversation.uploadAttachment(
                                channelId = channelId,
                                name = picked.name,
                                contentType = picked.contentType,
                                bytes = picked.bytes,
                            )
                            pending = pending + uploaded
                        }
                        null
                    }.exceptionOrNull()?.message
                    uploading = false
                }
            },
        )
    }

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
