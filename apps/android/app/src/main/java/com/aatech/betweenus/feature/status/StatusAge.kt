package com.aatech.betweenus.feature.status

import java.time.Duration
import java.time.Instant

/**
 * How long ago a status was posted, in words.
 *
 * Its own function rather than `LastSeen`'s: a status is never more than a day
 * old, so every branch that one has for weekdays and dates is unreachable here,
 * and the branches this one needs - minutes, then hours - are the ones that
 * reduce to "today at 7:07 PM" there. Somebody glancing at a tray wants "12m
 * ago", not the clock.
 *
 * The port of `apps/desktop/src/features/status/age.ts`; if one changes, so
 * does the other.
 */
fun statusAge(iso: String, now: Instant = Instant.now()): String {
    val posted = runCatching { Instant.parse(iso) }.getOrNull() ?: return ""
    val elapsed = Duration.between(posted, now)

    // A phone clock a little behind the server's puts a fresh post in the
    // future. "just now" is the honest answer; "-1m ago" is not.
    if (elapsed.toMinutes() < 1) return "just now"
    if (elapsed.toHours() < 1) return "${elapsed.toMinutes()}m ago"
    // Nothing here lives past 24 hours, so hours is where it stops. A post
    // older than that is expired and about to be swept, and a "1d ago" branch
    // would exist only for rows nobody can see.
    return "${elapsed.toHours()}h ago"
}
