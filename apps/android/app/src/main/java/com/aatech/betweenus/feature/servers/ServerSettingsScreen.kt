package com.aatech.betweenus.feature.servers

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.width
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import android.content.Intent
import com.aatech.betweenus.core.data.ChannelType
import com.aatech.betweenus.feature.settings.PicturePicker
import com.aatech.betweenus.ui.components.Avatar
import androidx.compose.foundation.shape.RoundedCornerShape
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.InviteLink
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.ServerInvite
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.EmptyState
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Edge
import com.aatech.betweenus.ui.theme.Ground
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate50
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.StatusOnline
import com.aatech.betweenus.ui.theme.Surface950
import kotlinx.coroutines.launch

/**
 * A server's own settings: its name, its channels, and the two ways to stop
 * being in it.
 *
 * The desktop's version also edits roles as a table; here that lives on the
 * members screen, one person at a time, because a permission matrix on a phone
 * is a scrolling exercise rather than a screen.
 */
@Composable
fun ServerSettingsScreen(serverId: String?, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val servers by Workspace.servers.collectAsState()
    val channelsByServer by Workspace.channels.collectAsState()
    val server = servers.firstOrNull { it.id == serverId }

    var name by remember(server?.id) { mutableStateOf(server?.name.orEmpty()) }
    var note by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var confirmingDestruction by remember { mutableStateOf(false) }

    fun act(block: suspend () -> Unit) {
        scope.launch {
            busy = true
            note = runCatching { block() }.exceptionOrNull()?.message
            busy = false
        }
    }

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
                text = server?.name ?: "Server",
                style = MaterialTheme.typography.titleMedium,
                color = Slate50,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
        }
        HorizontalDivider(color = Edge)

        if (server == null) {
            EmptyState(
                icon = BetweenUsIcons.Compass,
                title = "No server open",
                detail = "Pick one from the rail first.",
            )
            return@Column
        }

        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 32.dp)) {
            PicturePicker(
                label = "server icon",
                canClear = server.iconUrl != null,
                onPicked = { url ->
                    BetweenUsApi.setServerIcon(server.id, url)
                    Workspace.refresh()
                },
                onClear = {
                    BetweenUsApi.setServerIcon(server.id, null)
                    Workspace.refresh()
                },
                preview = {
                    Avatar(
                        id = server.id,
                        label = server.name,
                        url = server.iconUrl?.let { Endpoint.absolute(it) },
                        size = 56.dp,
                        shape = RoundedCornerShape(18.dp),
                    )
                },
            )

            SectionLabel("Identity")
            Column(Modifier.padding(horizontal = 12.dp)) {
                BetweenUsField(
                    label = "Name",
                    value = name,
                    onValueChange = { name = it; note = null },
                    placeholder = server.name,
                    imeAction = ImeAction.Done,
                    enabled = !busy && server.can("MANAGE_SERVER"),
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    // Not the slug. A slug is a name and stopped opening doors
                    // when invites landed; this line still said otherwise.
                    text = "People join with an invite code - see below.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate500,
                )
                if (server.can("MANAGE_SERVER")) {
                    Spacer(Modifier.height(12.dp))
                    BetweenUsButton(
                        text = "Save",
                        busy = busy,
                        enabled = name.isNotBlank() && name != server.name,
                        onClick = {
                            act {
                                BetweenUsApi.updateServer(server.id, name.trim(), null)
                                Workspace.refresh()
                            }
                        },
                    )
                }
            }

            SectionLabel("Channels")
            channelsByServer[server.id].orEmpty().forEach { channel ->
                ListRow(
                    title = channel.name,
                    subtitle = channel.topic,
                    leading = {
                        BetweenUsIcon(
                            icon = when {
                                channel.isPrivate -> BetweenUsIcons.Lock
                                channel.type == ChannelType.VOICE -> BetweenUsIcons.Speaker
                                else -> BetweenUsIcons.Hash
                            },
                            size = 18.dp,
                        )
                    },
                    trailing = {
                        if (server.can("MANAGE_CHANNEL")) {
                            IconAction(BetweenUsIcons.Trash, "Delete channel", tint = Danger, onClick = {
                                act { Workspace.deleteChannel(channel) }
                            })
                        }
                    },
                )
            }

            note?.let {
                Spacer(Modifier.height(12.dp))
                Notice(it, Danger, Modifier.padding(horizontal = 16.dp))
            }

            if (server.can("MANAGE_SERVER")) {
                InviteSection(serverId = server.id, busy = busy, onNote = { note = it })
            }

            RoleSection(
                serverId = server.id,
                mayManage = server.can("MANAGE_ROLE"),
                onNote = { note = it },
            )

            EmojiSection(
                serverId = server.id,
                mayManage = server.can("MANAGE_EMOJI"),
                onNote = { note = it },
            )

            SectionLabel("Leaving")
            Column(Modifier.padding(horizontal = 16.dp)) {
                Text(
                    text = if (server.role.name == "OWNER") {
                        "You own this server. Deleting it removes every channel and message in it, " +
                            "for everybody, and cannot be undone."
                    } else {
                        "Leaving removes your access. Anything you wrote stays."
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = Slate500,
                )
                Spacer(Modifier.height(12.dp))

                if (confirmingDestruction) {
                    Row {
                        Chip(
                            text = if (server.role.name == "OWNER") "Yes, delete it" else "Yes, leave",
                            tone = Danger,
                            onClick = {
                                act {
                                    if (server.role.name == "OWNER") {
                                        Workspace.deleteServer(server.id)
                                    } else {
                                        Workspace.leaveServer(server.id)
                                    }
                                    onBack()
                                }
                            },
                        )
                        Spacer(Modifier.height(0.dp))
                        Chip("Cancel", onClick = { confirmingDestruction = false })
                    }
                } else {
                    Chip(
                        text = if (server.role.name == "OWNER") "Delete this server" else "Leave this server",
                        tone = Danger,
                        onClick = { confirmingDestruction = true },
                    )
                }
            }
        }
    }
}

/**
 * The codes that let somebody in, and the two ways to stop one working.
 *
 * The desktop has had this since invites landed; the phone had the three API
 * calls and no screen, so a server created on a phone could not be joined by
 * anybody at all. An invite is the only way in now - the slug is a name and
 * opens nothing - which makes this the difference between a server and a
 * private diary.
 *
 * Loaded when the section is first drawn rather than with the rest of the
 * screen: most visits here are to rename a channel, and a list of codes is not
 * worth a request on every one of them.
 */
@Composable
private fun InviteSection(serverId: String, busy: Boolean, onNote: (String?) -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current

    var invites by remember(serverId) { mutableStateOf<List<ServerInvite>?>(null) }
    var working by remember { mutableStateOf(false) }
    /** Hours until a new invite expires, or null for one that never does. */
    var expiresIn by remember { mutableStateOf<Int?>(24) }
    /** Uses a new invite allows, or null for unlimited. */
    var maxUses by remember { mutableStateOf<Int?>(null) }

    fun act(block: suspend () -> Unit) {
        scope.launch {
            working = true
            onNote(runCatching { block() }.exceptionOrNull()?.message)
            working = false
        }
    }

    LaunchedEffect(serverId) {
        invites = runCatching { BetweenUsApi.serverInvites(serverId) }.getOrNull().orEmpty()
    }

    SectionLabel("Invites")

    Column(Modifier.padding(horizontal = 16.dp)) {
        Text(
            text = "An invite is the only way a stranger gets in. Give one an expiry, " +
                "a use limit, both or neither - copying or sending it hands over a link.",
            style = MaterialTheme.typography.bodySmall,
            color = Slate500,
        )
        Spacer(Modifier.height(10.dp))

        Row(verticalAlignment = Alignment.CenterVertically) {
            Chip(
                text = when (expiresIn) {
                    null -> "Never expires"
                    1 -> "1 hour"
                    24 -> "1 day"
                    else -> "7 days"
                },
                onClick = {
                    // A short cycle beats a date picker for four options.
                    expiresIn = when (expiresIn) {
                        1 -> 24
                        24 -> 24 * 7
                        24 * 7 -> null
                        else -> 1
                    }
                },
            )
            Spacer(Modifier.width(8.dp))
            Chip(
                text = maxUses?.let { count -> "$count uses" } ?: "Unlimited uses",
                onClick = {
                    maxUses = when (maxUses) {
                        null -> 1
                        1 -> 5
                        5 -> 25
                        else -> null
                    }
                },
            )
        }

        Spacer(Modifier.height(10.dp))
        BetweenUsButton(
            text = "Create an invite",
            busy = working || busy,
            onClick = {
                act {
                    val created = BetweenUsApi.createServerInvite(serverId, expiresIn, maxUses)
                    invites = listOf(created) + invites.orEmpty()
                    // Straight to the clipboard, and as a link rather than a
                    // code: the only reason to mint one is to send it to
                    // somebody, and a bare code pasted into a chat looks like a
                    // typo to whoever gets it. The link says which deployment
                    // as well, which a code cannot - two BetweenUss can both have
                    // an invite `k3m9x2qp` and neither is wrong.
                    clipboard.setText(AnnotatedString(InviteLink.of(Endpoint.current(), created.code)))
                }
            },
        )
    }

    val list = invites
    if (list == null) {
        ListRow(title = "Loading invites", leading = { BetweenUsIcon(BetweenUsIcons.UserPlus) })
    } else if (list.isEmpty()) {
        ListRow(
            title = "No invites yet",
            subtitle = "Nobody can join until there is one",
            leading = { BetweenUsIcon(BetweenUsIcons.UserPlus) },
        )
    } else {
        list.forEach { invite ->
            ListRow(
                title = invite.code,
                subtitle = inviteState(invite),
                titleColor = if (invite.active) Slate100 else Slate500,
                leading = {
                    BetweenUsIcon(
                        icon = BetweenUsIcons.UserPlus,
                        tint = if (invite.active) StatusOnline else Slate500,
                    )
                },
                trailing = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (invite.active) {
                            IconAction(BetweenUsIcons.Copy, "Copy the link", onClick = {
                                clipboard.setText(
                                    AnnotatedString(InviteLink.of(Endpoint.current(), invite.code)),
                                )
                            })
                            IconAction(BetweenUsIcons.Send, "Send this link", onClick = {
                                val share = Intent(Intent.ACTION_SEND).apply {
                                    type = "text/plain"
                                    putExtra(
                                        Intent.EXTRA_TEXT,
                                        "Join me on BetweenUs: " +
                                            InviteLink.of(Endpoint.current(), invite.code),
                                    )
                                }
                                context.startActivity(
                                    Intent.createChooser(share, "Send the invite"),
                                )
                            })
                            IconAction(BetweenUsIcons.X, "Revoke", tint = Danger, onClick = {
                                act {
                                    val revoked = BetweenUsApi.revokeServerInvite(serverId, invite.code)
                                    invites = invites.orEmpty().map { existing ->
                                        if (existing.code == revoked.code) revoked else existing
                                    }
                                }
                            })
                        }
                    }
                },
            )
        }
    }
}

/**
 * Why an invite does or does not work, in one line.
 *
 * Three separate reasons an invite is dead, and a screen that said only
 * "inactive" would leave whoever minted it guessing which.
 */
private fun inviteState(invite: ServerInvite): String {
    val limit = invite.maxUses
    val expires = invite.expiresAt
    val used = if (limit == null) "${invite.uses} used" else "${invite.uses}/$limit used"
    return when {
        invite.revokedAt != null -> "Revoked - $used"
        !invite.active && limit != null && invite.uses >= limit -> "Spent - $used"
        !invite.active -> "Expired - $used"
        expires != null -> "$used - expires ${shortDate(expires)}"
        else -> "$used - never expires"
    }
}

/** The date part of an ISO timestamp. A time to the second is not news here. */
private fun shortDate(iso: String): String = iso.take(10)
