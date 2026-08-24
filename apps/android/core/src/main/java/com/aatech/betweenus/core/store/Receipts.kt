package com.aatech.betweenus.core.store

import com.aatech.betweenus.core.data.ChannelReadReceipt
import java.time.Instant

/**
 * Read receipts, derived from read markers.
 *
 * The port of `apps/desktop/src/features/chat/receipts.ts`, and the same
 * arithmetic for the same reason: the server stores one marker per person per
 * channel - "read up to here" - and never a row per message, so "who has seen
 * this message" is "whose marker is at or past its timestamp".
 *
 * Two questions, and they are not the same one:
 *
 * - [seenBy] - who has seen *this* message. What the dialog lists.
 * - [anchorReceipts] - where each person's face is drawn. Once, on the newest
 *   message of yours they have read. Drawing everybody against every message
 *   would repeat the same four faces down the whole conversation.
 */
object Receipts {
    /** How many faces the row draws before it starts counting instead. */
    const val FACES = 4

    private fun at(iso: String): Long =
        runCatching { Instant.parse(iso).toEpochMilli() }.getOrDefault(0L)

    /** Everyone whose marker is at or past this message. Oldest reader first. */
    fun seenBy(sentAt: String, receipts: List<ChannelReadReceipt>): List<ChannelReadReceipt> {
        val sent = at(sentAt)
        return receipts.filter { at(it.readAt) >= sent }.sortedBy { at(it.readAt) }
    }

    /**
     * messageId -> the readers whose row it is, for [selfId]'s messages only.
     *
     * Somebody else's message never carries a receipt: it is their message that
     * was read, and telling you who else has read it is a different feature.
     */
    fun anchorReceipts(
        messages: List<ReadableMessage>,
        receipts: List<ChannelReadReceipt>,
        selfId: String?,
    ): Map<String, List<ChannelReadReceipt>> {
        if (selfId == null) return emptyMap()
        val mine = messages
            .filter { it.message.author.id == selfId }
            .sortedBy { at(it.message.createdAt) }
        if (mine.isEmpty()) return emptyMap()

        val anchors = mutableMapOf<String, MutableList<ChannelReadReceipt>>()
        for (receipt in receipts) {
            val read = at(receipt.readAt)
            // The newest message this marker has reached. A marker older than
            // everything on screen anchors nowhere, which is the "has not seen
            // it yet" case and draws nothing at all.
            val newest = mine.lastOrNull { at(it.message.createdAt) <= read } ?: continue
            anchors.getOrPut(newest.id) { mutableListOf() }.add(receipt)
        }

        // Oldest reader first within a row, so the faces stop shuffling every
        // time somebody else opens the channel.
        return anchors.mapValues { (_, row) -> row.sortedBy { at(it.readAt) } }
    }

    /** "Seen by Ana", "Seen by Ana and Bo", "Seen by Ana, Bo and 3 others". */
    fun seenByLabel(receipts: List<ChannelReadReceipt>): String {
        val names = receipts.map { it.user.label }
        return when {
            names.isEmpty() -> "Not seen yet"
            names.size == 1 -> "Seen by ${names[0]}"
            names.size == 2 -> "Seen by ${names[0]} and ${names[1]}"
            else -> {
                val rest = names.size - 2
                "Seen by ${names[0]}, ${names[1]} and $rest other" + if (rest == 1) "" else "s"
            }
        }
    }
}
