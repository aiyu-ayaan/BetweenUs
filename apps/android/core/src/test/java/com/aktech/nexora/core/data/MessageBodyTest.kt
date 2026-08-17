package com.aktech.nexora.core.data

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The message body encoding, checked against the desktop's
 * `apps/desktop/src/services/message-body.check.ts` case for case.
 *
 * This exists because the two clients disagreed and nothing caught it: Android
 * wrote bare JSON and sniffed for a leading `{`, the desktop wrote a
 * NUL-marked document, and a photo sent from a phone arrived on the web as a
 * paragraph of JSON. An encoding shared by three clients needs the same cases
 * asserted in each of them.
 */
class MessageBodyTest {

    private val attachment = MessageAttachment(
        key = "attachments/u1/2026-08/abc",
        url = "/api/v1/uploads/attachments/u1/2026-08/abc",
        name = "cat.png",
        contentType = "image/png",
        size = 1024,
        iv = "aXY",
        epoch = 4,
    )

    @Test
    fun `text with no files stays exactly as it was typed`() {
        assertEquals("hello", MessageBody("hello").encode())
        assertEquals(MessageBody("hello"), MessageBody.decode("hello"))
    }

    @Test
    fun `a message that looks like an envelope is still just text`() {
        // The hole the marker closes: no text field can produce a NUL, so a
        // person typing this cannot forge an attachment.
        val impostor = "{\"text\":\"nope\",\"attachments\":[]}"
        assertEquals(MessageBody(impostor), MessageBody.decode(impostor))
    }

    @Test
    fun `files survive a round trip`() {
        val body = MessageBody("look at this", listOf(attachment))
        val decoded = MessageBody.decode(body.encode())

        assertEquals("look at this", decoded.text)
        assertEquals(1, decoded.attachments.size)
        assertEquals(attachment.key, decoded.attachments[0].key)
        assertEquals(attachment.name, decoded.attachments[0].name)
        assertEquals(attachment.iv, decoded.attachments[0].iv)
        assertEquals(attachment.epoch, decoded.attachments[0].epoch)
    }

    @Test
    fun `an encoded body carries the marker the desktop looks for`() {
        val encoded = MessageBody("hi", listOf(attachment)).encode()
        assertEquals("\u0000nexora-body:1\n", encoded.take(15))
    }

    @Test
    fun `a reply carries no files and is still a document`() {
        val body = MessageBody("agreed", replyTo = MessageReply("m-1", "Ada", "shall we ship it"))
        val decoded = MessageBody.decode(body.encode())

        assertEquals("agreed", decoded.text)
        assertEquals(MessageReply("m-1", "Ada", "shall we ship it"), decoded.replyTo)
    }

    @Test
    fun `a quote with no id is dropped rather than drawn unclickable`() {
        val encoded = "\u0000nexora-body:1\n{\"text\":\"hi\",\"replyTo\":{\"author\":\"Ada\"}}"
        assertEquals(null, MessageBody.decode(encoded).replyTo)
    }

    @Test
    fun `a quote is one line however many the original had`() {
        assertEquals("two lines", MessageReply.preview("  two\n\nlines  "))
        assertEquals(MessageReply.PREVIEW_CHARS, MessageReply.preview("x".repeat(500)).length)
    }

    @Test
    fun `a marked body that will not parse is shown rather than swallowed`() {
        val broken = "\u0000nexora-body:1\nnot json at all"
        assertEquals(broken, MessageBody.decode(broken).text)
    }
}
