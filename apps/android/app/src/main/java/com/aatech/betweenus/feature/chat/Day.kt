package com.aatech.betweenus.feature.chat

import android.content.Context
import android.text.format.DateFormat
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
import com.aatech.betweenus.core.data.ServerClock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.chrono.IsoChronology
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeFormatterBuilder
import java.time.format.FormatStyle
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
 * Every timestamp on the wire is UTC (`toISOString()` on the services' side),
 * and everything here reads it in the reader's own zone: a message sent at 20:00
 * in Berlin is 23:30 to somebody in Kolkata, under that reader's day, and both
 * of them see their own clock. Nothing is ever drawn in the sender's zone or in
 * UTC - which is also why days are local days, so a message sent at 00:30 here
 * belongs under today's divider even where the server called it yesterday.
 *
 * The desktop's `day.ts` is the same rule; if one changes, so does the other.
 */

/** Spelled out, in the reader's own order: "22 August 2026", "August 22, 2026". */
private val dateFormat: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG)

/** The local day `iso` falls in, or null if it is not a timestamp. */
private fun dayOf(iso: String): LocalDate? = runCatching {
    Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDate()
}.getOrNull()

/** Whether two timestamps fall on the same local day. */
fun sameDay(a: String, b: String): Boolean {
    val one = dayOf(a) ?: return false
    return one == dayOf(b)
}

/**
 * The divider's words for the day `iso` falls in.
 *
 * "Today" is the *server's* today, not this phone's: a device whose clock is a
 * day out would otherwise file yesterday's conversation under "Today" and
 * today's under a weekday, which reads as broken software rather than as a
 * wrong clock. See `ServerClock`.
 */
fun dayLabel(iso: String, today: LocalDate = ServerClock.today()): String {
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

/**
 * The clock time on a bubble, in the device's own setting for it.
 *
 * Android has a *Use 24-hour format* switch, and it is not the locale's
 * business: somebody on `en_IN` may have turned it on, somebody on `de_DE` may
 * have turned it off, and a chat showing 14:32 to a reader whose phone says
 * 2:32 PM everywhere else is the one thing on screen out of step with the
 * device. `DateFormat.is24HourFormat` is that switch.
 *
 * The pattern is still the locale's, though - the separator and the order are
 * not ours to pick - so this takes the locale's own short time pattern and
 * moves only the hour field onto the clock the reader asked for. The desktop
 * gets the same answer from `Intl` for free; this is that, by hand, because
 * `is24HourFormat` is a device setting `Intl` has no equivalent of.
 */
fun clockPattern(is24Hour: Boolean, locale: Locale = Locale.getDefault()): String {
    val short = DateTimeFormatterBuilder.getLocalizedDateTimePattern(
        null,
        FormatStyle.SHORT,
        IsoChronology.INSTANCE,
        locale,
    )
    val has12 = short.contains('h')
    if (is24Hour == !has12) return short
    return if (is24Hour) {
        // Drop the AM/PM field and whatever space was holding it on.
        short.replace('h', 'H').replace(Regex("""\s*a\s*"""), "").trim()
    } else {
        short.replace('H', 'h').trim() + " a"
    }
}

/** The clock time of `iso`, in the reader's zone and the device's format. */
fun clockTime(context: Context, iso: String): String = runCatching {
    val pattern = clockPattern(DateFormat.is24HourFormat(context))
    Instant.parse(iso)
        .atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern(pattern, Locale.getDefault()))
}.getOrDefault("")
