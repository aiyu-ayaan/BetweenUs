package com.aatech.betweenus.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.crypto.BackupSecret
import com.aatech.betweenus.core.crypto.E2ee
import com.aatech.betweenus.core.crypto.IdentityStatus
import android.content.Intent
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.NotificationPreferences
import com.aatech.betweenus.core.data.PresenceStatus
import com.aatech.betweenus.core.data.PublicUser
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.feature.voice.AudioPrefs
import com.aatech.betweenus.feature.voice.CallAudio
import com.aatech.betweenus.feature.voice.inputLabel
import com.aatech.betweenus.feature.voice.rememberCallDevices
import com.aatech.betweenus.feature.voice.routeLabel
import com.aatech.betweenus.feature.voice.CallTones
import com.aatech.betweenus.feature.voice.VoiceEngine
import com.aatech.betweenus.core.store.LastPlace
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.feature.auth.ServerSheet
import com.aatech.betweenus.ui.components.Avatar
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.theme.Accent
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Edge
import com.aatech.betweenus.ui.theme.Ground
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate50
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.StatusOnline
import com.aatech.betweenus.ui.theme.Surface700
import com.aatech.betweenus.ui.theme.Surface950
import kotlinx.coroutines.launch

/**
 * Account, presence, encryption, notifications, permissions, deployment.
 *
 * The port of `apps/desktop/src/features/settings/UserSettings.tsx`, plus the
 * one section a phone needs that a desktop does not: what Android has been
 * asked for and what it said.
 */
@Composable
fun SettingsScreen(
    user: PublicUser,
    onBack: () -> Unit,
    onServerSettings: () -> Unit,
    onPermissions: () -> Unit,
    onAutoUpdate: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    val identity by E2ee.status.collectAsState()
    val presence by Presence.self.collectAsState()

    var displayName by remember { mutableStateOf(user.displayName) }
    var note by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var pickingServer by remember { mutableStateOf(false) }
    var passphrase by remember { mutableStateOf("") }
    var currentPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var preferences by remember { mutableStateOf<NotificationPreferences?>(null) }
    // A machine setting, not an account one: which room you are sitting in is
    // what decides whether a sound is welcome.
    var callTones by remember { mutableStateOf(CallTones.enabled) }
    // Machine settings, like the tones: the processing that suits a headset in
    // a quiet room is the processing that ruins a call held on a train.
    var mode by remember { mutableStateOf(AudioPrefs.mode) }
    var route by remember { mutableStateOf(AudioPrefs.route) }
    var input by remember { mutableStateOf(AudioPrefs.input) }
    var echoCancellation by remember { mutableStateOf(AudioPrefs.echoCancellation) }
    var noiseSuppression by remember { mutableStateOf(AudioPrefs.noiseSuppression) }
    var autoGainControl by remember { mutableStateOf(AudioPrefs.autoGainControl) }
    // Live, not read once: a headset connected while this screen is open used
    // to leave a list saying there was none.
    val devices by rememberCallDevices()

    LaunchedEffect(Unit) {
        preferences = runCatching { BetweenUsApi.notificationPreferences() }.getOrNull()
    }

    val notifications = rememberPermission(BetweenUsPermissions.NOTIFICATIONS) {}
    val microphone = rememberPermission(BetweenUsPermissions.MICROPHONE) {}
    val camera = rememberPermission(BetweenUsPermissions.CAMERA) {}
    val bluetooth = rememberPermission(BetweenUsPermissions.BLUETOOTH) {}

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
            IconAction(BetweenUsIcons.ChevronLeft, "Back", onBack)
            Text(
                text = "Settings",
                style = MaterialTheme.typography.titleMedium,
                color = Slate50,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
        }
        HorizontalDivider(color = Edge)

        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 40.dp)) {
            // --- account ---
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
                    Text(user.label, style = MaterialTheme.typography.titleMedium, color = Slate50)
                    Text(
                        text = "@${user.username} · ${user.email}",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate500,
                    )
                }
            }

            PicturePicker(
                label = "avatar",
                canClear = user.avatarUrl != null,
                onPicked = { url -> Session.updateUser(BetweenUsApi.setAvatar(url)) },
                onClear = { Session.updateUser(BetweenUsApi.setAvatar(null)) },
                // No preview: the account row above this already draws the
                // avatar, and two of the same picture on one screen reads as a
                // second, different setting.
            )

            SectionLabel("Profile")
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
                    text = "Save",
                    busy = busy,
                    enabled = displayName.isNotBlank() && displayName != user.displayName,
                    onClick = {
                        act {
                            // Fed back into the session: this name is drawn from
                            // there, so saving it and not saying so left the old
                            // one on screen until the next launch.
                            Session.updateUser(
                                BetweenUsApi.updateAccount(displayName.trim(), null, null),
                            )
                        }
                    },
                )
            }

            // --- presence ---
            SectionLabel("Appear as")
            Row(
                modifier = Modifier.padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf(
                    PresenceStatus.ONLINE,
                    PresenceStatus.IDLE,
                    PresenceStatus.DND,
                    PresenceStatus.INVISIBLE,
                ).forEach { option ->
                    Chip(
                        text = option.wire,
                        selected = option == presence,
                        onClick = { Presence.setStatus(option) },
                    )
                }
            }

            // --- encryption ---
            SectionLabel("Encryption")
            Column(Modifier.padding(horizontal = 16.dp)) {
                Text(
                    text = when (val state = identity) {
                        is IdentityStatus.Ready -> if (state.backedUp) {
                            "This device holds your identity key, and the account has a sealed " +
                                "backup of it. Signing in elsewhere will restore your history."
                        } else {
                            "This device holds your identity key, but the account has no backup. " +
                                "Lose this device and the messages sealed for it go with it."
                        }

                        is IdentityStatus.Locked ->
                            "Your messages are locked until this device can open the account backup."

                        IdentityStatus.Revoked ->
                            "This device was revoked from another one. It can still read what it " +
                                "already had; nothing sent since is encrypted for it."

                        IdentityStatus.Absent -> "No identity key on this device yet."
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = Slate400,
                )
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
                    text = "A passphrase is never sent anywhere in any form. Set one if your " +
                        "threat model includes the running server, which does see your password " +
                        "when you sign in.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate500,
                )
                Spacer(Modifier.height(10.dp))
                BetweenUsButton(
                    text = "Seal my identity with this passphrase",
                    busy = busy,
                    enabled = passphrase.length >= 8,
                    onClick = {
                        act {
                            E2ee.backupIdentity(BackupSecret.passphrase(passphrase))
                            passphrase = ""
                        }
                    },
                )
            }

            // --- password ---
            SectionLabel("Password")
            Column(Modifier.padding(horizontal = 12.dp)) {
                BetweenUsField(
                    label = "Current",
                    value = currentPassword,
                    onValueChange = { currentPassword = it; note = null },
                    placeholder = "Your password now",
                    secret = true,
                    enabled = !busy,
                )
                Spacer(Modifier.height(10.dp))
                BetweenUsField(
                    label = "New",
                    value = newPassword,
                    onValueChange = { newPassword = it; note = null },
                    placeholder = "At least 8 characters",
                    secret = true,
                    imeAction = ImeAction.Done,
                    enabled = !busy,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "Changing it signs every other session out, and re-seals your identity " +
                        "backup if it was keyed to the password.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate500,
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

            // --- call sounds ---
            SectionLabel("Calls")

            ListRow(
                title = "Play through",
                subtitle = routeLabel(route),
                leading = { BetweenUsIcon(BetweenUsIcons.Speaker) },
                trailing = {
                    Chip(
                        text = "Change",
                        onClick = {
                            // A cycle rather than a menu: there are at most
                            // five of these and four of them are usually not
                            // plugged in. The call screen has the full picker,
                            // which is where somebody in a call reaches for it.
                            val list = devices.routes
                            val next = list[(list.indexOf(route) + 1).mod(list.size)]
                            route = next
                            AudioPrefs.route = next
                            // Now, on a call that is already up: the moment
                            // somebody reaches for this is the moment they have
                            // just put a headset on.
                            CallAudio.apply(context)
                        },
                    )
                },
            )

            ListRow(
                title = "Speak into",
                subtitle = inputLabel(input),
                leading = { BetweenUsIcon(BetweenUsIcons.Mic) },
                trailing = {
                    Chip(
                        text = "Change",
                        onClick = {
                            val list = devices.inputs
                            val next = list[(list.indexOf(input) + 1).mod(list.size)]
                            input = next
                            AudioPrefs.input = next
                            CallAudio.apply(context)
                        },
                    )
                },
            )

            ListRow(
                title = "High fidelity microphone",
                subtitle = if (mode == AudioPrefs.Mode.HIFI) {
                    "Stereo at twice the bitrate, with the speech processing off"
                } else {
                    "Speech: mono, denoised, and silent between sentences"
                },
                leading = { BetweenUsIcon(BetweenUsIcons.Mic) },
                trailing = {
                    Switch(
                        checked = mode == AudioPrefs.Mode.HIFI,
                        onCheckedChange = { on ->
                            mode = if (on) AudioPrefs.Mode.HIFI else AudioPrefs.Mode.CLEAR
                            AudioPrefs.mode = mode
                        },
                        colors = switchColours(),
                    )
                },
            )

            if (mode == AudioPrefs.Mode.CLEAR) {
                AudioSwitch(
                    title = "Noise suppression",
                    subtitle = "Drops the fan, the keyboard and the room",
                    checked = noiseSuppression,
                ) {
                    noiseSuppression = it
                    AudioPrefs.noiseSuppression = it
                }
                AudioSwitch(
                    title = "Echo cancellation",
                    subtitle = "Without it, the speaker sends the call back into itself",
                    checked = echoCancellation,
                ) {
                    echoCancellation = it
                    AudioPrefs.echoCancellation = it
                }
                AudioSwitch(
                    title = "Automatic gain control",
                    subtitle = "Evens out a quiet or a loud voice",
                    checked = autoGainControl,
                ) {
                    autoGainControl = it
                    AudioPrefs.autoGainControl = it
                }
            }

            ListRow(
                title = "Join and leave tones",
                subtitle = "Two notes when somebody arrives or goes - up for one, down for the other",
                leading = { BetweenUsIcon(BetweenUsIcons.Speaker) },
                trailing = {
                    Switch(
                        checked = callTones,
                        onCheckedChange = { on ->
                            callTones = on
                            CallTones.enabled = on
                            // The toggle is the demonstration: turning it on
                            // plays the sound it is turning on.
                            if (on) CallTones.play(CallTones.Tone.JOIN)
                        },
                        colors = switchColours(),
                    )
                },
            )

            // --- notifications ---
            SectionLabel("Notifications")
            preferences?.let { prefs ->
                ListRow(
                    title = "Notify me",
                    subtitle = "Mentions, direct messages, calls and remote sessions",
                    leading = { BetweenUsIcon(BetweenUsIcons.Bell) },
                    trailing = {
                        Switch(
                            checked = prefs.enabled,
                            onCheckedChange = { enabled ->
                                preferences = prefs.copy(enabled = enabled)
                                act {
                                    preferences =
                                        BetweenUsApi.updateNotificationPreferences(enabled = enabled)
                                }
                            },
                            colors = SwitchDefaults.colors(
                                checkedThumbColor = Slate100,
                                checkedTrackColor = Accent,
                                uncheckedTrackColor = Surface700,
                                uncheckedBorderColor = Surface700,
                                uncheckedThumbColor = Slate400,
                            ),
                        )
                    },
                )
            }

            // --- android permissions ---
            SectionLabel("This device")
            PermissionsRow(onOpen = onPermissions)
            PermissionRow(
                title = "Notifications",
                detail = "So a message or a call can reach you when the app is closed.",
                icon = BetweenUsIcons.Bell,
                granted = BetweenUsPermissions.granted(context, BetweenUsPermissions.NOTIFICATIONS),
                request = notifications,
            )
            PermissionRow(
                title = "Microphone",
                detail = "Asked for when you join a voice channel, not before.",
                icon = BetweenUsIcons.Mic,
                granted = BetweenUsPermissions.granted(context, BetweenUsPermissions.MICROPHONE),
                request = microphone,
            )
            PermissionRow(
                title = "Camera",
                detail = "Asked for when you turn video on in a call.",
                icon = BetweenUsIcons.Video,
                granted = BetweenUsPermissions.granted(context, BetweenUsPermissions.CAMERA),
                request = camera,
            )
            if (BetweenUsPermissions.BLUETOOTH != null) {
                PermissionRow(
                    title = "Nearby devices",
                    detail = "Without it Android reports no Bluetooth headset, paired or not.",
                    icon = BetweenUsIcons.Speaker,
                    granted = BetweenUsPermissions.granted(context, BetweenUsPermissions.BLUETOOTH),
                    request = bluetooth,
                )
            }

            var crashes by remember { mutableStateOf(CrashReports.enabled) }
            ListRow(
                title = "Keep a crash report",
                subtitle = "On this phone only. Nothing is uploaded and nobody else is involved.",
                leading = { BetweenUsIcon(BetweenUsIcons.File) },
                trailing = {
                    Switch(
                        checked = crashes,
                        onCheckedChange = {
                            crashes = it
                            CrashReports.enabled = it
                        },
                        colors = switchColours(),
                    )
                },
            )
            if (crashes && CrashReports.report() != null) {
                ListRow(
                    title = "Share the last crash",
                    subtitle = "The stack, the Android version and the model. No account, no address.",
                    leading = { BetweenUsIcon(BetweenUsIcons.Download) },
                    onClick = {
                        CrashReports.share(context)?.let {
                            context.startActivity(Intent.createChooser(it, "Share the crash report"))
                        }
                    },
                )
            }

            ListRow(
                title = "Auto update",
                subtitle = "Channel, and whether this app updates itself from GitHub",
                leading = { BetweenUsIcon(BetweenUsIcons.Download) },
                onClick = onAutoUpdate,
            )

            // --- deployment ---
            SectionLabel("Deployment")
            ListRow(
                title = Endpoint.label(),
                subtitle = "The BetweenUs server this app talks to",
                leading = { BetweenUsIcon(BetweenUsIcons.Globe) },
                onClick = { pickingServer = true },
            )
            ListRow(
                title = "Server settings",
                subtitle = "Name, channels, leaving",
                leading = { BetweenUsIcon(BetweenUsIcons.Settings) },
                onClick = onServerSettings,
            )

            note?.let {
                Spacer(Modifier.height(12.dp))
                Notice(it, Danger, Modifier.padding(horizontal = 16.dp))
            }

            SectionLabel("Session")
            ListRow(
                title = "Sign out",
                titleColor = Danger,
                leading = { BetweenUsIcon(BetweenUsIcons.LogOut, tint = Danger) },
                // A call outlives every screen, so signing out is the one place
                // that has to reach across and end one it did not start.
                onClick = {
                    scope.launch {
                        VoiceEngine.release()
                        // The remembered place belongs to an account, not to
                        // the app: the next person to sign in here must not
                        // land in the last one's conversation.
                        LastPlace.forget()
                        // So does the plaintext of its pictures.
                        com.aatech.betweenus.feature.chat.MediaCache.clear()
                        // And so does anything still sitting in the shade: a
                        // notification holds the words of a conversation this
                        // account is walking away from.
                        com.aatech.betweenus.feature.notifications.MessageNotifications
                            .clearAll(context)
                        com.aatech.betweenus.feature.notifications.SocialNotifications
                            .clearAll(context)
                        com.aatech.betweenus.feature.notifications.PushGate.forgetPreferences()
                        com.aatech.betweenus.feature.chat.Outbox.forgetPending()
                        // And this account stops reading whatever was on
                        // screen, or the next one inherits its silence.
                        com.aatech.betweenus.core.store.ChannelFocus.forget()
                        Session.signOut()
                    }
                },
            )
        }
    }

    if (pickingServer) {
        ServerSheet(onDismiss = { pickingServer = false })
    }
}

/** The one set of switch colours this screen uses, in one place. */
@Composable
private fun switchColours() = SwitchDefaults.colors(
    checkedThumbColor = Slate100,
    checkedTrackColor = Accent,
    uncheckedTrackColor = Surface700,
    uncheckedBorderColor = Surface700,
    uncheckedThumbColor = Slate400,
)

/** One of the three microphone-processing switches. */
@Composable
private fun AudioSwitch(
    title: String,
    subtitle: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
) {
    ListRow(
        title = title,
        subtitle = subtitle,
        leading = { BetweenUsIcon(BetweenUsIcons.Settings, tint = Slate400) },
        trailing = {
            Switch(checked = checked, onCheckedChange = onChange, colors = switchColours())
        },
    )
}

@Composable
private fun PermissionRow(
    title: String,
    detail: String,
    icon: Int,
    granted: Boolean,
    request: PermissionRequest,
) {
    ListRow(
        title = title,
        subtitle = if (request.refused) {
            "Refused. Android will not ask again from here."
        } else {
            detail
        },
        leading = { BetweenUsIcon(icon, tint = if (granted) StatusOnline else Slate400) },
        trailing = {
            when {
                granted -> BetweenUsIcon(BetweenUsIcons.Check, tint = StatusOnline, size = 18.dp)
                request.refused -> Chip("Open settings", onClick = { request.openSettings() })
                else -> Chip("Allow", onClick = { request.request() })
            }
        },
    )
}
