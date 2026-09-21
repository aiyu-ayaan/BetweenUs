package com.aatech.betweenus.core.data

import com.aatech.betweenus.core.data.Syntax.Kind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The desktop `syntax.check.ts` cases, case for case. The two lexers are
 * separate code and have to stay one behaviour.
 *
 * Every case also checks the one property the renderer depends on: the tokens
 * joined back together are the code that went in, character for character.
 */
class SyntaxTest {

    private fun lex(code: String, lang: String): List<Syntax.Token> {
        val tokens = Syntax.tokenize(code, lang)
        assertEquals(code, tokens.joinToString("") { it.text })
        return tokens
    }

    private fun coloured(code: String, lang: String): List<Pair<Kind, String>> =
        lex(code, lang).filter { it.kind != Kind.Plain }.map { it.kind to it.text }

    @Test
    fun `no language or an unknown one is one plain token`() {
        assertEquals(listOf(Syntax.Token("it's fine", Kind.Plain)), lex("it's fine", ""))
        assertEquals(listOf(Syntax.Token("x = 1", Kind.Plain)), lex("x = 1", "brainfuck"))
        assertTrue(lex("", "ts").isEmpty())
        assertTrue(Syntax.knowsLanguage("TS"))
        assertFalse(Syntax.knowsLanguage("cobol"))
    }

    @Test
    fun `the basics`() {
        assertEquals(
            listOf(
                Kind.Keyword to "const",
                Kind.String to "\"hi\"",
                Kind.Comment to "// note",
                Kind.Keyword to "return",
                Kind.Literal to "null",
            ),
            coloured("const a = \"hi\"; // note\nreturn null;", "ts"),
        )
        assertEquals(listOf(Kind.String to "\"a\\\"b\""), coloured("constant = \"a\\\"b\"", "js"))
    }

    @Test
    fun `numbers but not the digits at the end of a name`() {
        assertEquals(
            listOf(Kind.Number to "0xFF", Kind.Number to "2.5e3", Kind.Number to "1"),
            coloured("x1 = 0xFF + 2.5e3 - i-1", "js"),
        )
    }

    @Test
    fun `comments and stray quotes stay where they started`() {
        assertEquals(listOf(Kind.Comment to "/* b\nc */"), coloured("a /* b\nc */ d", "c"))
        assertEquals(listOf(Kind.Comment to "/* b"), coloured("a /* b", "c"))
        assertEquals(
            listOf(Kind.String to "\"open", Kind.Keyword to "if"),
            coloured("\"open\nif", "java"),
        )
    }

    @Test
    fun `python shell sql and css`() {
        assertEquals(
            listOf(
                Kind.Keyword to "def",
                Kind.String to "\"\"\"doc\n    more\"\"\"",
                Kind.Keyword to "return",
                Kind.Literal to "None",
                Kind.Comment to "# done",
            ),
            coloured("def f():\n    \"\"\"doc\n    more\"\"\"\n    return None  # done", "python"),
        )
        assertEquals(
            listOf(Kind.Keyword to "echo", Kind.Comment to "# count"),
            coloured("echo \$# # count", "bash"),
        )
        assertEquals(
            listOf(
                Kind.Keyword to "SELECT",
                Kind.Keyword to "FROM",
                Kind.Keyword to "WHERE",
                Kind.String to "'x'",
                Kind.Comment to "-- why",
            ),
            coloured("SELECT * FROM t WHERE a = 'x' -- why", "sql"),
        )
        assertEquals(
            listOf(Kind.Keyword to "@media", Kind.Number to "12px", Kind.Keyword to "!important"),
            coloured("@media (x) { a { font-size: 12px !important } }", "css"),
        )
    }

    @Test
    fun `kotlin and json`() {
        assertEquals(
            listOf(
                Kind.Keyword to "fun",
                Kind.Keyword to "val",
                Kind.String to "\"x\"",
                Kind.Comment to "// it's",
            ),
            coloured("fun main() { val s = \"x\" } // it's", "kotlin"),
        )
        assertEquals(
            listOf(Kind.String to "\"a\"", Kind.Number to "1", Kind.Literal to "true", Kind.Literal to "null"),
            coloured("{\"a\": [1, true, null]}", "json"),
        )
        assertEquals(listOf(Syntax.Token("();", Kind.Plain)), lex("();", "ts"))
    }
}
