package com.aatech.betweenus.core.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Splitting a message around its custom emoji, checked against the desktop's
 * `server-emoji.check.ts` case for case.
 *
 * The two clients read each other's messages, so what one writes as `:shipit:`
 * the other has to draw as the same picture - and a splitter that is one
 * character out turns a message into half a message.
 */
class CustomEmojiTest {

    private val shipit = MessageCustomEmoji("shipit", "/api/v1/uploads/pictures/a.webp", false)
    private val parrot = MessageCustomEmoji("party_parrot", "/api/v1/uploads/pictures/b.gif", true)
    private val manifest = listOf(shipit, parrot)

    @Test
    fun `a message with no emoji is one piece of text`() {
        assertEquals(listOf(CustomEmoji.Piece.Text("hello")), CustomEmoji.split("hello", emptyList()))
        assertEquals(emptyList<CustomEmoji.Piece>(), CustomEmoji.split("", emptyList()))
    }

    @Test
    fun `text either side is kept exactly, spaces and all`() {
        val pieces = CustomEmoji.split("a :shipit: b", manifest)

        assertEquals(3, pieces.size)
        assertEquals(CustomEmoji.Piece.Text("a "), pieces[0])
        assertEquals(CustomEmoji.Piece.Emoji(shipit), pieces[1])
        assertEquals(CustomEmoji.Piece.Text(" b"), pieces[2])
    }

    @Test
    fun `a shortcode with no picture stays a word`() {
        // A deleted emoji, or one from a server this reader is not in. It must
        // read as what somebody typed rather than as a broken image.
        assertEquals(listOf(CustomEmoji.Piece.Text("look :gone:")), CustomEmoji.split("look :gone:", manifest))
    }

    @Test
    fun `two in a row are two pictures`() {
        val pieces = CustomEmoji.split(":shipit::party_parrot:", manifest)

        assertEquals(
            listOf(CustomEmoji.Piece.Emoji(shipit), CustomEmoji.Piece.Emoji(parrot)),
            pieces,
        )
    }

    @Test
    fun `a message that is only emoji is drawn large`() {
        assertTrue(CustomEmoji.isOnlyEmoji(CustomEmoji.split(":shipit:", manifest)))
        assertTrue(CustomEmoji.isOnlyEmoji(CustomEmoji.split(" :shipit:  :party_parrot: ", manifest)))
        assertFalse(CustomEmoji.isOnlyEmoji(CustomEmoji.split("ship it :shipit:", manifest)))
        assertFalse(CustomEmoji.isOnlyEmoji(emptyList()))
    }

    @Test
    fun `a body carries its emoji through a round trip`() {
        val body = MessageBody("ship it :shipit:", emoji = listOf(shipit))
        val decoded = MessageBody.decode(body.encode())

        assertEquals("ship it :shipit:", decoded.text)
        assertEquals(1, decoded.emoji.size)
        assertEquals("shipit", decoded.emoji[0].name)
        assertEquals(shipit.url, decoded.emoji[0].url)
    }
}
