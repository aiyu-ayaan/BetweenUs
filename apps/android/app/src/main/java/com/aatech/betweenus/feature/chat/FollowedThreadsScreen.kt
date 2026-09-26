package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.PublicUser
import com.aatech.betweenus.core.data.ThreadRules
import com.aatech.betweenus.core.store.Conversation
import com.aatech.betweenus.core.store.Workspace
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

/**
 * The threads this account follows in the server on screen - or among the
 * direct messages, at home - most recently active first, each with its unread
 * count. Opening one goes to the thread screen.
 *
 * The port of `apps/desktop/src/features/chat/FollowedThreadsPanel.tsx`. Every
 * root is opened here with its channel's key; the server only says which roots
 * and how many replies are unread.
 */
@Composable
fun FollowedThreadsScreen(
    serverId: String?,
    self: PublicUser,
    onOpen: (channelId: String, rootId: String) -> Unit,
    onBack: () -> Unit,
) {
    val list by Conversation.followedList.collectAsState()
    val unread by Conversation.threadUnread.collectAsState()
    val channels by Workspace.channels.collectAsState()
    val directs by Workspace.directChannels.collectAsState()

    // A different server is a different list.
    LaunchedEffect(serverId) { Conversation.loadFollowedList(serverId) }

    val kept = ThreadRules.stillFollowed(list.items.map { it.rootId }, unread.keys)
    val rows = list.items.filter { it.rootId in kept }

    fun channelName(channelId: String): String =
        directs.firstOrNull { it.channelId == channelId }?.participant?.label
            ?: channels.values.flatten().firstOrNull { it.id == channelId }?.name
            ?: "a channel"

    Column(Modifier.fillMaxSize().background(Ground)) {
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
                text = "Followed threads",
                style = MaterialTheme.typography.titleMedium,
                color = Slate50,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
        }
        HorizontalDivider(color = Edge)

        when {
            list.error != null && rows.isEmpty() ->
                Notice(list.error.orEmpty(), Danger, Modifier.padding(12.dp))

            list.loading && rows.isEmpty() -> Text(
                text = "Loading…",
                style = MaterialTheme.typography.bodyMedium,
                color = Slate500,
                modifier = Modifier.padding(20.dp),
            )

            rows.isEmpty() -> EmptyState(
                icon = BetweenUsIcons.Message,
                title = "No followed threads here",
                detail = "You follow a thread when you start or reply to one, or with Follow in its screen.",
            )

            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(12.dp),
            ) {
                items(rows, key = { it.rootId }) { row ->
                    val message = row.root.message
                    val badge = ThreadRules.unreadBadge(unread[row.rootId])
                    val chip = ThreadRules.chipLabel(message.thread)
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(Surface950)
                            .clickable { onOpen(row.channelId, row.rootId) }
                            .padding(12.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = channelName(row.channelId),
                                style = MaterialTheme.typography.labelMedium,
                                color = Slate500,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f),
                            )
                            if (badge != null) {
                                Text(
                                    text = badge,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Slate50,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(50))
                                        .background(Accent)
                                        .padding(horizontal = 8.dp, vertical = 2.dp),
                                )
                            }
                        }
                        Text(
                            text = if (message.author.id == self.id) "You" else message.author.label,
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = if (badge != null) FontWeight.SemiBold else FontWeight.Medium,
                            color = if (badge != null) Slate50 else Slate200,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                        Text(
                            text = ThreadRules.rootPreview(
                                deleted = message.deleted,
                                text = row.root.text,
                                attachmentNames = row.root.attachments.map { it.name },
                            ),
                            style = MaterialTheme.typography.bodyMedium,
                            color = Slate400,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                        if (chip != null) {
                            Text(
                                text = chip,
                                style = MaterialTheme.typography.labelMedium,
                                color = Accent,
                                modifier = Modifier.padding(top = 4.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}
