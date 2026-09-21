package com.aatech.betweenus.core.data

/**
 * Colour for a fenced code block, by the language its fence named.
 *
 * Deliberately a lexer and not a parser: it knows what a comment, a string, a
 * number and a keyword look like in a couple of dozen languages, and nothing
 * about what the code means. That is the whole of what a snippet in a chat
 * needs - somebody pasting twenty lines wants to see where the string ends,
 * not a type-checked AST - and it keeps the cost to one small file instead of
 * a highlighting library and its grammar bundle on both clients.
 *
 * A fence with no language, or one this does not know, comes back as one plain
 * token and is drawn monospace and uncoloured. Guessing the language of an
 * untagged block is how a sentence with an apostrophe in it gets painted as a
 * string to the end of the line.
 *
 * Pure, and line for line the desktop client's `syntax.ts`. Changing one
 * changes both, or the same snippet is coloured differently on two screens.
 */
object Syntax {

    enum class Kind { Plain, Keyword, Literal, String, Number, Comment }

    data class Token(val text: kotlin.String, val kind: Kind)

    private class Grammar(
        val keywords: Set<kotlin.String>,
        /** `true`, `null`, `None` - values rather than words of the language. */
        val literals: Set<kotlin.String>,
        val lineComments: List<kotlin.String>,
        val blockComment: Pair<kotlin.String, kotlin.String>?,
        /** Characters that open a string, each closed by itself. */
        val quotes: kotlin.String,
        /** Python's and Kotlin's `"""`, which may run across lines. */
        val tripleQuotes: Boolean = false,
        /** SQL does not care how a keyword is spelled; everybody else does. */
        val caseInsensitive: Boolean = false,
    )

    private fun words(list: kotlin.String): Set<kotlin.String> = list.split(' ').toSet()

    private val C_LIKE_LITERALS = words("true false null")

    private val JS = Grammar(
        keywords = words(
            "abstract as async await break case catch class const continue debugger declare default delete do else enum export extends finally for from function get if implements import in instanceof interface let new of private protected public readonly return set static super switch this throw try type typeof var void while with yield",
        ),
        literals = words("true false null undefined NaN Infinity"),
        lineComments = listOf("//"),
        blockComment = "/*" to "*/",
        quotes = "\"'`",
    )

    private val PYTHON = Grammar(
        keywords = words(
            "and as assert async await break class continue def del elif else except finally for from global if import in is lambda match case nonlocal not or pass raise return try while with yield self",
        ),
        literals = words("True False None"),
        lineComments = listOf("#"),
        blockComment = null,
        quotes = "\"'",
        tripleQuotes = true,
    )

    private val KOTLIN = Grammar(
        keywords = words(
            "abstract annotation as break by catch class companion const constructor continue data do else enum external final finally for fun get if import in init inline interface internal is lateinit object open operator out override package private protected public return sealed set super suspend this throw try typealias val var vararg when where while",
        ),
        literals = C_LIKE_LITERALS,
        lineComments = listOf("//"),
        blockComment = "/*" to "*/",
        quotes = "\"'",
        tripleQuotes = true,
    )

    private val JAVA = Grammar(
        keywords = words(
            "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public record return short static super switch synchronized this throw throws transient try var void volatile while",
        ),
        literals = C_LIKE_LITERALS,
        lineComments = listOf("//"),
        blockComment = "/*" to "*/",
        quotes = "\"'",
    )

    private val C = Grammar(
        keywords = words(
            "auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern float for friend goto if inline int long namespace new operator private protected public register return short signed sizeof static struct switch template this throw try typedef typename union unsigned using virtual void volatile while #include #define #ifdef #ifndef #endif #pragma",
        ),
        literals = words("true false NULL nullptr"),
        lineComments = listOf("//"),
        blockComment = "/*" to "*/",
        quotes = "\"'",
    )

    private val CSHARP = Grammar(
        keywords = words(
            "abstract as async await base bool break byte case catch char class const continue decimal default delegate do double else enum event explicit extern finally fixed float for foreach get if implicit in int interface internal is lock long namespace new object operator out override params private protected public readonly record ref return sealed set short static string struct switch this throw try typeof uint ulong using var virtual void volatile while",
        ),
        literals = C_LIKE_LITERALS,
        lineComments = listOf("//"),
        blockComment = "/*" to "*/",
        quotes = "\"'",
    )

    private val GO = Grammar(
        keywords = words(
            "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var",
        ),
        literals = words("true false nil iota"),
        lineComments = listOf("//"),
        blockComment = "/*" to "*/",
        quotes = "\"'`",
    )

    private val RUST = Grammar(
        keywords = words(
            "as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while",
        ),
        literals = words("true false None Some Ok Err"),
        lineComments = listOf("//"),
        blockComment = "/*" to "*/",
        // A single quote is a lifetime as often as a char, and a lifetime has
        // no closing quote - so only double quotes open a string here.
        quotes = "\"",
    )

    private val SWIFT = Grammar(
        keywords = words(
            "as associatedtype break case catch class continue default defer do else enum extension fallthrough for func guard if import in init inout internal is let private protocol public repeat rethrows return self static struct subscript super switch throw throws try typealias var where while",
        ),
        literals = words("true false nil"),
        lineComments = listOf("//"),
        blockComment = "/*" to "*/",
        quotes = "\"",
        tripleQuotes = true,
    )

    private val SHELL = Grammar(
        keywords = words(
            "if then else elif fi for while until do done case esac in function return local export readonly unset shift exit break continue source alias sudo echo cd",
        ),
        literals = words("true false"),
        lineComments = listOf("#"),
        blockComment = null,
        quotes = "\"'",
    )

    private val SQL = Grammar(
        keywords = words(
            "select from where and or not insert into values update set delete create alter drop table index view join inner left right outer full on as group by order having limit offset distinct union all exists in is like between case when then else end primary key foreign references default unique returning with begin commit rollback",
        ),
        literals = words("null true false"),
        lineComments = listOf("--"),
        blockComment = "/*" to "*/",
        quotes = "\"'",
        caseInsensitive = true,
    )

    private val JSON = Grammar(
        keywords = emptySet(),
        literals = C_LIKE_LITERALS,
        lineComments = emptyList(),
        blockComment = null,
        quotes = "\"",
    )

    private val YAML = Grammar(
        keywords = emptySet(),
        literals = words("true false null yes no on off"),
        lineComments = listOf("#"),
        blockComment = null,
        quotes = "\"'",
    )

    private val CSS = Grammar(
        keywords = words("@media @import @keyframes @font-face @supports @layer @apply !important"),
        literals = emptySet(),
        lineComments = emptyList(),
        blockComment = "/*" to "*/",
        quotes = "\"'",
    )

    private val MARKUP = Grammar(
        keywords = emptySet(),
        literals = emptySet(),
        lineComments = emptyList(),
        blockComment = "<!--" to "-->",
        // Double quotes only: an apostrophe in the text between two tags is
        // far more common than an attribute in single quotes.
        quotes = "\"",
    )

    /** Every name a fence might use, pointed at the grammar it means. */
    private val GRAMMARS: Map<kotlin.String, Grammar> = buildMap {
        listOf("js", "javascript", "jsx", "mjs", "cjs", "ts", "typescript", "tsx").forEach { put(it, JS) }
        listOf("py", "python", "python3").forEach { put(it, PYTHON) }
        listOf("kt", "kts", "kotlin").forEach { put(it, KOTLIN) }
        listOf("java").forEach { put(it, JAVA) }
        listOf("c", "h", "cpp", "c++", "cc", "hpp", "cxx").forEach { put(it, C) }
        listOf("cs", "csharp", "c#").forEach { put(it, CSHARP) }
        listOf("go", "golang").forEach { put(it, GO) }
        listOf("rs", "rust").forEach { put(it, RUST) }
        listOf("swift").forEach { put(it, SWIFT) }
        listOf("sh", "bash", "shell", "zsh", "console", "shellscript").forEach { put(it, SHELL) }
        listOf("sql", "postgres", "postgresql", "mysql", "sqlite").forEach { put(it, SQL) }
        listOf("json", "jsonc", "json5").forEach { put(it, JSON) }
        listOf("yaml", "yml").forEach { put(it, YAML) }
        listOf("css", "scss", "less").forEach { put(it, CSS) }
        listOf("html", "xml", "svg", "vue").forEach { put(it, MARKUP) }
    }

    /** Whether a fence's language is one this colours. */
    fun knowsLanguage(lang: kotlin.String): Boolean = GRAMMARS.containsKey(lang.lowercase())

    private val NUMBER =
        Regex("^(?:0[xX][\\da-fA-F_]+|0[bB][01_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)[a-zA-Z%]*")

    /** `@media`, `#include` and `!important` are words too, in their languages. */
    private fun isWordStart(c: Char): Boolean =
        c in 'A'..'Z' || c in 'a'..'z' || c == '_' || c == '$' || c == '@' || c == '#' || c == '!'

    private fun isWordPart(c: Char): Boolean =
        c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '_' || c == '$'

    private fun isAsciiLetter(c: Char?): Boolean = c != null && (c in 'A'..'Z' || c in 'a'..'z')

    private fun isAsciiDigit(c: Char): Boolean = c in '0'..'9'

    /**
     * [code] cut into coloured tokens. Joined back together the tokens are
     * always exactly [code], character for character - the renderer draws
     * them in order and nothing else, so a token that dropped or doubled a
     * character would be a snippet that no longer says what was sent.
     */
    fun tokenize(code: kotlin.String, lang: kotlin.String): List<Token> {
        if (code.isEmpty()) return emptyList()
        val grammar = GRAMMARS[lang.lowercase()] ?: return listOf(Token(code, Kind.Plain))

        val out = mutableListOf<Token>()
        fun push(text: kotlin.String, kind: Kind) {
            val last = out.lastOrNull()
            // Neighbouring plain text is one token, so a line of punctuation
            // is one node to draw rather than forty.
            if (last != null && last.kind == kind && kind == Kind.Plain) {
                out[out.size - 1] = last.copy(text = last.text + text)
            } else {
                out += Token(text, kind)
            }
        }

        var i = 0
        while (i < code.length) {
            val c = code[i]
            val before: Char? = if (i > 0) code[i - 1] else null

            val line = grammar.lineComments.firstOrNull { token ->
                // `#` is a comment only where a word could start. `$#` and
                // `${#x}` in a shell script, or `a#b` anywhere, are not.
                code.startsWith(token, i) && (token != "#" || before == null || before.isWhitespace())
            }
            if (line != null) {
                val end = code.indexOf('\n', i)
                val stop = if (end == -1) code.length else end
                push(code.substring(i, stop), Kind.Comment)
                i = stop
                continue
            }

            val block = grammar.blockComment
            if (block != null && code.startsWith(block.first, i)) {
                val close = code.indexOf(block.second, i + block.first.length)
                val stop = if (close == -1) code.length else close + block.second.length
                push(code.substring(i, stop), Kind.Comment)
                i = stop
                continue
            }

            if (c in grammar.quotes) {
                val triple = "$c$c$c"
                if (grammar.tripleQuotes && c != '`' && code.startsWith(triple, i)) {
                    val close = code.indexOf(triple, i + 3)
                    val stop = if (close == -1) code.length else close + 3
                    push(code.substring(i, stop), Kind.String)
                    i = stop
                    continue
                }
                // A backtick string may run across lines; the others end at
                // the line, so one stray quote colours a line rather than the
                // rest of the block.
                var j = i + 1
                while (j < code.length) {
                    val d = code[j]
                    if (d == '\\') {
                        j += 2
                        continue
                    }
                    if (d == c) {
                        j++
                        break
                    }
                    if (d == '\n' && c != '`') break
                    j++
                }
                val stop = minOf(j, code.length)
                push(code.substring(i, stop), Kind.String)
                i = stop
                continue
            }

            if (isAsciiDigit(c) && (before == null || !isWordPart(before))) {
                val match = NUMBER.find(code.substring(i))
                if (match != null) {
                    push(match.value, Kind.Number)
                    i += match.value.length
                    continue
                }
            }

            if (isWordStart(c) && (before == null || !isWordPart(before))) {
                var j = i + 1
                // A hyphen joins a word only when a letter follows it, which
                // keeps `font-size` and `@font-face` whole and leaves `i-1` a
                // subtraction.
                while (
                    j < code.length &&
                    (isWordPart(code[j]) || (code[j] == '-' && isAsciiLetter(code.getOrNull(j + 1))))
                ) {
                    j++
                }
                val word = code.substring(i, j)
                val key = if (grammar.caseInsensitive) word.lowercase() else word
                val kind = when (key) {
                    in grammar.keywords -> Kind.Keyword
                    in grammar.literals -> Kind.Literal
                    else -> Kind.Plain
                }
                push(word, kind)
                i = j
                continue
            }

            push(c.toString(), Kind.Plain)
            i++
        }

        return out
    }
}
