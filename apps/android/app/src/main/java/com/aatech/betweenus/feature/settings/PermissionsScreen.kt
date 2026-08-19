package com.aatech.betweenus.feature.settings

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import com.aatech.betweenus.ui.theme.Accent
import com.aatech.betweenus.ui.theme.Edge
import com.aatech.betweenus.ui.theme.Ground
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate300
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate50
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.StatusIdle
import com.aatech.betweenus.ui.theme.StatusOnline
import com.aatech.betweenus.ui.theme.Surface700
import com.aatech.betweenus.ui.theme.Surface800
import com.aatech.betweenus.ui.theme.Surface900
import com.aatech.betweenus.ui.theme.Surface950
import kotlinx.coroutines.launch

private data class PermissionItem(
    val id: String,
    val title: String,
    val category: String,
    val detail: String,
    val rationale: String,
    val icon: Int,
    val permissions: List<String>,
    val requiresAny: Boolean = false,
)

private fun getPermissionItems(): List<PermissionItem> {
    val list = mutableListOf(
        PermissionItem(
            id = "mic",
            title = "Microphone",
            category = "Calls & Voice",
            detail = "Speaking in voice channels, 1-on-1 calls, and group calls.",
            rationale = "Without it you can still listen to others, but won't be able to talk in calls.",
            icon = BetweenUsIcons.Mic,
            permissions = listOf(BetweenUsPermissions.MICROPHONE),
        ),
        PermissionItem(
            id = "camera",
            title = "Camera",
            category = "Calls & Media",
            detail = "Streaming live video in calls and capturing photos to send in chat.",
            rationale = "Only activated when you choose to turn on video or capture a photo.",
            icon = BetweenUsIcons.Video,
            permissions = listOf(BetweenUsPermissions.CAMERA),
        ),
    )

    if (BetweenUsPermissions.BLUETOOTH != null) {
        list.add(
            PermissionItem(
                id = "bluetooth",
                title = "Nearby Devices",
                category = "Audio Devices",
                detail = "Detecting and routing audio seamlessly to your paired Bluetooth headsets.",
                rationale = "Without it Android cannot switch call audio to your wireless earbuds.",
                icon = BetweenUsIcons.Speaker,
                permissions = listOf(BetweenUsPermissions.BLUETOOTH),
            ),
        )
    }

    if (BetweenUsPermissions.NOTIFICATIONS != null) {
        list.add(
            PermissionItem(
                id = "notifications",
                title = "Notifications",
                category = "Messages & Calls",
                detail = "Receiving alerts for mentions, direct messages, and incoming calls when the app is in the background.",
                rationale = "Also keeps background call audio alive when your screen is locked.",
                icon = BetweenUsIcons.Bell,
                permissions = listOf(BetweenUsPermissions.NOTIFICATIONS),
            ),
        )
    }

    list.add(
        PermissionItem(
            id = "media",
            title = "Photos & Videos",
            category = "Chat Attachments",
            detail = "Browsing and attaching your recent photos and videos directly in chats.",
            rationale = "The system photo picker and document browser still work without this.",
            icon = BetweenUsIcons.Image,
            permissions = BetweenUsPermissions.MEDIA,
            requiresAny = true,
        ),
    )

    return list
}

private fun isItemGranted(context: Context, item: PermissionItem): Boolean {
    return if (item.requiresAny) {
        BetweenUsPermissions.anyGranted(context, item.permissions)
    } else {
        item.permissions.all { BetweenUsPermissions.granted(context, it) }
    }
}

/**
 * Interactive carousel for permissions with live progress and WhatsApp-style step progression.
 */
@Composable
fun PermissionsScreen(
    onDone: () -> Unit,
    onBack: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val items = remember { getPermissionItems() }

    var tick by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        tick++
        onPauseOrDispose { }
    }

    val refusedMap = remember { mutableStateMapOf<String, Boolean>() }
    val pagerState = rememberPagerState(initialPage = 0) { items.size }

    // Launcher for single item request with auto-advance
    val singleLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
        tick++
        results.forEach { (perm, granted) ->
            if (!granted) refusedMap[perm] = true
        }
        // Auto-advance to next slide if available
        if (pagerState.currentPage < items.size - 1) {
            scope.launch { pagerState.animateScrollToPage(pagerState.currentPage + 1) }
        }
    }

    // Launcher for "Allow All Permissions" batch request
    val allLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
        tick++
        results.forEach { (perm, granted) ->
            if (!granted) refusedMap[perm] = true
        }
        BetweenUsPermissions.markIntroduced(context)
        onDone()
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

    val currentItem = items.getOrNull(pagerState.currentPage) ?: items.first()
    val isCurrentGranted = grantedStatus[currentItem.id] == true
    val isCurrentRefused = currentItem.permissions.any { refusedMap[it] == true } && !isCurrentGranted

    fun requestSingle(item: PermissionItem) {
        val missing = if (item.requiresAny) {
            if (BetweenUsPermissions.anyGranted(context, item.permissions)) emptyList() else item.permissions
        } else {
            item.permissions.filterNot { BetweenUsPermissions.granted(context, it) }
        }
        if (missing.isNotEmpty()) {
            singleLauncher.launch(missing.toTypedArray())
        } else if (pagerState.currentPage < items.size - 1) {
            scope.launch { pagerState.animateScrollToPage(pagerState.currentPage + 1) }
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
            .background(Ground)
            .systemBarsPadding(),
    ) {
        // --- Top Bar ---
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Surface950)
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                IconAction(BetweenUsIcons.ChevronLeft, "Back", onBack)
            }
            Text(
                text = "Permissions",
                style = MaterialTheme.typography.titleMedium,
                color = Slate50,
                modifier = Modifier
                    .weight(1f)
                    .padding(start = if (onBack != null) 4.dp else 12.dp),
            )
            Text(
                text = if (allGranted) "Done" else "Skip",
                style = MaterialTheme.typography.labelLarge,
                color = if (allGranted) StatusOnline else Slate400,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable {
                        BetweenUsPermissions.markIntroduced(context)
                        onDone()
                    }
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            )
        }
        HorizontalDivider(color = Edge)

        // --- Progress Tracker Section ---
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "STEP ${pagerState.currentPage + 1} OF ${items.size}",
                    style = MaterialTheme.typography.labelSmall,
                    color = Slate500,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = "$grantedCount of ${items.size} granted",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (allGranted) StatusOnline else Accent,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp)),
                color = if (allGranted) StatusOnline else Accent,
                trackColor = Surface700,
                strokeCap = StrokeCap.Round,
            )
        }

        // --- Carousel Horizontal Pager ---
        HorizontalPager(
            state = pagerState,
            contentPadding = PaddingValues(horizontal = 24.dp),
            pageSpacing = 16.dp,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { page ->
            val item = items[page]
            val granted = grantedStatus[item.id] == true
            val refused = item.permissions.any { refusedMap[it] == true } && !granted

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(20.dp))
                    .background(Surface900)
                    .border(1.dp, Edge, RoundedCornerShape(20.dp))
                    .padding(20.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState()),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    // Category Pill
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(Surface800)
                            .border(1.dp, Edge, RoundedCornerShape(999.dp))
                            .padding(horizontal = 12.dp, vertical = 4.dp),
                    ) {
                        Text(
                            text = item.category.uppercase(),
                            style = MaterialTheme.typography.labelSmall,
                            color = Slate400,
                            fontWeight = FontWeight.Bold,
                        )
                    }

                    Spacer(Modifier.height(20.dp))

                    // Large Icon Tile with Status Styling
                    Box(
                        modifier = Modifier
                            .size(80.dp)
                            .clip(RoundedCornerShape(22.dp))
                            .background(
                                when {
                                    granted -> StatusOnline.copy(alpha = 0.15f)
                                    refused -> StatusIdle.copy(alpha = 0.15f)
                                    else -> Accent.copy(alpha = 0.15f)
                                },
                            )
                            .border(
                                width = 1.dp,
                                color = when {
                                    granted -> StatusOnline.copy(alpha = 0.4f)
                                    refused -> StatusIdle.copy(alpha = 0.4f)
                                    else -> Accent.copy(alpha = 0.4f)
                                },
                                shape = RoundedCornerShape(22.dp),
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        BetweenUsIcon(
                            icon = item.icon,
                            tint = when {
                                granted -> StatusOnline
                                refused -> StatusIdle
                                else -> Accent
                            },
                            size = 38.dp,
                        )
                    }

                    Spacer(Modifier.height(16.dp))

                    // Title
                    Text(
                        text = item.title,
                        style = MaterialTheme.typography.headlineSmall,
                        color = Slate50,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )

                    Spacer(Modifier.height(8.dp))

                    // Primary Detail
                    Text(
                        text = item.detail,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Slate300,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 8.dp),
                    )

                    Spacer(Modifier.height(16.dp))

                    // Rationale Box
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(Surface800)
                            .border(1.dp, Edge, RoundedCornerShape(12.dp))
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                    ) {
                        Text(
                            text = item.rationale,
                            style = MaterialTheme.typography.bodySmall,
                            color = Slate400,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    Spacer(Modifier.height(16.dp))

                    // Status Pill / Action
                    when {
                        granted -> {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                modifier = Modifier
                                    .clip(RoundedCornerShape(999.dp))
                                    .background(StatusOnline.copy(alpha = 0.15f))
                                    .padding(horizontal = 14.dp, vertical = 6.dp),
                            ) {
                                BetweenUsIcon(BetweenUsIcons.Check, tint = StatusOnline, size = 16.dp)
                                Text(
                                    text = "Permission Granted",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = StatusOnline,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }
                        refused -> {
                            Chip(
                                text = "Refused — Open Settings",
                                tone = StatusIdle,
                                onClick = { BetweenUsPermissions.openSettings(context) },
                            )
                        }
                        else -> {
                            Chip(
                                text = "Required for ${item.title}",
                                tone = Slate400,
                                selected = false,
                            )
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(14.dp))

        // --- Pager Dot Indicators ---
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            items.indices.forEach { index ->
                val isCurrent = index == pagerState.currentPage
                val isGranted = grantedStatus[items[index].id] == true

                Box(
                    modifier = Modifier
                        .padding(horizontal = 4.dp)
                        .size(width = if (isCurrent) 22.dp else 8.dp, height = 8.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(
                            when {
                                isCurrent -> Accent
                                isGranted -> StatusOnline
                                else -> Surface700
                            },
                        )
                        .clickable {
                            scope.launch { pagerState.animateScrollToPage(index) }
                        },
                )
            }
        }

        Spacer(Modifier.height(14.dp))

        // --- Bottom Action Footer (WhatsApp Style) ---
        HorizontalDivider(color = Edge)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(Surface950)
                .padding(horizontal = 20.dp, vertical = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Main Action Button (WhatsApp Style: Allow active item or continue)
            BetweenUsButton(
                text = when {
                    allGranted -> "All Set — Continue"
                    isCurrentGranted && pagerState.currentPage < items.size - 1 -> "Next"
                    isCurrentGranted -> "Continue"
                    isCurrentRefused -> "Open Settings"
                    else -> "Allow ${currentItem.title}"
                },
                onClick = {
                    when {
                        allGranted -> {
                            BetweenUsPermissions.markIntroduced(context)
                            onDone()
                        }
                        isCurrentGranted && pagerState.currentPage < items.size - 1 -> {
                            scope.launch { pagerState.animateScrollToPage(pagerState.currentPage + 1) }
                        }
                        isCurrentGranted -> {
                            BetweenUsPermissions.markIntroduced(context)
                            onDone()
                        }
                        isCurrentRefused -> {
                            BetweenUsPermissions.openSettings(context)
                        }
                        else -> {
                            requestSingle(currentItem)
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            )

            if (!allGranted) {
                Spacer(Modifier.height(10.dp))
                // Secondary Batch Option
                OutlinedButton(
                    onClick = { requestAll() },
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = Slate300,
                    ),
                    border = BorderStroke(1.dp, Surface700),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(44.dp),
                ) {
                    Text(
                        text = "Allow All Permissions at Once",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }

            Spacer(Modifier.height(8.dp))
            Text(
                text = "You can skip anything. BetweenUs will ask again when needed.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
                textAlign = TextAlign.Center,
            )
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
            .background(Color(0xFF281E12))
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
                color = Slate100,
            )
            Text(
                text = "You won't receive message alerts or incoming call notifications.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate400,
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
                tint = Slate400,
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

