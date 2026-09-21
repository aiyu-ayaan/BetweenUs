package com.aatech.betweenus.feature.schedule

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.ServerClock
import com.aatech.betweenus.core.store.Scheduling
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.EmptyState
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate500
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private fun whenLabel(at: Long): String =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .format(Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault()))

/**
 * "When?": a few presets, each showing the time it resolves to, and a custom
 * date-and-time made of the system's own two pickers. Used for a scheduled
 * message, a reminder, and changing either one's time.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WhenSheet(
    title: String,
    note: String,
    presets: List<Scheduling.Preset>,
    onPick: (Long) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val context = LocalContext.current
    var problem by remember { mutableStateOf<String?>(null) }

    fun choose(at: Long) {
        val refused = Scheduling.check(at, ServerClock.nowMs())
        if (refused != null) {
            problem = refused
            return
        }
        onPick(at)
        onDismiss()
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                color = Slate100,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            Text(
                text = note,
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
                modifier = Modifier.padding(horizontal = 20.dp).padding(bottom = 8.dp),
            )
            presets.forEach { preset ->
                val at = Scheduling.resolve(preset, ServerClock.nowMs())
                ListRow(
                    title = preset.label,
                    subtitle = whenLabel(at),
                    leading = { BetweenUsIcon(BetweenUsIcons.Clock, tint = Slate400) },
                    onClick = { choose(at) },
                )
            }
            ListRow(
                title = "Pick a date and time",
                leading = { BetweenUsIcon(BetweenUsIcons.Clock, tint = Slate400) },
                onClick = {
                    val start = LocalDateTime.now().plusHours(1)
                    DatePickerDialog(
                        context,
                        { _, year, month, day ->
                            TimePickerDialog(
                                context,
                                { _, hour, minute ->
                                    choose(
                                        LocalDateTime.of(year, month + 1, day, hour, minute)
                                            .atZone(ZoneId.systemDefault())
                                            .toInstant()
                                            .toEpochMilli(),
                                    )
                                },
                                start.hour,
                                0,
                                android.text.format.DateFormat.is24HourFormat(context),
                            ).show()
                        },
                        start.year,
                        start.monthValue - 1,
                        start.dayOfMonth,
                    ).show()
                },
            )
            problem?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = Danger,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                )
            }
        }
    }
}

/**
 * Scheduled messages and reminders across every conversation, with change
 * time, send now and cancel on each. Global for the reason the desktop's is:
 * they are held by this phone, not by a channel.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduledSheet(onOpenChannel: (String) -> Unit, onDismiss: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val context = LocalContext.current
    val items by Scheduled.items.collectAsState()
    var changing by remember { mutableStateOf<Scheduling.Item?>(null) }
    val now = ServerClock.nowMs()

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding()) {
            Text(
                text = "Scheduled",
                style = MaterialTheme.typography.titleMedium,
                color = Slate100,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            if (items.isEmpty()) {
                EmptyState(
                    icon = BetweenUsIcons.Clock,
                    title = "Nothing scheduled",
                    detail = "Long-press the send button to send later, or long-press a message to be reminded.",
                )
            } else {
                LazyColumn {
                    items(items, key = { it.id }) { item ->
                        val where = if (item.serverId != null) "#${item.channelName}" else item.channelName
                        val state = Scheduling.stateOf(item, now)
                        val status = when (state) {
                            Scheduling.State.WAITING -> ""
                            Scheduling.State.DUE -> " - sending"
                            Scheduling.State.LATE -> " - overdue, goes when this phone can"
                            Scheduling.State.RETRYING -> " - could not send, trying again"
                            Scheduling.State.FAILED -> " - not sent: ${item.error ?: "failed"}"
                        }
                        Column {
                            ListRow(
                                title = if (item.kind == Scheduling.Kind.REMINDER) {
                                    "Remind: ${item.excerpt.ifEmpty { "a message" }}"
                                } else {
                                    item.text
                                },
                                subtitle = "$where - ${whenLabel(item.dueAt)}$status",
                                leading = { BetweenUsIcon(BetweenUsIcons.Clock, tint = Slate400) },
                                onClick = { onOpenChannel(item.channelId) },
                            )
                            Row(
                                Modifier.padding(horizontal = 12.dp),
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                TextButton(onClick = { changing = item }) { Text("Change time") }
                                if (item.kind == Scheduling.Kind.MESSAGE) {
                                    TextButton(onClick = { Scheduled.sendNow(context, item.id) }) {
                                        Text(if (state == Scheduling.State.FAILED) "Try again" else "Send now")
                                    }
                                }
                                TextButton(onClick = { Scheduled.cancel(context, item.id) }) {
                                    Text("Cancel", color = Danger)
                                }
                            }
                        }
                    }
                }
            }
            Text(
                text = "Kept on this phone only and sent from it - the server never holds them. " +
                    "If the phone was off at the time, they go when it next can, and say so.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
                modifier = Modifier.padding(20.dp),
            )
        }
    }

    changing?.let { item ->
        WhenSheet(
            title = "Change time",
            note = "",
            presets = if (item.kind == Scheduling.Kind.MESSAGE) Scheduling.SEND_PRESETS else Scheduling.REMIND_PRESETS,
            onPick = { Scheduled.reschedule(context, item.id, it) },
            onDismiss = { changing = null },
        )
    }
}
