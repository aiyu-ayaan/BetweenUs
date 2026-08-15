package com.aktech.nexora.feature.members

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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.aktech.nexora.core.data.Endpoint
import com.aktech.nexora.core.data.NexoraApi
import com.aktech.nexora.core.data.PresenceStatus
import com.aktech.nexora.core.data.ServerMember
import com.aktech.nexora.core.data.ServerRole
import com.aktech.nexora.core.store.Presence
import com.aktech.nexora.core.store.Workspace
import com.aktech.nexora.ui.components.AvatarWithStatus
import com.aktech.nexora.ui.components.Chip
import com.aktech.nexora.ui.components.EmptyState
import com.aktech.nexora.ui.components.IconAction
import com.aktech.nexora.ui.components.ListRow
import com.aktech.nexora.ui.components.NexoraField
import com.aktech.nexora.ui.components.NexoraIcons
import com.aktech.nexora.ui.components.Notice
import com.aktech.nexora.ui.components.SectionLabel
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Edge
import com.aktech.nexora.ui.theme.Ground
import com.aktech.nexora.ui.theme.Slate50
import com.aktech.nexora.ui.theme.Surface950
import kotlinx.coroutines.launch

/**
 * Who is in this server, grouped by whether they are around.
 *
 * The port of `apps/desktop/src/features/members/MemberList.tsx`. Role changes
 * live here too, and are offered only to somebody the server says may make
 * them - the UI hides what the backend would refuse anyway, and the backend is
 * still the one refusing it.
 */
@Composable
fun MembersScreen(
    serverId: String?,
    channelId: String?,
    onBack: () -> Unit,
    onOpenDirect: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val membersByServer by Workspace.members.collectAsState()
    val statuses by Presence.statuses.collectAsState()
    val server = Workspace.server(serverId)

    var adding by remember { mutableStateOf("") }
    var note by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<ServerMember?>(null) }

    LaunchedEffect(serverId) { serverId?.let { Workspace.loadMembers(it, force = true) } }

    val members = serverId?.let { membersByServer[it] }.orEmpty()
    val online = members.filter {
        (statuses[it.userId] ?: PresenceStatus.OFFLINE) != PresenceStatus.OFFLINE
    }
    val offline = members - online.toSet()
    val mayManage = server?.can("MANAGE_MEMBER") == true

    Column(Modifier.fillMaxSize().background(Ground).systemBarsPadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().background(Surface950).padding(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(NexoraIcons.ChevronLeft, "Back", onBack)
            Text(
                text = server?.name?.let { "$it · members" } ?: "Members",
                style = MaterialTheme.typography.titleMedium,
                color = Slate50,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
        }
        HorizontalDivider(color = Edge)

        if (serverId == null) {
            EmptyState(
                icon = NexoraIcons.Users,
                title = "No server open",
                detail = "A direct message has exactly two people in it, and you are one of them.",
            )
            return@Column
        }

        LazyColumn(Modifier.fillMaxSize()) {
            if (mayManage) {
                item {
                    Column(Modifier.padding(horizontal = 12.dp, vertical = 12.dp)) {
                        NexoraField(
                            label = "Add a member",
                            value = adding,
                            onValueChange = { adding = it; note = null },
                            placeholder = "Their username",
                            imeAction = ImeAction.Done,
                            onImeAction = {
                                scope.launch {
                                    note = runCatching {
                                        NexoraApi.addMember(serverId, adding.trim())
                                        Workspace.loadMembers(serverId, force = true)
                                        adding = ""
                                    }.exceptionOrNull()?.message
                                }
                            },
                        )
                        note?.let { Notice(it, Danger, Modifier.padding(top = 8.dp)) }
                    }
                }
            }

            if (online.isNotEmpty()) item { SectionLabel("Online — ${online.size}") }
            items(online, key = { "on-${it.userId}" }) { member ->
                MemberRow(member, statuses[member.userId]?.wire ?: "online", mayManage,
                    onOpenDirect = { scope.launch { onOpenDirect(Workspace.openDirect(member.userId).channelId) } },
                    onEdit = { editing = member })
            }

            if (offline.isNotEmpty()) item { SectionLabel("Offline — ${offline.size}") }
            items(offline, key = { "off-${it.userId}" }) { member ->
                MemberRow(member, "offline", mayManage,
                    onOpenDirect = { scope.launch { onOpenDirect(Workspace.openDirect(member.userId).channelId) } },
                    onEdit = { editing = member })
            }
        }
    }

    editing?.let { member ->
        MemberRoleSheet(
            member = member,
            serverId = serverId.orEmpty(),
            onDismiss = { editing = null },
            onChanged = { scope.launch { Workspace.loadMembers(serverId.orEmpty(), force = true) } },
        )
    }
}

@Composable
private fun MemberRow(
    member: ServerMember,
    status: String,
    mayManage: Boolean,
    onOpenDirect: () -> Unit,
    onEdit: () -> Unit,
) {
    ListRow(
        title = member.label,
        subtitle = "@${member.username}",
        leading = {
            AvatarWithStatus(
                id = member.userId,
                label = member.label,
                url = member.avatarUrl?.let { Endpoint.absolute(it) },
                status = status,
                size = 36.dp,
            )
        },
        trailing = {
            if (member.role != ServerRole.MEMBER) Chip(member.role.name.lowercase())
            IconAction(NexoraIcons.Message, "Message", onOpenDirect)
            if (mayManage && member.role != ServerRole.OWNER) {
                IconAction(NexoraIcons.Shield, "Role and permissions", onEdit)
            }
        },
        onClick = onOpenDirect,
    )
}
