package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/**
 * Which day a message was sent, in words.
 *
 * A conversation read weeks later is a wall of times with no dates on it: the
 * clock says 09:14 and nothing says whether that was this morning or in March.
 * The divider between two days is what carries that, so the label only has to
 * name the day well enough to place it - "Today", "Yesterday", the weekday for
 * the week just gone, and the full date once a week has passed and the weekday
 * has stopped being unambiguous.
 *
 * Days are the reader's local days, not UTC ones: a message sent at 00:30 here
 * belongs under today's divider even where the server called it yesterday. The
 * desktop's `day.ts` is the same rule; if one changes, so does the other.
 */

private val dateFormat = DateTimeFormatter.ofPattern("d MMMM yyyy")

/** The local day `iso` falls in, or null if it is not a timestamp. */
private fun dayOf(iso: String): LocalDate? = runCatching {
    Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDate()
}.getOrNull()

/** Whether two timestamps fall on the same local day. */
fun sameDay(a: String, b: String): Boolean {
    val one = dayOf(a) ?: return false
    return one == dayOf(b)
}

/** The divider's words for the day `iso` falls in. */
fun dayLabel(iso: String, today: LocalDate = LocalDate.now()): String {
    val day = dayOf(iso) ?: return ""
    return when (today.toEpochDay() - day.toEpochDay()) {
        0L -> "Today"
        1L -> "Yesterday"
        // Inside the week just gone a weekday names the day on its own; past
        // that it would name two different days, so the date takes over.
        in 2L..6L -> day.dayOfWeek.getDisplayName(TextStyle.FULL, Locale.getDefault())
        else -> day.format(dateFormat)
    }
}

/**
 * Which day the messages under it were sent.
 *
 * The times on the bubbles are only clock times, so a conversation read later
 * says 09:14 without saying which morning. This is the only thing in the list
 * that carries the date, which is why it sits above the first message of every
 * day rather than only where a gap looks long enough to need one.
 */
@Composable
fun DayDivider(iso: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = dayLabel(iso),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .background(
                    MaterialTheme.colorScheme.surfaceVariant,
                    RoundedCornerShape(50),
                )
                .padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}
