package com.aatech.betweenus.feature.shell

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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.Channel
import com.aatech.betweenus.core.data.ChannelType
import com.aatech.betweenus.core.data.PublicUser
import com.aatech.betweenus.core.data.ServerWithRole
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.feature.servers.CreateChannelSheet
import com.aatech.betweenus.feature.servers.JoinOrCreateServerSheet
import com.aatech.betweenus.ui.components.AvatarWithStatus
import com.aatech.betweenus.ui.components.Badge
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.Avatar
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.components.ServerTile

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
    onServerSettings: () -> Unit,
    onRemote: () -> Unit,
) {
    var addingServer by remember { mutableStateOf(false) }
    var addingChannel by remember { mutableStateOf(false) }

    val channels by Workspace.channels.collectAsState()
    val unread by Workspace.unread.collectAsState()
    val self by Presence.self.collectAsState()

    // Collected, not read: `Presence.voiceMembers()` returns the value at the
    // moment it is called, so a room that fills up after this drawer was drawn
    // never redrew it. The member list is what puts names to the ids.
    val voiceRooms by Presence.voice.collectAsState()
    val members by Workspace.members.collectAsState()

    val server = servers.firstOrNull { it.id == selectedServerId }

    LaunchedEffect(selectedServerId) {
        selectedServerId?.let {
            Workspace.loadChannels(it)
            // Names for whoever is sitting in a voice channel.
            Workspace.loadMembers(it)
        }
    }

    Row(Modifier.fillMaxSize().systemBarsPadding()) {
        // --- the rail ---
        Column(
            modifier = Modifier
                .width(68.dp)
                .fillMaxHeight()
                .background(MaterialTheme.colorScheme.surfaceContainerLowest)
                .verticalScroll(rememberScrollState())
                .padding(vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            // Home is the rail's first tile and reads as one: filled when it
            // is where you are, quiet when it is not, so "which of these am I
            // in" is answered the same way for the DM list as for a server.
            IconAction(
                icon = BetweenUsIcons.Message,
                contentDescription = "Direct messages",
                onClick = onHome,
                prominent = selectedServerId == null,
            )
            HorizontalDivider(
                Modifier.width(28.dp),
                color = MaterialTheme.colorScheme.outlineVariant,
            )

            servers.forEach { entry ->
                Box(Modifier.clip(RoundedCornerShape(24.dp))) {
                    ServerTile(
                        id = entry.id,
                        name = entry.name,
                        iconUrl = entry.iconUrl?.let { com.aatech.betweenus.core.data.Endpoint.absolute(it) },
                        selected = entry.id == selectedServerId,
                        unread = Workspace.unreadOfServer(entry.id),
                        modifier = Modifier.clickable { onSelectServer(entry.id) },
                    )
                }
            }

            IconAction(
                icon = BetweenUsIcons.Plus,
                contentDescription = "Add a server",
                onClick = { addingServer = true },
            )
            IconAction(
                icon = BetweenUsIcons.Monitor,
                contentDescription = "Remote machines",
                onClick = onRemote,
            )
        }

        // --- channels of the selected server, or the DM list ---
        Column(
            Modifier
                .weight(1f)
                .fillMaxHeight()
                .background(MaterialTheme.colorScheme.surfaceContainerLow),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 4.dp, top = 12.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = server?.name ?: "Direct messages",
                    style = MaterialTheme.typography.titleLargeEmphasized,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                // Invites used to live two screens away - the drawer, then
                // account settings, then server settings - which is a long way
                // to walk to answer "how do I add somebody". It is one tap from
                // the server whose invite it would be.
                if (server != null && server.can("MANAGE_MEMBER")) {
                    IconAction(
                        icon = BetweenUsIcons.UserPlus,
                        contentDescription = "Invite people",
                        onClick = onServerSettings,
                    )
                }
                if (server != null && server.can("MANAGE_CHANNEL")) {
                    IconAction(
                        icon = BetweenUsIcons.Plus,
                        contentDescription = "Create a channel",
                        onClick = { addingChannel = true },
                    )
                }
            }
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
                        // Presence gives user ids; the member list of the
                        // server is what turns them into people. Without that
                        // a voice channel could only say how many were in it,
                        // which is the one thing you can already see.
                        val inRoom = voiceRooms[channel.id].orEmpty()
                        val roster = members[channel.serverId].orEmpty()
                        val names = inRoom.map { id ->
                            roster.firstOrNull { it.userId == id }?.label ?: "Someone"
                        }

                        Column {
                            ChannelRow(
                                channel = channel,
                                selected = channel.id == selectedChannelId,
                                unread = 0,
                                subtitle = if (inRoom.isEmpty()) null else "${inRoom.size} in the room",
                            ) { onSelectChannel(channel) }

                            for (name in names) VoiceMember(name)
                        }
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            ListRow(
                title = user.label,
                subtitle = "@${user.username} · ${self.wire}",
                leading = {
                    AvatarWithStatus(
                        id = user.id,
                        label = user.label,
                        url = user.avatarUrl?.let { com.aatech.betweenus.core.data.Endpoint.absolute(it) },
                        status = self.wire,
                        size = 34.dp,
                    )
                },
                trailing = {
                    IconAction(
                        icon = BetweenUsIcons.Settings,
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

/**
 * One person sitting in a voice channel, under its row.
 *
 * The count alone was no use: "1 in the room" does not say whether the room is
 * worth joining, and the web has said who all along. Indented to the width of
 * the channel icon, so the list reads as belonging to the channel above it.
 */
@Composable
private fun VoiceMember(name: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 44.dp, end = 12.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Avatar(id = name, label = name, url = null, size = 20.dp)
        Text(
            text = name,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
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
            BetweenUsIcon(
                icon = when {
                    channel.isPrivate -> BetweenUsIcons.Lock
                    channel.type == ChannelType.VOICE -> BetweenUsIcons.Speaker
                    else -> BetweenUsIcons.Hash
                },
                tint = if (selected) {
                    MaterialTheme.colorScheme.onSecondaryContainer
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                size = 20.dp,
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
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
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
                            com.aatech.betweenus.core.data.Endpoint.absolute(it)
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
