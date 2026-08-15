package com.aktech.nexora.feature.home

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
import com.aktech.nexora.core.data.UserSummary
import com.aktech.nexora.core.store.Presence
import com.aktech.nexora.core.store.Workspace
import com.aktech.nexora.ui.components.AvatarWithStatus
import com.aktech.nexora.ui.components.Chip
import com.aktech.nexora.ui.components.EmptyState
import com.aktech.nexora.ui.components.IconAction
import com.aktech.nexora.ui.components.ListRow
import com.aktech.nexora.ui.components.NexoraField
import com.aktech.nexora.ui.components.NexoraIcon
import com.aktech.nexora.ui.components.NexoraIcons
import com.aktech.nexora.ui.components.Notice
import com.aktech.nexora.ui.components.SectionLabel
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Edge
import com.aktech.nexora.ui.theme.Ground
import com.aktech.nexora.ui.theme.Slate50
import com.aktech.nexora.ui.theme.StatusOnline
import com.aktech.nexora.ui.theme.Surface950
import kotlinx.coroutines.launch

/**
 * Home: friends, requests, and the conversations they belong to.
 *
 * The port of `apps/desktop/src/features/home/FriendsView.tsx`. Opening a
 * direct message from here is the only way one gets created, on every client.
 */
@Composable
fun FriendsScreen(onOpenMenu: () -> Unit, onOpenChannel: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val friends by Workspace.friends.collectAsState()
    val statuses by Presence.statuses.collectAsState()

    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<UserSummary>>(emptyList()) }
    var note by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { Workspace.loadFriends() }
    LaunchedEffect(query) {
        results = if (query.length < 2) {
            emptyList()
        } else {
            runCatching { NexoraApi.searchUsers(query) }.getOrDefault(emptyList())
        }
    }

    val incoming = friends.filter { it.incoming }
    val outgoing = friends.filter { it.outgoing }
    val accepted = friends.filter { it.status.name == "ACCEPTED" }

    fun act(block: suspend () -> Unit) {
        scope.launch {
            busy = true
            note = runCatching { block() }.exceptionOrNull()?.message
            busy = false
        }
    }

    Column(Modifier.fillMaxSize().background(Ground).systemBarsPadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().background(Surface950).padding(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(NexoraIcons.LayoutSidebar, "Open the channel list", onOpenMenu)
            Text(
                text = "Friends",
                style = MaterialTheme.typography.titleMedium,
                color = Slate50,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
        }
        HorizontalDivider(color = Edge)

        LazyColumn(Modifier.fillMaxSize()) {
            item {
                Column(Modifier.padding(horizontal = 12.dp, vertical = 12.dp)) {
                    NexoraField(
                        label = "Add someone",
                        value = query,
                        onValueChange = { query = it; note = null },
                        placeholder = "Their username",
                        imeAction = ImeAction.Search,
                        enabled = !busy,
                    )
                    note?.let {
                        Notice(it, Danger, Modifier.padding(top = 8.dp))
                    }
                }
            }

            if (results.isNotEmpty()) {
                item { SectionLabel("Search results") }
                items(results, key = { "search-${it.id}" }) { user ->
                    PersonRow(
                        user = user,
                        status = statuses[user.id]?.wire ?: "offline",
                        trailing = {
                            IconAction(NexoraIcons.UserPlus, "Send a friend request", {
                                act {
                                    NexoraApi.addFriend(user.username)
                                    Workspace.loadFriends()
                                    query = ""
                                }
                            })
                        },
                    )
                }
            }

            if (incoming.isNotEmpty()) {
                item { SectionLabel("Wants to be friends") }
                items(incoming, key = { "in-${it.user.id}" }) { friend ->
                    PersonRow(
                        user = friend.user,
                        status = statuses[friend.user.id]?.wire ?: "offline",
                        trailing = {
                            IconAction(NexoraIcons.Check, "Accept", tint = StatusOnline, onClick = {
                                act { NexoraApi.acceptFriend(friend.user.id); Workspace.loadFriends() }
                            })
                            IconAction(NexoraIcons.X, "Refuse", tint = Danger, onClick = {
                                act { NexoraApi.removeFriend(friend.user.id); Workspace.loadFriends() }
                            })
                        },
                    )
                }
            }

            if (outgoing.isNotEmpty()) {
                item { SectionLabel("Asked") }
                items(outgoing, key = { "out-${it.user.id}" }) { friend ->
                    PersonRow(
                        user = friend.user,
                        status = statuses[friend.user.id]?.wire ?: "offline",
                        trailing = { Chip("Pending") },
                    )
                }
            }

            item { SectionLabel("Friends") }
            if (accepted.isEmpty()) {
                item {
                    EmptyState(
                        icon = NexoraIcons.Users,
                        title = "No friends yet",
                        detail = "Search for a username above to send the first request.",
                    )
                }
            }
            items(accepted, key = { "friend-${it.user.id}" }) { friend ->
                PersonRow(
                    user = friend.user,
                    status = statuses[friend.user.id]?.wire ?: "offline",
                    onClick = {
                        act {
                            val direct = Workspace.openDirect(friend.user.id)
                            onOpenChannel(direct.channelId)
                        }
                    },
                    trailing = {
                        IconAction(NexoraIcons.Message, "Open a conversation", {
                            act {
                                val direct = Workspace.openDirect(friend.user.id)
                                onOpenChannel(direct.channelId)
                            }
                        })
                        IconAction(NexoraIcons.X, "Remove", tint = Danger, onClick = {
                            act { NexoraApi.removeFriend(friend.user.id); Workspace.loadFriends() }
                        })
                    },
                )
            }
        }
    }
}

@Composable
private fun PersonRow(
    user: UserSummary,
    status: String,
    onClick: (() -> Unit)? = null,
    trailing: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit,
) {
    ListRow(
        title = user.label,
        subtitle = "@${user.username}",
        leading = {
            AvatarWithStatus(
                id = user.id,
                label = user.label,
                url = user.avatarUrl?.let { Endpoint.absolute(it) },
                status = status,
                size = 36.dp,
            )
        },
        trailing = trailing,
        onClick = onClick,
    )
}
