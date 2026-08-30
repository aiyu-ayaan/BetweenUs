package com.aatech.betweenus.core.store

import com.aatech.betweenus.core.data.PresenceStatus
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.time.temporal.ChronoUnit

/**
 * "online", or when somebody was last here, in words.
 *
 * The line under a name in a direct message's header and on the profile sheet.
 * It is read at a glance and never studied, so it says the least that still
 * places the moment: the clock for today, "yesterday" and the clock, the
 * weekday while a weekday still names one day, and the date once it stops.
 *
 * The port of `apps/desktop/src/services/last-seen.ts`, rule for rule - two
 * clients in the same conversation must not disagree about when somebody was
 * last here. If one changes, so does the other.
 *
 * Every timestamp is UTC on the wire and read in the reader's own zone, so the
 * clock in this line is the clock on the wall of whoever is looking at it.
 */
object LastSeen {
    /** Past this, a weekday no longer names exactly one day. */
    private val WEEK: Duration = Duration.ofDays(7)

    private val CLOCK: DateTimeFormatter = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)
    private val WEEKDAY: DateTimeFormatter = DateTimeFormatter.ofPattern("EEEE")
    private val DATE_THIS_YEAR: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMMM")
    private val DATE_WITH_YEAR: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMMM yyyy")

    /**
     * The whole line, ready to draw: `last seen today at 7:07 PM`.
     *
     * Null for an account nobody has ever seen go offline - a new one, or one
     * whose only sessions predate the column. The caller draws nothing at all
     * in that case rather than a date in 1970 or the word "never", which reads
     * as an accusation about somebody who simply signed up this morning.
     */
    fun label(
        iso: String?,
        now: LocalDateTime = LocalDateTime.now(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): String? {
        if (iso.isNullOrBlank()) return null

        val parsed = try {
            LocalDateTime.ofInstant(Instant.parse(iso), zone)
        } catch (_: DateTimeParseException) {
            return null
        }

        // Clamped to now, because a phone whose clock is a few minutes ahead of
        // the server's would otherwise be told somebody was last seen in the
        // future - and "last seen today at 3:34 PM" beside a status bar reading
        // 3:30 reads as broken software rather than as a wrong clock.
        val at = if (parsed.isAfter(now)) now else parsed

        // Every line carries the clock. A day on its own answers "roughly when"
        // and leaves the question people actually have - was that this morning
        // or ten minutes before I looked - to be worked out from nothing.
        val time = at.format(CLOCK)

        // Calendar days apart, not elapsed hours: 00:05 this morning is today
        // however few minutes ago, and 20:00 last night is yesterday however
        // recently. The message list's dividers count the same way - `Day.kt`.
        val days = ChronoUnit.DAYS.between(at.toLocalDate(), now.toLocalDate())

        return when {
            days == 0L -> "last seen today at $time"
            days == 1L -> "last seen yesterday at $time"
            Duration.between(at, now) < WEEK -> "last seen ${at.format(WEEKDAY)} at $time"
            else -> {
                val date = if (at.year == now.year) DATE_THIS_YEAR else DATE_WITH_YEAR
                "last seen ${at.format(date)} at $time"
            }
        }
    }

    /**
     * What the header under a name says, status and last-seen time together.
     *
     * One function rather than a conditional at every call site, because the
     * interesting case is the one that is easy to get wrong: somebody who is
     * *here* is not "last seen a moment ago", and drawing both is saying the
     * same thing twice with the second half already going stale.
     *
     * Idle and do-not-disturb are deliberately not spelled out. The coloured
     * dot beside the name already says which, and a header reading "do not
     * disturb" over a conversation somebody is about to type into is a worse
     * guess than "online" at what the reader wants to know - which is whether a
     * message will be read now.
     */
    fun line(
        status: PresenceStatus,
        lastSeenAt: String?,
        now: LocalDateTime = LocalDateTime.now(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): String? =
        if (status != PresenceStatus.OFFLINE) "online" else label(lastSeenAt, now, zone)

    /** The same line with its first letter raised, for a heading or a card. */
    fun sentence(
        status: PresenceStatus,
        lastSeenAt: String?,
        now: LocalDateTime = LocalDateTime.now(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): String? = line(status, lastSeenAt, now, zone)?.replaceFirstChar { it.uppercase() }
}
