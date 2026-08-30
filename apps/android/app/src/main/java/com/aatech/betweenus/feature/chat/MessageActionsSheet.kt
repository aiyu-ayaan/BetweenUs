package com.aatech.betweenus.feature.chat

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
import androidx.compose.ui.draw.scale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.PublicUser
import com.aatech.betweenus.core.store.Conversation
import com.aatech.betweenus.core.store.ReadableMessage
import com.aatech.betweenus.ui.components.EmptyState
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.Surface700

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
    /**
     * Null when there is nothing to forward: a tombstone, or a one-time
     * message, whose whole bargain is that it is seen once by the people it
     * was sent to.
     */
    onForward: (() -> Unit)?,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onPin: () -> Unit,
    onReact: (String) -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val clipboard = LocalClipboardManager.current
    val mine = readable.message.author.id == self.id

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
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
                leading = { BetweenUsIcon(BetweenUsIcons.Reply, tint = Slate400) },
                onClick = onReply,
            )
            onForward?.let { forward ->
                ListRow(
                    title = "Forward",
                    // The reply mark, mirrored - which is the forward mark. One
                    // glyph rather than a second drawable that says the same
                    // thing pointing the other way.
                    leading = {
                        BetweenUsIcon(
                            BetweenUsIcons.Reply,
                            tint = Slate400,
                            modifier = Modifier.scale(scaleX = -1f, scaleY = 1f),
                        )
                    },
                    onClick = forward,
                )
            }
            ListRow(
                title = "Copy text",
                leading = { BetweenUsIcon(BetweenUsIcons.Copy, tint = Slate400) },
                onClick = {
                    clipboard.setText(AnnotatedString(readable.text))
                    onDismiss()
                },
            )
            if (mine) {
                ListRow(
                    title = "Edit",
                    leading = { BetweenUsIcon(BetweenUsIcons.Pencil, tint = Slate400) },
                    onClick = onEdit,
                )
            }
            ListRow(
                title = if (readable.message.pinned) "Unpin" else "Pin to channel",
                leading = { BetweenUsIcon(BetweenUsIcons.Pin, tint = Slate400) },
                onClick = onPin,
            )
            if (mine || canModerate) {
                ListRow(
                    title = "Delete",
                    titleColor = Danger,
                    leading = { BetweenUsIcon(BetweenUsIcons.Trash, tint = Danger) },
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

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
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
                    icon = BetweenUsIcons.Pin,
                    title = "Nothing pinned",
                    detail = "Long-press a message to pin it here.",
                )

                else -> LazyColumn(Modifier.padding(bottom = 16.dp)) {
                    items(list, key = { it.id }) { readable ->
                        ListRow(
                            title = readable.message.author.label,
                            subtitle = readable.text.take(120),
                            leading = { BetweenUsIcon(BetweenUsIcons.Pin, tint = Surface700) },
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
