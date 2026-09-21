package com.aatech.betweenus.core.store

import org.json.JSONArray
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Scheduled messages and reminders: the rules, with no storage and no clock.
 *
 * The port of `apps/desktop/src/services/schedule.ts`, rule for rule - read
 * that file's header for why both features are **local to the device** (the
 * server must never hold an unsent message, and holding sealed ciphertext for
 * later release would be a new server capability). On this phone the device
 * "running" means WorkManager waking the app at the due time; a phone that was
 * off or out of range then sends on the next wake and says it was late.
 *
 * Every function takes `now`, so a test can pin one. Wall-clock presets are
 * resolved with `ZonedDateTime`, so a daylight-saving change between now and
 * then still lands on 9:00.
 */
object Scheduling {

    /** Inside this, a send was merely slow. Past it, the phone was away. */
    const val LATE_GRACE_MS = 5 * 60_000L
    const val MIN_LEAD_MS = 60_000L
    const val MAX_AHEAD_MS = 366L * 24 * 60 * 60_000
    const val MAX_ATTEMPTS = 8
    const val MORNING_HOUR = 9

    enum class Preset(val label: String) {
        IN_20_MINUTES("In 20 minutes"),
        IN_30_MINUTES("In 30 minutes"),
        IN_1_HOUR("In 1 hour"),
        IN_3_HOURS("In 3 hours"),
        TOMORROW_MORNING("Tomorrow morning"),
        MONDAY_MORNING("Monday morning"),
    }

    val SEND_PRESETS = listOf(
        Preset.IN_30_MINUTES,
        Preset.IN_1_HOUR,
        Preset.TOMORROW_MORNING,
        Preset.MONDAY_MORNING,
    )

    val REMIND_PRESETS = listOf(
        Preset.IN_20_MINUTES,
        Preset.IN_1_HOUR,
        Preset.IN_3_HOURS,
        Preset.TOMORROW_MORNING,
    )

    enum class Kind { MESSAGE, REMINDER }

    /**
     * One thing waiting on this phone. A message has [text] to send; a
     * reminder has [messageId], [author] and an [excerpt] to show. One shape
     * for both, as on the desktop's union, so the list and the worker treat
     * them alike.
     */
    data class Item(
        val kind: Kind,
        val id: String,
        val channelId: String,
        val channelName: String,
        /** Null for a direct message. */
        val serverId: String?,
        val dueAt: Long,
        val createdAt: Long,
        val text: String = "",
        val messageId: String = "",
        val author: String = "",
        val excerpt: String = "",
        val attempts: Int = 0,
        val retryAt: Long? = null,
        val error: String? = null,
    )

    enum class State { WAITING, DUE, LATE, RETRYING, FAILED }

    private fun inMinutes(now: Long, minutes: Long): Long {
        val at = now + minutes * 60_000
        return (at + 59_999) / 60_000 * 60_000
    }

    private fun atLocal(now: Long, zone: ZoneId, days: Long, hour: Int): Long {
        val date = LocalDate.ofInstant(Instant.ofEpochMilli(now), zone).plusDays(days)
        return ZonedDateTime.of(date, java.time.LocalTime.of(hour, 0), zone).toInstant().toEpochMilli()
    }

    /** When a preset lands, from [now], in [zone]. */
    fun resolve(preset: Preset, now: Long, zone: ZoneId = ZoneId.systemDefault()): Long =
        when (preset) {
            Preset.IN_20_MINUTES -> inMinutes(now, 20)
            Preset.IN_30_MINUTES -> inMinutes(now, 30)
            Preset.IN_1_HOUR -> inMinutes(now, 60)
            Preset.IN_3_HOURS -> inMinutes(now, 180)
            Preset.TOMORROW_MORNING -> atLocal(now, zone, 1, MORNING_HOUR)
            Preset.MONDAY_MORNING -> {
                // The next Monday - on a Monday, the one after, never this morning.
                val day = LocalDateTime.ofInstant(Instant.ofEpochMilli(now), zone).dayOfWeek
                val ahead = ((DayOfWeek.MONDAY.value - day.value + 7) % 7).let { if (it == 0) 7 else it }
                atLocal(now, zone, ahead.toLong(), MORNING_HOUR)
            }
        }

    /** Null when [dueAt] is one this phone can honour, otherwise the reason. */
    fun check(dueAt: Long, now: Long): String? = when {
        dueAt < now + MIN_LEAD_MS -> "Pick a time at least a minute from now"
        dueAt > now + MAX_AHEAD_MS -> "Pick a time within the next year"
        else -> null
    }

    /** When the scheduler should next act on [item], or null for never on its own. */
    fun fireAt(item: Item): Long? {
        if (item.kind == Kind.REMINDER) return item.dueAt
        if (item.error != null && item.retryAt == null) return null
        return item.retryAt ?: item.dueAt
    }

    fun isLate(dueAt: Long, firedAt: Long): Boolean = firedAt - dueAt > LATE_GRACE_MS

    fun stateOf(item: Item, now: Long): State {
        if (item.kind == Kind.MESSAGE && item.error != null) {
            val retry = item.retryAt ?: return State.FAILED
            if (retry > now) return State.RETRYING
        }
        if (item.dueAt > now) return State.WAITING
        return if (isLate(item.dueAt, now)) State.LATE else State.DUE
    }

    /** Everything to act on now, soonest first. */
    fun ready(items: List<Item>, now: Long): List<Item> =
        items.filter { (fireAt(it) ?: Long.MAX_VALUE) <= now }.sortedBy { fireAt(it) }

    /** Milliseconds until the soonest thing is due, or null with nothing to wait for. */
    fun nextWake(items: List<Item>, now: Long): Long? =
        items.mapNotNull { fireAt(it) }.minOrNull()?.let { (it - now).coerceAtLeast(0) }

    /** No status is the offline case; a 4xx is the server saying no. */
    fun worthRetrying(status: Int?): Boolean =
        status == null || status == 408 || status == 429 || status >= 500

    fun retryDelayMs(attempts: Int): Long =
        (30_000L * (1L shl (attempts - 1).coerceIn(0, 20))).coerceAtMost(15 * 60_000L)

    fun afterFailure(item: Item, now: Long, status: Int?, message: String): Item {
        val attempts = item.attempts + 1
        val again = worthRetrying(status) && attempts < MAX_ATTEMPTS
        return item.copy(
            attempts = attempts,
            retryAt = if (again) now + retryDelayMs(attempts) else null,
            error = message,
        )
    }

    fun sendingNow(item: Item, now: Long): Item =
        item.copy(dueAt = now, attempts = 0, retryAt = null, error = null)

    fun rescheduled(item: Item, dueAt: Long): Item =
        if (item.kind == Kind.REMINDER) item.copy(dueAt = dueAt)
        else item.copy(dueAt = dueAt, attempts = 0, retryAt = null, error = null)

    /** Text only: files would have to be uploaded now, which is what this design refuses. */
    fun blocker(text: String, fileCount: Int, overflowChars: Int): String? = when {
        fileCount > 0 -> "Only text can be scheduled - send the files now"
        text.isBlank() -> "Write something to schedule"
        text.trim().length > overflowChars -> "Scheduled messages are limited to $overflowChars characters"
        else -> null
    }

    fun excerptOf(text: String, max: Int = 140): String {
        val line = text.replace(Regex("\\s+"), " ").trim()
        return if (line.length > max) line.take(max - 1) + "…" else line
    }

    /** The notification a reminder raises, as (title, body). */
    fun reminderNotice(item: Item, firedAt: Long): Pair<String, String> {
        val where = if (item.serverId != null) "#${item.channelName}" else item.channelName
        val late = if (isLate(item.dueAt, firedAt)) " (late - this phone was away)" else ""
        return "Reminder: ${item.author} in $where$late" to
            item.excerpt.ifEmpty { "A message you asked to be reminded about" }
    }

    /** Null when a scheduled send went out on time, which needs no telling. */
    fun sentNotice(item: Item, firedAt: Long): Pair<String, String>? {
        if (!isLate(item.dueAt, firedAt)) return null
        val where = if (item.serverId != null) "#${item.channelName}" else item.channelName
        return "Sent late to $where" to
            "This phone was away at the scheduled time. \"${excerptOf(item.text, 80)}\""
    }

    // --- Disk ------------------------------------------------------------------

    fun encode(items: List<Item>): String {
        val array = JSONArray()
        items.forEach { item ->
            array.put(
                JSONObject()
                    .put("kind", item.kind.name)
                    .put("id", item.id)
                    .put("channelId", item.channelId)
                    .put("channelName", item.channelName)
                    .put("serverId", item.serverId ?: JSONObject.NULL)
                    .put("dueAt", item.dueAt)
                    .put("createdAt", item.createdAt)
                    .put("text", item.text)
                    .put("messageId", item.messageId)
                    .put("author", item.author)
                    .put("excerpt", item.excerpt)
                    .put("attempts", item.attempts)
                    .put("retryAt", item.retryAt ?: JSONObject.NULL)
                    .put("error", item.error ?: JSONObject.NULL),
            )
        }
        return array.toString()
    }

    /** One malformed row is dropped rather than taking the list down with it. */
    fun decode(raw: String?): List<Item> {
        if (raw.isNullOrEmpty()) return emptyList()
        val array = runCatching { JSONArray(raw) }.getOrNull() ?: return emptyList()
        return (0 until array.length()).mapNotNull { index ->
            runCatching {
                val row = array.getJSONObject(index)
                Item(
                    kind = Kind.valueOf(row.getString("kind")),
                    id = row.getString("id"),
                    channelId = row.getString("channelId"),
                    channelName = row.getString("channelName"),
                    serverId = if (row.isNull("serverId")) null else row.getString("serverId"),
                    dueAt = row.getLong("dueAt"),
                    createdAt = row.getLong("createdAt"),
                    text = row.optString("text", ""),
                    messageId = row.optString("messageId", ""),
                    author = row.optString("author", ""),
                    excerpt = row.optString("excerpt", ""),
                    attempts = row.optInt("attempts", 0),
                    retryAt = if (row.isNull("retryAt")) null else row.getLong("retryAt"),
                    error = if (row.isNull("error")) null else row.getString("error"),
                )
            }.getOrNull()
        }
    }
}
