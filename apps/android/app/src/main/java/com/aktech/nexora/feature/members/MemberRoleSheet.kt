package com.aktech.nexora.feature.members

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aktech.nexora.core.data.NexoraApi
import com.aktech.nexora.core.data.ServerMember
import com.aktech.nexora.core.data.ServerRole
import com.aktech.nexora.ui.components.Chip
import com.aktech.nexora.ui.components.NexoraButton
import com.aktech.nexora.ui.components.Notice
import com.aktech.nexora.ui.components.SectionLabel
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Slate100
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.Surface900
import kotlinx.coroutines.launch

/**
 * One member's role, and the permissions granted or denied beyond it.
 *
 * Deny wins over grant, which is the server's rule and is stated here rather
 * than left for somebody to discover: a permission shown as both is shown as
 * denied, because that is what it will actually be.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun MemberRoleSheet(
    member: ServerMember,
    serverId: String,
    onDismiss: () -> Unit,
    onChanged: () -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    var role by remember { mutableStateOf(member.role) }
    var granted by remember { mutableStateOf(member.grantedPermissions.toSet()) }
    var denied by remember { mutableStateOf(member.deniedPermissions.toSet()) }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Surface900) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 20.dp)
                .padding(bottom = 20.dp),
        ) {
            Text(member.label, style = MaterialTheme.typography.titleMedium, color = Slate100)
            Text(
                text = "@${member.username}",
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
            )

            SectionLabel("Role", Modifier.padding(horizontal = 0.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ServerRole.entries.filter { it != ServerRole.OWNER }.forEach { option ->
                    Chip(
                        text = option.name.lowercase(),
                        selected = option == role,
                        onClick = { role = option },
                    )
                }
            }

            SectionLabel("Granted beyond the role", Modifier.padding(horizontal = 0.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PERMISSIONS.forEach { permission ->
                    Chip(
                        text = permission.lowercase().replace('_', ' '),
                        selected = permission in granted,
                        onClick = {
                            granted = if (permission in granted) granted - permission else granted + permission
                            denied = denied - permission
                        },
                    )
                }
            }

            SectionLabel("Denied despite the role", Modifier.padding(horizontal = 0.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PERMISSIONS.forEach { permission ->
                    Chip(
                        text = permission.lowercase().replace('_', ' '),
                        selected = permission in denied,
                        tone = Danger,
                        onClick = {
                            denied = if (permission in denied) denied - permission else denied + permission
                            granted = granted - permission
                        },
                    )
                }
            }

            note?.let {
                Spacer(Modifier.height(12.dp))
                Notice(it, Danger)
            }

            Spacer(Modifier.height(16.dp))
            NexoraButton(
                text = "Save",
                busy = busy,
                onClick = {
                    scope.launch {
                        busy = true
                        note = runCatching {
                            NexoraApi.updateMember(
                                serverId = serverId,
                                userId = member.userId,
                                role = role,
                                granted = granted.toList(),
                                denied = denied.toList(),
                            )
                            onChanged()
                            onDismiss()
                        }.exceptionOrNull()?.message
                        busy = false
                    }
                },
            )
        }
    }
}

/** The set from section 19 of CLAUDE.md; the server is what enforces them. */
private val PERMISSIONS = listOf(
    "VIEW_CHANNEL",
    "SEND_MESSAGE",
    "DELETE_MESSAGE",
    "MANAGE_CHANNEL",
    "MANAGE_MEMBER",
    "MANAGE_ROLE",
    "START_CALL",
    "MANAGE_CALL",
)
