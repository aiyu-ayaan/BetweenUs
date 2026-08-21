package com.aatech.betweenus.core.data

import com.aatech.betweenus.core.data.Markup.Kind
import com.aatech.betweenus.core.data.Markup.Span
import com.aatech.betweenus.core.data.Markup.Style
import org.junit.Assert.assertEquals
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
    fun `isPlain agrees with parse doing nothing`() {
        for (text in listOf("hello", "a b c", "2 > 1 yes", "https://example.com/a_b")) {
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
