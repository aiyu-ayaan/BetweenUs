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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.NotificationPreferences
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.theme.StatusOnline
import kotlinx.coroutines.launch

/**
 * Dedicated Notifications Settings Sub-Page.
 *
 * Manages notification preferences (mentions, direct messages, incoming calls, remote sessions),
 * background push delivery state, and OS notification permission integration.
 */
@Composable
fun NotificationSettingsScreen(
    onBack: () -> Unit,
    onPermissions: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var preferences by remember { mutableStateOf<NotificationPreferences?>(null) }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        preferences = runCatching { BetweenUsApi.notificationPreferences() }.getOrNull()
    }

    val isSysGranted = BetweenUsPermissions.granted(context, BetweenUsPermissions.NOTIFICATIONS)

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
                text = "Notifications",
                style = MaterialTheme.typography.titleLargeEmphasized,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
        }

        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 40.dp)) {
            SectionLabel("Preferences")

            preferences?.let { prefs ->
                ListRow(
                    title = "Receive Push Notifications",
                    subtitle = "Alerts for mentions, direct messages, calls and remote sessions",
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
                            colors = SwitchDefaults.colors(),
                        )
                    },
                )
            }

            SectionLabel("System Permissions")

            ListRow(
                title = "Android Notification Access",
                subtitle = if (isSysGranted) {
                    "System notifications are active and enabled"
                } else {
                    "System notifications are blocked. Tap to configure permissions."
                },
                leading = {
                    BetweenUsIcon(
                        icon = if (isSysGranted) BetweenUsIcons.Bell else BetweenUsIcons.BellOff,
                        tint = if (isSysGranted) StatusOnline else MaterialTheme.colorScheme.primary,
                    )
                },
                trailing = {
                    if (isSysGranted) {
                        BetweenUsIcon(BetweenUsIcons.Check, tint = StatusOnline, size = 18.dp)
                    } else {
                        Chip("Manage", onClick = onPermissions)
                    }
                },
                onClick = onPermissions,
            )

            SectionLabel("Security & Privacy in Notifications")
            Column(Modifier.padding(horizontal = 16.dp)) {
                Text(
                    text = "BetweenUs push notifications are delivered via data-only payloads. Plaintext message bodies and media previews are decrypted locally on your device only when received.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            note?.let {
                Spacer(Modifier.height(12.dp))
                Notice(it, MaterialTheme.colorScheme.error, Modifier.padding(horizontal = 16.dp))
            }
        }
    }
}
