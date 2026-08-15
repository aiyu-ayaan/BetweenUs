package com.aktech.nexora.feature.servers

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import com.aktech.nexora.core.data.ChannelType
import com.aktech.nexora.core.data.NexoraApi
import com.aktech.nexora.core.store.Workspace
import com.aktech.nexora.ui.components.Chip
import com.aktech.nexora.ui.components.EmptyState
import com.aktech.nexora.ui.components.IconAction
import com.aktech.nexora.ui.components.ListRow
import com.aktech.nexora.ui.components.NexoraButton
import com.aktech.nexora.ui.components.NexoraField
import com.aktech.nexora.ui.components.NexoraIcon
import com.aktech.nexora.ui.components.NexoraIcons
import com.aktech.nexora.ui.components.Notice
import com.aktech.nexora.ui.components.SectionLabel
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Edge
import com.aktech.nexora.ui.theme.Ground
import com.aktech.nexora.ui.theme.Slate100
import com.aktech.nexora.ui.theme.Slate50
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.Surface950
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

    Column(Modifier.fillMaxSize().background(Ground).systemBarsPadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().background(Surface950).padding(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(NexoraIcons.ChevronLeft, "Back", onBack)
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
                icon = NexoraIcons.Compass,
                title = "No server open",
                detail = "Pick one from the rail first.",
            )
            return@Column
        }

        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 32.dp)) {
            SectionLabel("Identity")
            Column(Modifier.padding(horizontal = 12.dp)) {
                NexoraField(
                    label = "Name",
                    value = name,
                    onValueChange = { name = it; note = null },
                    placeholder = server.name,
                    imeAction = ImeAction.Done,
                    enabled = !busy && server.can("MANAGE_SERVER"),
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "Invite people with the slug ${server.slug}",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate500,
                )
                if (server.can("MANAGE_SERVER")) {
                    Spacer(Modifier.height(12.dp))
                    NexoraButton(
                        text = "Save",
                        busy = busy,
                        enabled = name.isNotBlank() && name != server.name,
                        onClick = {
                            act {
                                NexoraApi.updateServer(server.id, name.trim(), null)
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
                        NexoraIcon(
                            icon = when {
                                channel.isPrivate -> NexoraIcons.Lock
                                channel.type == ChannelType.VOICE -> NexoraIcons.Speaker
                                else -> NexoraIcons.Hash
                            },
                            size = 18.dp,
                        )
                    },
                    trailing = {
                        if (server.can("MANAGE_CHANNEL")) {
                            IconAction(NexoraIcons.Trash, "Delete channel", tint = Danger, onClick = {
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
