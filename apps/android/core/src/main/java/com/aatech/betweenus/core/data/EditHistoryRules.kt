package com.aatech.betweenus.core.data

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** A version as the sheet lists it. */
data class OpenedVersion(
    val id: String,
    /** Plain text of that version; empty when [readable] is false. */
    val text: String,
    val readable: Boolean,
    val writtenAt: String,
)

/**
 * The rules the "edited" history is drawn by, kept out of the composables so
 * they can be asserted on without a screen.
 *
 * The port of `apps/desktop/src/features/chat/edit-history.ts`; if one changes,
 * so does the other.
 */
object EditHistoryRules {
    /** Whether the marker is a control: only a message with something behind it. */
    fun hasHistory(message: Message): Boolean = message.editedAt != null && message.editCount > 0

    /** The marker's accessible name, which says what activating it does. */
    fun markerLabel(editCount: Int): String = when {
        editCount <= 0 -> "Edited"
        editCount == 1 -> "Edited, 1 earlier version. Show history"
        else -> "Edited, $editCount earlier versions. Show history"
    }

    /**
     * Opens every version, in the order the server sent (newest first). [open]
     * returns the body's text or null when the key is missing; a throw counts
     * as null, and the version stays in the list so the count on screen still
     * matches the count the server holds.
     */
    suspend fun openVersions(
        items: List<MessageEditVersion>,
        open: suspend (String) -> String?,
    ): List<OpenedVersion> = items.map { item ->
        val text = runCatching { open(item.content) }.getOrNull()
        OpenedVersion(
            id = item.id,
            text = text.orEmpty(),
            readable = text != null,
            writtenAt = item.writtenAt,
        )
    }

    /** "12 Sep, 14:03" - enough to tell two versions apart without a year. */
    fun versionTime(iso: String, locale: Locale = Locale.getDefault(), zone: ZoneId = ZoneId.systemDefault()): String =
        runCatching {
            DateTimeFormatter.ofPattern("d MMM, HH:mm", locale)
                .withZone(zone)
                .format(Instant.parse(iso))
        }.getOrDefault("")
}
