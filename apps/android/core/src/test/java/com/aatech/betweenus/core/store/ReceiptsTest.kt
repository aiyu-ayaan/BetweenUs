package com.aatech.betweenus.core.store

import com.aatech.betweenus.core.data.ChannelReadReceipt
import com.aatech.betweenus.core.data.Message
import com.aatech.betweenus.core.data.MessageBody
import com.aatech.betweenus.core.data.UserSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The same cases as `apps/desktop/src/features/chat/receipts.check.ts`.
 *
 * Both clients derive receipts from the same markers, and a phone that draws a
 * face against a different message than the desktop does is two answers to one
 * question - which is exactly the bug a shared derivation is meant to avoid.
 */
class ReceiptsTest {
    private fun reader(name: String, readAt: String) = ChannelReadReceipt(
        user = UserSummary(id = name, username = name, displayName = name, avatarUrl = null),
        readAt = readAt,
    )

    private fun message(id: String, createdAt: String, authorId: String) = ReadableMessage(
        message = Message(
            id = id,
            channelId = "c1",
            content = "",
            author = UserSummary(authorId, authorId, authorId, null),
            createdAt = createdAt,
            editedAt = null,
            deletedAt = null,
            deletedBy = null,
            pinnedAt = null,
            reactions = emptyList(),
        ),
        body = MessageBody(text = "hello"),
    )

    private val first = message("m1", "2026-01-01T10:00:00.000Z", "me")
    private val second = message("m2", "2026-01-01T10:05:00.000Z", "me")
    private val third = message("m3", "2026-01-01T10:10:00.000Z", "me")
    private val mine = listOf(first, second, third)

    private val readers = listOf(
        reader("ana", "2026-01-01T10:06:00.000Z"),
        reader("bo", "2026-01-01T10:11:00.000Z"),
    )

    @Test
    fun `seenBy is everyone whose marker is at or past the message`() {
        assertEquals(
            listOf("ana", "bo"),
            Receipts.seenBy(first.message.createdAt, readers).map { it.user.id },
        )
        assertEquals(
            listOf("bo"),
            Receipts.seenBy(third.message.createdAt, readers).map { it.user.id },
        )
        // The marker landing on the same millisecond counts: it was read.
        assertEquals(
            1,
            Receipts.seenBy(
                second.message.createdAt,
                listOf(reader("cy", second.message.createdAt)),
            ).size,
        )
    }

    @Test
    fun `each reader is drawn once, on the newest message they have read`() {
        val anchors = Receipts.anchorReceipts(mine, readers, "me")
        assertEquals(setOf("m2", "m3"), anchors.keys)
        assertEquals(listOf("ana"), anchors["m2"]?.map { it.user.id })
        assertEquals(listOf("bo"), anchors["m3"]?.map { it.user.id })
        assertNull(anchors["m1"])
    }

    @Test
    fun `a marker older than everything on screen anchors nowhere`() {
        val old = listOf(reader("old", "2026-01-01T09:00:00.000Z"))
        assertEquals(emptyMap<String, List<ChannelReadReceipt>>(), Receipts.anchorReceipts(mine, old, "me"))
    }

    @Test
    fun `somebody else's message never carries a receipt`() {
        val theirs = listOf(message("t1", "2026-01-01T10:00:00.000Z", "them"))
        assertEquals(emptyMap<String, List<ChannelReadReceipt>>(), Receipts.anchorReceipts(theirs, readers, "me"))
        assertEquals(emptyMap<String, List<ChannelReadReceipt>>(), Receipts.anchorReceipts(mine, readers, null))
    }

    @Test
    fun `out of order input does not change the answer`() {
        val shuffled = listOf(third, first, second)
        assertEquals(setOf("m2", "m3"), Receipts.anchorReceipts(shuffled, readers, "me").keys)
    }

    @Test
    fun `the label counts the readers it did not name`() {
        assertEquals("Not seen yet", Receipts.seenByLabel(emptyList()))
        assertEquals("Seen by ana", Receipts.seenByLabel(readers.take(1)))
        assertEquals("Seen by ana and bo", Receipts.seenByLabel(readers))
        assertEquals(
            "Seen by ana, bo and 1 other",
            Receipts.seenByLabel(readers + reader("cy", "2026-01-01T10:12:00.000Z")),
        )
    }
}
