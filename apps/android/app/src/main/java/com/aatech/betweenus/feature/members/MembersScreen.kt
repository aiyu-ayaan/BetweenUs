package com.aatech.betweenus.feature.members

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
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.ApiError
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.PresenceStatus
import com.aatech.betweenus.core.data.ServerMember
import com.aatech.betweenus.core.data.ServerRole
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.data.UserSummary
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.ui.components.AvatarWithStatus
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.EmptyState
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Edge
import com.aatech.betweenus.ui.theme.Ground
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate50
import com.aatech.betweenus.ui.theme.Surface950
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
    /** The signed-in account's id. Your own row offers nothing to do to you. */
    selfId: String,
    onBack: () -> Unit,
    onOpenDirect: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val membersByServer by Workspace.members.collectAsState()
    val statuses by Presence.statuses.collectAsState()
    val server = Workspace.server(serverId)

    var adding by remember { mutableStateOf("") }
    var note by remember { mutableStateOf<String?>(null) }
    // Typing a username exactly right, blind, was the whole interaction here;
    // people who could not guess the spelling could not add anybody. The
    // search is the same one the desktop offers, and friends-only because the
    // service refuses anyone else.
    var candidates by remember { mutableStateOf<List<UserSummary>>(emptyList()) }
    var editing by remember { mutableStateOf<ServerMember?>(null) }
    var menuFor by remember { mutableStateOf<ServerMember?>(null) }
    /** Whose profile the sheet is showing, or null. Opened by a double tap. */
    var profileOf by remember { mutableStateOf<UserSummary?>(null) }

    LaunchedEffect(serverId) { serverId?.let { Workspace.loadMembers(it, force = true) } }

    /**
     * Opening a conversation with a member, which is allowed to be refused.
     *
     * A server puts people in the same room; it does not make them friends, and
     * `POST /api/v1/dm` refuses a stranger. Letting that throw out of the
     * launched coroutine took the whole app down - an uncaught exception in a
     * coroutine is a crash, not a failed request - so the refusal is caught
     * here and said in a sentence instead.
     */
    fun openDirect(member: ServerMember) {
        scope.launch {
            note = runCatching { onOpenDirect(Workspace.openDirect(member.userId).channelId) }
                .exceptionOrNull()
                ?.let {
                    // FRIENDSHIP_NOT_FOUND is "you never asked"; NOT_FRIENDS is
                    // "you asked and it has not been accepted". Both mean the
                    // same thing to the person tapping, and neither is an error
                    // worth showing the server's wording for.
                    if (it is ApiError && it.code in setOf("FRIENDSHIP_NOT_FOUND", "NOT_FRIENDS")) {
                        "You and ${member.label} are not friends yet, so there is no " +
                            "conversation to open. Tap More on their row to send a request."
                    } else {
                        Session.messageOf(it)
                    }
                }
        }
    }

    val members = serverId?.let { membersByServer[it] }.orEmpty()
    val online = members.filter {
        (statuses[it.userId] ?: PresenceStatus.OFFLINE) != PresenceStatus.OFFLINE
    }
    val offline = members - online.toSet()

    LaunchedEffect(adding, members) {
        val query = adding.trim()
        candidates = if (query.length < 2) {
            emptyList()
        } else {
            val already = members.map { it.userId }.toSet()
            runCatching { BetweenUsApi.searchUsers(query, friendsOnly = true) }
                .getOrDefault(emptyList())
                .filterNot { it.id in already }
        }
    }
    val mayManage = server?.can("MANAGE_MEMBER") == true

    Column(Modifier.fillMaxSize().background(Ground).navigationBarsPadding()) {
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
                text = server?.name?.let { "$it · members" } ?: "Members",
                style = MaterialTheme.typography.titleMedium,
                color = Slate50,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
        }
        HorizontalDivider(color = Edge)

        note?.let {
            Notice(it, Danger, Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
        }

        if (serverId == null) {
            EmptyState(
                icon = BetweenUsIcons.Users,
                title = "No server open",
                detail = "A direct message has exactly two people in it, and you are one of them.",
            )
            return@Column
        }

        LazyColumn(Modifier.fillMaxSize()) {
            if (mayManage) {
                item {
                    Column(Modifier.padding(horizontal = 12.dp, vertical = 12.dp)) {
                        BetweenUsField(
                            label = "Add a friend to this server",
                            value = adding,
                            onValueChange = { adding = it; note = null },
                            // Friends only, and the server enforces it: adding
                            // somebody puts them in the server without asking
                            // them. An invite link is how a stranger gets in,
                            // by choosing to.
                            placeholder = "A friend's username",
                            imeAction = ImeAction.Search,
                        )
                        if (adding.trim().length >= 2 && candidates.isEmpty() && note == null) {
                            Notice(
                                "No friend by that name. Only friends can be added; " +
                                    "send an invite link to anyone else.",
                                Slate400,
                                Modifier.padding(top = 8.dp),
                            )
                        }
                    }
                }

                items(candidates, key = { "add-${it.id}" }) { user ->
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
                            IconAction(BetweenUsIcons.UserPlus, "Add to this server", {
                                scope.launch {
                                    note = runCatching {
                                        BetweenUsApi.addMember(serverId, user.username)
                                        Workspace.loadMembers(serverId, force = true)
                                        adding = ""
                                    }.exceptionOrNull()?.message
                                }
                            })
                        },
                    )
                }
            }

            if (online.isNotEmpty()) item { SectionLabel("Online — ${online.size}") }
            items(online, key = { "on-${it.userId}" }) { member ->
                MemberRow(
                    member = member,
                    status = statuses[member.userId]?.wire ?: "online",
                    self = member.userId == selfId,
                    onOpenDirect = { openDirect(member) },
                    onMenu = { menuFor = member },
                    onOpenProfile = { profileOf = member.summary },
                )
            }

            if (offline.isNotEmpty()) item { SectionLabel("Offline — ${offline.size}") }
            items(offline, key = { "off-${it.userId}" }) { member ->
                MemberRow(
                    member = member,
                    status = "offline",
                    self = member.userId == selfId,
                    onOpenDirect = { openDirect(member) },
                    onMenu = { menuFor = member },
                    onOpenProfile = { profileOf = member.summary },
                )
            }
        }
    }

    profileOf?.let { person ->
        ProfileSheet(person = person, onDismiss = { profileOf = null })
    }

    menuFor?.let { member ->
        MemberMenuSheet(
            member = member,
            // The role editor lives behind the same sheet as everything else a
            // row offers. It used to be a fourth icon on the row itself, which
            // is what left the name with two characters of width to fit in.
            mayEditRole = mayManage && member.role != ServerRole.OWNER,
            onDismiss = { menuFor = null },
            onOpenDirect = { openDirect(member) },
            onEditRole = { editing = member },
        )
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

/**
 * One person in the server.
 *
 * Two actions and at most one pill, deliberately. A row is a name first: with a
 * role chip and four buttons on the end of it, the weighted name column was
 * measured last and got what was left, which on a phone was an ellipsis. The
 * rest is a tap away in [MemberMenuSheet].
 *
 * Your own row has neither. Message, mute and add-friend are all things done to
 * somebody else - `POST /api/v1/dm` will not open a conversation with yourself
 * and is right not to - so the row says which one you are and stops there,
 * rather than offering buttons whose only outcome is a refusal.
 */
@Composable
private fun MemberRow(
    member: ServerMember,
    status: String,
    self: Boolean,
    onOpenDirect: () -> Unit,
    onMenu: () -> Unit,
    onOpenProfile: () -> Unit,
) {
    ListRow(
        title = member.label,
        subtitle = member.handle,
        leading = {
            AvatarWithStatus(
                id = member.userId,
                label = member.label,
                url = member.avatarUrl?.let { Endpoint.absolute(it) },
                status = status,
                size = 36.dp,
                // The same second tap that opens a profile from a message.
                // One question, one gesture, wherever a face is drawn.
                onDoubleTap = onOpenProfile,
            )
        },
        trailing = {
            if (member.role != ServerRole.MEMBER) Chip(member.role.name.lowercase())
            if (self) {
                Chip("You")
            } else {
                IconAction(BetweenUsIcons.Message, "Message ${member.label}", onOpenDirect, compact = true)
                IconAction(BetweenUsIcons.User, "More about ${member.label}", onMenu, compact = true)
            }
        },
        onClick = if (self) null else onOpenDirect,
    )
}
