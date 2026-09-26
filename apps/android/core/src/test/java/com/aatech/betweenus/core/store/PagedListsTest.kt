package com.aatech.betweenus.core.store

import com.aatech.betweenus.core.data.Page
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class PagedListsTest {
    private data class Row(val id: String, val at: String, val text: String)

    private fun row(n: Int, text: String = "hay") =
        Row("m%04d".format(n), "2026-01-01T00:%02d:00Z".format(n % 60), text)

    /** Page "pN" holds `size` rows; N grows going back in time. */
    private fun channel(pages: Int, size: Int): suspend (String) -> Page<Row> = { cursor ->
        val n = cursor.drop(1).toInt()
        val base = (pages - n) * size
        Page(
            items = (0 until size).map { row(base + it, if (base + it == 7) "needle" else "hay") },
            nextCursor = if (n + 1 < pages) "p${n + 1}" else null,
        )
    }

    @Test
    fun `a pin page is appended without repeats`() {
        val shown = listOf("a", "b")
        assertEquals(listOf("a", "b", "c"), appendPinPage(shown, listOf("b", "c")) { it })
        assertSame(shown, appendPinPage(shown, listOf("a")) { it })
    }

    @Test
    fun `a walk reads to the end and reports each page`() = runBlocking {
        val seen = mutableListOf<WalkProgress<Row>>()
        val result = walkOlder("p0", channel(4, 5), { it.text == "needle" }, { it.at }, { false }, { seen += it })
        assertEquals(WalkStop.End, result.stop)
        assertEquals(20, result.scanned)
        assertEquals(4, seen.size)
        assertEquals(1, seen.sumOf { it.hits.size })
        assertNull(result.cursor)
    }

    @Test
    fun `the cap is a hard bound and the run can be continued`() = runBlocking {
        val result = walkOlder("p0", channel(10, 5), { false }, { it.at }, { false }, {}, maxMessages = 12)
        assertEquals(WalkStop.Cap, result.stop)
        assertEquals(15, result.scanned)
        assertEquals("p3", result.cursor)
    }

    @Test
    fun `a stop while a page is in flight discards it`() = runBlocking {
        var stopped = false
        val reported = mutableListOf<Int>()
        val result = walkOlder(
            "p0",
            { c -> stopped = true; channel(3, 5)(c) },
            { true }, { it.at }, { stopped }, { reported += it.scanned },
        )
        assertEquals(WalkStop.Stopped, result.stop)
        assertTrue(reported.isEmpty())
    }

    @Test
    fun `a failing page stops with the cursor kept for a retry`() = runBlocking {
        val result = walkOlder<Row>("p0", { error("offline") }, { true }, { it.at }, { false }, {})
        assertEquals(WalkStop.Error, result.stop)
        assertEquals("p0", result.cursor)
    }
}
