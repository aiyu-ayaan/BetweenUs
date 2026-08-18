package com.aktech.nexora.feature.servers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
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
import com.aktech.nexora.core.data.InviteLink
import com.aktech.nexora.core.data.InvitePreview
import com.aktech.nexora.core.data.NexoraApi
import com.aktech.nexora.core.data.ServerWithRole
import com.aktech.nexora.core.store.Workspace
import com.aktech.nexora.ui.components.Avatar
import com.aktech.nexora.ui.components.Chip
import com.aktech.nexora.ui.components.NexoraButton
import com.aktech.nexora.ui.components.NexoraField
import com.aktech.nexora.ui.components.Notice
import com.aktech.nexora.ui.theme.Accent
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Slate100
import com.aktech.nexora.ui.theme.Slate400
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.StatusOffline
import com.aktech.nexora.ui.theme.StatusOnline
import com.aktech.nexora.ui.theme.Surface700
import com.aktech.nexora.ui.theme.Surface900
import kotlinx.coroutines.launch

/**
 * Create a server, or join one with an invite somebody sent you.
 *
 * A code is never spent on the strength of somebody having pasted it. The link
 * or the code is looked up first and answered with a card - whose server, how
 * many people are in it, how many of them are here - and joining is a decision
 * made against that. The desktop's `InviteDialog` shows the same card for the
 * same reason.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JoinOrCreateServerSheet(onDismiss: () -> Unit, onDone: (ServerWithRole) -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    var creating by remember { mutableStateOf(true) }
    var value by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    /** The invite being decided about. Null until a code has been looked up. */
    var preview by remember { mutableStateOf<InvitePreview?>(null) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Surface900) {
        Column(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(20.dp),
        ) {
            val invite = preview
            if (invite != null) {
                InviteCard(
                    invite = invite,
                    busy = busy,
                    note = note,
                    onBack = { preview = null; note = null },
                    onAccept = {
                        scope.launch {
                            busy = true
                            note = runCatching {
                                // Already a member: opening it is what the
                                // server would have done anyway, without
                                // spending a use of the invite.
                                val server = if (invite.member) {
                                    Workspace.server(invite.serverId)
                                        ?: Workspace.joinServer(invite.code)
                                } else {
                                    Workspace.joinServer(invite.code)
                                }
                                onDone(server)
                                onDismiss()
                            }.exceptionOrNull()?.message
                            busy = false
                        }
                    },
                )
                return@Column
            }

            Text(
                text = if (creating) "Create a server" else "Join a server",
                style = MaterialTheme.typography.titleMedium,
                color = Slate100,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = if (creating) {
                    "You will be its owner. Everything else - channels, roles, who is in it - comes after."
                } else {
                    "Paste the invite link or the code somebody sent you. Either works."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = Slate500,
            )

            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("Create", selected = creating, onClick = { creating = true; note = null })
                Chip("Join", selected = !creating, onClick = { creating = false; note = null })
            }

            Spacer(Modifier.height(16.dp))
            NexoraField(
                label = if (creating) "Name" else "Invite link or code",
                value = value,
                onValueChange = { value = it; note = null },
                placeholder = if (creating) "Weekend project" else "https://nexora.example.com/invite/kJ3f9aQ2",
                imeAction = ImeAction.Done,
                enabled = !busy,
            )

            note?.let {
                Spacer(Modifier.height(12.dp))
                Notice(it, Danger)
            }

            Spacer(Modifier.height(16.dp))
            NexoraButton(
                text = if (creating) "Create" else "Continue",
                busy = busy,
                enabled = value.isNotBlank(),
                onClick = {
                    scope.launch {
                        busy = true
                        note = runCatching {
                            if (creating) {
                                val server = Workspace.createServer(value.trim())
                                onDone(server)
                                onDismiss()
                            } else {
                                val code = InviteLink.codeIn(value)
                                    ?: error("That is not an invite link or code")
                                preview = NexoraApi.invitePreview(code)
                            }
                        }.exceptionOrNull()?.message
                        busy = false
                    }
                },
            )
        }
    }
}

/** The card an invite is accepted from: whose server, and how busy it is. */
@Composable
private fun InviteCard(
    invite: InvitePreview,
    busy: Boolean,
    note: String?,
    onBack: () -> Unit,
    onAccept: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "You have been invited to join",
            style = MaterialTheme.typography.bodySmall,
            color = Slate500,
        )
        Spacer(Modifier.height(12.dp))
        Avatar(
            id = invite.serverId,
            label = invite.name,
            url = invite.iconUrl,
            size = 72.dp,
            shape = RoundedCornerShape(20.dp),
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = invite.name,
            style = MaterialTheme.typography.titleMedium,
            color = Slate100,
        )
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            // The online half is left out entirely when presence could not be
            // reached, rather than shown as zero: that would describe a busy
            // server as an empty one because a service was restarting.
            invite.onlineCount?.let { online ->
                Dot(StatusOnline)
                Spacer(Modifier.width(6.dp))
                Text("$online online", style = MaterialTheme.typography.bodySmall, color = Slate400)
                Spacer(Modifier.width(14.dp))
            }
            Dot(StatusOffline)
            Spacer(Modifier.width(6.dp))
            Text(
                text = "${invite.memberCount} " +
                    if (invite.memberCount == 1) "member" else "members",
                style = MaterialTheme.typography.bodySmall,
                color = Slate400,
            )
        }

        note?.let {
            Spacer(Modifier.height(12.dp))
            Notice(it, Danger)
        }

        Spacer(Modifier.height(20.dp))
        NexoraButton(
            text = if (invite.member) "Open server" else "Accept invite",
            busy = busy,
            onClick = onAccept,
        )
        Spacer(Modifier.height(8.dp))
        Chip(text = "Not now", onClick = onBack)
    }
}

@Composable
private fun Dot(colour: androidx.compose.ui.graphics.Color) {
    Spacer(Modifier.size(8.dp).background(colour, CircleShape))
}

/**
 * Create a channel.
 *
 * A private channel is visible only to the people on its allowlist, and the
 * creator is always on it - so leaving the list empty makes a channel only its
 * creator can open, which is a real thing to want and not a mistake.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateChannelSheet(server: ServerWithRole, onDismiss: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    var name by remember { mutableStateOf("") }
    var voice by remember { mutableStateOf(false) }
    var private by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Surface900) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(20.dp)) {
            Text(
                text = "Create a channel in ${server.name}",
                style = MaterialTheme.typography.titleMedium,
                color = Slate100,
            )

            Spacer(Modifier.height(16.dp))
            NexoraField(
                label = "Name",
                value = name,
                onValueChange = { name = it; note = null },
                placeholder = "general",
                imeAction = ImeAction.Done,
                enabled = !busy,
            )

            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("Text", selected = !voice, onClick = { voice = false })
                Chip("Voice", selected = voice, onClick = { voice = true })
            }

            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Private", style = MaterialTheme.typography.bodyLarge, color = Slate100)
                    Text(
                        text = "Only people added to it can see it. You are always one of them.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate500,
                    )
                }
                Switch(
                    checked = private,
                    onCheckedChange = { private = it },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = Slate100,
                        checkedTrackColor = Accent,
                        uncheckedTrackColor = Surface700,
                        uncheckedBorderColor = Surface700,
                        uncheckedThumbColor = Slate400,
                    ),
                )
            }

            note?.let {
                Spacer(Modifier.height(12.dp))
                Notice(it, Danger)
            }

            Spacer(Modifier.height(16.dp))
            NexoraButton(
                text = "Create",
                busy = busy,
                enabled = name.isNotBlank(),
                onClick = {
                    scope.launch {
                        busy = true
                        note = runCatching {
                            Workspace.createChannel(
                                serverId = server.id,
                                name = name.trim(),
                                type = if (voice) ChannelType.VOICE else ChannelType.TEXT,
                                isPrivate = private,
                                memberIds = emptyList(),
                            )
                            onDismiss()
                        }.exceptionOrNull()?.message
                        busy = false
                    }
                },
            )
        }
    }
}
