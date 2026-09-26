package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import android.graphics.Bitmap
import android.net.Uri
import com.aatech.betweenus.core.data.PublicUser
import com.aatech.betweenus.core.data.ThreadRules
import com.aatech.betweenus.core.store.Conversation
import com.aatech.betweenus.core.store.ReadableMessage
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.EmptyState
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.theme.Accent
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Edge
import com.aatech.betweenus.ui.theme.Ground
import com.aatech.betweenus.ui.theme.Slate200
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate50
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.Surface950
import kotlinx.coroutines.launch

/**
 * One thread, as its own screen: the root, its replies, and a box to answer in.
 *
 * The port of `apps/desktop/src/features/chat/ThreadPanel.tsx`. Everything said
 * here is sealed with the channel's key - the server only knows which root a
 * reply hangs off. Files ride in a reply the way they do in the channel: the
 * same picker and preview, sealed and uploaded by [Outbox] under the channel
 * key, and drawn here with the channel's own attachment cards. A Follow /
 * Unfollow button in the header moves this account's place in the thread on
 * every device.
 *
 * Reached from the "N replies" chip under a message and from "Reply in thread"
 * on the long-press sheet.
 */
@Composable
fun ThreadScreen(
    channelId: String,
    rootId: String,
    self: PublicUser,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val threads by Conversation.threads.collectAsState()
    val thread = threads[rootId]
    val listState = rememberLazyListState()
    val context = LocalContext.current

    var draft by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var showAttachmentSheet by remember { mutableStateOf(false) }
    var previewing by remember { mutableStateOf<List<PickedPreview>>(emptyList()) }
    var previewCaption by remember { mutableStateOf("") }
    var viewingImage by remember { mutableStateOf<Pair<Bitmap, String>?>(null) }
    var playingVideo by remember { mutableStateOf<Pair<Uri, String>?>(null) }
    val outgoing by Outbox.progress.collectAsState()
    val outboxFailures by Outbox.failures.collectAsState()

    LaunchedEffect(rootId) { Conversation.openThread(channelId, rootId) }
    // Memory only, and only while somebody is looking: a thread nobody has open
    // is not worth keeping decrypted.
    DisposableEffect(rootId) { onDispose { Conversation.closeThread(rootId) } }

    val replies = thread?.replies.orEmpty()
    // A new reply scrolls to itself; an older page arriving above does not.
    LaunchedEffect(replies.lastOrNull()?.id) {
        if (replies.isNotEmpty()) listState.animateScrollToItem(replies.size)
    }

    // The newest reply is on screen once the first page is in: that is read,
    // on every device. Keyed on the count too, so a reply counted before it
    // arrived here is read once it does.
    val unread by Conversation.threadUnread.collectAsState()
    // Following is the server's word, and a thread being followed is exactly one
    // that has an unread count held for it.
    val following = rootId in unread
    var toggling by remember { mutableStateOf(false) }
    // Coming back to the app is a reason to read it, too: a reply counted while
    // the phone was locked changed nothing else this effect watches.
    val resumed by Conversation.resumed.collectAsState()
    val newestId = replies.lastOrNull()?.id
    val loaded = thread?.loading == false
    LaunchedEffect(newestId, loaded, unread[rootId], resumed) {
        if (newestId != null && loaded) Conversation.markThreadSeen(rootId, newestId)
    }

    fun addFiles(items: List<PickedPreview>) {
        val room = MAX_ATTACHMENTS - previewing.size
        if (items.size > room) failure = "A message can carry $MAX_ATTACHMENTS files at most"
        if (room > 0) previewing = previewing + items.take(room)
    }

    fun sendFiles() {
        val chosen = previewing
        if (chosen.isEmpty()) return
        Outbox.enqueue(
            context = context,
            channelId = channelId,
            caption = previewCaption.trim(),
            items = chosen,
            threadRootId = rootId,
        )
        previewing = emptyList()
        previewCaption = ""
    }

    fun submit() {
        val text = draft.trim()
        if (text.isEmpty() || sending) return
        sending = true
        failure = null
        scope.launch {
            runCatching { Conversation.sendThreadReply(channelId, rootId, text) }
                .onSuccess { draft = "" }
                .onFailure { failure = it.message ?: "Reply failed to send" }
            sending = false
        }
    }

    Column(Modifier.fillMaxSize().background(Ground).navigationBarsPadding().imePadding()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Surface950)
                .statusBarsPadding()
                .padding(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(BetweenUsIcons.ChevronLeft, "Back", onBack)
            Text(
                text = "Thread",
                style = MaterialTheme.typography.titleMedium,
                color = Slate50,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
            // Only once the thread is known to exist: following a root that
            // could not be opened is a request the server would refuse.
            if (thread != null && !thread.failed) {
                TextButton(
                    enabled = !toggling,
                    onClick = {
                        toggling = true
                        scope.launch {
                            runCatching { Conversation.setThreadFollowing(rootId, !following) }
                                .onFailure { failure = it.message ?: "Could not change following" }
                            toggling = false
                        }
                    },
                ) { Text(ThreadRules.followLabel(following)) }
            }
        }
        HorizontalDivider(color = Edge)

        failure?.let { Notice(it, Danger, Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) }
        outboxFailures[channelId]?.let {
            Notice(it, Danger, Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
        }
        outgoing?.takeIf { it.channelId == channelId }?.let { going ->
            Text(
                text = "Sending ${going.name} · ${(going.fraction * 100).toInt()}%",
                style = MaterialTheme.typography.labelMedium,
                color = Slate400,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
            )
        }

        when {
            thread == null || (thread.root == null && thread.loading) -> Text(
                text = "Loading…",
                style = MaterialTheme.typography.bodyMedium,
                color = Slate500,
                modifier = Modifier.padding(20.dp),
            )

            thread.failed && thread.root == null -> EmptyState(
                icon = BetweenUsIcons.Message,
                title = "Thread unavailable",
                detail = "It may have expired, or you may not be able to open its channel.",
            )

            else -> LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
            ) {
                item(key = "root") {
                    Column {
                        thread.root?.let { ThreadLine(channelId, it, self, root = true, onViewImage = { b, n -> viewingImage = b to n }, onPlayVideo = { u, n -> playingVideo = u to n }) }
                        Text(
                            text = if (replies.size == 1) "1 reply" else "${replies.size} replies",
                            style = MaterialTheme.typography.labelMedium,
                            color = Slate500,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                        if (thread.cursor != null) {
                            Text(
                                text = "Load earlier replies",
                                style = MaterialTheme.typography.labelLarge,
                                color = Accent,
                                modifier = Modifier
                                    .padding(top = 8.dp)
                                    .clickable { Conversation.loadOlderThread(rootId) },
                            )
                        }
                    }
                }
                if (replies.isEmpty() && !thread.loading) {
                    item(key = "empty") {
                        Text(
                            text = "No replies yet. Start the thread below.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Slate400,
                        )
                    }
                }
                items(replies, key = { it.id }) { reply -> ThreadLine(channelId, reply, self, root = false, onViewImage = { b, n -> viewingImage = b to n }, onPlayVideo = { u, n -> playingVideo = u to n }) }
            }
        }

        HorizontalDivider(color = Edge)
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            IconAction(
                BetweenUsIcons.Paperclip,
                "Attach files",
                onClick = { showAttachmentSheet = true },
                enabled = !sending,
            )
            BetweenUsField(
                label = "Reply",
                value = draft,
                onValueChange = { draft = it },
                placeholder = "Reply in thread",
                imeAction = ImeAction.Send,
                enabled = !sending,
                onImeAction = { submit() },
                modifier = Modifier.weight(1f),
            )
            IconAction(
                BetweenUsIcons.Send,
                "Send reply",
                onClick = { submit() },
                enabled = draft.isNotBlank() && !sending,
                prominent = true,
            )
        }
    }

    if (showAttachmentSheet) {
        AttachmentSheet(
            onDismiss = { showAttachmentSheet = false },
            room = MAX_ATTACHMENTS - previewing.size,
            // A poll is its own message; it has no thread form.
            onPoll = null,
            onPicked = { uris -> scope.launch { addFiles(uris.map { describePicked(context, it) }) } },
        )
    }
    SendPreviewDialog(
        items = previewing,
        caption = previewCaption,
        onCaption = { previewCaption = it },
        onRemove = { previewing = previewing - it },
        onReplace = { original, edited ->
            previewing = previewing.map { if (it == original) edited else it }
        },
        onAdd = { showAttachmentSheet = true },
        // A thread reply is never one-time: the server only honours it on a
        // message in the channel.
        viewOnce = false,
        onViewOnce = {},
        onCancel = {
            previewing = emptyList()
            previewCaption = ""
        },
        onSend = { sendFiles() },
    )
    viewingImage?.let { (bitmap, title) ->
        ImageViewerDialog(bitmap = bitmap, title = title, onDismiss = { viewingImage = null })
    }
    playingVideo?.let { (videoUri, title) ->
        VideoPlayerDialog(videoUri = videoUri, title = title, onDismiss = { playingVideo = null })
    }
}

/** One line of a thread: who, and what they said. */
@Composable
private fun ThreadLine(
    channelId: String,
    readable: ReadableMessage,
    self: PublicUser,
    root: Boolean,
    onViewImage: (Bitmap, String) -> Unit,
    onPlayVideo: (Uri, String) -> Unit,
) {
    val message = readable.message
    val mine = message.author.id == self.id
    Column {
        Text(
            text = if (mine) "You" else message.author.label,
            style = MaterialTheme.typography.labelLarge,
            color = if (mine) Accent else Slate50,
        )
        when {
            message.deleted && root -> Text(
                // The thread outlives its root: it is somebody else's conversation.
                text = "Original message deleted",
                style = MaterialTheme.typography.bodyMedium,
                color = Slate500,
            )

            message.deleted -> Text(
                text = "Message deleted",
                style = MaterialTheme.typography.bodyMedium,
                color = Slate500,
            )

            else -> {
                if (readable.text.isNotBlank()) {
                    Text(
                        text = readable.text,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Slate200,
                    )
                }
                readable.attachments.forEach { attachment ->
                    Spacer(Modifier.height(8.dp))
                    if (attachment.isAudio) {
                        VoiceMessage(
                            channelId = channelId,
                            attachment = attachment,
                            author = message.author,
                            mine = mine,
                            fileName = attachment.name.takeUnless { attachment.isVoiceNote },
                        )
                    } else {
                        AttachmentCard(channelId, attachment, onViewImage, onPlayVideo)
                    }
                }
            }
        }
    }
}
