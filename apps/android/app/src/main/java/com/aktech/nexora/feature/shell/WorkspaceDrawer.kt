package com.aktech.nexora.feature.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.aktech.nexora.core.data.Channel
import com.aktech.nexora.core.data.ChannelType
import com.aktech.nexora.core.data.PublicUser
import com.aktech.nexora.core.data.ServerWithRole
import com.aktech.nexora.core.store.Presence
import com.aktech.nexora.core.store.Workspace
import com.aktech.nexora.feature.servers.CreateChannelSheet
import com.aktech.nexora.feature.servers.JoinOrCreateServerSheet
import com.aktech.nexora.ui.components.AvatarWithStatus
import com.aktech.nexora.ui.components.Badge
import com.aktech.nexora.ui.components.IconAction
import com.aktech.nexora.ui.components.ListRow
import com.aktech.nexora.ui.components.NexoraIcon
import com.aktech.nexora.ui.components.NexoraIcons
import com.aktech.nexora.ui.components.SectionLabel
import com.aktech.nexora.ui.components.ServerTile
import com.aktech.nexora.ui.theme.Accent
import com.aktech.nexora.ui.theme.Edge
import com.aktech.nexora.ui.theme.Slate400
import com.aktech.nexora.ui.theme.Slate50
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.Surface800
import com.aktech.nexora.ui.theme.Surface950

/**
 * The two left panels of the desktop, folded into one drawer: the server rail
 * down the side, and the channels of whichever server is selected beside it.
 */
@Composable
fun WorkspaceDrawer(
    user: PublicUser,
    servers: List<ServerWithRole>,
    selectedServerId: String?,
    selectedChannelId: String?,
    onSelectServer: (String?) -> Unit,
    onSelectChannel: (Channel) -> Unit,
    onHome: () -> Unit,
    onSettings: () -> Unit,
    onRemote: () -> Unit,
) {
    var addingServer by remember { mutableStateOf(false) }
    var addingChannel by remember { mutableStateOf(false) }

    val channels by Workspace.channels.collectAsState()
    val unread by Workspace.unread.collectAsState()
    val self by Presence.self.collectAsState()
    val server = servers.firstOrNull { it.id == selectedServerId }

    LaunchedEffect(selectedServerId) {
        selectedServerId?.let { Workspace.loadChannels(it) }
    }

    Row(Modifier.fillMaxSize().systemBarsPadding()) {
        // --- the rail ---
        Column(
            modifier = Modifier
                .width(68.dp)
                .fillMaxHeight()
                .background(Surface950)
                .verticalScroll(rememberScrollState())
                .padding(vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(
                modifier = Modifier.clip(RoundedCornerShape(14.dp)),
                contentAlignment = Alignment.Center,
            ) {
                IconAction(
                    icon = NexoraIcons.Message,
                    contentDescription = "Direct messages",
                    onClick = onHome,
                    tint = if (selectedServerId == null) Accent else Slate400,
                )
            }
            HorizontalDivider(Modifier.width(28.dp), color = Edge)

            servers.forEach { entry ->
                Box(Modifier.clip(RoundedCornerShape(16.dp))) {
                    ServerTile(
                        id = entry.id,
                        name = entry.name,
                        iconUrl = entry.iconUrl?.let { com.aktech.nexora.core.data.Endpoint.absolute(it) },
                        selected = entry.id == selectedServerId,
                        unread = Workspace.unreadOfServer(entry.id),
                        modifier = Modifier.clickable { onSelectServer(entry.id) },
                    )
                }
            }

            IconAction(
                icon = NexoraIcons.Plus,
                contentDescription = "Add a server",
                onClick = { addingServer = true },
            )
            IconAction(
                icon = NexoraIcons.Monitor,
                contentDescription = "Remote machines",
                onClick = onRemote,
            )
        }

        // --- channels of the selected server, or the DM list ---
        Column(Modifier.weight(1f).fillMaxHeight().background(Surface800)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 4.dp, top = 12.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = server?.name ?: "Direct messages",
                    style = MaterialTheme.typography.titleMedium,
                    color = Slate50,
                    modifier = Modifier.weight(1f),
                )
                if (server != null && server.can("MANAGE_CHANNEL")) {
                    IconAction(
                        icon = NexoraIcons.Plus,
                        contentDescription = "Create a channel",
                        onClick = { addingChannel = true },
                    )
                }
            }
            HorizontalDivider(color = Edge)

            LazyColumn(Modifier.weight(1f)) {
                if (server == null) {
                    item { DirectMessageList(onSelectChannel = { onSelectChannel(it) }) }
                } else {
                    val all = channels[server.id].orEmpty()
                    val text = all.filter { it.type == ChannelType.TEXT }
                    val voice = all.filter { it.type == ChannelType.VOICE }

                    if (text.isNotEmpty()) item { SectionLabel("Text channels") }
                    items(text, key = { it.id }) { channel ->
                        ChannelRow(channel, channel.id == selectedChannelId, unread[channel.id] ?: 0) {
                            onSelectChannel(channel)
                        }
                    }
                    if (voice.isNotEmpty()) item { SectionLabel("Voice channels") }
                    items(voice, key = { it.id }) { channel ->
                        val members = Presence.voiceMembers(channel.id)
                        ChannelRow(
                            channel = channel,
                            selected = channel.id == selectedChannelId,
                            unread = 0,
                            subtitle = if (members.isEmpty()) null else "${members.size} in the room",
                        ) { onSelectChannel(channel) }
                    }
                }
            }

            HorizontalDivider(color = Edge)
            ListRow(
                title = user.label,
                subtitle = "@${user.username} · ${self.wire}",
                leading = {
                    AvatarWithStatus(
                        id = user.id,
                        label = user.label,
                        url = user.avatarUrl?.let { com.aktech.nexora.core.data.Endpoint.absolute(it) },
                        status = self.wire,
                        size = 34.dp,
                    )
                },
                trailing = {
                    IconAction(
                        icon = NexoraIcons.Settings,
                        contentDescription = "Settings",
                        onClick = onSettings,
                    )
                },
                onClick = onSettings,
            )
        }
    }

    if (addingServer) {
        JoinOrCreateServerSheet(
            onDismiss = { addingServer = false },
            onDone = { onSelectServer(it.id) },
        )
    }
    if (addingChannel && server != null) {
        CreateChannelSheet(server = server, onDismiss = { addingChannel = false })
    }
}

@Composable
private fun ChannelRow(
    channel: Channel,
    selected: Boolean,
    unread: Int,
    subtitle: String? = null,
    onClick: () -> Unit,
) {
    ListRow(
        title = channel.name,
        subtitle = subtitle,
        selected = selected,
        leading = {
            NexoraIcon(
                icon = when {
                    channel.isPrivate -> NexoraIcons.Lock
                    channel.type == ChannelType.VOICE -> NexoraIcons.Speaker
                    else -> NexoraIcons.Hash
                },
                tint = if (selected) Slate50 else Slate500,
                size = 18.dp,
            )
        },
        trailing = { if (unread > 0) Badge(unread) },
        onClick = onClick,
    )
}

@Composable
private fun DirectMessageList(onSelectChannel: (Channel) -> Unit) {
    val directs by Workspace.directChannels.collectAsState()
    val unread by Workspace.unread.collectAsState()

    Column {
        SectionLabel("Direct messages")
        if (directs.isEmpty()) {
            Text(
                text = "No conversations yet. Open one from the friends screen.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        directs.forEach { direct ->
            val status = Presence.statusOf(direct.participant.id).wire
            ListRow(
                title = direct.participant.label,
                leading = {
                    AvatarWithStatus(
                        id = direct.participant.id,
                        label = direct.participant.label,
                        url = direct.participant.avatarUrl?.let {
                            com.aktech.nexora.core.data.Endpoint.absolute(it)
                        },
                        status = status,
                        size = 32.dp,
                    )
                },
                trailing = { (unread[direct.channelId] ?: 0).let { if (it > 0) Badge(it) } },
                onClick = {
                    onSelectChannel(
                        Channel(
                            id = direct.channelId,
                            serverId = null,
                            name = direct.participant.label,
                            type = ChannelType.DM,
                            topic = null,
                            isPrivate = true,
                        ),
                    )
                },
            )
        }
        Spacer(Modifier.height(8.dp))
    }
}
