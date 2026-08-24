package com.aatech.betweenus.feature.home

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.UserSummary
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.feature.settings.BetweenUsPermissions
import com.aatech.betweenus.feature.settings.NotificationPermissionBanner
import com.aatech.betweenus.ui.components.AvatarWithStatus
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.EmptyState
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.theme.StatusOnline
import kotlinx.coroutines.launch

/**
 * Home: friends, requests, and the conversations they belong to.
 *
 * The port of `apps/desktop/src/features/home/FriendsView.tsx`. Opening a
 * direct message from here is the only way one gets created, on every client.
 */
@Composable
fun FriendsScreen(onOpenMenu: () -> Unit, onOpenChannel: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val friends by Workspace.friends.collectAsState()
    val statuses by Presence.statuses.collectAsState()

    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<UserSummary>>(emptyList()) }
    var note by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    var permissionTick by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        permissionTick++
        onPauseOrDispose { }
    }

    var notificationBannerDismissed by rememberSaveable { mutableStateOf(false) }
    val notificationsGranted = remember(permissionTick) {
        BetweenUsPermissions.granted(context, BetweenUsPermissions.NOTIFICATIONS)
    }

    val notificationLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { allowed ->
        permissionTick++
        if (!allowed) {
            BetweenUsPermissions.openSettings(context)
        }
    }

    LaunchedEffect(Unit) { Workspace.loadFriends() }
    LaunchedEffect(query) {
        results = if (query.length < 2) {
            emptyList()
        } else {
            runCatching { BetweenUsApi.searchUsers(query) }.getOrDefault(emptyList())
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

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .padding(start = 4.dp, end = 12.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(BetweenUsIcons.LayoutSidebar, "Open the channel list", onOpenMenu)
            Text(
                text = "Friends",
                style = MaterialTheme.typography.titleLargeEmphasized,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
        }

        // Notification Permission Warning Banner (if user denied or turned off notifications)
        if (BetweenUsPermissions.NOTIFICATIONS != null && !notificationsGranted && !notificationBannerDismissed) {
            NotificationPermissionBanner(
                onEnable = {
                    notificationLauncher.launch(BetweenUsPermissions.NOTIFICATIONS)
                },
                onDismiss = {
                    notificationBannerDismissed = true
                },
            )
        }

        LazyColumn(Modifier.fillMaxSize()) {
            item {
                Column(Modifier.padding(horizontal = 12.dp, vertical = 12.dp)) {
                    BetweenUsField(
                        label = "Add someone",
                        value = query,
                        onValueChange = { query = it; note = null },
                        placeholder = "Their username",
                        imeAction = ImeAction.Search,
                        enabled = !busy,
                    )
                    note?.let {
                        Notice(it, MaterialTheme.colorScheme.error, Modifier.padding(top = 8.dp))
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
                            IconAction(BetweenUsIcons.UserPlus, "Send a friend request", {
                                act {
                                    BetweenUsApi.addFriend(user.username)
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
                            IconAction(BetweenUsIcons.Check, "Accept", tint = StatusOnline, onClick = {
                                act { BetweenUsApi.acceptFriend(friend.user.id); Workspace.loadFriends() }
                            })
                            IconAction(BetweenUsIcons.X, "Refuse", tint = MaterialTheme.colorScheme.error, onClick = {
                                act { BetweenUsApi.removeFriend(friend.user.id); Workspace.loadFriends() }
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
                        icon = BetweenUsIcons.Users,
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
                        IconAction(BetweenUsIcons.Message, "Open a conversation", {
                            act {
                                val direct = Workspace.openDirect(friend.user.id)
                                onOpenChannel(direct.channelId)
                            }
                        })
                        IconAction(BetweenUsIcons.X, "Remove", tint = MaterialTheme.colorScheme.error, onClick = {
                            act { BetweenUsApi.removeFriend(friend.user.id); Workspace.loadFriends() }
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
