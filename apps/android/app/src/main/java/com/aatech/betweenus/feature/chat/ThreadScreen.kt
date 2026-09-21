package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.PublicUser
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
 * reply hangs off. Text only in this build; a reply that carries files says how
 * many rather than drawing them, and the channel is where to open them.
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

    var draft by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(rootId) { Conversation.openThread(channelId, rootId) }
    // Memory only, and only while somebody is looking: a thread nobody has open
    // is not worth keeping decrypted.
    DisposableEffect(rootId) { onDispose { Conversation.closeThread(rootId) } }

    val replies = thread?.replies.orEmpty()
    // A new reply scrolls to itself; an older page arriving above does not.
    LaunchedEffect(replies.lastOrNull()?.id) {
        if (replies.isNotEmpty()) listState.animateScrollToItem(replies.size)
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
        }
        HorizontalDivider(color = Edge)

        failure?.let { Notice(it, Danger, Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) }

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
                        thread.root?.let { ThreadLine(it, self, root = true) }
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
                items(replies, key = { it.id }) { reply -> ThreadLine(reply, self, root = false) }
            }
        }

        HorizontalDivider(color = Edge)
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
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
}

/** One line of a thread: who, and what they said. */
@Composable
private fun ThreadLine(readable: ReadableMessage, self: PublicUser, root: Boolean) {
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
                if (readable.attachments.isNotEmpty()) {
                    Text(
                        text = if (readable.attachments.size == 1) {
                            "1 attachment - open it in the channel"
                        } else {
                            "${readable.attachments.size} attachments - open them in the channel"
                        },
                        style = MaterialTheme.typography.labelMedium,
                        color = Slate500,
                    )
                }
            }
        }
    }
}
