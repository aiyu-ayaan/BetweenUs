package com.aatech.betweenus.feature.settings

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
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

data class PermissionDetailData(
    val id: String,
    val title: String,
    val category: String,
    val icon: Int,
    val overview: String,
    val whyNeeded: String,
    val technicalDetails: String,
    val privacyGuarantee: String,
    val permissions: List<String>,
    val requiresAny: Boolean = false,
)

fun getPermissionDetailData(id: String): PermissionDetailData {
    return when (id) {
        "notifications" -> PermissionDetailData(
            id = "notifications",
            title = "Notifications",
            category = "Alerts & Incoming Calls",
            icon = BetweenUsIcons.Bell,
            overview = "Alerts for incoming direct messages, server mentions, incoming voice/video calls, and remote sessions.",
            whyNeeded = "On Android 13 (API 33)+, apps must explicitly request notification access. Without it, Android blocks all notifications when the app is in the background or closed.",
            technicalDetails = "Delivered via background data push. The system displays high-priority CallStyle heads-up banners for incoming calls and standard notifications for chats.",
            privacyGuarantee = "Push payloads are data-only and end-to-end encrypted. Message bodies are decrypted locally on your device only when received.",
            permissions = listOfNotNull(BetweenUsPermissions.NOTIFICATIONS),
        )
        "mic" -> PermissionDetailData(
            id = "mic",
            title = "Microphone",
            category = "Calls & Voice Channels",
            icon = BetweenUsIcons.Mic,
            overview = "Speaking in voice channels, 1-on-1 audio/video calls, and recording voice notes.",
            whyNeeded = "Required to capture your voice in real time and stream it to call participants over WebRTC mesh.",
            technicalDetails = "Processes audio using Opus codec at 48 kHz. Supports noise suppression, acoustic echo cancellation, and software gate sensitivity.",
            privacyGuarantee = "No background audio capture. Active only while in an ongoing call or recording a voice note. Android 12+ privacy dot displays when active.",
            permissions = listOf(BetweenUsPermissions.MICROPHONE),
        )
        "camera" -> PermissionDetailData(
            id = "camera",
            title = "Camera",
            category = "Video Calls & Media Capture",
            icon = BetweenUsIcons.Video,
            overview = "Streaming live video during calls and capturing instant photos to send in chats.",
            whyNeeded = "Required when you choose to turn your camera on during a video call or take an instant picture to attach.",
            technicalDetails = "Streams VP8/H.264 video peer-to-peer over DTLS-SRTP encrypted connections.",
            privacyGuarantee = "Camera is never turned on automatically. It activates strictly when you press the video toggle in a call or snap a photo.",
            permissions = listOf(BetweenUsPermissions.CAMERA),
        )
        "bluetooth" -> PermissionDetailData(
            id = "bluetooth",
            title = "Nearby Devices",
            category = "Wireless Audio Routing",
            icon = BetweenUsIcons.Speaker,
            overview = "Detecting, connecting, and routing call audio to Bluetooth wireless headsets and earbuds.",
            whyNeeded = "Android 12+ requires the BLUETOOTH_CONNECT permission to discover paired Bluetooth headsets and route voice audio.",
            technicalDetails = "Communicates with Android AudioManager to dynamically route call audio between built-in earpiece, speakerphone, and Bluetooth headsets.",
            privacyGuarantee = "BetweenUs does not scan for nearby beacons or track location. It only queries already-paired Bluetooth audio peripherals.",
            permissions = listOfNotNull(BetweenUsPermissions.BLUETOOTH),
        )
        "media" -> PermissionDetailData(
            id = "media",
            title = "Photos & Media Storage",
            category = "Gallery & File Attachments",
            icon = BetweenUsIcons.Image,
            overview = "Browsing and attaching images and videos directly from your local device gallery into chats.",
            whyNeeded = "Allows fast in-app inline gallery thumbnail previews when opening the attachment sheet.",
            technicalDetails = "Reads local MediaStore images and videos. Selected media is encrypted with AES-256-GCM prior to chunked upload.",
            privacyGuarantee = "Only images you explicitly choose to attach are encrypted and sent. The system document picker works even without this permission.",
            permissions = BetweenUsPermissions.MEDIA,
            requiresAny = true,
        )
        else -> PermissionDetailData(
            id = id,
            title = "App Permission",
            category = "Device Access",
            icon = BetweenUsIcons.Shield,
            overview = "Hardware or platform capability requested by BetweenUs.",
            whyNeeded = "Used to provide core secure communication capabilities.",
            technicalDetails = "Android runtime permission system.",
            privacyGuarantee = "Protected by end-to-end encryption and strict client-side controls.",
            permissions = emptyList(),
        )
    }
}

/**
 * Dedicated Full Sub-Page for an Individual Android Permission.
 *
 * Provides deep architectural rationales, hardware usage details, live permission state,
 * interactive request launchers, and system settings integration for a specific permission.
 */
@Composable
fun PermissionDetailScreen(
    permissionId: String,
    onBack: () -> Unit,
    onNavigateToSettings: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    val data = remember(permissionId) { getPermissionDetailData(permissionId) }

    var tick by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        tick++
        onPauseOrDispose { }
    }

    var refused by remember { mutableStateOf(false) }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
        tick++
        if (results.values.any { !it }) {
            refused = true
        }
    }

    val isGranted = remember(tick, data) {
        if (data.permissions.isEmpty()) true
        else if (data.requiresAny) {
            BetweenUsPermissions.anyGranted(context, data.permissions)
        } else {
            data.permissions.all { BetweenUsPermissions.granted(context, it) }
        }
    }

    fun request() {
        val missing = if (data.requiresAny) {
            if (BetweenUsPermissions.anyGranted(context, data.permissions)) emptyList() else data.permissions
        } else {
            data.permissions.filterNot { BetweenUsPermissions.granted(context, it) }
        }
        if (missing.isNotEmpty()) {
            launcher.launch(missing.toTypedArray())
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
            IconAction(BetweenUsIcons.ChevronLeft, "Back", onBack)
            Text(
                text = data.title,
                style = MaterialTheme.typography.titleLargeEmphasized,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
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
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // --- Hero Status Card ---
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainer)
                    .border(
                        1.dp,
                        if (isGranted) StatusOnline.copy(alpha = 0.35f) else MaterialTheme.colorScheme.outlineVariant,
                        RoundedCornerShape(16.dp),
                    )
                    .padding(20.dp),
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Box(
                        modifier = Modifier
                            .size(64.dp)
                            .clip(CircleShape)
                            .background(
                                if (isGranted) StatusOnline.copy(alpha = 0.15f)
                                else MaterialTheme.colorScheme.primaryContainer,
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        BetweenUsIcon(
                            icon = data.icon,
                            tint = if (isGranted) StatusOnline else MaterialTheme.colorScheme.primary,
                            size = 32.dp,
                        )
                    }

                    Text(
                        text = data.title,
                        style = MaterialTheme.typography.titleLargeEmphasized,
                        color = MaterialTheme.colorScheme.onSurface,
                    )

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(
                                if (isGranted) StatusOnline.copy(alpha = 0.15f)
                                else if (refused) StatusIdle.copy(alpha = 0.15f)
                                else MaterialTheme.colorScheme.surfaceContainerHighest,
                            )
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                    ) {
                        BetweenUsIcon(
                            icon = if (isGranted) BetweenUsIcons.Check else if (refused) BetweenUsIcons.X else BetweenUsIcons.Shield,
                            tint = if (isGranted) StatusOnline else if (refused) StatusIdle else MaterialTheme.colorScheme.onSurfaceVariant,
                            size = 16.dp,
                        )
                        Text(
                            text = if (isGranted) "Permission Granted" else if (refused) "Permission Refused" else "Permission Required",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Bold,
                            color = if (isGranted) StatusOnline else if (refused) StatusIdle else MaterialTheme.colorScheme.onSurface,
                        )
                    }

                    Text(
                        text = data.overview,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }

            // --- Why Needed Section ---
            SectionLabel("Why BetweenUs Needs This")
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainer)
                    .padding(14.dp),
            ) {
                Text(
                    text = data.whyNeeded,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }

            // --- Technical Operation ---
            SectionLabel("Technical Operation & Hardware")
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainer)
                    .padding(14.dp),
            ) {
                Text(
                    text = data.technicalDetails,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }

            // --- Privacy & Security Guarantee ---
            SectionLabel("Privacy & Encryption")
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainer)
                    .padding(14.dp),
            ) {
                Text(
                    text = data.privacyGuarantee,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(Modifier.height(8.dp))

            // --- Action Buttons ---
            if (!isGranted) {
                BetweenUsButton(
                    text = if (refused) "Open System Settings" else "Grant ${data.title} Access",
                    onClick = {
                        if (refused) BetweenUsPermissions.openSettings(context)
                        else request()
                    },
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
                        text = "Android System App Settings",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }

            Spacer(Modifier.height(24.dp))
        }
    }
}
