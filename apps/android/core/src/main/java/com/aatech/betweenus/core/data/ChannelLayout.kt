package com.aatech.betweenus.core.data

import org.json.JSONArray
import org.json.JSONObject

/*
 * Rearranging a server's channel list, as data.
 *
 * The port of two desktop files that have to agree with each other and with
 * the server: `applyChannelLayout` in `packages/shared-types` (what a layout
 * request does to the rows - the server runs the same function, so an
 * optimistic redraw here lands where the refetch will) and the move helpers in
 * `apps/desktop/src/features/channels/sidebar-layout.ts` (which step turns into
 * which request). Pure, so every case is a unit test rather than a device.
 *
 * Inside every section text comes before voice. Every move re-groups before it
 * is saved (`groupByKind`), so the saved positions always match the drawing.
 */

/** Where one channel goes: which category (null for none), in list order. */
data class ChannelLayoutEntry(val id: String, val categoryId: String?)

/**
 * A new arrangement, sent whole: `PUT /servers/:id/channel-layout`.
 *
 * Anything not named keeps its category and goes after the named ones - a
 * manager may not see every private channel, and a request that had to name
 * them all could never be sent. Either half may be left out.
 */
data class ChannelLayoutRequest(
    val categoryIds: List<String>? = null,
    val channels: List<ChannelLayoutEntry>? = null,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        categoryIds?.let { ids -> put("categoryIds", JSONArray(ids)) }
        channels?.let { entries ->
            put(
                "channels",
                JSONArray().also { array ->
                    entries.forEach { entry ->
                        array.put(
                            JSONObject()
                                .put("id", entry.id)
                                // JSONObject.NULL, not a missing key: null means
                                // "take it out of its category".
                                .put("categoryId", entry.categoryId ?: JSONObject.NULL),
                        )
                    }
                },
            )
        }
    }
}

/** A server's categories and channels after a layout has been applied. */
data class ChannelLayout(val categories: List<ChannelCategory>, val channels: List<Channel>)

/** The one order every sidebar draws: position, then age, then id. */
internal val categoryOrder = compareBy<ChannelCategory>({ it.position }, { it.createdAt }, { it.id })
internal val channelOrder = compareBy<Channel>({ it.position }, { it.createdAt }, { it.id })

/** [rows] reordered so the ones [ids] names come first, in that order. */
private fun <T> placeInOrder(rows: List<T>, ids: List<String>, idOf: (T) -> String): List<T> {
    val byId = rows.associateBy(idOf)
    val first = LinkedHashMap<String, T>()
    for (id in ids) {
        val row = byId[id] ?: continue
        if (id !in first) first[id] = row
    }
    return first.values.toList() + rows.filter { idOf(it) !in first }
}

/**
 * What a [request] does to these rows: every row back with its new position
 * (and, for a channel, category). The desktop's and the server's
 * `applyChannelLayout`, case for case.
 *
 * Ids that are not among the rows are ignored. A channel named twice keeps its
 * first placement. A channel sent to a category that is not among the rows
 * stays where it was.
 */
fun applyChannelLayout(
    categories: List<ChannelCategory>,
    channels: List<Channel>,
    request: ChannelLayoutRequest,
): ChannelLayout {
    val nextCategories = placeInOrder(
        categories.sortedWith(categoryOrder),
        request.categoryIds.orEmpty(),
    ) { it.id }.mapIndexed { index, category -> category.copy(position = index) }

    val known = categories.map { it.id }.toSet()
    val target = LinkedHashMap<String, String?>()
    for (entry in request.channels.orEmpty()) {
        if (target.containsKey(entry.id)) continue
        if (entry.categoryId != null && entry.categoryId !in known) continue
        target[entry.id] = entry.categoryId
    }

    val moved = channels.map { channel ->
        if (target.containsKey(channel.id)) channel.copy(categoryId = target[channel.id]) else channel
    }
    val named = target.keys.toList()

    // Positions are per category, so each group is ordered on its own: named
    // channels first in the order the request gave, then the rest as they were.
    val position = HashMap<String, Int>()
    moved.groupBy { it.categoryId }.values.forEach { group ->
        placeInOrder(group.sortedWith(channelOrder), named) { it.id }
            .forEachIndexed { index, channel -> position[channel.id] = index }
    }

    return ChannelLayout(
        categories = nextCategories,
        channels = moved.map { it.copy(position = position[it.id] ?: 0) },
    )
}

private fun Channel.isVoice(): Boolean = type == ChannelType.VOICE

/** Text channels, then voice channels, each group keeping its relative order. */
fun groupByKind(channels: List<Channel>): List<Channel> =
    channels.filterNot { it.isVoice() } + channels.filter { it.isVoice() }

/** The request that makes the server's layout match these sections. */
fun layoutFrom(sections: List<ChannelSection>): ChannelLayoutRequest = ChannelLayoutRequest(
    categoryIds = sections.mapNotNull { it.category?.id },
    channels = sections.flatMap { section ->
        section.channels.map { ChannelLayoutEntry(it.id, section.category?.id) }
    },
)

/** True when two arrangements would send the same request. */
fun sameLayout(a: List<ChannelSection>, b: List<ChannelSection>): Boolean = layoutFrom(a) == layoutFrom(b)

private fun locate(sections: List<ChannelSection>, channelId: String): Pair<Int, Int>? {
    sections.forEachIndexed { section, entry ->
        val index = entry.channels.indexOfFirst { it.id == channelId }
        if (index >= 0) return section to index
    }
    return null
}

/**
 * Moves a channel to [index] of the section holding [categoryId] (null for the
 * loose ones), counted after it has been taken out of wherever it was. The
 * destination is re-grouped text before voice. Unchanged when there is
 * nothing to do.
 */
fun moveChannel(
    sections: List<ChannelSection>,
    channelId: String,
    categoryId: String?,
    index: Int,
): List<ChannelSection> {
    val from = locate(sections, channelId) ?: return sections
    val to = sections.indexOfFirst { it.category?.id == categoryId }
    if (to < 0) return sections
    val channel = sections[from.first].channels[from.second]

    val without = sections.mapIndexed { at, section ->
        if (at == from.first) section.copy(channels = section.channels.filter { it.id != channelId }) else section
    }
    return without.mapIndexed { at, section ->
        if (at != to) return@mapIndexed section
        val placed = section.channels.toMutableList()
        placed.add(index.coerceIn(0, placed.size), channel)
        section.copy(channels = groupByKind(placed))
    }
}

/**
 * One step up (-1) or down (+1). Inside a section it swaps with the neighbour
 * of the same kind; at the edge of its group it crosses into the next section
 * - the bottom of its group in the one above, the top in the one below - so a
 * channel can be carried into and out of a category one step at a time.
 *
 * The drawn order is loose text, loose voice, then each category (text, voice).
 * A step goes to the previous or next place the channel's own kind can sit in
 * that order, stepping over the other kind's list rather than entering it, so
 * the opposite step undoes it. A voice channel with only its own section's
 * text above it has nowhere to go and stays put.
 */
fun stepChannel(sections: List<ChannelSection>, channelId: String, delta: Int): List<ChannelSection> {
    val (section, index) = locate(sections, channelId) ?: return sections
    val here = sections[section]
    val channel = here.channels[index]
    val neighbour = here.channels.getOrNull(index + delta)
    if (neighbour != null && neighbour.isVoice() == channel.isVoice()) {
        return moveChannel(sections, channelId, here.category?.id, index + delta)
    }
    val next = sections.getOrNull(section + delta) ?: return sections
    return moveChannel(
        sections,
        channelId,
        next.category?.id,
        if (delta < 0) next.channels.size else 0,
    )
}

/** Moves a category heading, with its channels, to [index] among the categories. */
fun moveCategory(sections: List<ChannelSection>, categoryId: String, index: Int): List<ChannelSection> {
    val loose = sections.firstOrNull() ?: return sections
    val rest = sections.drop(1)
    val moving = rest.firstOrNull { it.category?.id == categoryId } ?: return sections
    val others = rest.filter { it !== moving }.toMutableList()
    others.add(index.coerceIn(0, others.size), moving)
    return listOf(loose) + others
}

/** One step up (-1) or down (+1) among the categories. The loose section never moves. */
fun stepCategory(sections: List<ChannelSection>, categoryId: String, delta: Int): List<ChannelSection> {
    val at = sections.indexOfFirst { it.category?.id == categoryId }
    // Index 0 is the loose section, so a category's place among categories is at - 1.
    return if (at < 1) sections else moveCategory(sections, categoryId, at - 1 + delta)
}

/**
 * The name the server will store for a category: trimmed, inner whitespace
 * collapsed, cut to 64 characters, and "Category" when nothing is left. The
 * port of `normalizeCategoryName` in server-service, so a dialog can say what
 * it is about to save.
 */
fun normalizeCategoryName(name: String): String =
    name.trim().replace(Regex("\\s+"), " ").take(64).ifEmpty { "Category" }
