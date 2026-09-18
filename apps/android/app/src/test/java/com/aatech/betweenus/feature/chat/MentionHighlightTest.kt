package com.aatech.betweenus.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MentionHighlightTest {

    @Test
    fun `mention at start of message`() {
        val mentions = extractMentions("@mobile Hi dost")
        assertEquals(listOf("@mobile"), mentions)
    }

    @Test
    fun `mention in middle of text`() {
        val mentions = extractMentions("Hello @ada Lovelace")
        assertEquals(listOf("@ada"), mentions)
    }

    @Test
    fun `email address is not matched as mention`() {
        val mentions = extractMentions("Email test@example.com should not match")
        assertTrue(mentions.isEmpty())
    }

    @Test
    fun `trailing sentence punctuation is excluded from mention`() {
        val mentions = extractMentions("Thanks @mobile.")
        assertEquals(listOf("@mobile"), mentions)

        val exclamation = extractMentions("Hey @ada!")
        assertEquals(listOf("@ada"), exclamation)

        val comma = extractMentions("Hi @user, welcome!")
        assertEquals(listOf("@user"), comma)
    }

    @Test
    fun `broadcast mentions are extracted`() {
        val mentions = extractMentions("Alert @everyone and @here please")
        assertEquals(listOf("@everyone", "@here"), mentions)
    }

    @Test
    fun `mentions inside URLs are ignored`() {
        val mentions = extractMentions("Visit https://twitter.com/@user for news")
        assertTrue(mentions.isEmpty())
    }

    @Test
    fun `URL containing mention alongside independent mention`() {
        val mentions = extractMentions("See https://github.com/@org/repo or ask @bob")
        assertEquals(listOf("@bob"), mentions)
    }

    @Test
    fun `handles with underscores hyphens and dots are extracted`() {
        val mentions = extractMentions("@user_name @user-name @user.name")
        assertEquals(listOf("@user_name", "@user-name", "@user.name"), mentions)
    }

    @Test
    fun `trailing dot on handle is not included`() {
        val mentions = extractMentions("@user.name.")
        assertEquals(listOf("@user.name"), mentions)
    }

    @Test
    fun `bare at sign is not matched`() {
        val mentions = extractMentions("hello @ world")
        assertTrue(mentions.isEmpty())
        assertTrue(extractMentions("@").isEmpty())
    }

    @Test
    fun `extractMentionRanges returns exact ranges`() {
        val text = "Hi @mobile and @ada!"
        val ranges = extractMentionRanges(text)
        assertEquals(2, ranges.size)
        assertEquals(3 until 10 to "@mobile", ranges[0])
        assertEquals(15 until 19 to "@ada", ranges[1])
    }
}
