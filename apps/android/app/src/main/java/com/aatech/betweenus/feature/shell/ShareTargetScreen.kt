package com.aatech.betweenus.feature.shell

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.ChannelType
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.ui.components.AvatarWithStatus
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.EmptyState
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.theme.Edge
import com.aatech.betweenus.ui.theme.Ground
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate50
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.Surface950

/**
 * Where a share is going: the screen the system share sheet hands off to.
 *
 * An `ACTION_SEND` names files and nothing else. It does not name a
 * conversation, and this app used to answer that itself - the last channel
 * that happened to be open, or the drawer if there was not one - which meant a
 * share either landed somewhere nobody chose or looked like it had been
 * swallowed. WhatsApp's answer is the right one and this is it: a list of
 * every conversation, one tap, and the files land in the send preview of the
 * one that was picked with a Send button still to press.
 *
 * Nothing is sent from here. Picking a conversation opens it; [PendingShare]
 * survives the trip and the chat screen takes it into the preview, which is
 * the one place in this app where something about to be sent is looked at
 * first.
 */
@Composable
fun ShareTargetScreen(
    count: Int,
    onPick: (channelId: String, serverId: String?) -> Unit,
    onCancel: () -> Unit,
) {
    val servers by Workspace.servers.collectAsState()
    val directs by Workspace.directChannels.collectAsState()
    val channelsByServer by Workspace.channels.collectAsState()
    val statuses by Presence.statuses.collectAsState()

    var query by remember { mutableStateOf("") }

    // Every server's channels, not only the one that was open. A share is the
    // one moment the whole list has to be there at once, because the thing
    // being chosen is where the files go.
    LaunchedEffect(servers) {
        Workspace.loadDirectChannels()
        servers.forEach { Workspace.loadChannels(it.id) }
    }

    val needle = query.trim().lowercase()
    fun matches(text: String) = needle.isEmpty() || text.lowercase().contains(needle)

    val people = directs.filter { matches(it.participant.label) || matches(it.participant.username) }

    // Back is cancel, and cancel drops the files: they are URIs this activity
    // was lent, and a list nobody chose a home for is not worth keeping.
    BackHandler(onBack = onCancel)

    Column(Modifier.fillMaxSize().background(Ground).systemBarsPadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().background(Surface950).padding(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(BetweenUsIcons.X, "Cancel this share", onCancel)
            Column(Modifier.weight(1f).padding(start = 8.dp)) {
                Text(
                    text = "Send to",
                    style = MaterialTheme.typography.titleMedium,
                    color = Slate50,
                )
                Text(
                    text = if (count == 1) "1 file" else "$count files",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate500,
                )
            }
            BetweenUsIcon(BetweenUsIcons.Paperclip, tint = Slate400, contentDescription = null)
        }
        HorizontalDivider(color = Edge)

        Column(Modifier.padding(horizontal = 12.dp, vertical = 12.dp)) {
            BetweenUsField(
                label = "Search",
                value = query,
                onValueChange = { query = it },
                placeholder = "A name or a channel",
                imeAction = ImeAction.Search,
            )
        }

        val serversWithMatches = servers.map { server ->
            server to channelsByServer[server.id].orEmpty()
                .filter { it.type == ChannelType.TEXT && matches(it.name) }
        }.filter { (_, channels) -> channels.isNotEmpty() }

        if (people.isEmpty() && serversWithMatches.isEmpty()) {
            EmptyState(
                icon = BetweenUsIcons.Message,
                title = if (needle.isEmpty()) "Nowhere to send it yet" else "Nothing by that name",
                detail = if (needle.isEmpty()) {
                    "Start a conversation or join a server, and it will be on this list."
                } else {
                    "No conversation or channel matches what you typed."
                },
            )
            return@Column
        }

        LazyColumn(Modifier.fillMaxSize()) {
            if (people.isNotEmpty()) {
                item { SectionLabel("Direct messages") }
                items(people, key = { "dm-${it.channelId}" }) { direct ->
                    ListRow(
                        title = direct.participant.label,
                        subtitle = "@${direct.participant.username}",
                        leading = {
                            AvatarWithStatus(
                                id = direct.participant.id,
                                label = direct.participant.label,
                                url = direct.participant.avatarUrl?.let { Endpoint.absolute(it) },
                                status = statuses[direct.participant.id]?.wire ?: "offline",
                                size = 36.dp,
                            )
                        },
                        onClick = { onPick(direct.channelId, null) },
                    )
                }
            }

            serversWithMatches.forEach { (server, channels) ->
                item(key = "server-${server.id}") { SectionLabel(server.name) }
                items(channels, key = { "channel-${it.id}" }) { channel ->
                    ListRow(
                        title = channel.name,
                        subtitle = channel.topic?.takeIf { it.isNotBlank() },
                        leading = {
                            BetweenUsIcon(
                                BetweenUsIcons.Hash,
                                tint = Slate400,
                                contentDescription = null,
                            )
                        },
                        onClick = { onPick(channel.id, server.id) },
                    )
                }
            }
        }
    }
}
