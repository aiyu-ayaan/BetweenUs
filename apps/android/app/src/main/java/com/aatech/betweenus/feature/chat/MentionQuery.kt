package com.aatech.betweenus.feature.chat

data class MentionQuery(val term: String, val start: Int)

object MentionQueryParser {
    fun queryAt(text: String, caret: Int): MentionQuery? {
        if (caret <= 0 || caret > text.length) return null
        val before = text.substring(0, caret)
        val at = before.lastIndexOf('@')
        if (at == -1) return null

        val term = before.substring(at + 1)
        // Any whitespace terminates the query
        if (term.any { it.isWhitespace() }) return null
        // Allowed username/search characters
        if (term.isNotEmpty() && !term.all { it.isLetterOrDigit() || it == '_' || it == '.' || it == '-' }) {
            return null
        }

        // Preceding character must be start of line or whitespace
        if (at > 0 && !before[at - 1].isWhitespace()) return null

        return MentionQuery(term, at)
    }
}
