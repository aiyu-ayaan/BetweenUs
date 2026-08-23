package com.aatech.betweenus.feature.settings

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.CallAnalytics
import com.aatech.betweenus.core.data.CallHistoryEntry
import com.aatech.betweenus.core.data.CallLinkReport
import com.aatech.betweenus.core.data.CallTransportSplit
import com.aatech.betweenus.core.data.CallUsageTotals
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.theme.Accent
import com.aatech.betweenus.ui.theme.Amber200
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Edge
import com.aatech.betweenus.ui.theme.Ground
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate50
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.Surface700
import com.aatech.betweenus.ui.theme.Surface900
import com.aatech.betweenus.ui.theme.Surface950
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Calls & Data: what this account's calls have cost, and what each one did.
 *
 * The same page the desktop and web clients draw, from the same two endpoints,
 * because the log is per account and not per device - a call taken on a phone
 * and one taken on a laptop belong in one list or the list is wrong on both.
 *
 * Everything here is measured by the clients. Media goes directly between the
 * people in a call, so nothing in the backend is in the path to count a byte,
 * and a call the app was killed in reports nothing at all - which the page says
 * rather than drawing as a zero.
 */
@Composable
fun CallUsageScreen(onBack: () -> Unit) {
    var days by remember { mutableStateOf(30) }
    var analytics by remember { mutableStateOf<CallAnalytics?>(null) }
    var entries by remember { mutableStateOf<List<CallHistoryEntry>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(days) {
        analytics = null
        error = null
        runCatching {
            val usage = BetweenUsApi.callAnalytics(days)
            val history = BetweenUsApi.callHistory()
            usage to history
        }.onSuccess { (usage, history) ->
            analytics = usage
            entries = history
        }.onFailure {
            error = it.message ?: "Could not load your calls"
        }
    }

    Column(Modifier.fillMaxSize().background(Ground).systemBarsPadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().background(Surface950).padding(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(BetweenUsIcons.ChevronLeft, "Back", onBack)
            Text(
                text = "Calls & data",
                style = MaterialTheme.typography.titleMedium,
                color = Slate50,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
        }
        HorizontalDivider(color = Edge)

        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 40.dp)) {
            Text(
                text = "Every call this account has been in, and what it moved. Media goes " +
                    "directly between the people in a call, so these are your own devices' " +
                    "numbers rather than a server's.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate400,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            )

            error?.let { Notice(it, Danger, Modifier.padding(horizontal = 16.dp)) }

            Row(
                modifier = Modifier.padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for (range in listOf(7, 30, 90)) {
                    Chip(
                        text = "$range days",
                        selected = days == range,
                        onClick = { days = range },
                    )
                }
            }

            val usage = analytics
            if (usage == null && error == null) {
                Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Accent)
                }
            }

            if (usage != null) {
                Spacer(Modifier.height(12.dp))
                Totals(usage.totals, usage.transport)
                UsageChart(usage)
                Ranked(
                    title = "Busiest channels",
                    empty = "No calls in this window.",
                    rows = usage.channels.map { channel ->
                        RankedRow(
                            key = channel.channelId,
                            label = channel.serverName?.let { "$it · ${channel.channelName}" }
                                ?: channel.channelName,
                            value = duration(channel.totals.seconds),
                            sub = bytes(channel.totals.bytes),
                        )
                    },
                )
                Ranked(
                    title = "Most time with",
                    empty = "Nobody else was in them.",
                    rows = usage.peers.map { peer ->
                        RankedRow(
                            key = peer.id,
                            label = peer.label,
                            value = duration(peer.seconds),
                            sub = "${peer.calls} ${if (peer.calls == 1) "call" else "calls"}",
                        )
                    },
                )
            }

            SectionLabel("Call history")
            Text(
                text = "Your last 50 calls, newest first. Tap one for what each connection in " +
                    "it did.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            Spacer(Modifier.height(8.dp))

            if (entries?.isEmpty() == true) {
                Text(
                    text = "No calls yet. Join a voice channel and this fills itself in.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Slate500,
                    modifier = Modifier.padding(16.dp),
                )
            }

            for (entry in entries.orEmpty()) {
                CallRow(
                    entry = entry,
                    expanded = open == entry.id,
                    onToggle = { open = if (open == entry.id) null else entry.id },
                )
            }
        }
    }
}

/** The three answers somebody opens this page for, before any of the detail. */
@Composable
private fun Totals(totals: CallUsageTotals, transport: CallTransportSplit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Total(
            label = "Data used",
            value = bytes(totals.bytes),
            detail = "${bytes(totals.bytesSent)} up · ${bytes(totals.bytesReceived)} down",
            modifier = Modifier.weight(1f),
        )
        Total(
            label = "Time in calls",
            value = duration(totals.seconds),
            detail = "across ${totals.calls} ${if (totals.calls == 1) "call" else "calls"}",
            modifier = Modifier.weight(1f),
        )
    }
    Spacer(Modifier.height(8.dp))
    Total(
        label = "How it connected",
        value = describeTransport(transport),
        detail = if (transport.relay > 0) {
            "${transport.relay} of ${transport.known + transport.unknown} links went through a relay"
        } else {
            "nothing needed a relay"
        },
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
    )
}

@Composable
private fun Total(label: String, value: String, detail: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Surface900)
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = Slate400)
        Text(value, style = MaterialTheme.typography.titleMedium, color = Slate100)
        Text(detail, style = MaterialTheme.typography.bodySmall, color = Slate500)
    }
}

/**
 * A day per bar, sent stacked on received.
 *
 * Scaled to the busiest day in the window rather than to a fixed ceiling: what
 * is read off this is the shape of a month, and a scale that never moves draws
 * every ordinary week as a flat line along the bottom.
 */
@Composable
private fun UsageChart(analytics: CallAnalytics) {
    val peak = analytics.daily.maxOfOrNull { it.totals.bytes }?.coerceAtLeast(1L) ?: 1L

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(12.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Surface900)
            .padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Data per day",
                style = MaterialTheme.typography.labelSmall,
                color = Slate400,
                modifier = Modifier.weight(1f),
            )
            Text(
                "busiest day ${bytes(peak)}",
                style = MaterialTheme.typography.labelSmall,
                color = Slate500,
            )
        }
        Spacer(Modifier.height(10.dp))

        Row(
            modifier = Modifier.fillMaxWidth().height(96.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            for (day in analytics.daily) {
                Column(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    verticalArrangement = Arrangement.Bottom,
                ) {
                    Bar(day.totals.bytesSent, peak, Accent)
                    Bar(day.totals.bytesReceived, peak, Accent.copy(alpha = 0.4f))
                    // A day with nothing in it still gets a floor, so the axis
                    // reads as a row of days rather than as a gap.
                    if (day.totals.bytes == 0L) {
                        Box(Modifier.fillMaxWidth().height(2.dp).background(Surface700))
                    }
                }
            }
        }

        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                analytics.daily.firstOrNull()?.date.orEmpty(),
                style = MaterialTheme.typography.labelSmall,
                color = Slate500,
                modifier = Modifier.weight(1f),
            )
            Text(
                "■ sent  ■ received",
                style = MaterialTheme.typography.labelSmall,
                color = Slate500,
            )
            Text(
                analytics.daily.lastOrNull()?.date.orEmpty(),
                style = MaterialTheme.typography.labelSmall,
                color = Slate500,
                modifier = Modifier.weight(1f),
                textAlign = TextAlign.End,
            )
        }
    }
}

/** One half of one day's bar, sized against the busiest day in the window. */
@Composable
private fun ColumnScope.Bar(value: Long, peak: Long, colour: Color) {
    if (value <= 0L) return
    Box(
        Modifier
            .fillMaxWidth()
            .weight((value.toFloat() / peak).coerceIn(0.01f, 1f))
            .background(colour),
    )
}

private data class RankedRow(
    val key: String,
    val label: String,
    val value: String,
    val sub: String,
)

@Composable
private fun Ranked(title: String, empty: String, rows: List<RankedRow>) {
    SectionLabel(title)
    if (rows.isEmpty()) {
        Text(
            text = empty,
            style = MaterialTheme.typography.bodySmall,
            color = Slate500,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
        return
    }
    for (row in rows) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                row.label,
                style = MaterialTheme.typography.bodyMedium,
                color = Slate100,
                modifier = Modifier.weight(1f),
            )
            Text(
                "${row.value} · ${row.sub}",
                style = MaterialTheme.typography.bodySmall,
                color = Slate400,
            )
        }
    }
}

/**
 * One call, and - once it is opened - one row per connection it held.
 *
 * The per-link rows are the part worth having: two people in the same call can
 * have completely different answers about whether it went direct, and an
 * expensive call is nearly always one link doing something the others were not.
 */
@Composable
private fun CallRow(entry: CallHistoryEntry, expanded: Boolean, onToggle: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Surface900)
            .clickable(onClick = onToggle)
            .padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = entry.serverName?.let { "$it · ${entry.channelName}" } ?: entry.channelName,
                style = MaterialTheme.typography.bodyMedium,
                color = Slate100,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = entry.durationSeconds?.let { duration(it) } ?: "no ending recorded",
                style = MaterialTheme.typography.bodySmall,
                color = Slate400,
            )
        }
        Text(
            text = "${when_(entry.joinedAt)} · ${who(entry)} · " +
                if (entry.bytes > 0) bytes(entry.bytes) else "no data recorded",
            style = MaterialTheme.typography.bodySmall,
            color = Slate500,
        )

        AnimatedVisibility(expanded) {
            Column(Modifier.padding(top = 10.dp)) {
                HorizontalDivider(color = Edge)
                Spacer(Modifier.height(8.dp))
                Fact("Started", stamp(entry.joinedAt))
                Fact("Ended", entry.endedAt?.let { stamp(it) } ?: "never recorded")
                Fact(
                    "Data",
                    if (entry.bytesSent + entry.bytesReceived > 0) {
                        "${bytes(entry.bytesSent)} up · ${bytes(entry.bytesReceived)} down"
                    } else {
                        "nothing reported"
                    },
                )

                Spacer(Modifier.height(8.dp))
                if (entry.links.isEmpty()) {
                    Text(
                        text = "No connection detail for this call. The client reports it on the " +
                            "way out, so a call the app was killed in - or one from an older " +
                            "build - has none.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate500,
                    )
                } else {
                    for (link in entry.links) LinkRow(link)
                }
            }
        }
    }
}

@Composable
private fun LinkRow(link: CallLinkReport) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(Surface950)
            .padding(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = link.username.ifBlank { link.userId },
                style = MaterialTheme.typography.bodyMedium,
                color = Slate100,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = when (link.transport) {
                    "relay" -> "relayed"
                    "direct" -> "direct"
                    else -> "unknown"
                },
                style = MaterialTheme.typography.labelSmall,
                color = if (link.transport == "relay") Amber200 else Slate400,
            )
        }
        Text(
            text = "${bytes(link.bytesSent)} up · ${bytes(link.bytesReceived)} down · " +
                (link.roundTripMs?.let { "$it ms" } ?: "no ping") + " · ${loss(link)} loss",
            style = MaterialTheme.typography.bodySmall,
            color = Slate500,
        )
    }
}

@Composable
private fun Fact(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = Slate500,
            modifier = Modifier.weight(1f),
        )
        Text(value, style = MaterialTheme.typography.bodySmall, color = Slate400)
    }
}

// --- formatting, ported from `apps/desktop/src/services` so the two agree ---

private fun bytes(value: Long): String {
    if (value < 1024) return "$value B"
    var scaled = value.toDouble() / 1024
    val units = listOf("KB", "MB", "GB")
    var unit = 0
    while (scaled >= 1024 && unit < units.size - 1) {
        scaled /= 1024
        unit += 1
    }
    return if (scaled < 10) {
        String.format(Locale.US, "%.1f %s", scaled, units[unit])
    } else {
        "${scaled.toInt()} ${units[unit]}"
    }
}

private fun duration(seconds: Int): String {
    val total = seconds.coerceAtLeast(0)
    val hours = total / 3600
    val minutes = (total % 3600) / 60
    val secs = total % 60
    val mmss = String.format(Locale.US, "%02d:%02d", minutes, secs)
    return if (hours > 0) "$hours:$mmss" else mmss
}

private fun loss(link: CallLinkReport): String {
    val total = link.packetsLost + link.packetsReceived
    if (total == 0L) return "no"
    return String.format(Locale.US, "%.1f%%", link.packetsLost.toDouble() / total * 100)
}

private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
    timeZone = TimeZone.getTimeZone("UTC")
}

private fun parse(value: String): Date? = runCatching { iso.parse(value.take(19)) }.getOrNull()

private fun stamp(value: String): String =
    parse(value)?.let { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(it) }
        ?: value

private fun when_(value: String): String {
    val at = parse(value) ?: return value
    val sameDay = DateFormat.getDateInstance().format(at) == DateFormat.getDateInstance().format(Date())
    return if (sameDay) {
        DateFormat.getTimeInstance(DateFormat.SHORT).format(at)
    } else {
        DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(at)
    }
}

/**
 * Who else was there. "Alone" is a real answer and worth saying: a call
 * somebody sat in by themselves waiting for anybody to join is the entry they
 * are most likely to be looking for.
 */
private fun who(entry: CallHistoryEntry): String {
    val names = entry.peers.map { it.label }
    return when {
        names.isEmpty() -> "alone"
        names.size <= 2 -> "with ${names.joinToString(", ")}"
        else -> "with ${names.take(2).joinToString(", ")} and ${names.size - 2} more"
    }
}

private fun describeTransport(transport: CallTransportSplit): String = when {
    transport.known == 0 -> "not measured"
    transport.relay == 0 -> "all direct"
    else -> "${transport.relay * 100 / transport.known}% relayed"
}
