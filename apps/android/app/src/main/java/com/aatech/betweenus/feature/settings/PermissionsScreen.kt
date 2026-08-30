package com.aatech.betweenus.feature.settings

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.theme.StatusIdle
import com.aatech.betweenus.ui.theme.StatusOnline

data class PermissionItem(
    val id: String,
    val title: String,
    val category: String,
    val detail: String,
    val rationale: String,
    val icon: Int,
    val permissions: List<String>,
    val requiresAny: Boolean = false,
)

fun getPermissionItems(): List<PermissionItem> {
    val list = mutableListOf(
        PermissionItem(
            id = "notifications",
            title = "Notifications",
            category = "Alerts & Calls",
            detail = "Alerts for incoming direct messages, mentions, and incoming audio/video calls.",
            rationale = "Required on Android 13+ so the app can alert you when closed and keep call audio active in the background.",
            icon = BetweenUsIcons.Bell,
            permissions = listOfNotNull(BetweenUsPermissions.NOTIFICATIONS),
        ),
        PermissionItem(
            id = "mic",
            title = "Microphone",
            category = "Calls & Voice",
            detail = "Speaking in voice channels, 1-on-1 audio/video calls, and recording voice notes.",
            rationale = "Active only when participating in an ongoing call or recording a voice note. Never accessed in the background.",
            icon = BetweenUsIcons.Mic,
            permissions = listOf(BetweenUsPermissions.MICROPHONE),
        ),
        PermissionItem(
            id = "camera",
            title = "Camera",
            category = "Video & Media",
            detail = "Streaming live video during calls and capturing instant photos to send in chats.",
            rationale = "Active only when you choose to turn video on in a call or take a photo to attach.",
            icon = BetweenUsIcons.Video,
            permissions = listOf(BetweenUsPermissions.CAMERA),
        ),
    )

    if (BetweenUsPermissions.BLUETOOTH != null) {
        list.add(
            PermissionItem(
                id = "bluetooth",
                title = "Nearby Devices",
                category = "Audio Routing",
                detail = "Detecting, connecting, and routing call audio to Bluetooth wireless headsets and earbuds.",
                rationale = "Without this permission, Android prevents the app from discovering and switching audio to Bluetooth headsets.",
                icon = BetweenUsIcons.Speaker,
                permissions = listOf(BetweenUsPermissions.BLUETOOTH),
            ),
        )
    }

    list.add(
        PermissionItem(
            id = "media",
            title = "Photos & Media",
            category = "Chat Attachments",
            detail = "Browsing and attaching images and videos directly from your local gallery.",
            rationale = "The system document picker and camera remain fully functional even without this permission.",
            icon = BetweenUsIcons.Image,
            permissions = BetweenUsPermissions.MEDIA,
            requiresAny = true,
        ),
    )

    return list
}

private fun isItemGranted(context: Context, item: PermissionItem): Boolean {
    if (item.permissions.isEmpty()) return true
    return if (item.requiresAny) {
        BetweenUsPermissions.anyGranted(context, item.permissions)
    } else {
        item.permissions.all { BetweenUsPermissions.granted(context, it) }
    }
}

/**
 * Comprehensive Permissions Page for BetweenUs Android.
 *
 * Provides a unified overview of all runtime permissions (Notifications, Microphone,
 * Camera, Nearby Bluetooth Devices, and Media Storage), detailed rationales, live status
 * indicators, individual request triggers, batch grant, and Android System Settings shortcuts.
 */
@Composable
fun PermissionsScreen(
    onDone: () -> Unit,
    onBack: (() -> Unit)? = null,
    onOpenDetail: ((String) -> Unit)? = null,
) {
    val context = LocalContext.current
    val items = remember { getPermissionItems() }

    var tick by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        tick++
        onPauseOrDispose { }
    }

    val refusedMap = remember { mutableStateMapOf<String, Boolean>() }

    val singleLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
        tick++
        results.forEach { (perm, granted) ->
            if (!granted) refusedMap[perm] = true
        }
    }

    val allLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
        tick++
        results.forEach { (perm, granted) ->
            if (!granted) refusedMap[perm] = true
        }
        BetweenUsPermissions.markIntroduced(context)
    }

    val grantedStatus = remember(tick) {
        items.associate { it.id to isItemGranted(context, it) }
    }

    val grantedCount = remember(grantedStatus) {
        items.count { grantedStatus[it.id] == true }
    }

    val allGranted = grantedCount == items.size
    val progress by animateFloatAsState(
        targetValue = if (items.isNotEmpty()) grantedCount.toFloat() / items.size.toFloat() else 1f,
        label = "permissionsProgress",
    )

    fun requestSingle(item: PermissionItem) {
        val missing = if (item.requiresAny) {
            if (BetweenUsPermissions.anyGranted(context, item.permissions)) emptyList() else item.permissions
        } else {
            item.permissions.filterNot { BetweenUsPermissions.granted(context, it) }
        }
        if (missing.isNotEmpty()) {
            singleLauncher.launch(missing.toTypedArray())
        }
    }

    fun requestAll() {
        val missing = items.flatMap { item ->
            if (item.requiresAny) {
                if (BetweenUsPermissions.anyGranted(context, item.permissions)) emptyList() else item.permissions
            } else {
                item.permissions.filterNot { BetweenUsPermissions.granted(context, it) }
            }
        }.distinct()

        if (missing.isNotEmpty()) {
            allLauncher.launch(missing.toTypedArray())
        } else {
            BetweenUsPermissions.markIntroduced(context)
            onDone()
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .navigationBarsPadding(),
    ) {
        // --- Top Bar ---
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .statusBarsPadding()
                .padding(start = 4.dp, end = 12.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                IconAction(BetweenUsIcons.ChevronLeft, "Back", onBack)
            }
            Text(
                text = "App Permissions",
                style = MaterialTheme.typography.titleLargeEmphasized,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier
                    .weight(1f)
                    .padding(start = if (onBack != null) 4.dp else 12.dp),
            )
            Chip(
                text = "System Settings",
                onClick = { BetweenUsPermissions.openSettings(context) },
            )
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 32.dp),
        ) {
            // --- Overview Health Summary Card ---
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainer)
                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(16.dp))
                    .padding(16.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .background(
                                        if (allGranted) StatusOnline.copy(alpha = 0.15f)
                                        else MaterialTheme.colorScheme.primaryContainer,
                                    ),
                                contentAlignment = Alignment.Center,
                            ) {
                                BetweenUsIcon(
                                    icon = if (allGranted) BetweenUsIcons.Check else BetweenUsIcons.Shield,
                                    tint = if (allGranted) StatusOnline else MaterialTheme.colorScheme.primary,
                                    size = 20.dp,
                                )
                            }
                            Column {
                                Text(
                                    text = if (allGranted) "All Permissions Granted" else "Permissions Health",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                                Text(
                                    text = "$grantedCount of ${items.size} permissions active",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = if (allGranted) StatusOnline else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }

                    LinearProgressIndicator(
                        progress = { progress },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(6.dp)
                            .clip(RoundedCornerShape(3.dp)),
                        color = if (allGranted) StatusOnline else MaterialTheme.colorScheme.primary,
                        trackColor = MaterialTheme.colorScheme.surfaceContainerHighest,
                        strokeCap = StrokeCap.Round,
                    )

                    Text(
                        text = "BetweenUs uses end-to-end encryption for private communications. Permissions are strictly used on this device for real-time calls, alerts, and photo sharing.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            SectionLabel("Manage Permissions (${items.size})")

            // --- Permission Cards List ---
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items.forEach { item ->
                    val isGranted = grantedStatus[item.id] == true
                    val isRefused = item.permissions.any { refusedMap[it] == true } && !isGranted

                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .background(MaterialTheme.colorScheme.surfaceContainer)
                            .border(
                                width = 1.dp,
                                color = if (isGranted) StatusOnline.copy(alpha = 0.35f) else MaterialTheme.colorScheme.outlineVariant,
                                shape = RoundedCornerShape(14.dp),
                            )
                            .let {
                                if (onOpenDetail != null) {
                                    it.clickable { onOpenDetail(item.id) }
                                } else {
                                    it
                                }
                            }
                            .padding(14.dp),
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.weight(1f),
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(36.dp)
                                            .clip(RoundedCornerShape(10.dp))
                                            .background(
                                                when {
                                                    isGranted -> StatusOnline.copy(alpha = 0.12f)
                                                    isRefused -> StatusIdle.copy(alpha = 0.12f)
                                                    else -> MaterialTheme.colorScheme.surfaceContainerHighest
                                                },
                                            ),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        BetweenUsIcon(
                                            icon = item.icon,
                                            tint = when {
                                                isGranted -> StatusOnline
                                                isRefused -> StatusIdle
                                                else -> MaterialTheme.colorScheme.primary
                                            },
                                            size = 20.dp,
                                        )
                                    }
                                    Column {
                                        Text(
                                            text = item.title,
                                            style = MaterialTheme.typography.titleMedium,
                                            color = MaterialTheme.colorScheme.onSurface,
                                        )
                                        Text(
                                            text = item.category.uppercase(),
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }

                                // Status Badge / Action Button
                                when {
                                    isGranted -> {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(8.dp))
                                                .background(StatusOnline.copy(alpha = 0.15f))
                                                .padding(horizontal = 10.dp, vertical = 6.dp),
                                        ) {
                                            BetweenUsIcon(BetweenUsIcons.Check, tint = StatusOnline, size = 14.dp)
                                            Text(
                                                text = "Granted",
                                                style = MaterialTheme.typography.labelMedium,
                                                color = StatusOnline,
                                                fontWeight = FontWeight.SemiBold,
                                            )
                                        }
                                    }
                                    isRefused -> {
                                        Chip(
                                            text = "Open Settings",
                                            tone = StatusIdle,
                                            onClick = { BetweenUsPermissions.openSettings(context) },
                                        )
                                    }
                                    else -> {
                                        Chip(
                                            text = "Allow",
                                            selected = true,
                                            onClick = { requestSingle(item) },
                                        )
                                    }
                                }
                            }

                            Text(
                                text = item.detail,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                            )

                            Text(
                                text = item.rationale,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )

                            if (onOpenDetail != null) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(top = 4.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        text = "View details & permissions architecture",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.primary,
                                    )
                                    BetweenUsIcon(
                                        BetweenUsIcons.ChevronRight,
                                        tint = MaterialTheme.colorScheme.primary,
                                        size = 14.dp,
                                    )
                                }
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(20.dp))

            // --- Bottom Batch & Navigation Actions ---
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (!allGranted) {
                    BetweenUsButton(
                        text = "Allow All Missing Permissions",
                        onClick = { requestAll() },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                OutlinedButton(
                    onClick = { BetweenUsPermissions.openSettings(context) },
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.onSurface,
                    ),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        BetweenUsIcon(BetweenUsIcons.Settings, size = 18.dp)
                        Text(
                            text = "Open Android App Settings",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }

                if (onBack == null) {
                    Spacer(Modifier.height(4.dp))
                    BetweenUsButton(
                        text = "Continue to BetweenUs",
                        onClick = {
                            BetweenUsPermissions.markIntroduced(context)
                            onDone()
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

/**
 * Sleek top-of-layout banner displayed when notification permission is disabled.
 * Allows instant granting or dismissing without blocking the user.
 */
@Composable
fun NotificationPermissionBanner(
    onEnable: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .border(1.dp, StatusIdle.copy(alpha = 0.35f))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        BetweenUsIcon(
            icon = BetweenUsIcons.BellOff,
            tint = StatusIdle,
            size = 20.dp,
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "Notifications are turned off",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = "You won't receive message alerts or incoming call notifications.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            text = "Enable",
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            color = StatusIdle,
            modifier = Modifier
                .clip(RoundedCornerShape(6.dp))
                .background(StatusIdle.copy(alpha = 0.18f))
                .clickable(onClick = onEnable)
                .padding(horizontal = 12.dp, vertical = 6.dp),
        )
        Box(
            modifier = Modifier
                .size(24.dp)
                .clip(CircleShape)
                .clickable(onClick = onDismiss),
            contentAlignment = Alignment.Center,
        ) {
            BetweenUsIcon(
                icon = BetweenUsIcons.X,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                size = 14.dp,
            )
        }
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
            "All permissions granted"
        } else {
            "$missing permission${if (missing == 1) "" else "s"} not granted"
        },
        leading = {
            BetweenUsIcon(
                BetweenUsIcons.Shield,
                tint = if (missing == 0) StatusOnline else MaterialTheme.colorScheme.primary,
            )
        },
        trailing = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (missing == 0) {
                    BetweenUsIcon(BetweenUsIcons.Check, tint = StatusOnline, size = 16.dp)
                }
                BetweenUsIcon(BetweenUsIcons.ChevronRight, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        onClick = onOpen,
    )
}
