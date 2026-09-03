package com.aatech.betweenus.feature.chat

import com.aatech.betweenus.core.data.Message
import com.aatech.betweenus.core.data.MessageWebhook
import com.aatech.betweenus.core.data.UserSummary
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which rows carry a body, and therefore which rows a bubble may group with.
 *
 * Grouping decides whether a message draws a name and a face of its own, so
 * getting it wrong is not cosmetic: a message wrongly grouped is a message from
 * nobody, and one wrongly split is somebody's name repeated down the screen.
 *
 * The case worth pinning is the one that shipped. An arrival line sits in the
 * same list as the bubbles and carries the arriving person as its author, so
 * "mobile is here." followed by mobile's own "Hi" matched on author id, grouped
 * with the arrival, and drew neither a name nor a picture.
 *
 * The desktop pins the same rule in `ChatView.check.ts`.
 */
class GroupingTest {

    private fun message(
        kind: String = Message.KIND_USER,
        authorId: String = "u1",
        webhook: MessageWebhook? = null,
    ) = Message(
        id = "m1",
        channelId = "c1",
        kind = kind,
        content = "hi",
        author = UserSummary(authorId, "mobile", "mobile", null),
        createdAt = "2026-09-03T18:04:00.000Z",
        editedAt = null,
        deletedAt = null,
        deletedBy = null,
        pinnedAt = null,
        reactions = emptyList(),
        webhook = webhook,
    )

    @Test
    fun `an arrival line carries no body, so nothing groups with it`() {
        // This is the whole bug: `hasBody` is what MessageRow now checks before
        // it will treat the row above as the start of a run.
        assertFalse(message(kind = Message.KIND_MEMBER_JOIN).hasBody)
        assertTrue(message(kind = Message.KIND_MEMBER_JOIN).isArrival)
    }

    @Test
    fun `a person's message carries one`() {
        assertTrue(message().hasBody)
        assertFalse(message().isArrival)
        assertFalse(message().isWebhook)
    }

    @Test
    fun `a webhook message carries one too`() {
        // The regression that made the allowlist necessary. `kind != USER` meant
        // "the server wrote this and it has no text", which was true while
        // MEMBER_JOIN was the only other kind and silently became "a webhook
        // message renders empty" the moment a third existed.
        val hook = message(
            kind = Message.KIND_WEBHOOK,
            webhook = MessageWebhook("w1", "Deploys", null),
        )
        assertTrue(hook.hasBody)
        assertTrue(hook.isWebhook)
        assertFalse(hook.isArrival)
    }

    @Test
    fun `an unknown future kind carries no body`() {
        // An allowlist and not a denylist, so a client that has never heard of a
        // kind draws nothing for it rather than drawing the wrong thing.
        assertFalse(message(kind = "SOMETHING_ADDED_LATER").hasBody)
    }
}
