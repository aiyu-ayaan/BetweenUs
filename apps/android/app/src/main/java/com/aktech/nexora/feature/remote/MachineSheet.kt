package com.aktech.nexora.feature.remote

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.aktech.nexora.core.data.NexoraApi
import com.aktech.nexora.core.data.REMOTE_PERMISSIONS
import com.aktech.nexora.core.data.RemoteAuditEntry
import com.aktech.nexora.core.data.RemoteGrant
import com.aktech.nexora.core.data.RemoteMachine
import com.aktech.nexora.core.data.UserSummary
import com.aktech.nexora.core.data.permissionLabel
import com.aktech.nexora.ui.components.Chip
import com.aktech.nexora.ui.components.ListRow
import com.aktech.nexora.ui.components.NexoraButton
import com.aktech.nexora.ui.components.NexoraField
import com.aktech.nexora.ui.components.Notice
import com.aktech.nexora.ui.components.SectionLabel
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Slate100
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.Surface900
import kotlinx.coroutines.launch

/**
 * A machine this account owns: its name, who may reach it, and what they did.
 *
 * These three lived only on the desktop, which put the security decisions about
 * remote access on one device and the access itself on every device. Granting
 * somebody control of a computer is exactly the decision worth being able to
 * take back from wherever you are standing - and reading the audit trail is
 * worth even more from there, because the reason to read it is usually that
 * something has happened.
 *
 * Nothing here is trusted to the UI. The gateway checks ownership on every one
 * of these calls; this only avoids offering what it would refuse.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun MachineSheet(
    machine: RemoteMachine,
    onDismiss: () -> Unit,
    onChanged: () -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    var name by remember(machine.id) { mutableStateOf(machine.name) }
    var grants by remember(machine.id) { mutableStateOf<List<RemoteGrant>>(emptyList()) }
    var audit by remember(machine.id) { mutableStateOf<List<RemoteAuditEntry>>(emptyList()) }
    var query by remember { mutableStateOf("") }
    var found by remember { mutableStateOf<List<UserSummary>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    var confirmingRemoval by remember { mutableStateOf(false) }

    LaunchedEffect(machine.id) {
        grants = runCatching { NexoraApi.machineGrants(machine.id) }.getOrDefault(emptyList())
        audit = runCatching { NexoraApi.machineAudit(machine.id) }.getOrDefault(emptyList())
    }

    // Typing a name searches for it, after a pause: a request per keystroke is
    // a request per keystroke.
    LaunchedEffect(query) {
        val wanted = query.trim()
        if (wanted.length < 2) {
            found = emptyList()
            return@LaunchedEffect
        }
        kotlinx.coroutines.delay(250)
        found = runCatching { NexoraApi.searchUsers(wanted) }
            .getOrDefault(emptyList())
            .filter { it.id != machine.ownerId && grants.none { held -> held.userId == it.id } }
    }

    /** Grants, changes or revokes, and re-reads the trail - this is in it. */
    fun set(userId: String, permissions: List<String>) {
        scope.launch {
            busy = true
            note = runCatching {
                grants = NexoraApi.setMachineGrant(machine.id, userId, permissions)
                audit = runCatching { NexoraApi.machineAudit(machine.id) }.getOrDefault(audit)
                query = ""
            }.exceptionOrNull()?.message
            busy = false
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Surface900) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .heightIn(max = 640.dp)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 20.dp),
        ) {
            Text(machine.name, style = MaterialTheme.typography.titleMedium, color = Slate100)
            Text(
                text = "${machine.platform} · ${if (machine.online) "online" else "offline"}",
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
            )

            SectionLabel("Name", Modifier.padding(horizontal = 0.dp))
            NexoraField(
                label = "What this machine is called",
                value = name,
                onValueChange = { name = it; note = null },
                placeholder = machine.name,
                imeAction = ImeAction.Done,
                enabled = !busy,
            )
            Spacer(Modifier.height(8.dp))
            NexoraButton(
                text = "Rename",
                busy = busy,
                enabled = name.isNotBlank() && name != machine.name,
                onClick = {
                    scope.launch {
                        busy = true
                        note = runCatching {
                            NexoraApi.renameMachine(machine.id, name.trim())
                            onChanged()
                        }.exceptionOrNull()?.message
                        busy = false
                    }
                },
            )

            SectionLabel("Who may reach it", Modifier.padding(horizontal = 0.dp))
            if (grants.isEmpty()) {
                Text(
                    text = "Nobody but you. Access is granted per person and per permission, " +
                        "and taking every permission away is how it is revoked.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate500,
                )
            }

            grants.forEach { grant ->
                Spacer(Modifier.height(12.dp))
                Text("@${grant.username}", style = MaterialTheme.typography.bodyMedium, color = Slate100)
                grant.expiresAt?.let {
                    Text(
                        text = "Lapses ${it.take(10)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate500,
                    )
                }
                Spacer(Modifier.height(6.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    REMOTE_PERMISSIONS.forEach { permission ->
                        val held = permission in grant.permissions
                        Chip(
                            text = permissionLabel(permission).removePrefix("remote "),
                            selected = held,
                            onClick = {
                                val next = if (held) {
                                    grant.permissions - permission
                                } else {
                                    grant.permissions + permission
                                }
                                set(grant.userId, next)
                            },
                        )
                    }
                    Chip(
                        text = "revoke",
                        tone = Danger,
                        onClick = { set(grant.userId, emptyList()) },
                    )
                }
            }

            SectionLabel("Grant access", Modifier.padding(horizontal = 0.dp))
            NexoraField(
                label = "Find somebody",
                value = query,
                onValueChange = { query = it; note = null },
                placeholder = "A username",
                imeAction = ImeAction.Search,
                enabled = !busy,
            )
            found.forEach { user ->
                ListRow(
                    title = user.label,
                    subtitle = "@${user.username}",
                    // Viewing only, to start with. Control is a second decision
                    // and should be taken deliberately rather than handed over
                    // by the same tap that granted a look at the screen.
                    trailing = { Chip("give view access") },
                    onClick = { set(user.id, listOf("REMOTE_VIEW")) },
                )
            }

            note?.let {
                Spacer(Modifier.height(12.dp))
                Notice(it, Danger)
            }

            SectionLabel("What has happened", Modifier.padding(horizontal = 0.dp))
            if (audit.isEmpty()) {
                Text(
                    text = "Nothing yet.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate500,
                )
            }
            audit.take(30).forEach { entry ->
                ListRow(
                    title = entry.action.lowercase().replace('.', ' '),
                    subtitle = listOfNotNull(
                        entry.actorUsername?.let { "@$it" },
                        entry.createdAt.take(16).replace('T', ' '),
                    ).joinToString(" · "),
                )
            }

            SectionLabel("Removing", Modifier.padding(horizontal = 0.dp))
            Text(
                text = "Removing this machine forgets it and every grant on it. Its agent has " +
                    "to enrol again before anybody can reach it.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
            )
            Spacer(Modifier.height(10.dp))
            if (confirmingRemoval) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip(
                        text = "Yes, remove it",
                        tone = Danger,
                        onClick = {
                            scope.launch {
                                busy = true
                                note = runCatching {
                                    NexoraApi.removeMachine(machine.id)
                                    onChanged()
                                    onDismiss()
                                }.exceptionOrNull()?.message
                                busy = false
                            }
                        },
                    )
                    Chip(text = "Keep it", onClick = { confirmingRemoval = false })
                }
            } else {
                Chip(text = "Remove this machine", tone = Danger, onClick = { confirmingRemoval = true })
            }
        }
    }
}
