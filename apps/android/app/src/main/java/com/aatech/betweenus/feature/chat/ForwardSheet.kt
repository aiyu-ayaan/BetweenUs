package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.ChannelType
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.ReadableMessage
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.ui.components.AvatarWithStatus
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.EmptyState
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.SectionLabel

/**
 * Where a message is being forwarded to.
 *
 * Everywhere it could go, minus the one place it already is. This started as
 * the current server's other text channels and that was too narrow to be
 * usable: a server with one channel in it - which is every server on the day
 * it is made - offered nothing at all, and the sheet's whole answer was that
 * there was no answer. A forward is not a per-server action any more than a
 * share is.
 *
 * So it is the same list [ShareTargetScreen] draws, and deliberately: every
 * direct message and every server's text channels, searchable, in one column.
 * Two pickers that answer "which conversation" differently is one of them
 * being wrong.
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

    val servers by Workspace.servers.collectAsState()
    val channelsByServer by Workspace.channels.collectAsState()
    val directs by Workspace.directChannels.collectAsState()
    val statuses by Presence.statuses.collectAsState()

    var query by remember { mutableStateOf("") }

    // Every server's channels, not only the one being read. A server whose
    // channels were never opened on this device has none cached, and a list
    // that is short because nothing fetched it looks exactly like a list that
    // is short because there is nowhere to send it.
    LaunchedEffect(servers) {
        Workspace.loadDirectChannels()
        servers.forEach { Workspace.loadChannels(it.id) }
    }

    val needle = query.trim().lowercase()
    fun matches(text: String) = needle.isEmpty() || text.lowercase().contains(needle)

    val people = directs
        .filter { it.channelId != from }
        .filter { matches(it.participant.label) || matches(it.participant.username) }

    val serversWithMatches = servers.map { server ->
        server to channelsByServer[server.id].orEmpty()
            .filter { it.type == ChannelType.TEXT && it.id != from && matches(it.name) }
    }.filter { (_, channels) -> channels.isNotEmpty() }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp)) {
            Text(
                text = "Forward to",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )

            Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                BetweenUsField(
                    label = "Search",
                    value = query,
                    onValueChange = { query = it },
                    placeholder = "A name or a channel",
                    imeAction = ImeAction.Search,
                )
            }

            if (people.isEmpty() && serversWithMatches.isEmpty()) {
                EmptyState(
                    icon = BetweenUsIcons.Message,
                    title = if (needle.isEmpty()) "Nowhere to send it yet" else "Nothing by that name",
                    detail = if (needle.isEmpty()) {
                        "Start a conversation or make another channel, and it will be on this list."
                    } else {
                        "No conversation or channel matches what you typed."
                    },
                )
                return@Column
            }

            // Capped rather than free: the sheet is over a conversation, and a
            // picker that grows to the height of the screen has stopped being a
            // sheet. It scrolls past this.
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                if (people.isNotEmpty()) {
                    item { SectionLabel("Direct messages") }
                    items(people, key = { "dm-${it.channelId}" }) { direct ->
                        ListRow(
                            title = direct.participant.label,
                            subtitle = direct.participant.handle,
                            leading = {
                                AvatarWithStatus(
                                    id = direct.participant.id,
                                    label = direct.participant.label,
                                    url = direct.participant.avatarUrl?.let { Endpoint.absolute(it) },
                                    status = statuses[direct.participant.id]?.wire ?: "offline",
                                    size = 36.dp,
                                    viewable = false,
                                )
                            },
                            onClick = { onPick(direct.channelId) },
                        )
                    }
                }

                serversWithMatches.forEach { (server, channels) ->
                    item(key = "server-${server.id}") { SectionLabel(server.name) }
                    items(channels, key = { "channel-${it.id}" }) { channel ->
                        ListRow(
                            title = channel.name,
                            subtitle = channel.topic?.takeIf { it.isNotBlank() },
                            leading = { BetweenUsIcon(BetweenUsIcons.Hash) },
                            onClick = { onPick(channel.id) },
                        )
                    }
                }
            }
        }
    }
}
