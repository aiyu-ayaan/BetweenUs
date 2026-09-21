package com.aatech.betweenus.core.data

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * How the channel list is grouped for drawing.
 *
 * The desktop's `sidebar-layout.check.ts` holds the same grouping cases. If one
 * of these has to change, so does that one.
 */
class ChannelSectionsTest {

    private fun channel(id: String, n: Int, categoryId: String?, position: Int = 0) = Channel(
        id = id,
        serverId = "s",
        name = id,
        type = ChannelType.TEXT,
        topic = null,
        isPrivate = false,
        categoryId = categoryId,
        position = position,
        createdAt = "2026-09-22T10:0$n:00.000Z",
    )

    private fun category(id: String, position: Int) =
        ChannelCategory(id, "s", id, position, "2026-09-22T10:0$position:00.000Z")

    private fun names(sections: List<ChannelSection>) =
        sections.map { "${it.category?.id ?: "-"}:${it.channels.joinToString(",") { c -> c.id }}" }

    @Test
    fun `loose channels come first and categories follow in order`() {
        val sections = channelSections(
            listOf(category("B", 1), category("A", 0)),
            listOf(channel("c1", 1, null), channel("c3", 3, "A", 1), channel("c2", 2, "A", 0), channel("c4", 4, "B")),
        )
        assertEquals(listOf("-:c1", "A:c2,c3", "B:c4"), names(sections))
    }

    @Test
    fun `channels that predate categories keep their creation order`() {
        val sections = channelSections(
            emptyList(),
            listOf(channel("c3", 3, null), channel("c1", 1, null), channel("c2", 2, null)),
        )
        assertEquals(listOf("-:c1,c2,c3"), names(sections))
    }

    @Test
    fun `a channel in a category we do not hold is drawn loose and not lost`() {
        val sections = channelSections(listOf(category("A", 0)), listOf(channel("x", 1, "gone")))
        assertEquals(listOf("-:x", "A:"), names(sections))
    }

    @Test
    fun `a channel json without category fields still parses`() {
        val json = org.json.JSONObject().put("id", "c").put("name", "general").put("type", "TEXT")
        val parsed = Channel.from(json)
        assertEquals(null, parsed.categoryId)
        assertEquals(0, parsed.position)
    }
}
