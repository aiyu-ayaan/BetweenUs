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
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.crypto.BackupSecret
import com.aatech.betweenus.core.crypto.E2ee
import com.aatech.betweenus.core.crypto.IdentityStatus
import com.aatech.betweenus.core.data.ABOUT_MAX_LENGTH
import com.aatech.betweenus.core.data.DEFAULT_ABOUT
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.LastSeenVisibility
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.Pictures
import com.aatech.betweenus.core.data.PublicUser
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.ui.components.AvatarWithStatus
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.ProfileCover
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
) {
    val scope = rememberCoroutineScope()
    val identity by E2ee.status.collectAsState()

    var displayName by remember { mutableStateOf(user.displayName) }
    var about by remember { mutableStateOf(user.about) }
    /** Your own chosen status, for the dot on the header. Live, so a change
        made on the Settings screen behind this one is already reflected. */
    val presence by Presence.self.collectAsState()
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
            // --- Cover band ---
            //
            // The picture and the preview at once: what is below it is the row
            // that edits everything else about the profile, so the band reads
            // as the top of that card rather than as decoration above it.
            ProfileCover(
                coverUrl = user.coverUrl?.let { Endpoint.absolute(it) },
                height = 120.dp,
            )

            // --- Profile Header ---
            Row(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                // The same dot the Settings screen draws, on the screen that
                // edits the rest of the profile - so the picture, the name, the
                // about line and whether you are showing as here are one card
                // rather than two screens apart.
                AvatarWithStatus(
                    id = user.id,
                    label = user.label,
                    url = user.avatarUrl?.let { Endpoint.absolute(it) },
                    status = presence.wire,
                    size = 56.dp,
                    ring = MaterialTheme.colorScheme.background,
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
                    if (user.about.isNotBlank()) {
                        Text(
                            text = user.about,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                }
            }

            PicturePicker(
                label = "avatar",
                canClear = user.avatarUrl != null,
                onPicked = { url -> Session.updateUser(BetweenUsApi.setAvatar(url)) },
                onClear = { Session.updateUser(BetweenUsApi.setAvatar(null)) },
            )

            Spacer(Modifier.height(12.dp))

            PicturePicker(
                label = "cover",
                canClear = user.coverUrl != null,
                aspect = Pictures.COVER_ASPECT,
                maxWidth = Pictures.COVER_WIDTH,
                onPicked = { url -> Session.updateUser(BetweenUsApi.setCover(url)) },
                onClear = { Session.updateUser(BetweenUsApi.setCover(null)) },
            )

            SectionLabel("Last seen")
            LastSeenPrivacy(chosen = user.lastSeenVisibility, enabled = !busy, onFail = { note = it })

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
                BetweenUsField(
                    label = "About",
                    value = about,
                    // Cut by code point, so an emoji is one character to the
                    // person typing it - and so the count here can never exceed
                    // the server's, which measures UTF-16 units.
                    onValueChange = { text ->
                        val points = text.codePoints().toArray()
                        about = if (points.size <= ABOUT_MAX_LENGTH) {
                            text
                        } else {
                            String(points, 0, ABOUT_MAX_LENGTH)
                        }
                        note = null
                    },
                    placeholder = DEFAULT_ABOUT,
                    imeAction = ImeAction.Done,
                    enabled = !busy,
                )
                Spacer(Modifier.height(4.dp))
                val left = ABOUT_MAX_LENGTH - about.codePointCount(0, about.length)
                Text(
                    // The count appears only in the last quarter, which is
                    // where somebody is deciding what to leave out. A counter
                    // that is always there is a number nobody reads.
                    text = if (left <= ABOUT_MAX_LENGTH / 4) {
                        "$left left · shown on your profile to anyone who can see your name"
                    } else {
                        "Shown on your profile to anyone who can see your name."
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(10.dp))
                BetweenUsButton(
                    text = "Save Profile",
                    busy = busy,
                    // An empty about line is a value - "draw nothing under my
                    // name" - so only the display name has a blank to refuse.
                    enabled = displayName.isNotBlank() &&
                        (displayName != user.displayName || about != user.about),
                    onClick = {
                        act {
                            Session.updateUser(
                                BetweenUsApi.updateAccount(
                                    displayName.trim(),
                                    null,
                                    null,
                                    about.trim(),
                                ),
                            )
                        }
                    },
                )
            }

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

/**
 * Who may see when you were last here.
 *
 * Saved on the press rather than behind the Save Profile button below it: this
 * is a switch and not a field being edited, and a privacy switch that needs a
 * second press to take effect is one people believe they have set when they
 * have not.
 *
 * The note under the row is the whole reason it is a row of chips and not a
 * three-item dropdown. `NOBODY` is reciprocal - choosing it costs you everyone
 * else's last seen too - and a rule somebody only discovers by losing something
 * is a rule they experience as a bug.
 */
@Composable
private fun LastSeenPrivacy(
    chosen: LastSeenVisibility,
    enabled: Boolean,
    onFail: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }

    Column(Modifier.padding(horizontal = 16.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LastSeenVisibility.entries.forEach { option ->
                FilterChip(
                    selected = option == chosen,
                    enabled = enabled && !saving,
                    onClick = {
                        if (option == chosen) return@FilterChip
                        saving = true
                        scope.launch {
                            try {
                                Session.updateUser(BetweenUsApi.setLastSeenVisibility(option))
                            } catch (error: Exception) {
                                onFail(error.message ?: "That could not be saved")
                            } finally {
                                saving = false
                            }
                        }
                    },
                    label = { Text(option.label) },
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            text = chosen.note,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = "This is not the same as Invisible. Invisible hides that you are here now; " +
                "this decides who may read when you were last here at all.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
