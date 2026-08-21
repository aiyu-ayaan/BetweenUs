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

    enum class Kind { Body, Quote, Code }

    data class Block(val kind: Kind, val text: String, val spans: List<Span> = emptyList())

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

    private fun inline(source: String, kind: Kind): Block {
        val out = StringBuilder()
        val spans = mutableListOf<Span>()
        scan(source, out, spans)
        return Block(kind, out.toString(), spans)
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
            !text.startsWith("> ") && !text.contains("\n> ")
}
