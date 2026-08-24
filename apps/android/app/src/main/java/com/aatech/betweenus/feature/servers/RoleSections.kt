package com.aatech.betweenus.feature.servers

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.ASSIGNABLE_PERMISSIONS
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.ServerCustomRole
import com.aatech.betweenus.core.data.permissionLabel
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate500
import kotlinx.coroutines.launch

/**
 * A server's own roles.
 *
 * These are additive on top of the five built-in rungs, not a replacement for
 * them: the built-in role is still the hierarchy - who may edit whom, who may
 * hand out what - and one of these carries a name, a colour and a bundle of
 * permissions. Members could already be given one from this client; there was
 * no way to make one, which is half a feature.
 */
@Composable
fun RoleSection(serverId: String, mayManage: Boolean, onNote: (String?) -> Unit) {
    val scope = rememberCoroutineScope()

    var roles by remember(serverId) { mutableStateOf<List<ServerCustomRole>?>(null) }
    var editing by remember { mutableStateOf<ServerCustomRole?>(null) }
    var creating by remember { mutableStateOf(false) }

    suspend fun reload() {
        roles = runCatching { BetweenUsApi.serverRoles(serverId) }.getOrNull().orEmpty()
    }

    LaunchedEffect(serverId) { reload() }

    SectionLabel("Roles")

    val list = roles
    when {
        list == null -> ListRow(title = "Loading roles", leading = { BetweenUsIcon(BetweenUsIcons.Shield) })
        list.isEmpty() -> ListRow(
            title = "No roles yet",
            subtitle = "A role is a name, a colour and a set of permissions",
            leading = { BetweenUsIcon(BetweenUsIcons.Shield) },
        )
        else -> list.forEach { role ->
            ListRow(
                title = role.name,
                subtitle = describe(role),
                titleColor = role.colour?.let { parseColour(it) } ?: Slate100,
                leading = {
                    BetweenUsIcon(
                        icon = BetweenUsIcons.Shield,
                        tint = role.colour?.let { parseColour(it) } ?: Slate500,
                    )
                },
                trailing = {
                    if (mayManage) {
                        IconAction(BetweenUsIcons.Settings, "Edit this role", onClick = { editing = role })
                    }
                },
                onClick = if (mayManage) ({ editing = role }) else null,
            )
        }
    }

    if (mayManage) {
        Column(Modifier.padding(horizontal = 16.dp)) {
            Spacer(Modifier.height(8.dp))
            Chip(text = "New role", onClick = { creating = true })
        }
    }

    if (creating || editing != null) {
        RoleSheet(
            serverId = serverId,
            role = editing,
            onDismiss = { creating = false; editing = null },
            onChanged = { scope.launch { reload() } },
            onNote = onNote,
        )
    }
}

/** "3 members - 4 permissions", which is what a list of roles is asked at a glance. */
private fun describe(role: ServerCustomRole): String {
    val members = "${role.memberCount} " + if (role.memberCount == 1) "member" else "members"
    val permissions = "${role.permissions.size} " +
        if (role.permissions.size == 1) "permission" else "permissions"
    return "$members - $permissions"
}

/**
 * Making a role, or changing one. A null [role] is a new one.
 *
 * Deleting is here rather than beside the row for the usual reason: the button
 * that destroys something belongs on the screen that shows what it is, not next
 * to a name in a list somebody is scrolling past.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun RoleSheet(
    serverId: String,
    role: ServerCustomRole?,
    onDismiss: () -> Unit,
    onChanged: () -> Unit,
    onNote: (String?) -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    var name by remember(role?.id) { mutableStateOf(role?.name.orEmpty()) }
    var colour by remember(role?.id) { mutableStateOf(role?.colour) }
    var held by remember(role?.id) { mutableStateOf(role?.permissions.orEmpty().toSet()) }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    var confirmingDelete by remember { mutableStateOf(false) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 20.dp)
                .padding(bottom = 20.dp),
        ) {
            Text(
                text = if (role == null) "New role" else "Edit ${role.name}",
                style = MaterialTheme.typography.titleMedium,
                color = Slate100,
            )

            Spacer(Modifier.height(16.dp))
            BetweenUsField(
                label = "Name",
                value = name,
                onValueChange = { name = it; note = null },
                placeholder = "Moderators",
                imeAction = ImeAction.Done,
                enabled = !busy,
            )

            SectionLabel("Colour", Modifier.padding(horizontal = 0.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                // A short palette rather than a colour picker: a role's colour
                // has to stay legible on this background, and every one of
                // these does.
                for (option in ROLE_COLOURS) {
                    Swatch(
                        colour = option,
                        selected = option == colour,
                        onClick = { colour = if (option == colour) null else option },
                    )
                }
            }

            SectionLabel("Permissions", Modifier.padding(horizontal = 0.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (permission in ASSIGNABLE_PERMISSIONS) {
                    Chip(
                        text = permissionLabel(permission),
                        selected = permission in held,
                        onClick = {
                            held = if (permission in held) held - permission else held + permission
                        },
                    )
                }
            }

            note?.let {
                Spacer(Modifier.height(12.dp))
                Notice(it, Danger)
            }

            Spacer(Modifier.height(16.dp))
            BetweenUsButton(
                text = if (role == null) "Create" else "Save",
                busy = busy,
                enabled = name.isNotBlank(),
                onClick = {
                    scope.launch {
                        busy = true
                        note = runCatching {
                            if (role == null) {
                                BetweenUsApi.createServerRole(serverId, name.trim(), colour, held.toList())
                            } else {
                                BetweenUsApi.updateServerRole(
                                    serverId = serverId,
                                    roleId = role.id,
                                    name = name.trim(),
                                    // Null means "leave it": clearing a colour
                                    // is sent as the empty string, which the
                                    // server reads as no colour.
                                    colour = colour ?: "",
                                    permissions = held.toList(),
                                )
                            }
                            onChanged()
                            onDismiss()
                        }.exceptionOrNull()?.message
                        busy = false
                    }
                },
            )

            if (role != null) {
                Spacer(Modifier.height(12.dp))
                if (confirmingDelete) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Chip(
                            text = "Yes, delete it",
                            tone = Danger,
                            onClick = {
                                scope.launch {
                                    busy = true
                                    val failure = runCatching {
                                        BetweenUsApi.deleteServerRole(serverId, role.id)
                                        onChanged()
                                        onDismiss()
                                    }.exceptionOrNull()?.message
                                    onNote(failure)
                                    note = failure
                                    busy = false
                                }
                            },
                        )
                        Chip(text = "Keep it", onClick = { confirmingDelete = false })
                    }
                } else {
                    Chip(
                        text = "Delete this role",
                        tone = Danger,
                        onClick = { confirmingDelete = true },
                    )
                }
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "Deleting a role takes it off everyone who holds it. " +
                        "It does not remove them from the server.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate500,
                )
            }
        }
    }
}

@Composable
private fun Swatch(colour: String, selected: Boolean, onClick: () -> Unit) {
    Chip(
        text = if (selected) "selected" else " ",
        tone = parseColour(colour),
        selected = selected,
        onClick = onClick,
        modifier = Modifier.width(if (selected) 96.dp else 44.dp),
    )
}

/**
 * The palette a role may be given.
 *
 * Discord offers a full picker; this does not, because a role's colour is drawn
 * as a name on a dark panel and half of a picker's range is unreadable there.
 */
private val ROLE_COLOURS = listOf(
    "#7c5cff",
    "#3fd68c",
    "#f5b83d",
    "#ff5d5d",
    "#4dd0e1",
    "#ff8fc7",
)

/** `#rrggbb` as a colour, and the default when it is anything else. */
private fun parseColour(value: String): Color =
    runCatching { Color(android.graphics.Color.parseColor(value)) }.getOrDefault(Slate100)
