package com.aktech.nexora.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import com.aktech.nexora.core.data.PublicUser
import com.aktech.nexora.core.store.Conversation
import com.aktech.nexora.core.store.ReadableMessage
import com.aktech.nexora.ui.components.EmptyState
import com.aktech.nexora.ui.components.ListRow
import com.aktech.nexora.ui.components.NexoraIcon
import com.aktech.nexora.ui.components.NexoraIcons
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Slate100
import com.aktech.nexora.ui.theme.Slate400
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.Surface700
import com.aktech.nexora.ui.theme.Surface900

/**
 * What a long press on a message offers.
 *
 * The desktop shows this as a hover toolbar; a phone has no hover, so the same
 * actions arrive as a sheet. Which ones appear is decided the same way: the
 * author may edit, the author or a moderator may delete.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MessageActionsSheet(
    readable: ReadableMessage,
    self: PublicUser,
    canModerate: Boolean,
    onDismiss: () -> Unit,
    onReply: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onPin: () -> Unit,
    onReact: (String) -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val clipboard = LocalClipboardManager.current
    val mine = readable.message.author.id == self.id

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Surface900) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                QUICK_REACTIONS.forEach { emoji ->
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .clickable { onReact(emoji) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(emoji, style = MaterialTheme.typography.titleMedium)
                    }
                }
            }

            ListRow(
                title = "Reply",
                leading = { NexoraIcon(NexoraIcons.Reply, tint = Slate400) },
                onClick = onReply,
            )
            ListRow(
                title = "Copy text",
                leading = { NexoraIcon(NexoraIcons.Copy, tint = Slate400) },
                onClick = {
                    clipboard.setText(AnnotatedString(readable.text))
                    onDismiss()
                },
            )
            if (mine) {
                ListRow(
                    title = "Edit",
                    leading = { NexoraIcon(NexoraIcons.Pencil, tint = Slate400) },
                    onClick = onEdit,
                )
            }
            ListRow(
                title = if (readable.message.pinned) "Unpin" else "Pin to channel",
                leading = { NexoraIcon(NexoraIcons.Pin, tint = Slate400) },
                onClick = onPin,
            )
            if (mine || canModerate) {
                ListRow(
                    title = "Delete",
                    titleColor = Danger,
                    leading = { NexoraIcon(NexoraIcons.Trash, tint = Danger) },
                    onClick = onDelete,
                )
            }
        }
    }
}

/** The pinned list, which on the desktop is a right-hand panel. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PinnedSheet(channelId: String, self: PublicUser, onDismiss: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var pins by remember { mutableStateOf<List<ReadableMessage>?>(null) }

    LaunchedEffect(channelId) {
        pins = runCatching { Conversation.pins(channelId) }.getOrDefault(emptyList())
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Surface900) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding()) {
            Text(
                text = "Pinned messages",
                style = MaterialTheme.typography.titleMedium,
                color = Slate100,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            val list = pins
            when {
                list == null -> Text(
                    text = "Loading…",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Slate500,
                    modifier = Modifier.padding(20.dp),
                )

                list.isEmpty() -> EmptyState(
                    icon = NexoraIcons.Pin,
                    title = "Nothing pinned",
                    detail = "Long-press a message to pin it here.",
                )

                else -> LazyColumn(Modifier.padding(bottom = 16.dp)) {
                    items(list, key = { it.id }) { readable ->
                        ListRow(
                            title = readable.message.author.label,
                            subtitle = readable.text.take(120),
                            leading = { NexoraIcon(NexoraIcons.Pin, tint = Surface700) },
                        )
                    }
                }
            }
        }
    }
}

/**
 * Six, not an emoji keyboard. The desktop has a picker with a search box
 * because it has the room; a phone already has an emoji keyboard one tap away
 * in the composer, and a second one inside a sheet is furniture.
 */
private val QUICK_REACTIONS = listOf("👍", "🎉", "❤️", "😂", "👀", "🙏")
