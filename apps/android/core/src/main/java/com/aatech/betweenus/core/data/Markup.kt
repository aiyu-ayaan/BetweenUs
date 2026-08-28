package com.aatech.betweenus.core.data

/**
 * The markdown-ish shape of a message body.
 *
 * `MessageBody` decides what a message *is* - words, attachments and the quote
 * above a reply. This decides how the words read: the small set of marks every
 * chat app has trained people to type, and nothing else. There is no link
 * syntax, because a bare URL is already a link on every client, and no images,
 * because an attachment is not a body.
 *
 * Headings are the one thing that depends on what is being read. A heading in a
 * chat line is shouting, so [parse] does not have them; release notes are a
 * document and are nothing but headings, so [parseNotes] does. It is the same
 * parser with one rule switched on.
 *
 * Line for line the desktop client's `markup.ts`. Changing one changes both, or
 * the same message reads differently on two screens.
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

    enum class Kind { Body, Quote, Code, Bullet, Number, Heading }

    /**
     * One block of a message.
     *
     * A list is not a block: every item is its own, and a run of them next to
     * each other is what a list *is*. That keeps this list flat - no tree, no
     * nesting - which is the whole of what a chat line needs and a fraction of
     * what a document parser would cost.
     *
     * [ordinal] is the number a `Number` item is drawn with, and the level of
     * a `Heading` - `## Install` is 2. Zero for everything else.
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

    /** `### Features`. The space is what keeps a `#channel` mention from being one. */
    private val HEADING = Regex("^ {0,3}(#{1,6}) +(.*?)\\s*#*\\s*$")

    /**
     * The `| --- | --- |` under a table's header row.
     *
     * ponytail: tables are not parsed, only this line is swallowed - the rows
     * draw as the pipes they are, which is legible for the three-row table a
     * release note carries. A real table block if one ever gets wide enough to
     * need it.
     */
    private val TABLE_RULE = Regex("^ {0,3}\\|[\\s:|-]*-[\\s:|-]*\\|\\s*$")

    /**
     * The same parser, reading a document rather than a chat line.
     *
     * Release notes are `### Features` and a list under it, which [parse] would
     * draw as a line beginning with three hashes. This is the only caller that
     * wants headings, and chat is the only one that must not have them.
     */
    fun parseNotes(text: String): List<Block> = parse(text, headings = true)

    fun parse(text: String, headings: Boolean = false): List<Block> {
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

            if (headings) {
                if (TABLE_RULE.matches(line)) {
                    i++
                    continue
                }
                val heading = HEADING.find(line)
                if (heading != null) {
                    flush()
                    blocks += inline(
                        heading.groupValues[2],
                        Kind.Heading,
                        heading.groupValues[1].length,
                    )
                    i++
                    continue
                }
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

    /** The box's text and where the caret sits in it, after a newline was typed. */
    data class Continuation(val text: String, val caret: Int)

    /**
     * What a newline typed inside a list should do.
     *
     * Null for an ordinary newline anywhere else - the caller then does
     * nothing and the box behaves as it always did. This is what makes a list
     * feel like a list while it is being written rather than only once it has
     * been sent: typing `- eggs` and pressing return offers the next bullet,
     * the way every editor anybody has used does.
     *
     * An empty item ends the list instead of offering another one. Without
     * that, the only way out of a list is to delete a marker somebody never
     * typed, which is the single thing that makes auto-continuation
     * infuriating rather than helpful.
     *
     * Line for line the desktop's `continueList`. Changing one changes both.
     */
    fun continueList(text: String, caret: Int): Continuation? {
        val from = text.lastIndexOf('\n', caret - 1) + 1
        val line = text.substring(from, caret)

        val bullet = BULLET.find(line)
        val numbered = if (bullet == null) NUMBER.find(line) else null
        if (bullet == null && numbered == null) return null

        // An empty item is somebody asking to stop. The marker goes, and with
        // it the item they were about to write.
        val content = bullet?.groupValues?.get(1) ?: numbered!!.groupValues[2]
        if (content.isBlank()) {
            return Continuation(text.substring(0, from) + text.substring(caret), from)
        }

        // The content is the tail of the line by construction, so whatever is
        // in front of it is exactly the marker - indent, bullet character and
        // spacing included. Rebuilding it from the parts would quietly
        // normalise all three.
        val prefix = line.substring(0, line.length - content.length)
        val marker = if (bullet != null) {
            prefix
        } else {
            val next = (numbered!!.groupValues[1].toIntOrNull() ?: 1) + 1
            prefix.replaceFirst(Regex("\\d{1,9}"), next.toString())
        }
        val inserted = "\n$marker"
        return Continuation(
            text.substring(0, caret) + inserted + text.substring(caret),
            caret + inserted.length,
        )
    }

    /** Whether anything at all would be drawn differently. Saves a rebuild. */
    fun isPlain(text: String): Boolean =
        text.none { it == '*' || it == '_' || it == '~' || it == '`' || it == '\\' } &&
            text.lineSequence().none {
                it.startsWith("> ") || it == ">" || BULLET.matches(it) || NUMBER.matches(it)
            }
}
