package com.aatech.betweenus.core.data

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/** The same cases as `apps/desktop/src/features/chat/edit-history.check.ts`. */
class EditHistoryRulesTest {
    private val author = UserSummary("u1", "ada", "Ada", null)

    private fun message(editedAt: String?, editCount: Int) = Message(
        id = "m1",
        channelId = "c1",
        content = "sealed",
        author = author,
        createdAt = "2026-09-01T10:00:00.000Z",
        editedAt = editedAt,
        deletedAt = null,
        deletedBy = null,
        pinnedAt = null,
        reactions = emptyList(),
        expiresAt = null,
        viewOnce = false,
        viewedBy = emptyList(),
        editCount = editCount,
    )

    @Test
    fun `the marker is a control only with something behind it`() {
        assertFalse(EditHistoryRules.hasHistory(message(null, 2)))
        assertFalse(EditHistoryRules.hasHistory(message("x", 0)))
        assertTrue(EditHistoryRules.hasHistory(message("x", 1)))
    }

    @Test
    fun `the label says what activating it does`() {
        assertEquals("Edited", EditHistoryRules.markerLabel(0))
        assertEquals("Edited, 1 earlier version. Show history", EditHistoryRules.markerLabel(1))
        assertEquals("Edited, 3 earlier versions. Show history", EditHistoryRules.markerLabel(3))
    }

    @Test
    fun `an unreadable version stays in the list`() = runBlocking {
        val items = listOf(
            MessageEditVersion("a", "sealed-a", "2026-09-01T11:00:00.000Z", "2026-09-01T12:00:00.000Z"),
            MessageEditVersion("b", "sealed-b", "2026-09-01T10:00:00.000Z", "2026-09-01T11:00:00.000Z"),
            MessageEditVersion("c", "sealed-c", "2026-09-01T09:00:00.000Z", "2026-09-01T10:00:00.000Z"),
        )
        val opened = EditHistoryRules.openVersions(items) { content ->
            when (content) {
                "sealed-b" -> null
                "sealed-c" -> error("bad tag")
                else -> "plain $content"
            }
        }
        assertEquals(listOf("a", "b", "c"), opened.map { it.id })
        assertEquals(listOf(true, false, false), opened.map { it.readable })
        assertEquals("plain sealed-a", opened[0].text)
        assertEquals("", opened[1].text)
        assertTrue(EditHistoryRules.openVersions(emptyList()) { "x" }.isEmpty())
    }

    @Test
    fun `times read like the desktop and a bad one is empty`() {
        assertEquals(
            "1 Sep, 10:00",
            EditHistoryRules.versionTime("2026-09-01T10:00:00.000Z", Locale.ENGLISH, ZoneOffset.UTC),
        )
        assertEquals("", EditHistoryRules.versionTime("not a date"))
    }

    @Test
    fun `the count survives the cache`() {
        assertEquals(2, Message.from(message("x", 2).toJson()).editCount)
        assertEquals(0, Message.from(message(null, 0).toJson()).editCount)
    }
}
