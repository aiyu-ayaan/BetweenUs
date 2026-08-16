package com.aktech.nexora.feature.servers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
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
import com.aktech.nexora.core.data.ServerWithRole
import com.aktech.nexora.core.store.Workspace
import com.aktech.nexora.ui.components.Chip
import com.aktech.nexora.ui.components.NexoraButton
import com.aktech.nexora.ui.components.NexoraField
import com.aktech.nexora.ui.components.Notice
import com.aktech.nexora.ui.theme.Accent
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Slate100
import com.aktech.nexora.ui.theme.Slate400
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.Surface700
import com.aktech.nexora.ui.theme.Surface900
import kotlinx.coroutines.launch

/** Create a server, or join one with an invite code somebody sent you. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JoinOrCreateServerSheet(onDismiss: () -> Unit, onDone: (ServerWithRole) -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    var creating by remember { mutableStateOf(true) }
    var value by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Surface900) {
        Column(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(20.dp),
        ) {
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
                    "Paste the invite code somebody sent you. It may expire or run out."
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
                label = if (creating) "Name" else "Invite code",
                value = value,
                onValueChange = { value = it; note = null },
                placeholder = if (creating) "Weekend project" else "kJ3f9aQ2xR1p",
                imeAction = ImeAction.Done,
                enabled = !busy,
            )

            note?.let {
                Spacer(Modifier.height(12.dp))
                Notice(it, Danger)
            }

            Spacer(Modifier.height(16.dp))
            NexoraButton(
                text = if (creating) "Create" else "Join",
                busy = busy,
                enabled = value.isNotBlank(),
                onClick = {
                    scope.launch {
                        busy = true
                        note = runCatching {
                            val server = if (creating) {
                                Workspace.createServer(value.trim())
                            } else {
                                Workspace.joinServer(value.trim())
                            }
                            onDone(server)
                            onDismiss()
                        }.exceptionOrNull()?.message
                        busy = false
                    }
                },
            )
        }
    }
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
