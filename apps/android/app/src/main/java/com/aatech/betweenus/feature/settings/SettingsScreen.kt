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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.PresenceStatus
import com.aatech.betweenus.core.data.PublicUser
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.store.LastPlace
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.ThemePreferences
import com.aatech.betweenus.feature.auth.ServerSheet
import com.aatech.betweenus.feature.voice.VoiceEngine
import com.aatech.betweenus.ui.components.Avatar
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.theme.ANDROID_THEMES
import kotlinx.coroutines.launch

/**
 * Main Settings Hub.
 *
 * Organized into structured subsections:
 * - Account & Security -> AccountSecurityScreen
 * - Privacy & Safety -> PrivacyScreen
 * - Appearance & Themes -> ThemesScreen
 * - Voice & Audio -> VoiceSettingsScreen
 * - Notifications -> NotificationSettingsScreen
 * - App Permissions -> PermissionsScreen
 * - This Device -> DeviceSettingsScreen
 * - Calls & Data Usage -> CallUsageScreen
 * - Auto Update -> AutoUpdateScreen
 * - Deployment & Server Settings -> ServerSettingsScreen / ServerSheet
 */
@Composable
fun SettingsScreen(
    user: PublicUser,
    onBack: () -> Unit,
    onAccountSettings: () -> Unit,
    onVoiceSettings: () -> Unit,
    onNotificationSettings: () -> Unit,
    onDeviceSettings: () -> Unit,
    onServerSettings: () -> Unit,
    onPermissions: () -> Unit,
    onAutoUpdate: () -> Unit,
    onCallUsage: () -> Unit,
    onThemes: () -> Unit,
    onPrivacy: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val presence by Presence.self.collectAsState()
    var pickingServer by remember { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .navigationBarsPadding(),
    ) {
        // --- Top App Bar ---
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
            // --- User Profile Header ---
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

            // --- Appear As / Presence Chips ---
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

            // --- Account Subsection ---
            SectionLabel("Account")
            ListRow(
                title = "Account & Security",
                subtitle = "Profile name, avatar, password, encryption passphrase",
                leading = { BetweenUsIcon(BetweenUsIcons.User) },
                trailing = { BetweenUsIcon(BetweenUsIcons.ChevronRight, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
                onClick = onAccountSettings,
            )
            ListRow(
                title = "Privacy & Safety",
                subtitle = "Blocked people, and clearing your own messages",
                leading = { BetweenUsIcon(BetweenUsIcons.Block) },
                trailing = { BetweenUsIcon(BetweenUsIcons.ChevronRight, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
                onClick = onPrivacy,
            )

            // --- Preferences Subsection ---
            SectionLabel("Preferences")
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

            ListRow(
                title = "Voice & Audio",
                subtitle = "Devices, noise suppression, gate sensitivity, call tones",
                leading = { BetweenUsIcon(BetweenUsIcons.Mic) },
                trailing = { BetweenUsIcon(BetweenUsIcons.ChevronRight, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
                onClick = onVoiceSettings,
            )

            ListRow(
                title = "Notifications",
                subtitle = "Push alerts, mentions, direct messages, incoming calls",
                leading = { BetweenUsIcon(BetweenUsIcons.Bell) },
                trailing = { BetweenUsIcon(BetweenUsIcons.ChevronRight, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
                onClick = onNotificationSettings,
            )

            PermissionsRow(onOpen = onPermissions)

            // --- Device & Diagnostics Subsection ---
            SectionLabel("This Device")
            ListRow(
                title = "This Device",
                subtitle = "Crash reports, diagnostics, hardware specifications",
                leading = { BetweenUsIcon(BetweenUsIcons.Monitor) },
                trailing = { BetweenUsIcon(BetweenUsIcons.ChevronRight, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
                onClick = onDeviceSettings,
            )

            ListRow(
                title = "Calls & data usage",
                subtitle = "Every call this account has been in, and what each one moved",
                leading = { BetweenUsIcon(BetweenUsIcons.Phone) },
                trailing = { BetweenUsIcon(BetweenUsIcons.ChevronRight, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
                onClick = onCallUsage,
            )

            ListRow(
                title = "Auto update",
                subtitle = "Channel, and whether this app updates itself from GitHub",
                leading = { BetweenUsIcon(BetweenUsIcons.Download) },
                trailing = { BetweenUsIcon(BetweenUsIcons.ChevronRight, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
                onClick = onAutoUpdate,
            )

            // --- Deployment Subsection ---
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
                trailing = { BetweenUsIcon(BetweenUsIcons.ChevronRight, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
                onClick = onServerSettings,
            )

            // --- Session Subsection ---
            SectionLabel("Session")
            ListRow(
                title = "Sign out",
                titleColor = MaterialTheme.colorScheme.error,
                leading = { BetweenUsIcon(BetweenUsIcons.LogOut, tint = MaterialTheme.colorScheme.error) },
                onClick = {
                    scope.launch {
                        VoiceEngine.release()
                        LastPlace.forget()
                        com.aatech.betweenus.feature.chat.MediaCache.clear()
                        com.aatech.betweenus.feature.notifications.MessageNotifications.clearAll(context)
                        com.aatech.betweenus.feature.notifications.SocialNotifications.clearAll(context)
                        com.aatech.betweenus.feature.notifications.PushGate.forgetPreferences()
                        com.aatech.betweenus.feature.chat.Outbox.forgetPending()
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
