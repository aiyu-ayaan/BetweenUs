package com.aatech.betweenus.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
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
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.data.UserSummary
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.ui.components.AvatarWithStatus
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.EmptyState
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.SectionLabel
import kotlinx.coroutines.launch

/**
 * Finding somebody who is not a friend yet, and asking.
 *
 * Its own screen rather than a box on top of the friends list, which is the
 * shape the desktop already has as the "Add friend" tab: the two searches ask
 * different questions - "who is out there" and "which of my friends is this" -
 * and one field answering both is the field that answers neither. [FriendsScreen]
 * keeps the second one.
 *
 * People already on the friends list are dropped from the results. An accepted
 * friend is not a search result here at all, and a request already in flight is
 * shown with what it is waiting on rather than a button that would be refused.
 */
@Composable
fun AddFriendScreen(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val friends by Workspace.friends.collectAsState()
    val statuses by Presence.statuses.collectAsState()

    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<UserSummary>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    var sent by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { Workspace.loadFriends() }

    LaunchedEffect(query) {
        val term = query.trim()
        if (term.length < 2) {
            results = emptyList()
            searching = false
            return@LaunchedEffect
        }
        searching = true
        results = runCatching { BetweenUsApi.searchUsers(term) }
            .onFailure { note = Session.messageOf(it) }
            .getOrDefault(emptyList())
        searching = false
    }

    val accepted = remember(friends) {
        friends.filter { it.status.name == "ACCEPTED" }.map { it.user.id }.toSet()
    }
    val pending = remember(friends) {
        friends.filter { it.incoming || it.outgoing }.associateBy { it.user.id }
    }
    // Already a friend is not a search result: this screen is only about the
    // people who are not on the list yet.
    val offered = results.filterNot { it.id in accepted }
    val hidden = results.size - offered.size

    fun ask(user: UserSummary) {
        scope.launch {
            busy = true
            note = null
            runCatching {
                BetweenUsApi.addFriend(user.username)
                Workspace.loadFriends()
            }.onSuccess { sent = "Asked ${user.label}." }
                .onFailure { note = Session.messageOf(it) }
            busy = false
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .navigationBarsPadding(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .statusBarsPadding()
                .padding(start = 4.dp, end = 12.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(BetweenUsIcons.ChevronLeft, "Back", onBack)
            Text(
                text = "Add friend",
                style = MaterialTheme.typography.titleLargeEmphasized,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        LazyColumn(Modifier.fillMaxSize()) {
            item {
                Column(Modifier.padding(horizontal = 12.dp, vertical = 12.dp)) {
                    BetweenUsField(
                        label = "Search everyone",
                        value = query,
                        onValueChange = { query = it; note = null; sent = null },
                        placeholder = "Their username or name",
                        imeAction = ImeAction.Search,
                        enabled = !busy,
                    )
                    note?.let {
                        Notice(it, MaterialTheme.colorScheme.error, Modifier.padding(top = 8.dp))
                    }
                    sent?.let {
                        Notice(it, MaterialTheme.colorScheme.primary, Modifier.padding(top = 8.dp))
                    }
                }
            }

            when {
                query.trim().length < 2 -> item {
                    EmptyState(
                        icon = BetweenUsIcons.Search,
                        title = "Search for someone",
                        detail = "Two letters is enough. Anyone can be found; only friends can " +
                            "message you.",
                    )
                }

                searching -> Unit

                offered.isEmpty() -> item {
                    EmptyState(
                        icon = BetweenUsIcons.Users,
                        title = if (hidden > 0) "Already friends" else "Nobody by that name",
                        detail = if (hidden > 0) {
                            "Everyone matching that is already on your friends list."
                        } else {
                            "Check the spelling - a username is exact, a display name is not."
                        },
                    )
                }

                else -> {
                    item { SectionLabel("Results — ${offered.size}") }
                    items(offered, key = { it.id }) { user ->
                        val waiting = pending[user.id]
                        ListRow(
                            title = user.label,
                            subtitle = user.handle,
                            leading = {
                                AvatarWithStatus(
                                    id = user.id,
                                    label = user.label,
                                    url = user.avatarUrl?.let { Endpoint.absolute(it) },
                                    status = statuses[user.id]?.wire ?: "offline",
                                    size = 36.dp,
                                )
                            },
                            trailing = {
                                when {
                                    waiting?.incoming == true -> Chip("Asked you")
                                    waiting != null -> Chip("Pending")
                                    else -> IconAction(
                                        BetweenUsIcons.UserPlus,
                                        "Send ${user.label} a friend request",
                                        { ask(user) },
                                        enabled = !busy,
                                    )
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}
