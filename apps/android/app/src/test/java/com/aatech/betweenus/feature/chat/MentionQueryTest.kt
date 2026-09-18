package com.aatech.betweenus.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MentionQueryTest {

    @Test
    fun `at sign at start with empty term`() {
        assertEquals(
            MentionQuery(term = "", start = 0),
            MentionQueryParser.queryAt("@", 1),
        )
    }

    @Test
    fun `at sign at start with name`() {
        assertEquals(
            MentionQuery(term = "ali", start = 0),
            MentionQueryParser.queryAt("@ali", 4),
        )
    }

    @Test
    fun `mention preceded by space in middle of text`() {
        assertEquals(
            MentionQuery(term = "ali", start = 6),
            MentionQueryParser.queryAt("hello @ali", 10),
        )
    }

    @Test
    fun `empty mention preceded by space`() {
        assertEquals(
            MentionQuery(term = "", start = 6),
            MentionQueryParser.queryAt("hello @", 7),
        )
    }

    @Test
    fun `email address is not a mention`() {
        assertNull(MentionQueryParser.queryAt("test@example.com", 5))
        assertNull(MentionQueryParser.queryAt("test@example.com", 16))
    }

    @Test
    fun `mid-word at symbol is not a mention`() {
        assertNull(MentionQueryParser.queryAt("user@domain", 11))
    }

    @Test
    fun `space in term terminates mention query`() {
        assertNull(MentionQueryParser.queryAt("@ali smith", 10))
    }

    @Test
    fun `out of bounds caret or empty text returns null`() {
        assertNull(MentionQueryParser.queryAt("", 0))
        assertNull(MentionQueryParser.queryAt("", 1))
        assertNull(MentionQueryParser.queryAt("@ali", 0))
        assertNull(MentionQueryParser.queryAt("@ali", -1))
        assertNull(MentionQueryParser.queryAt("@ali", 5))
    }

    @Test
    fun `mention on newline is valid`() {
        assertEquals(
            MentionQuery(term = "ali", start = 6),
            MentionQueryParser.queryAt("line1\n@ali", 10),
        )
    }

    @Test
    fun `special characters outside allowed set invalidates query`() {
        assertNull(MentionQueryParser.queryAt("@ali!", 5))
        assertNull(MentionQueryParser.queryAt("@ali#", 5))
        assertNull(MentionQueryParser.queryAt("@ali$", 5))
    }

    @Test
    fun `allowed characters such as underscore dot and dash are supported`() {
        assertEquals(
            MentionQuery(term = "user_1.2-name", start = 0),
            MentionQueryParser.queryAt("@user_1.2-name", 14),
        )
    }

    @Test
    fun `multiple mentions extracts only the active one before caret`() {
        assertEquals(
            MentionQuery(term = "ali", start = 11),
            MentionQueryParser.queryAt("@bob hello @ali", 15),
        )
        assertEquals(
            MentionQuery(term = "bob", start = 0),
            MentionQueryParser.queryAt("@bob hello @ali", 4),
        )
    }
}
