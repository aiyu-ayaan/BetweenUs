package com.aatech.betweenus.core.data

/**
 * The markdown-ish shape of a message body.
 *
 * `MessageBody` decides what a message *is* - words, attachments and the quote
 * above a reply. This decides how the words read: the small set of marks every
 * chat app has trained people to type, and nothing else. There is no link
 * syntax, because a bare URL is already a link on every client; no headings,
 * because a heading in a chat line is shouting; and no images, because an
 * attachment is not a body.
 *
 * Pure and offset-exact, which is the whole reason it is here rather than in
 * the renderer: the marks are *removed* from the text, so every span is an
 * index into the text that comes out, and the emoji splitter runs over that
 * same string afterwards. A parser that left the asterisks in would need no
 * offsets at all - and would draw them.
 */
object Markup {

    enum class Style { Bold, Italic, Strike, Code }

    /** A style over `[start, end)` of the block's own text. */
    data class Span(val start: Int, val end: Int, val style: Style)

    enum class Kind { Body, Quote, Code, Bullet, Number }

    /**
     * One block of a message.
     *
     * A list is not a block: every item is its own, and a run of them next to
     * each other is what a list *is*. That keeps this list flat - no tree, no
     * nesting - which is the whole of what a chat line needs and a fraction of
     * what a document parser would cost.
     *
     * [ordinal] is the number a `Number` item is drawn with, and zero for
     * everything else.
     */
    data class Block(
        val kind: Kind,
        val text: String,
        val spans: List<Span> = emptyList(),
        val ordinal: Int = 0,
    )

    private data class Delimiter(val token: String, val style: Style)

    // Longest first: `**` has to be tried before `*` or every bold is two
    // italics with nothing between them.
    private val DELIMITERS = listOf(
        Delimiter("**", Style.Bold),
        Delimiter("~~", Style.Strike),
        Delimiter("*", Style.Italic),
        Delimiter("_", Style.Italic),
        Delimiter("`", Style.Code),
    )

    private const val ESCAPABLE = "*_~`\\>"

    /**
     * A list marker, and the space after it.
     *
     * The space is what keeps `*bold*` from being a bullet: a marker glued to
     * its word is a mark, and a marker standing off from it is a list. The
     * indent is bounded at three so a deliberately indented line stays prose.
     */
    private val BULLET = Regex("^ {0,3}[-*+] +(.*)$")
    private val NUMBER = Regex("^ {0,3}(\\d{1,9})[.)] +(.*)$")

    fun parse(text: String): List<Block> {
        val blocks = mutableListOf<Block>()
        val lines = text.split("\n")
        var i = 0

        val pending = StringBuilder()
        var pendingQuote = false

        fun flush() {
            if (pending.isEmpty()) return
            val kind = if (pendingQuote) Kind.Quote else Kind.Body
            blocks += inline(pending.toString(), kind)
            pending.setLength(0)
            pendingQuote = false
        }

        while (i < lines.size) {
            val line = lines[i]

            if (line.trimStart().startsWith("```")) {
                flush()
                val fence = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trimStart().startsWith("```")) {
                    fence += lines[i]
                    i++
                }
                // An unclosed fence is still a code block. Somebody who opened
                // one and hit send meant the rest to be code; drawing it as
                // prose with three backticks in front of it helps nobody.
                if (i < lines.size) i++
                blocks += Block(Kind.Code, fence.joinToString("\n").trim('\n'))
                continue
            }

            // A list item is its own block, so it ends whatever paragraph was
            // being gathered. Bullets first: `1.` cannot start with `-`, but a
            // bullet line can perfectly well contain a number.
            val bullet = BULLET.find(line)
            if (bullet != null) {
                flush()
                blocks += inline(bullet.groupValues[1], Kind.Bullet)
                i++
                continue
            }

            val numbered = NUMBER.find(line)
            if (numbered != null) {
                flush()
                // The run is renumbered from whatever the first item said, so
                // the `1. 1. 1.` everybody types comes out 1, 2, 3 - and a list
                // that deliberately starts at 5 still starts at 5.
                val previous = blocks.lastOrNull()
                val ordinal = if (previous != null && previous.kind == Kind.Number) {
                    previous.ordinal + 1
                } else {
                    numbered.groupValues[1].toIntOrNull() ?: 1
                }
                blocks += inline(numbered.groupValues[2], Kind.Number, ordinal)
                i++
                continue
            }

            val quoted = line.startsWith("> ") || line == ">"
            val body = if (quoted) line.removePrefix(">").removePrefix(" ") else line

            // A run of lines is one block only while they agree about being
            // quoted; the marker changing is a new block.
            if (pending.isNotEmpty() && quoted != pendingQuote) flush()
            if (pending.isNotEmpty()) pending.append('\n')
            pendingQuote = quoted
            pending.append(body)
            i++
        }
        flush()

        return blocks
    }

    private fun inline(source: String, kind: Kind, ordinal: Int = 0): Block {
        val out = StringBuilder()
        val spans = mutableListOf<Span>()
        scan(source, out, spans)
        return Block(kind, out.toString(), spans, ordinal)
    }

    private fun scan(source: String, out: StringBuilder, spans: MutableList<Span>) {
        var i = 0
        while (i < source.length) {
            val c = source[i]

            if (c == '\\' && i + 1 < source.length && source[i + 1] in ESCAPABLE) {
                out.append(source[i + 1])
                i += 2
                continue
            }

            val opener = openerAt(source, i)
            if (opener != null) {
                val from = i + opener.token.length
                val close = source.indexOf(opener.token, from)
                if (close > from) {
                    val start = out.length
                    val content = source.substring(from, close)
                    // Code is literal: a backtick span is where somebody puts
                    // the asterisks they do not want eaten.
                    if (opener.style == Style.Code) out.append(content)
                    else scan(content, out, spans)
                    spans += Span(start, out.length, opener.style)
                    i = close + opener.token.length
                    continue
                }
            }

            out.append(c)
            i++
        }
    }

    private fun openerAt(source: String, at: Int): Delimiter? {
        for (delimiter in DELIMITERS) {
            if (!source.startsWith(delimiter.token, at)) continue
            // `snake_case_names` are not two italics. An underscore only opens
            // when it is not glued to a word on its left, which is the rule
            // that keeps identifiers readable without a backtick round them.
            if (delimiter.token == "_" && at > 0 && source[at - 1].isLetterOrDigit()) continue
            return delimiter
        }
        return null
    }

    /** Whether anything at all would be drawn differently. Saves a rebuild. */
    fun isPlain(text: String): Boolean =
        text.none { it == '*' || it == '_' || it == '~' || it == '`' || it == '\\' } &&
            text.lineSequence().none {
                it.startsWith("> ") || it == ">" || BULLET.matches(it) || NUMBER.matches(it)
            }
}
