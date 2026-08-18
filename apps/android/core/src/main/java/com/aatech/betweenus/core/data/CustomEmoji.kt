package com.aatech.betweenus.core.data

/**
 * Splitting a message into the words and the pictures.
 *
 * The port of `splitMessage` in `apps/desktop/src/services/server-emoji.ts`,
 * and it has to agree with it: the two clients read each other's messages, so
 * what one writes as `:shipit:` the other has to draw as the same picture.
 *
 * The pictures come from the message rather than from this server's list. A
 * shortcode forwarded into a direct message still renders, and one whose emoji
 * has since been deleted degrades to the word somebody typed rather than to a
 * broken image - which is the whole reason the manifest carries a URL.
 *
 * Pure, and tested: the splitting is where an off-by-one turns a message into
 * half a message.
 */
object CustomEmoji {

    /** Every `:name:` in a line, as written. Byte for byte the desktop's rule. */
    private val SHORTCODE = Regex(":([a-z0-9_]{2,32}):")

    sealed interface Piece {
        data class Text(val text: String) : Piece
        data class Emoji(val emoji: MessageCustomEmoji) : Piece
    }

    fun split(text: String, manifest: List<MessageCustomEmoji>): List<Piece> {
        if (manifest.isEmpty()) return if (text.isEmpty()) emptyList() else listOf(Piece.Text(text))

        val byName = manifest.associateBy { it.name }
        val pieces = mutableListOf<Piece>()
        var at = 0

        for (match in SHORTCODE.findAll(text)) {
            val emoji = byName[match.groupValues[1]] ?: continue
            if (match.range.first > at) pieces += Piece.Text(text.substring(at, match.range.first))
            pieces += Piece.Emoji(emoji)
            at = match.range.last + 1
        }

        if (at < text.length) pieces += Piece.Text(text.substring(at))
        return pieces
    }

    /**
     * Whether a message is nothing but emoji, which every chat app draws larger.
     * Not decoration: a reaction sent as a message is the whole message, and at
     * emoji size it reads as a typo.
     */
    fun isOnlyEmoji(pieces: List<Piece>): Boolean =
        pieces.isNotEmpty() && pieces.all { it is Piece.Emoji || (it as Piece.Text).text.isBlank() }
}
