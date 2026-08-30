package com.aatech.betweenus.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import com.aatech.betweenus.core.crypto.BackupSecret
import com.aatech.betweenus.core.crypto.E2ee
import com.aatech.betweenus.core.crypto.IdentityStatus
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.PublicUser
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.ui.components.Avatar
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.SectionLabel
import kotlinx.coroutines.launch

/**
 * Dedicated Account & Security Sub-Page.
 *
 * Handles avatar customization, profile display name, account password changes,
 * end-to-end encryption keys, recovery passphrase sealing, and password recovery toggles.
 */
@Composable
fun AccountSecurityScreen(
    user: PublicUser,
    onBack: () -> Unit,
    onPrivacy: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val identity by E2ee.status.collectAsState()

    var displayName by remember { mutableStateOf(user.displayName) }
    var note by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var passphrase by remember { mutableStateOf("") }
    var keepPasswordRecovery by remember { mutableStateOf(true) }
    var byPassword by remember { mutableStateOf<Boolean?>(null) }
    var currentPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }

    LaunchedEffect(identity) {
        byPassword = runCatching { E2ee.passwordRecoveryEnabled() }.getOrNull()
    }

    fun act(block: suspend () -> Unit) {
        scope.launch {
            busy = true
            note = runCatching { block() }.exceptionOrNull()?.message
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
                text = "Account & Security",
                style = MaterialTheme.typography.titleLargeEmphasized,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
        }

        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 40.dp)) {
            // --- Profile Header ---
            Row(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Avatar(
                    id = user.id,
                    label = user.label,
                    url = user.avatarUrl?.let { Endpoint.absolute(it) },
                    size = 56.dp,
                )
                Column {
                    Text(
                        text = user.label,
                        style = MaterialTheme.typography.titleMediumEmphasized,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = "@${user.username} · ${user.email}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            PicturePicker(
                label = "avatar",
                canClear = user.avatarUrl != null,
                onPicked = { url -> Session.updateUser(BetweenUsApi.setAvatar(url)) },
                onClear = { Session.updateUser(BetweenUsApi.setAvatar(null)) },
            )

            SectionLabel("Profile Information")
            Column(Modifier.padding(horizontal = 12.dp)) {
                BetweenUsField(
                    label = "Display name",
                    value = displayName,
                    onValueChange = { displayName = it; note = null },
                    placeholder = user.username,
                    imeAction = ImeAction.Done,
                    enabled = !busy,
                )
                Spacer(Modifier.height(10.dp))
                BetweenUsButton(
                    text = "Save Profile",
                    busy = busy,
                    enabled = displayName.isNotBlank() && displayName != user.displayName,
                    onClick = {
                        act {
                            Session.updateUser(
                                BetweenUsApi.updateAccount(displayName.trim(), null, null),
                            )
                        }
                    },
                )
            }

            // --- Privacy & Safety Navigation ---
            SectionLabel("Privacy & Safety")
            ListRow(
                title = "Privacy & Safety Settings",
                subtitle = "Manage blocked people and message history",
                leading = { BetweenUsIcon(BetweenUsIcons.Block) },
                trailing = { BetweenUsIcon(BetweenUsIcons.ChevronRight, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
                onClick = onPrivacy,
            )

            // --- Password ---
            SectionLabel("Password")
            Column(Modifier.padding(horizontal = 12.dp)) {
                BetweenUsField(
                    label = "Current password",
                    value = currentPassword,
                    onValueChange = { currentPassword = it; note = null },
                    placeholder = "Your password now",
                    secret = true,
                    enabled = !busy,
                )
                Spacer(Modifier.height(10.dp))
                BetweenUsField(
                    label = "New password",
                    value = newPassword,
                    onValueChange = { newPassword = it; note = null },
                    placeholder = "At least 8 characters",
                    secret = true,
                    imeAction = ImeAction.Done,
                    enabled = !busy,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "Changing your password signs every other active session out and re-seals your identity backup.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(10.dp))
                BetweenUsButton(
                    text = "Change password",
                    busy = busy,
                    enabled = currentPassword.isNotBlank() && newPassword.length >= 8,
                    onClick = {
                        act {
                            BetweenUsApi.changePassword(currentPassword, newPassword)
                            E2ee.rewrapBackupForPassword(newPassword)
                            currentPassword = ""
                            newPassword = ""
                        }
                    },
                )
            }

            // --- End-to-End Encryption ---
            SectionLabel("End-to-End Encryption")
            Column(Modifier.padding(horizontal = 16.dp)) {
                Text(
                    text = when (val state = identity) {
                        is IdentityStatus.Ready -> when {
                            state.backedUp ->
                                "This device holds your account key, and it is backed up. Signing in elsewhere will restore your conversation history."
                            state.provisional ->
                                "This device could not open the account key, so it made one of its own. Sign out and back in with your account password to recover full history."
                            else ->
                                "This device has a key of its own, and no backup. Set a recovery passphrase to seal your identity key across devices."
                        }
                        IdentityStatus.Revoked ->
                            "This device was revoked from another session. Older cached messages remain readable, but new messages are not encrypted for it."
                        IdentityStatus.Absent -> "No identity key present on this device yet."
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                byPassword?.let { on ->
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = if (on) {
                            "Recovery by account password is on: signing in on a new device restores messages automatically."
                        } else {
                            "Recovery by account password is off. A new device requires your custom recovery passphrase."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.height(10.dp))
                BetweenUsField(
                    label = "Recovery passphrase",
                    value = passphrase,
                    onValueChange = { passphrase = it; note = null },
                    placeholder = "Something only you know",
                    secret = true,
                    imeAction = ImeAction.Done,
                    enabled = !busy,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "A passphrase is never sent anywhere in plaintext. Set one if your threat model includes server security.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(4.dp))
                ListRow(
                    title = "Also let my password recover my messages",
                    subtitle = "Leave on for instant sign-ins on new devices. Turn off to require passphrase only.",
                    trailing = {
                        Switch(
                            checked = keepPasswordRecovery,
                            onCheckedChange = { keepPasswordRecovery = it },
                            colors = SwitchDefaults.colors(),
                        )
                    },
                )
                Spacer(Modifier.height(10.dp))
                BetweenUsButton(
                    text = "Seal identity with passphrase",
                    busy = busy,
                    enabled = passphrase.length >= 8,
                    onClick = {
                        act {
                            E2ee.backupIdentity(BackupSecret.passphrase(passphrase))
                            if (!keepPasswordRecovery) E2ee.disablePasswordRecovery()
                            byPassword = keepPasswordRecovery
                            passphrase = ""
                        }
                    },
                )
            }

            note?.let {
                Spacer(Modifier.height(12.dp))
                Notice(it, MaterialTheme.colorScheme.error, Modifier.padding(horizontal = 16.dp))
            }
        }
    }
}
