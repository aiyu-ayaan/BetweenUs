package com.aatech.betweenus.core.data

import com.aatech.betweenus.core.data.Markup.Kind
import com.aatech.betweenus.core.data.Markup.Span
import com.aatech.betweenus.core.data.Markup.Style
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The offsets are the part with a bug in it. A style is drawn over indices
 * into the text the parser *returns*, and the marks have been taken out of
 * that text - so every case here asserts both halves, because a parser that
 * strips two characters and reports the range it saw before stripping paints
 * the wrong words and looks almost right.
 */
class MarkupTest {

    private fun one(text: String): Markup.Block =
        Markup.parse(text).single()

    @Test
    fun `plain text is one block and no spans`() {
        val block = one("hello there")
        assertEquals(Kind.Body, block.kind)
        assertEquals("hello there", block.text)
        assertTrue(block.spans.isEmpty())
    }

    @Test
    fun `bold loses its marks and keeps its range`() {
        val block = one("a **b** c")
        assertEquals("a b c", block.text)
        assertEquals(listOf(Span(2, 3, Style.Bold)), block.spans)
    }

    @Test
    fun `two asterisks are bold, not two italics`() {
        assertEquals(listOf(Span(0, 4, Style.Bold)), one("**bold**").spans)
    }

    @Test
    fun `italic takes either mark`() {
        assertEquals(listOf(Span(0, 1, Style.Italic)), one("*a*").spans)
        assertEquals(listOf(Span(0, 1, Style.Italic)), one("_a_").spans)
    }

    @Test
    fun `an identifier is not two italics`() {
        val block = one("call snake_case_name now")
        assertEquals("call snake_case_name now", block.text)
        assertTrue(block.spans.isEmpty())
    }

    @Test
    fun `nesting styles both, over the inner text`() {
        val block = one("**bold _and_ italic**")
        assertEquals("bold and italic", block.text)
        assertEquals(
            listOf(Span(5, 8, Style.Italic), Span(0, 15, Style.Bold)),
            block.spans,
        )
    }

    @Test
    fun `code is literal inside`() {
        val block = one("use `a*b*c` here")
        assertEquals("use a*b*c here", block.text)
        assertEquals(listOf(Span(4, 9, Style.Code)), block.spans)
    }

    @Test
    fun `an unmatched mark is just a character`() {
        val block = one("2 * 3 = 6")
        assertEquals("2 * 3 = 6", block.text)
        assertTrue(block.spans.isEmpty())
    }

    @Test
    fun `an empty pair is not a style`() {
        assertEquals("****", one("****").text)
    }

    @Test
    fun `a backslash escapes the mark it precedes`() {
        val block = one("a \\*not italic\\* b")
        assertEquals("a *not italic* b", block.text)
        assertTrue(block.spans.isEmpty())
    }

    @Test
    fun `a fence is its own block and is never parsed inside`() {
        val blocks = Markup.parse("before\n```\nval x = *2*\n```\nafter")
        assertEquals(listOf(Kind.Body, Kind.Code, Kind.Body), blocks.map { it.kind })
        assertEquals("val x = *2*", blocks[1].text)
        assertTrue(blocks[1].spans.isEmpty())
    }

    @Test
    fun `an unclosed fence still codes the rest`() {
        val blocks = Markup.parse("look\n```\nraw text")
        assertEquals(listOf(Kind.Body, Kind.Code), blocks.map { it.kind })
        assertEquals("raw text", blocks[1].text)
    }

    @Test
    fun `quoted lines group into one block and lose the marker`() {
        val blocks = Markup.parse("> one\n> two\nreply")
        assertEquals(listOf(Kind.Quote, Kind.Body), blocks.map { it.kind })
        assertEquals("one\ntwo", blocks[0].text)
        assertEquals("reply", blocks[1].text)
    }

    @Test
    fun `a greater-than inside a line is not a quote`() {
        val block = one("2 > 1")
        assertEquals(Kind.Body, block.kind)
        assertEquals("2 > 1", block.text)
    }

    @Test
    fun `a bullet is its own block and loses its marker`() {
        val blocks = Markup.parse("shopping\n- eggs\n- milk")
        assertEquals(listOf(Kind.Body, Kind.Bullet, Kind.Bullet), blocks.map { it.kind })
        assertEquals("eggs", blocks[1].text)
        assertEquals("milk", blocks[2].text)
    }

    @Test
    fun `a bullet still carries its inline styles`() {
        val blocks = Markup.parse("- buy **eggs**")
        assertEquals("buy eggs", blocks[0].text)
        assertEquals(listOf(Span(4, 8, Style.Bold)), blocks[0].spans)
    }

    @Test
    fun `a numbered run is renumbered from its first item`() {
        val blocks = Markup.parse("1. one\n1. two\n1. three")
        assertEquals(listOf(1, 2, 3), blocks.map { it.ordinal })
        assertEquals(listOf("one", "two", "three"), blocks.map { it.text })
    }

    @Test
    fun `a numbered run that starts elsewhere keeps its start`() {
        val blocks = Markup.parse("5. five\n6. six")
        assertEquals(listOf(5, 6), blocks.map { it.ordinal })
    }

    @Test
    fun `a paragraph between two runs starts the numbering again`() {
        val blocks = Markup.parse("1. one\nprose\n1. one again")
        assertEquals(listOf(Kind.Number, Kind.Body, Kind.Number), blocks.map { it.kind })
        assertEquals(1, blocks[2].ordinal)
    }

    @Test
    fun `a close paren numbers a list too`() {
        assertEquals(Kind.Number, Markup.parse("1) one").single().kind)
    }

    @Test
    fun `a marker glued to its word is a mark, not a list`() {
        // The space after the marker is the whole difference, and it is what
        // keeps every *italic* in the app from becoming a bullet.
        val block = one("*italic*")
        assertEquals(Kind.Body, block.kind)
        assertEquals("italic", block.text)
    }

    @Test
    fun `a hyphen mid-sentence is not a bullet`() {
        val block = one("well - maybe not")
        assertEquals(Kind.Body, block.kind)
        assertEquals("well - maybe not", block.text)
    }

    @Test
    fun `a decimal is not a numbered item`() {
        val block = one("3.14 is pi")
        assertEquals(Kind.Body, block.kind)
        assertEquals("3.14 is pi", block.text)
    }

    @Test
    fun `a list marker inside a fence is left alone`() {
        val blocks = Markup.parse("```\n- not a bullet\n```")
        assertEquals(listOf(Kind.Code), blocks.map { it.kind })
        assertEquals("- not a bullet", blocks[0].text)
    }

    @Test
    fun `there is nothing to continue outside a list`() {
        assertNull(Markup.continueList("just words", 10))
        // A marker with nothing after it is not a list yet.
        assertNull(Markup.continueList("-", 1))
        // The caret in prose under a list is an ordinary newline.
        assertNull(Markup.continueList("- eggs\nprose", 12))
    }

    @Test
    fun `a bullet offers the next bullet`() {
        assertEquals(Markup.Continuation("- eggs\n- ", 9), Markup.continueList("- eggs", 6))
    }

    @Test
    fun `the exact marker is kept`() {
        assertEquals(Markup.Continuation("* eggs\n* ", 9), Markup.continueList("* eggs", 6))
        assertEquals(Markup.Continuation("  + eggs\n  + ", 13), Markup.continueList("  + eggs", 8))
    }

    @Test
    fun `a numbered item offers the one after it`() {
        assertEquals(Markup.Continuation("1. one\n2. ", 10), Markup.continueList("1. one", 6))
        assertEquals(Markup.Continuation("3) three\n4) ", 12), Markup.continueList("3) three", 8))
    }

    @Test
    fun `an empty item ends the list`() {
        assertEquals(Markup.Continuation("- eggs\n", 7), Markup.continueList("- eggs\n- ", 9))
        assertEquals(Markup.Continuation("1. one\n", 7), Markup.continueList("1. one\n2. ", 10))
    }

    @Test
    fun `only the line the caret is on counts`() {
        assertEquals(
            Markup.Continuation("prose\n- eggs\n- ", 15),
            Markup.continueList("prose\n- eggs", 12),
        )
    }

    @Test
    fun `a caret mid-item splits it and carries the list on`() {
        assertEquals(Markup.Continuation("- eggs\n- milk", 9), Markup.continueList("- eggsmilk", 6))
    }

    @Test
    fun `isPlain agrees with parse doing nothing`() {
        for (text in listOf(
            "hello",
            "a b c",
            "2 > 1 yes",
            "https://example.com/a_b",
            "- a bullet",
            "1. an item",
            "1) an item",
            "well - maybe not",
            "3.14 is pi",
        )) {
            val plain = Markup.isPlain(text)
            val unchanged = Markup.parse(text).let {
                it.size == 1 && it[0].kind == Kind.Body && it[0].text == text && it[0].spans.isEmpty()
            }
            // isPlain may be pessimistic; it must never be optimistic.
            if (plain) assertTrue("said plain but changed: $text", unchanged)
        }
    }

    @Test
    fun `a shortcode survives the parse so the emoji splitter still sees it`() {
        // The two run in order over the same string; a mark eating a colon
        // would turn a picture back into words.
        val block = one("**a** :shipit: b")
        assertEquals("a :shipit: b", block.text)
        assertEquals(listOf(Span(0, 1, Style.Bold)), block.spans)
    }
}
