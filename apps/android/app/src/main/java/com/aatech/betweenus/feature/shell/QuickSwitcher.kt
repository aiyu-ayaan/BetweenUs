package com.aatech.betweenus.feature.shell

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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.Channel
import com.aatech.betweenus.core.data.ChannelType
import com.aatech.betweenus.core.data.DirectChannel
import com.aatech.betweenus.core.data.ServerWithRole
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.EmptyState
import com.aatech.betweenus.ui.components.ListRow

/**
 * One field over everywhere you can go: conversations, channels and servers.
 *
 * The port of `apps/desktop/src/features/shell/QuickSwitcher.tsx`, which opens
 * on Ctrl+K. A phone has no Ctrl and no K, so the way in is a search control in
 * the drawer header - which is where somebody who does not know where a thing is
 * has already gone looking.
 *
 * It lists **every** server's channels, where the desktop lists only the open
 * one's. That is not a different opinion about switchers: the desktop loads a
 * server's channels when it is opened, so it has nothing else to offer, and
 * `Workspace.refresh` on the phone loads all of them up front because the socket
 * has to be subscribed to every channel or nothing arrives to badge. The data is
 * already here, and a switcher that could only reach the server already on
 * screen would be a list of things one tap away.
 */

/** What a row goes to. The icon and the navigation both read this. */
enum class SwitchKind { DIRECT, TEXT_CHANNEL, VOICE_CHANNEL, SERVER }

/**
 * One destination.
 *
 * [id] is a channel id for the first three kinds and a server id for the last;
 * [serverId] is which server a channel belongs to, which the shell needs because
 * opening a channel also selects the server it is in.
 */
data class SwitchTarget(
    val id: String,
    val label: String,
    val hint: String,
    val kind: SwitchKind,
    val serverId: String? = null,
) {
    val key: String get() = "${kind.name}:$id"
}

/**
 * Everywhere this account can go, filtered by what has been typed.
 *
 * Order is the desktop's and is deliberate: conversations, then channels, then
 * servers. A person is what somebody is most often looking for, and a server is
 * the coarsest thing on the list - it is one more keystroke away from its own
 * channels, which are already here.
 *
 * A blank term lists everything rather than nothing. The sheet opens onto the
 * whole map, which is what makes it usable before anybody has decided what to
 * type.
 */
fun switchTargets(
    servers: List<ServerWithRole>,
    channels: Map<String, List<Channel>>,
    directs: List<DirectChannel>,
    query: String,
): List<SwitchTarget> {
    val all = mutableListOf<SwitchTarget>()

    for (direct in directs) {
        all += SwitchTarget(
            id = direct.channelId,
            label = direct.participant.label,
            hint = "Conversation",
            kind = SwitchKind.DIRECT,
        )
    }

    // In the rail's own order, so the list reads the way the drawer does.
    for (server in servers) {
        for (channel in channels[server.id].orEmpty()) {
            all += SwitchTarget(
                id = channel.id,
                label = channel.name,
                // The server's name rather than the word "Channel": with every
                // server's channels in one list, two `#general`s are otherwise
                // two identical rows.
                hint = if (channel.type == ChannelType.VOICE) {
                    "Voice · ${server.name}"
                } else {
                    server.name
                },
                kind = if (channel.type == ChannelType.VOICE) {
                    SwitchKind.VOICE_CHANNEL
                } else {
                    SwitchKind.TEXT_CHANNEL
                },
                serverId = server.id,
            )
        }
    }

    for (server in servers) {
        all += SwitchTarget(
            id = server.id,
            label = server.name,
            hint = "Server",
            kind = SwitchKind.SERVER,
        )
    }

    val needle = query.trim().lowercase()
    if (needle.isEmpty()) return all
    return all.filter { it.label.lowercase().contains(needle) }
}

/** The icon a row carries, which is the only thing that says what kind it is. */
fun switchIcon(kind: SwitchKind): Int = when (kind) {
    SwitchKind.DIRECT -> BetweenUsIcons.Message
    SwitchKind.TEXT_CHANNEL -> BetweenUsIcons.Hash
    SwitchKind.VOICE_CHANNEL -> BetweenUsIcons.Speaker
    SwitchKind.SERVER -> BetweenUsIcons.Compass
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuickSwitcherSheet(
    servers: List<ServerWithRole>,
    channels: Map<String, List<Channel>>,
    directs: List<DirectChannel>,
    onGo: (SwitchTarget) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var query by remember { mutableStateOf("") }
    val targets = remember(servers, channels, directs, query) {
        switchTargets(servers, channels, directs, query)
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding()) {
            BetweenUsField(
                label = "Go to",
                value = query,
                onValueChange = { query = it },
                placeholder = "A conversation, channel or server",
                imeAction = ImeAction.Go,
                modifier = Modifier.padding(horizontal = 20.dp),
            )

            if (targets.isEmpty()) {
                EmptyState(
                    icon = BetweenUsIcons.Search,
                    title = "Nothing matches that",
                    detail = "Try part of a name.",
                )
            } else {
                LazyColumn(Modifier.heightIn(max = 420.dp).padding(bottom = 16.dp)) {
                    items(targets, key = { it.key }) { target ->
                        ListRow(
                            title = target.label,
                            subtitle = target.hint,
                            leading = { BetweenUsIcon(switchIcon(target.kind)) },
                            onClick = {
                                onGo(target)
                                onDismiss()
                            },
                        )
                    }
                }
            }
        }
    }
}
