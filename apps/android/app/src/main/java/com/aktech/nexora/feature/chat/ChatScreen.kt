package com.aktech.nexora.feature.chat

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aktech.nexora.core.data.ChannelType
import com.aktech.nexora.core.data.MessageAttachment
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
import com.aktech.nexora.ui.theme.Accent
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Edge
import com.aktech.nexora.ui.theme.Ground
import com.aktech.nexora.ui.theme.Slate400
import com.aktech.nexora.ui.theme.Slate50
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.Surface950
import kotlinx.coroutines.launch

/**
 * One conversation.
 *
 * The port of `apps/desktop/src/features/chat/ChatView.tsx`, with the same
 * rules: history newest at the bottom, older pages fetched when the top comes
 * into view, a tombstone where a deleted message was, and a padlock where a
 * message this device holds no key for is.
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
    var showPins by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var pending by remember { mutableStateOf<List<MessageAttachment>>(emptyList()) }
    var uploading by remember { mutableStateOf(false) }

    DisposableEffect(channelId) {
        Conversation.open(channelId)
        onDispose { Conversation.close(channelId) }
    }

    // Stay pinned to the newest message, the way a chat app does, but only when
    // already at the bottom: yanking somebody out of history they are reading
    // is worse than making them scroll down.
    val atBottom by remember {
        derivedStateOf { listState.firstVisibleItemIndex + listState.layoutInfo.visibleItemsInfo.size >= messages.size - 1 }
    }
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty() && atBottom) listState.animateScrollToItem(messages.lastIndex)
    }

    // Older pages, when the top of the list comes into view.
    LaunchedEffect(listState.firstVisibleItemIndex) {
        if (listState.firstVisibleItemIndex <= 1 && messages.isNotEmpty()) {
            Conversation.loadOlder(channelId)
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            uploading = true
            failure = runCatching {
                val resolver = context.contentResolver
                val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
                    ?: error("That file could not be read")
                require(bytes.size <= MAX_ATTACHMENT_BYTES) {
                    "That file is larger than 25 MB"
                }
                val name = uri.lastPathSegment?.substringAfterLast('/') ?: "attachment"
                val type = resolver.getType(uri) ?: "application/octet-stream"
                pending = pending + Conversation.uploadAttachment(channelId, name, type, bytes)
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
        // --- header ---
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Surface950)
                .padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(NexoraIcons.LayoutSidebar, "Open the channel list", onOpenMenu)
            NexoraIcon(
                icon = if (direct != null) NexoraIcons.User else NexoraIcons.Hash,
                tint = Slate500,
                size = 18.dp,
            )
            Spacer(Modifier.height(0.dp))
            Column(Modifier.weight(1f).padding(start = 8.dp)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    color = Slate50,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                channel?.topic?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
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

        // --- history ---
        Box(Modifier.weight(1f)) {
            if (messages.isEmpty() && !busy) {
                EmptyState(
                    icon = NexoraIcons.Message,
                    title = "Nothing here yet",
                    detail = "Messages in this channel are end-to-end encrypted. " +
                        "Say something to start it off.",
                    modifier = Modifier.align(Alignment.Center),
                )
            }
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp),
            ) {
                items(messages, key = { it.id }) { readable ->
                    val index = messages.indexOf(readable)
                    val previous = messages.getOrNull(index - 1)
                    MessageRow(
                        readable = readable,
                        previous = previous,
                        self = self,
                        channelId = channelId,
                        onLongPress = { acting = readable },
                        onReact = { emoji ->
                            scope.launch {
                                failure = runCatching { Conversation.react(readable.message, emoji) }
                                    .exceptionOrNull()?.message
                            }
                        },
                    )
                }
            }
        }

        // --- typing, errors, composer ---
        val typing = typingByChannel[channelId].orEmpty().filter { it != self.username }
        if (typing.isNotEmpty()) {
            Text(
                text = when (typing.size) {
                    1 -> "${typing.first()} is typing…"
                    else -> "${typing.size} people are typing…"
                },
                style = MaterialTheme.typography.bodySmall,
                color = Slate400,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
            )
        }

        failure?.let {
            Notice(it, Danger, Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
        }

        Composer(
            channelId = channelId,
            editing = editing,
            attachments = pending,
            uploading = uploading,
            onCancelEdit = { editing = null },
            onRemoveAttachment = { pending = pending - it },
            onPickFile = { picker.launch(arrayOf("*/*")) },
            onSend = { text ->
                scope.launch {
                    val target = editing
                    failure = runCatching {
                        if (target != null) {
                            Conversation.edit(target.message, text)
                            editing = null
                        } else {
                            Conversation.send(channelId, text, pending)
                            pending = emptyList()
                        }
                        null
                    }.exceptionOrNull()?.message
                }
            },
        )
    }

    acting?.let { readable ->
        MessageActionsSheet(
            readable = readable,
            self = self,
            canModerate = Workspace.server(channel?.serverId)?.can("DELETE_MESSAGE") == true,
            onDismiss = { acting = null },
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

/**
 * The desktop refuses larger files for the same reason: an attachment is sealed
 * in one AES-GCM operation, so it is held in memory twice while that happens,
 * and a phone has far less of it to spare.
 */
const val MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
