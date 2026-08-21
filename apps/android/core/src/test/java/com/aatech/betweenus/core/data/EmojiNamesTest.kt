package com.aatech.betweenus.core.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The same cases as `emoji-names.check.ts`, because the shortcodes are a
 * contract between the clients: a name that resolves here and nowhere else
 * sends a message the others draw as the word somebody typed.
 */
class EmojiNamesTest {

    @Test
    fun `the table parses and every entry has a name`() {
        assertTrue(EmojiNames.ALL.size > 300)
        assertTrue(EmojiNames.ALL.all { it.emoji.isNotEmpty() && it.names.isNotEmpty() })
        assertTrue(EmojiNames.ALL.all { entry -> entry.names.none { it.contains(':') } })
    }

    @Test
    fun `the flame beats the fire engine`() {
        // The ranking is the whole feature: a prefix match on a longer name
        // must not come before the emoji actually called that.
        val found = EmojiNames.search("fire").map { it.emoji }
        assertEquals("🔥", found.first())
    }

    @Test
    fun `an alias finds the same emoji as its name`() {
        assertEquals(
            EmojiNames.search("thumbsup").first().emoji,
            EmojiNames.search("+1").first().emoji,
        )
    }

    @Test
    fun `a term nothing is called finds nothing`() {
        assertTrue(EmojiNames.search("qwertyuiop").isEmpty())
    }

    @Test
    fun `the menu is capped`() {
        assertTrue(EmojiNames.search("a").size <= EmojiNames.SUGGESTION_LIMIT)
    }

    @Test
    fun `a shortcode being typed is found with where it starts`() {
        val query = EmojiNames.queryAt("hey :fir", 8)
        assertNotNull(query)
        assertEquals("fir", query!!.term)
        assertEquals(4, query.start)
    }

    @Test
    fun `a colon in a URL or a clock opens nothing`() {
        assertNull(EmojiNames.queryAt("https://example.com", 19))
        assertNull(EmojiNames.queryAt("at 10:30am", 10))
    }

    @Test
    fun `a closed shortcode is finished, not a search`() {
        assertNull(EmojiNames.queryAt(":tada: ", 7))
        // The caret inside a closed one is still a search - the second colon is
        // after the caret and this only ever reads what is behind it.
        assertNotNull(EmojiNames.queryAt(":tada:", 5))
    }

    @Test
    fun `one character offers nothing`() {
        assertNull(EmojiNames.queryAt("a :f", 4))
        assertNotNull(EmojiNames.queryAt("a :fi", 5))
    }

    @Test
    fun `a space ends it`() {
        assertNull(EmojiNames.queryAt(": fire", 6))
    }
}
