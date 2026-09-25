package com.aatech.betweenus.core.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Rearranging the channel list.
 *
 * The `applyChannelLayout` cases are the server's `channel-layout.check.ts`
 * and the move cases follow the desktop's `sidebar-layout.check.ts`. If one of
 * these has to change, so does its twin: the optimistic redraw is only honest
 * while all three clients and the server reach the same answer.
 */
class ChannelLayoutTest {

    private fun at(minute: Int) = "2026-09-22T10:%02d:00.000Z".format(minute)

    private fun channel(
        id: String,
        minute: Int,
        categoryId: String? = null,
        position: Int = 0,
        type: ChannelType = ChannelType.TEXT,
    ) = Channel(
        id = id,
        serverId = "s",
        name = id,
        type = type,
        topic = null,
        isPrivate = false,
        categoryId = categoryId,
        position = position,
        createdAt = at(minute),
    )

    private fun category(id: String, position: Int) = ChannelCategory(id, "s", id, position, at(position))

    private val categories = listOf(category("cat-a", 0), category("cat-b", 1))

    /** Channels that predate categories: position 0, loose, in creation order. */
    private val legacy = listOf(channel("c3", 3), channel("c1", 1), channel("c2", 2))

    private fun ids(rows: List<Channel>, categoryId: String?) =
        rows.filter { it.categoryId == categoryId }.sortedWith(channelOrder).map { it.id }

    private fun names(sections: List<ChannelSection>) =
        sections.map { "${it.category?.id ?: "-"}:${it.channels.joinToString(",") { c -> c.id }}" }

    // --- applyChannelLayout ---

    @Test
    fun `a full layout files channels and restarts positions in every category`() {
        val next = applyChannelLayout(
            categories,
            legacy,
            ChannelLayoutRequest(
                channels = listOf(
                    ChannelLayoutEntry("c2", null),
                    ChannelLayoutEntry("c3", "cat-a"),
                    ChannelLayoutEntry("c1", "cat-a"),
                ),
            ),
        )
        assertEquals(listOf("c2"), ids(next.channels, null))
        assertEquals(listOf("c3", "c1"), ids(next.channels, "cat-a"))
        assertEquals(listOf(0, 1, 0), next.channels.map { it.position })
    }

    @Test
    fun `categories reorder on their own and a partial list keeps the rest after it`() {
        val three = categories + category("cat-c", 2)
        val next = applyChannelLayout(three, legacy, ChannelLayoutRequest(categoryIds = listOf("cat-c")))
        assertEquals(listOf("cat-c", "cat-a", "cat-b"), next.categories.sortedWith(categoryOrder).map { it.id })
        assertEquals(listOf("c1", "c2", "c3"), ids(next.channels, null))
    }

    @Test
    fun `a channel the manager cannot see falls in behind the named ones`() {
        val channels = listOf(
            channel("public-1", 1, "cat-a", 0),
            channel("hidden", 2, "cat-a", 1),
            channel("public-2", 3, "cat-a", 2),
        )
        val next = applyChannelLayout(
            categories,
            channels,
            ChannelLayoutRequest(
                channels = listOf(ChannelLayoutEntry("public-2", "cat-a"), ChannelLayoutEntry("public-1", "cat-a")),
            ),
        )
        assertEquals(listOf("public-2", "public-1", "hidden"), ids(next.channels, "cat-a"))
    }

    @Test
    fun `unknown categories are ignored and a channel named twice keeps its first placement`() {
        val next = applyChannelLayout(
            categories,
            legacy,
            ChannelLayoutRequest(
                channels = listOf(
                    ChannelLayoutEntry("c1", "nowhere"),
                    ChannelLayoutEntry("c2", "cat-b"),
                    ChannelLayoutEntry("c2", null),
                ),
            ),
        )
        assertEquals(null, next.channels.first { it.id == "c1" }.categoryId)
        assertEquals("cat-b", next.channels.first { it.id == "c2" }.categoryId)
    }

    @Test
    fun `positions are compacted on every layout`() {
        val next = applyChannelLayout(emptyList(), listOf(channel("x", 0, position = 4)), ChannelLayoutRequest())
        assertEquals(listOf(0), next.channels.map { it.position })
    }

    @Test
    fun `the request json names a loose channel with an explicit null`() {
        val json = ChannelLayoutRequest(
            categoryIds = listOf("cat-a"),
            channels = listOf(ChannelLayoutEntry("c1", null), ChannelLayoutEntry("c2", "cat-a")),
        ).toJson()
        assertEquals("cat-a", json.getJSONArray("categoryIds").getString(0))
        val first = json.getJSONArray("channels").getJSONObject(0)
        assertTrue(first.has("categoryId") && first.isNull("categoryId"))
        assertEquals("cat-a", json.getJSONArray("channels").getJSONObject(1).getString("categoryId"))
    }

    // --- moves ---

    private val mixed = channelSections(
        categories,
        listOf(
            channel("t1", 1, null, 0),
            channel("t2", 2, null, 1),
            channel("v1", 3, null, 2, ChannelType.VOICE),
            channel("a1", 4, "cat-a", 0),
            channel("av", 5, "cat-a", 1, ChannelType.VOICE),
            channel("b1", 6, "cat-b", 0),
        ),
    )

    @Test
    fun `a step inside a group swaps with the neighbour`() {
        assertEquals(listOf("-:t2,t1,v1", "cat-a:a1,av", "cat-b:b1"), names(stepChannel(mixed, "t2", -1)))
    }

    @Test
    fun `a step off the end of a group crosses into the next section`() {
        // The last text channel going down would only be put back above the
        // voice channel by the grouping, so it crosses into cat-a instead.
        assertEquals(listOf("-:t1,v1", "cat-a:t2,a1,av", "cat-b:b1"), names(stepChannel(mixed, "t2", 1)))
        // The top of a category going up lands at the bottom of its group above.
        assertEquals(listOf("-:t1,t2,a1,v1", "cat-a:av", "cat-b:b1"), names(stepChannel(mixed, "a1", -1)))
        // A voice channel carried down lands at the top of the voice group below.
        assertEquals(listOf("-:t1,t2", "cat-a:a1,v1,av", "cat-b:b1"), names(stepChannel(mixed, "v1", 1)))
    }

    @Test
    fun `nothing moves past either end of the list`() {
        assertTrue(sameLayout(mixed, stepChannel(mixed, "t1", -1)))
        assertTrue(sameLayout(mixed, stepChannel(mixed, "b1", 1)))
        assertTrue(sameLayout(mixed, stepCategory(mixed, "cat-a", -1)))
        assertTrue(sameLayout(mixed, stepCategory(mixed, "cat-b", 1)))
    }

    @Test
    fun `a voice channel dropped among text lands at the top of the voice group`() {
        assertEquals(
            listOf("-:t1,t2", "cat-a:a1,v1,av", "cat-b:b1"),
            names(moveChannel(mixed, "v1", "cat-a", 0)),
        )
    }

    @Test
    fun `a category moves with its channels and the loose list stays on top`() {
        assertEquals(listOf("-:t1,t2,v1", "cat-b:b1", "cat-a:a1,av"), names(stepCategory(mixed, "cat-b", -1)))
    }

    @Test
    fun `the layout of a step round-trips through the shared rule to the same drawing`() {
        val flat = mixed.flatMap { it.channels }
        val cats = mixed.mapNotNull { it.category }
        val moved = stepChannel(mixed, "v1", 1)
        val applied = applyChannelLayout(cats, flat, layoutFrom(moved))
        assertEquals(names(moved), names(channelSections(applied.categories, applied.channels)))
    }
}
