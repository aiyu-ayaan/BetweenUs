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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import com.aatech.betweenus.core.store.ThemePreferences
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.SectionLabel
import android.os.Build
import com.aatech.betweenus.ui.theme.ACCENT_PRESETS
import com.aatech.betweenus.ui.theme.ANDROID_THEMES
import com.aatech.betweenus.ui.theme.BetweenUsMotion

/**
 * Dedicated Themes & Appearance screen for BetweenUs Android.
 *
 * Provides a dedicated workbench preview, OS scheme synchronization,
 * Material You dynamic theming, category filtering, 16 curated theme cards,
 * and custom accent tint pickers.
 */
@Composable
fun ThemesScreen(
    onBack: () -> Unit,
) {
    val currentTheme by ThemePreferences.selectedTheme.collectAsState()
    val followSystem by ThemePreferences.followSystem.collectAsState()
    val dynamicColor by ThemePreferences.dynamicColor.collectAsState()
    val currentAccent by ThemePreferences.customAccentId.collectAsState()

    val isDynamicSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val activeDef = ANDROID_THEMES[currentTheme] ?: ANDROID_THEMES["dark"]!!

    var categoryFilter by remember { mutableStateOf("all") }
    val themeList = remember { ANDROID_THEMES.values.toList() }

    val filteredThemes = remember(categoryFilter) {
        themeList.filter { theme ->
            when (categoryFilter) {
                "all" -> true
                "light" -> !theme.isDark
                "developer" -> theme.category == "Developer"
                "vibrant" -> theme.category == "Vibrant" || theme.category == "Warm" || theme.category == "Pastel"
                "signature" -> theme.category == "Signature" || theme.category == "Monochrome" || theme.category == "Palette"
                else -> true
            }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding(),
    ) {
        // Sticky Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .padding(start = 4.dp, end = 12.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(BetweenUsIcons.ChevronLeft, "Back", onBack)
            Text(
                text = "Appearance & Themes",
                style = MaterialTheme.typography.titleLargeEmphasized,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
        }

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 32.dp),
        ) {
            // Live Preview Sandbox Card
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
                        Text(
                            text = "Live Preview",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Text(
                            text = activeDef.name,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    // Simulated message container
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                            .padding(12.dp),
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(24.dp)
                                        .clip(CircleShape)
                                        .background(MaterialTheme.colorScheme.primary),
                                )
                                Column {
                                    Text(
                                        text = "BetweenUs Workbench",
                                        style = MaterialTheme.typography.titleSmall,
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                    Text(
                                        text = "Theme preview · Real-time rendering",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }

                            Box(
                                modifier = Modifier
                                    .align(Alignment.End)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(MaterialTheme.colorScheme.primary)
                                    .padding(horizontal = 10.dp, vertical = 6.dp),
                            ) {
                                Text(
                                    text = "Looking crisp and vivid! ✨",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onPrimary,
                                )
                            }
                        }
                    }
                }
            }

            // System Auto-Sync Switch
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainer)
                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp))
                    .padding(16.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f).padding(end = 12.dp)) {
                        Text(
                            text = "Sync with system theme",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            text = "Automatically adapt between Daylight and dark themes based on your device settings.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = followSystem,
                        onCheckedChange = { ThemePreferences.setFollowSystem(it) },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = MaterialTheme.colorScheme.onPrimary,
                            checkedTrackColor = MaterialTheme.colorScheme.primary,
                            uncheckedThumbColor = MaterialTheme.colorScheme.outline,
                            uncheckedTrackColor = MaterialTheme.colorScheme.surfaceContainerHighest,
                        ),
                    )
                }
            }

            // Dynamic Theming (Material You) Switch
            if (isDynamicSupported) {
                Spacer(Modifier.height(10.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.surfaceContainer)
                        .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp))
                        .padding(16.dp),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f).padding(end = 12.dp)) {
                            Text(
                                text = "Dynamic theming (Material You)",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Spacer(Modifier.height(2.dp))
                            Text(
                                text = "Extract palette and accent tones dynamically from your Android wallpaper colors.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(
                            checked = dynamicColor,
                            onCheckedChange = { ThemePreferences.setDynamicColor(it) },
                            colors = SwitchDefaults.colors(
                                checkedThumbColor = MaterialTheme.colorScheme.onPrimary,
                                checkedTrackColor = MaterialTheme.colorScheme.primary,
                                uncheckedThumbColor = MaterialTheme.colorScheme.outline,
                                uncheckedTrackColor = MaterialTheme.colorScheme.surfaceContainerHighest,
                            ),
                        )
                    }
                }
            }

            // Theme Catalog Header
            SectionLabel("Theme Collection (${themeList.size})")

            // Category Filter Pills
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf(
                    "all" to "All (${themeList.size})",
                    "signature" to "Signature & Dark",
                    "light" to "Light Mode",
                    "developer" to "Developer",
                    "vibrant" to "Vibrant & Warm",
                ).forEach { (id, label) ->
                    val isCatActive = categoryFilter == id
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (isCatActive) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh)
                            .clickable { categoryFilter = id }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                    ) {
                        Text(
                            text = label,
                            style = MaterialTheme.typography.labelMedium,
                            color = if (isCatActive) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            Spacer(Modifier.height(8.dp))

            val effectSpec = BetweenUsMotion.effect<Float>()
            val spatialFastSpec = BetweenUsMotion.spatialFast<Float>()

            // Animated Theme Grid
            AnimatedContent(
                targetState = filteredThemes,
                transitionSpec = {
                    (fadeIn(effectSpec) + scaleIn(spatialFastSpec, initialScale = 0.98f))
                        .togetherWith(fadeOut(effectSpec) + scaleOut(spatialFastSpec, targetScale = 0.98f))
                },
                label = "ThemeGridTransition",
            ) { themes ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    themes.chunked(2).forEach { rowThemes ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            rowThemes.forEach { theme ->
                                val isSelected = currentTheme == theme.id
                                val borderColor by animateColorAsState(
                                    targetValue = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                                    animationSpec = BetweenUsMotion.effect(),
                                    label = "CardBorderColor",
                                )
                                Box(
                                    modifier = Modifier
                                        .weight(1f)
                                        .clip(RoundedCornerShape(14.dp))
                                        .background(MaterialTheme.colorScheme.surfaceContainer)
                                        .border(
                                            width = if (isSelected) 2.dp else 1.dp,
                                            color = borderColor,
                                            shape = RoundedCornerShape(14.dp),
                                        )
                                        .clickable { ThemePreferences.setTheme(theme.id) }
                                        .padding(10.dp),
                                ) {
                                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                        // Visual Palette Box
                                        Box(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .height(44.dp)
                                                .clip(RoundedCornerShape(8.dp))
                                                .background(theme.previewGround),
                                        ) {
                                            Row(
                                                modifier = Modifier
                                                    .fillMaxSize()
                                                    .padding(4.dp),
                                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                            ) {
                                                Box(
                                                    modifier = Modifier
                                                        .width(18.dp)
                                                        .fillMaxHeight()
                                                        .clip(RoundedCornerShape(4.dp))
                                                        .background(theme.palette.surface950),
                                                )
                                                Box(
                                                    modifier = Modifier
                                                        .weight(1f)
                                                        .fillMaxHeight()
                                                        .clip(RoundedCornerShape(4.dp))
                                                        .background(theme.previewSurface),
                                                ) {
                                                    Box(
                                                        modifier = Modifier
                                                            .padding(5.dp)
                                                            .size(10.dp)
                                                            .clip(CircleShape)
                                                            .background(theme.previewAccent),
                                                    )
                                                }
                                            }
                                        }

                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Text(
                                                text = theme.name,
                                                style = MaterialTheme.typography.titleSmall,
                                                color = MaterialTheme.colorScheme.onSurface,
                                                maxLines = 1,
                                                modifier = Modifier.weight(1f, fill = false),
                                            )
                                            if (isSelected) {
                                                BetweenUsIcon(
                                                    BetweenUsIcons.Check,
                                                    tint = MaterialTheme.colorScheme.primary,
                                                    size = 16.dp,
                                                )
                                            }
                                        }

                                        Text(
                                            text = theme.description,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            maxLines = 2,
                                        )

                                        Box(
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(6.dp))
                                                .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                                                .padding(horizontal = 6.dp, vertical = 2.dp),
                                        ) {
                                            Text(
                                                text = theme.category,
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                }
                            }
                            if (rowThemes.size == 1) {
                                Spacer(Modifier.weight(1f))
                            }
                        }
                    }
                }
            }

            // Custom Accent Tint Section
            SectionLabel("Custom Accent Tint")
            Text(
                text = "Choose an accent tint to personalize active highlights, buttons, and badges.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
            )

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ACCENT_PRESETS.forEach { preset ->
                    val isAccentSelected = currentAccent == preset.id
                    val dotColor = preset.color ?: MaterialTheme.colorScheme.primary
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(16.dp))
                            .background(
                                if (isAccentSelected) MaterialTheme.colorScheme.surfaceContainerHigh
                                else MaterialTheme.colorScheme.surfaceContainer
                            )
                            .border(
                                width = if (isAccentSelected) 2.dp else 1.dp,
                                color = if (isAccentSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                                shape = RoundedCornerShape(16.dp),
                            )
                            .clickable { ThemePreferences.setCustomAccent(preset.id) }
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(12.dp)
                                    .clip(CircleShape)
                                    .background(dotColor),
                            )
                            Text(
                                text = preset.label,
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                    }
                }
            }
        }
    }
}
