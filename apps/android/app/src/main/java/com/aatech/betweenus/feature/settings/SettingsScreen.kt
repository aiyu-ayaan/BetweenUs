package com.aatech.betweenus.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.MutableStateFlow
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
import com.aatech.betweenus.feature.voice.MicGate
import com.aatech.betweenus.feature.voice.VoiceEngine
import com.aatech.betweenus.core.store.LastPlace
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.ThemePreferences
import com.aatech.betweenus.ui.theme.ANDROID_THEMES
import com.aatech.betweenus.ui.theme.ACCENT_PRESETS
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
import com.aatech.betweenus.ui.theme.StatusOnline
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
    onCallUsage: () -> Unit,
    onThemes: () -> Unit,
    onPrivacy: () -> Unit,
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
    var sensitivity by remember { mutableStateOf(AudioPrefs.sensitivityDb) }
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
                text = "Settings",
                style = MaterialTheme.typography.titleLargeEmphasized,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
        }

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
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
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
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
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

            // --- privacy ---
            SectionLabel("Privacy")
            ListRow(
                title = "Privacy & Safety",
                subtitle = "Blocked people, and clearing your own messages",
                leading = { BetweenUsIcon(BetweenUsIcons.Block) },
                trailing = { BetweenUsIcon(BetweenUsIcons.ChevronRight) },
                onClick = onPrivacy,
            )

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

            InputSensitivity(
                threshold = sensitivity,
                onChange = {
                    sensitivity = it
                    AudioPrefs.sensitivityDb = it
                },
            )

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
                            colors = switchColours(),
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
                title = "Calls & data",
                subtitle = "Every call this account has been in, and what each one moved",
                leading = { BetweenUsIcon(BetweenUsIcons.Phone) },
                onClick = onCallUsage,
            )

            ListRow(
                title = "Auto update",
                subtitle = "Channel, and whether this app updates itself from GitHub",
                leading = { BetweenUsIcon(BetweenUsIcons.Download) },
                onClick = onAutoUpdate,
            )

            // --- appearance ---
            SectionLabel("Appearance")
            val currentTheme by ThemePreferences.selectedTheme.collectAsState()
            val followSys by ThemePreferences.followSystem.collectAsState()
            val activeDef = ANDROID_THEMES[currentTheme] ?: ANDROID_THEMES["dark"]!!

            ListRow(
                title = "Themes & appearance",
                subtitle = "${activeDef.name} · ${if (followSys) "Sync with system" else activeDef.category} · 16 themes",
                leading = { BetweenUsIcon(BetweenUsIcons.Palette) },
                trailing = { BetweenUsIcon(BetweenUsIcons.ChevronRight, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
                onClick = onThemes,
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
                Notice(it, MaterialTheme.colorScheme.error, Modifier.padding(horizontal = 16.dp))
            }

            SectionLabel("Session")
            ListRow(
                title = "Sign out",
                titleColor = MaterialTheme.colorScheme.error,
                leading = { BetweenUsIcon(BetweenUsIcons.LogOut, tint = MaterialTheme.colorScheme.error) },
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

/**
 * The switch colours.
 *
 * The toolkit's own, now that the scheme is right: an expressive switch already
 * draws its checked track from the primary and its unchecked one from the
 * surface ramp, and the hand-written set this replaces was six lines of saying
 * the same thing slightly worse.
 */
@Composable
private fun switchColours() = SwitchDefaults.colors()

/**
 * Input sensitivity: the threshold, and a meter to set it against.
 *
 * The meter is the point. A threshold in dBFS is a number nobody has an
 * intuition for, and setting one blind means either a gate that never opens or
 * one that never closes - both of which read as "the feature does not work"
 * rather than as "it is set wrong". With a live level beside it the setting
 * takes about four seconds: talk, watch where the bar sits, put the line under
 * it.
 *
 * The meter shows the level *before* the gate, which is the only way round it
 * can be: a meter of the gated signal would sit at silence exactly when
 * somebody is trying to find the threshold that stops it doing that.
 *
 * It only moves during a call. Opening a second capture just for this screen is
 * what the desktop does, and Android does not reliably allow two captures of
 * one microphone - so the row says so rather than showing a bar that is dead
 * for a reason nobody can see.
 */
@Composable
private fun InputSensitivity(threshold: Int?, onChange: (Int?) -> Unit) {
    // The engine only exists once somebody has been in a call. No engine is a
    // dead meter and a subtitle that says why, rather than a crash on a screen
    // that is mostly about other things.
    val engine = VoiceEngine.current()
    val level by (engine?.micLevelDb ?: remember { MutableStateFlow(-100.0) }).collectAsState()
    val open by (engine?.gateOpen ?: remember { MutableStateFlow(true) }).collectAsState()
    val call by (engine?.state ?: remember {
        MutableStateFlow<VoiceEngine.CallState>(VoiceEngine.CallState.Idle)
    }).collectAsState()
    val live = call is VoiceEngine.CallState.Live

    ListRow(
        title = "Input sensitivity",
        subtitle = when {
            threshold == null -> "Off: everything the microphone hears is sent"
            live -> "Below ${'$'}threshold dB the microphone is closed"
            else -> "Below ${'$'}threshold dB the microphone is closed. Join a call to see the meter."
        },
        leading = { BetweenUsIcon(BetweenUsIcons.Mic, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
        trailing = {
            Switch(
                checked = threshold != null,
                // -50 dBFS is under a normal speaking voice and over a quiet
                // room, which is the setting most people would arrive at.
                onCheckedChange = { on -> onChange(if (on) -50 else null) },
                colors = switchColours(),
            )
        },
    )

    if (threshold == null) return

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        MicMeter(levelDb = level, thresholdDb = threshold, open = open, live = live)
        Slider(
            value = threshold.toFloat(),
            onValueChange = { onChange(it.toInt()) },
            valueRange = MicGate.MIN_THRESHOLD_DB.toFloat()..MicGate.MAX_THRESHOLD_DB.toFloat(),
        )
    }
}

/**
 * The level, the threshold, and whether the gate is open, in one bar.
 *
 * Green when what you are saying is getting through and grey when it is not,
 * because "is anybody hearing me" is the only question this screen is being
 * asked. The line is where the threshold sits, so the two are read together
 * rather than as a number and a picture.
 */
@Composable
private fun MicMeter(levelDb: Double, thresholdDb: Int, open: Boolean, live: Boolean) {
    // dBFS is logarithmic and the interesting part is the top; -80 to 0 across
    // the bar puts a speaking voice around two thirds of the way along, which
    // is where a meter is easiest to read.
    fun position(db: Double): Float = ((db + 80.0) / 80.0).coerceIn(0.0, 1.0).toFloat()

    val filled = if (live) position(levelDb) else 0f

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(10.dp)
            .clip(RoundedCornerShape(5.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHighest),
    ) {
        if (filled > 0f) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(filled)
                    .fillMaxHeight()
                    .background(
                        if (open) StatusOnline else MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
            )
        }
        // The threshold, drawn over the level rather than beside it.
        Box(
            modifier = Modifier
                .fillMaxWidth(position(thresholdDb.toDouble()))
                .fillMaxHeight(),
            contentAlignment = Alignment.CenterEnd,
        ) {
            Box(
                modifier = Modifier
                    .width(2.dp)
                    .fillMaxHeight()
                    .background(MaterialTheme.colorScheme.onSurface),
            )
        }
    }
}

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
        leading = { BetweenUsIcon(BetweenUsIcons.Settings, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
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
        leading = { BetweenUsIcon(icon, tint = if (granted) StatusOnline else MaterialTheme.colorScheme.onSurfaceVariant) },
        trailing = {
            when {
                granted -> BetweenUsIcon(BetweenUsIcons.Check, tint = StatusOnline, size = 18.dp)
                request.refused -> Chip("Open settings", onClick = { request.openSettings() })
                else -> Chip("Allow", onClick = { request.request() })
            }
        },
    )
}
