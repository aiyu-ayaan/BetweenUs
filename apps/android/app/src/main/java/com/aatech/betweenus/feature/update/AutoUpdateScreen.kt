package com.aatech.betweenus.feature.update

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
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
import com.aatech.betweenus.ui.theme.Surface900
import com.aatech.betweenus.ui.theme.Surface950
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

/**
 * Auto update: the switch, the channel, and the button that asks now.
 *
 * One screen rather than four rows buried in settings, because the choice on it
 * is a real one - an alpha is a build nobody has finished testing, and somebody
 * choosing it should be reading the paragraph that says so rather than flipping
 * a toggle in a list.
 */
@Composable
fun AutoUpdateScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var enabled by remember { mutableStateOf(Updates.enabled) }
    var channel by remember { mutableStateOf(Updates.channel) }
    var snoozeDays by remember { mutableStateOf(Updates.snoozeDays) }
    val state by Updates.state.collectAsState()

    Column(Modifier.fillMaxSize().background(Ground).systemBarsPadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().background(Surface950).padding(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(BetweenUsIcons.ChevronLeft, "Back", onBack)
            Text(
                text = "Auto update",
                style = MaterialTheme.typography.titleMedium,
                color = Slate50,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
        }
        HorizontalDivider(color = Edge)

        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 40.dp)) {
            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(Surface700)
                    .clickable {
                        enabled = !enabled
                        Updates.enabled = enabled
                    }
                    .padding(horizontal = 20.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Enable auto update",
                    style = MaterialTheme.typography.titleMedium,
                    color = Slate50,
                    modifier = Modifier.weight(1f),
                )
                Switch(
                    checked = enabled,
                    onCheckedChange = {
                        enabled = it
                        Updates.enabled = it
                    },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = Slate100,
                        checkedTrackColor = Accent,
                        uncheckedTrackColor = Surface900,
                        uncheckedBorderColor = Surface900,
                        uncheckedThumbColor = Slate400,
                    ),
                )
            }

            Spacer(Modifier.height(12.dp))
            SectionLabel("Update channel")
            UpdateChannel.entries.forEach { option ->
                ChannelRow(
                    channel = option,
                    selected = channel == option,
                    onSelect = {
                        channel = option
                        Updates.channel = option
                    },
                )
            }

            SectionLabel("When you say not now")
            ListRow(
                title = "Ask again in $snoozeDays ${if (snoozeDays == 1) "day" else "days"}",
                subtitle = "How long the prompt stays away for after it is snoozed.",
                leading = { BetweenUsIcon(BetweenUsIcons.Bell, tint = Slate400) },
                trailing = {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf(1, 3, 7).forEach { days ->
                            Chip(
                                text = "$days",
                                selected = snoozeDays == days,
                                onClick = {
                                    snoozeDays = days
                                    Updates.snoozeDays = days
                                },
                            )
                        }
                    }
                },
            )

            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (state is UpdateState.Checking) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = Accent,
                    )
                    Spacer(Modifier.size(10.dp))
                }
                Chip(
                    text = "Check for updates",
                    tone = Slate100,
                    onClick = { scope.launch { Updates.check(manual = true) } },
                )
            }

            Spacer(Modifier.height(12.dp))

            // What the check found. The manual button is the only thing that
            // says "nothing new" out loud; the launch check stays quiet.
            when (val current = state) {
                is UpdateState.UpToDate -> Notice(
                    message = "BetweenUs ${Updates.installedName} is the newest build on ${channel.label.lowercase()}.",
                    tone = StatusOnline,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )

                is UpdateState.Failed -> Notice(
                    message = current.message,
                    tone = Danger,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )

                is UpdateState.Available -> UpdateOffer(
                    release = current.release,
                    detail = current.apk.name,
                    action = "Download ${sizeOf(current.apk.size)}",
                    onAction = {
                        scope.launch {
                            runCatching { Updates.download(current.release, current.apk) }
                                .onFailure { Updates.fail(it.message ?: "The download failed") }
                        }
                    },
                )

                is UpdateState.Downloading -> Column(Modifier.padding(horizontal = 16.dp)) {
                    Text(
                        text = "Downloading ${current.release.name}…",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Slate400,
                    )
                    Spacer(Modifier.height(8.dp))
                    LinearProgressIndicator(
                        progress = { current.progress },
                        modifier = Modifier.fillMaxWidth(),
                        color = Accent,
                        trackColor = Surface700,
                    )
                }

                is UpdateState.Ready -> UpdateOffer(
                    release = current.release,
                    detail = "Downloaded. Android will ask before it replaces this build.",
                    action = "Install",
                    onAction = {
                        if (Updates.canInstall(context)) {
                            scope.launch {
                                runCatching { Updates.install(context, current.file) }
                                    .onFailure { Updates.fail(it.message ?: "The install failed") }
                            }
                        } else {
                            Updates.requestInstallPermission(context)
                        }
                    },
                )

                else -> Unit
            }

            Spacer(Modifier.height(16.dp))
            HorizontalDivider(color = Edge)
            Spacer(Modifier.height(16.dp))

            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                BetweenUsIcon(BetweenUsIcons.Shield, tint = Slate400)
                Column {
                    Text(
                        text = channel.detail,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Slate400,
                    )
                    if (channel != UpdateChannel.STABLE) {
                        Spacer(Modifier.height(10.dp))
                        Text(
                            text = "Pre-release builds preview new features and changes before " +
                                "they are finished. There will be some instability in these " +
                                "versions, so please do not hesitate to report anything you run " +
                                "into - it is the whole reason they exist.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Slate500,
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = "Updates come from the GitHub releases of ${Releases.REPOSITORY}, " +
                            "and the build downloaded is the one for this device rather than the " +
                            "universal one. Android asks before anything is replaced.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Slate500,
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = "Installed ${Updates.installedName}" + lastCheckedSuffix(),
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate500,
                    )
                }
            }
        }
    }
}

@Composable
private fun ChannelRow(channel: UpdateChannel, selected: Boolean, onSelect: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onSelect)
            .padding(horizontal = 20.dp, vertical = 4.dp)
            .heightIn(min = 56.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = channel.label,
            style = MaterialTheme.typography.titleMedium,
            color = Slate50,
            modifier = Modifier.weight(1f),
        )
        RadioButton(
            selected = selected,
            onClick = onSelect,
            colors = RadioButtonDefaults.colors(
                selectedColor = Slate50,
                unselectedColor = Slate500,
            ),
        )
    }
}

/** A release on offer, with the one button that moves it along. */
@Composable
private fun UpdateOffer(
    release: Release,
    detail: String,
    action: String,
    onAction: () -> Unit,
) {
    Column(Modifier.padding(horizontal = 16.dp)) {
        Text(release.name, style = MaterialTheme.typography.titleMedium, color = Slate50)
        Text(detail, style = MaterialTheme.typography.bodySmall, color = Slate500)
        if (release.notes.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(
                text = release.notes.trim().lines().take(12).joinToString("\n"),
                style = MaterialTheme.typography.bodySmall,
                color = Slate400,
            )
        }
        Spacer(Modifier.height(12.dp))
        BetweenUsButton(text = action, onClick = onAction)
    }
}

private fun lastCheckedSuffix(): String {
    val checked = Updates.lastChecked
    if (checked == 0L) return ""
    val when_ = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
        .format(Date(checked))
    return " · checked $when_"
}

/** Megabytes, because that is the number that decides whether now is a good moment. */
internal fun sizeOf(bytes: Long): String =
    if (bytes <= 0) "" else "(${"%.1f".format(bytes / 1_000_000.0)} MB)"
