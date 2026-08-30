package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.ChannelType
import com.aatech.betweenus.core.store.ReadableMessage
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.EmptyState
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.SectionLabel

/**
 * Where a message is being forwarded to.
 *
 * The server it is already in, and every other text channel of it. Not the
 * whole workspace: a forward is nearly always "the rest of this server needs
 * to see this", and the one list that is never the answer is the channel it is
 * already in - so that one is left out rather than offered and then explained.
 *
 * A direct message has no server, so it offers the other conversations
 * instead. The same rule read the other way: everywhere this could go that is
 * not where it already is.
 *
 * Nothing is sent from here. Picking hands the channel back and the send
 * happens on the chat screen, where a failure has somewhere to be reported.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ForwardSheet(
    readable: ReadableMessage,
    onDismiss: () -> Unit,
    onPick: (channelId: String) -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val from = readable.message.channelId
    val serverId = Workspace.channel(from)?.serverId

    val channelsByServer by Workspace.channels.collectAsState()
    val directs by Workspace.directChannels.collectAsState()

    // The list has to be there before it is looked at. A server whose channels
    // were never opened on this device has none cached, and an empty sheet
    // reads as "nowhere to send it" rather than "not loaded yet".
    LaunchedEffect(serverId) {
        if (serverId != null) Workspace.loadChannels(serverId) else Workspace.loadDirectChannels()
    }

    val server = Workspace.server(serverId)
    val channels = serverId
        ?.let { channelsByServer[it].orEmpty() }
        .orEmpty()
        .filter { it.type == ChannelType.TEXT && it.id != from }
    val others = directs.filter { it.channelId != from }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp)) {
            Text(
                text = "Forward to",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )

            if (serverId != null && channels.isEmpty()) {
                EmptyState(
                    icon = BetweenUsIcons.Hash,
                    title = "No other channel here",
                    detail = "This server has nowhere else to put it yet.",
                )
                return@Column
            }
            if (serverId == null && others.isEmpty()) {
                EmptyState(
                    icon = BetweenUsIcons.Message,
                    title = "No other conversation",
                    detail = "Start one and it will be on this list.",
                )
                return@Column
            }

            LazyColumn {
                if (serverId != null) {
                    item { SectionLabel(server?.name ?: "This server") }
                    items(channels, key = { it.id }) { channel ->
                        ListRow(
                            title = channel.name,
                            subtitle = channel.topic?.takeIf { it.isNotBlank() },
                            leading = { BetweenUsIcon(BetweenUsIcons.Hash) },
                            onClick = { onPick(channel.id) },
                        )
                    }
                } else {
                    item { SectionLabel("Direct messages") }
                    items(others, key = { it.channelId }) { direct ->
                        ListRow(
                            title = direct.participant.label,
                            subtitle = direct.participant.handle,
                            leading = { BetweenUsIcon(BetweenUsIcons.User) },
                            onClick = { onPick(direct.channelId) },
                        )
                    }
                }
            }
        }
    }
}
