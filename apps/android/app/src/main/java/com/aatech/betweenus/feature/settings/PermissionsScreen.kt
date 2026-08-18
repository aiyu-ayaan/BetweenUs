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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.theme.Edge
import com.aatech.betweenus.ui.theme.Ground
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate50
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.StatusOnline
import com.aatech.betweenus.ui.theme.Surface950

/**
 * Everything Android will be asked for, in one place, with what each is for.
 *
 * This is a disclosure, not a gate. Nothing here blocks the app: every one of
 * these is still requested at the moment it is needed - the microphone when a
 * call is joined, the camera when video is turned on - because a permission
 * refused up front has to be grantable by tapping the thing that wanted it.
 * What the screen buys is that somebody sees the whole list once, with the
 * reason next to it, rather than meeting each prompt cold.
 *
 * It is shown once after signing in, and lives in Settings afterwards.
 */
@Composable
fun PermissionsScreen(
    onDone: () -> Unit,
    onBack: (() -> Unit)? = null,
) {
    val context = LocalContext.current

    // What is granted is not Compose state - the grant happens in the system's
    // process. So it is re-read whenever a prompt returns, and again on the way
    // back from the system settings screen, which is where a permanently
    // refused permission has to be changed.
    var tick by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        tick++
        onPauseOrDispose { }
    }

    val notifications = rememberPermission(BetweenUsPermissions.NOTIFICATIONS) { tick++ }
    val microphone = rememberPermission(BetweenUsPermissions.MICROPHONE) { tick++ }
    val camera = rememberPermission(BetweenUsPermissions.CAMERA) { tick++ }
    val bluetooth = rememberPermission(BetweenUsPermissions.BLUETOOTH) { tick++ }
    val media = rememberAnyPermission(BetweenUsPermissions.MEDIA) { tick++ }

    val held = remember(tick) {
        BetweenUsPermissions.all().associateWith { BetweenUsPermissions.granted(context, it) }
    }
    fun granted(permission: String?) = permission == null || held[permission] == true
    val photos = remember(tick) { BetweenUsPermissions.anyGranted(context, BetweenUsPermissions.MEDIA) }
    val outstanding = remember(tick) { BetweenUsPermissions.missing(context) > 0 }

    Column(Modifier.fillMaxSize().background(Ground).systemBarsPadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().background(Surface950).padding(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) IconAction(BetweenUsIcons.ChevronLeft, "Back", onBack)
            Text(
                text = "Permissions",
                style = MaterialTheme.typography.titleMedium,
                color = Slate50,
                modifier = Modifier.weight(1f).padding(start = if (onBack != null) 8.dp else 16.dp),
            )
        }
        HorizontalDivider(color = Edge)

        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 16.dp),
        ) {
            Text(
                text = "BetweenUs asks Android for these. Nothing is required to sign in or read " +
                    "messages - each one buys one feature, and refusing it costs only that.",
                style = MaterialTheme.typography.bodyMedium,
                color = Slate400,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            )

            SectionLabel("Calls")
            PermissionCard(
                title = "Microphone",
                detail = "Speaking in a voice or video call. Without it you can still listen.",
                icon = BetweenUsIcons.Mic,
                granted = granted(BetweenUsPermissions.MICROPHONE),
                request = microphone,
            )
            PermissionCard(
                title = "Camera",
                detail = "Video in a call, and taking a photo to send.",
                icon = BetweenUsIcons.Video,
                granted = granted(BetweenUsPermissions.CAMERA),
                request = camera,
            )
            if (BetweenUsPermissions.BLUETOOTH != null) {
                PermissionCard(
                    title = "Nearby devices",
                    detail = "Finding a paired Bluetooth headset. Without it Android reports no " +
                        "headset at all and a call cannot be sent to one.",
                    icon = BetweenUsIcons.Speaker,
                    granted = granted(BetweenUsPermissions.BLUETOOTH),
                    request = bluetooth,
                )
            }

            SectionLabel("Messages")
            PermissionCard(
                title = "Notifications",
                detail = "Mentions, direct messages and incoming calls when the app is closed - " +
                    "and the ongoing notification that keeps a call alive behind a locked screen.",
                icon = BetweenUsIcons.Bell,
                granted = granted(BetweenUsPermissions.NOTIFICATIONS),
                request = notifications,
            )
            PermissionCard(
                title = "Photos and videos",
                detail = "The grid of recent photos in the attachment sheet. The system picker " +
                    "and the file browser work without it.",
                icon = BetweenUsIcons.Image,
                granted = photos,
                request = media,
            )
        }

        HorizontalDivider(color = Edge)
        Column(Modifier.fillMaxWidth().background(Surface950).padding(16.dp)) {
            BetweenUsButton(
                text = if (outstanding) "Continue" else "Done",
                onClick = {
                    BetweenUsPermissions.markIntroduced(context)
                    onDone()
                },
                modifier = Modifier.fillMaxWidth(),
            )
            if (outstanding) {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "You can skip anything here. BetweenUs will ask again at the moment it " +
                        "needs it.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate500,
                )
            }
        }
    }
}

/** One permission: what it is for, and the one button that changes it. */
@Composable
private fun PermissionCard(
    title: String,
    detail: String,
    icon: Int,
    granted: Boolean,
    request: PermissionRequest,
) {
    Column(Modifier.fillMaxWidth()) {
        ListRow(
            title = title,
            leading = { BetweenUsIcon(icon, tint = if (granted) StatusOnline else Slate400) },
            trailing = {
                when {
                    granted -> BetweenUsIcon(BetweenUsIcons.Check, tint = StatusOnline, size = 18.dp)
                    request.refused -> Chip("Open settings", onClick = { request.openSettings() })
                    else -> Chip("Allow", onClick = { request.request() })
                }
            },
        )
        Text(
            text = if (request.refused && !granted) {
                "Refused. Android will not ask again from here - the settings screen is the only " +
                    "way back. $detail"
            } else {
                detail
            },
            style = MaterialTheme.typography.bodySmall,
            color = Slate500,
            modifier = Modifier.padding(start = 48.dp, end = 16.dp, bottom = 8.dp),
        )
    }
}

/** The row that opens this screen from Settings. */
@Composable
fun PermissionsRow(onOpen: () -> Unit) {
    val context = LocalContext.current
    val missing = BetweenUsPermissions.missing(context)
    ListRow(
        title = "App permissions",
        subtitle = if (missing == 0) {
            "Everything BetweenUs asks Android for is granted"
        } else {
            "$missing not granted"
        },
        leading = { BetweenUsIcon(BetweenUsIcons.Shield) },
        trailing = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (missing == 0) BetweenUsIcon(BetweenUsIcons.Check, tint = StatusOnline, size = 18.dp)
            }
        },
        onClick = onOpen,
    )
}
