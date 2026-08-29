package com.aatech.betweenus.core.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Everything the local cache writes has to come back off disk as what went in.
 *
 * `from` is written against the server's JSON and `toJson` against `from`, so
 * the two drift the moment a field is added to one and not the other - and the
 * symptom is not a crash, it is a message whose author has no avatar or a
 * server whose permissions are silently empty until the next refresh. A
 * round trip catches it here instead.
 */
class CacheCodecTest {
    private val user = UserSummary(
        id = "u1",
        username = "ada",
        displayName = "Ada Lovelace",
        avatarUrl = "https://example.test/a.png",
    )

    private fun <T> roundTrip(value: T, toJson: (T) -> JSONObject, from: (JSONObject) -> T) {
        assertEquals(value, from(JSONObject(toJson(value).toString())))
    }

    @Test
    fun `user survives a round trip`() {
        roundTrip(user, UserSummary::toJson, UserSummary::from)
        roundTrip(user.copy(avatarUrl = null), UserSummary::toJson, UserSummary::from)
    }

    @Test
    fun `server survives a round trip`() {
        val server = ServerWithRole(
            id = "s1",
            name = "BetweenUs",
            slug = "betweenus",
            iconUrl = null,
            ownerId = "u1",
            messageTtlSeconds = 86_400,
            role = ServerRole.ADMIN,
            permissions = listOf("SEND_MESSAGE", "MANAGE_ROLE"),
        )
        roundTrip(server, ServerWithRole::toJson, ServerWithRole::from)
        // Off is a value here, not an absence, and it has to survive the cache
        // as one: a window that came back as "an hour" after a restart because
        // null did not round-trip would delete history nobody asked to lose.
        roundTrip(server.copy(messageTtlSeconds = null), ServerWithRole::toJson, ServerWithRole::from)
    }

    @Test
    fun `member survives a round trip`() {
        val member = ServerMember(
            userId = "u1",
            username = "ada",
            displayName = "Ada",
            avatarUrl = null,
            role = ServerRole.MODERATOR,
            permissions = listOf("VIEW_CHANNEL"),
            grantedPermissions = listOf("DELETE_MESSAGE"),
            deniedPermissions = emptyList(),
            roleIds = listOf("role-1", "role-2"),
        )
        roundTrip(member, ServerMember::toJson, ServerMember::from)
    }

    @Test
    fun `channel survives a round trip`() {
        val channel = Channel(
            id = "c1",
            serverId = "s1",
            name = "general",
            type = ChannelType.VOICE,
            topic = "anything",
            isPrivate = true,
        )
        roundTrip(channel, Channel::toJson, Channel::from)
        // A DM has no server and no topic, and both are dropped from the JSON
        // rather than written as the string "null".
        roundTrip(
            channel.copy(serverId = null, topic = null, type = ChannelType.DM),
            Channel::toJson,
            Channel::from,
        )
    }

    @Test
    fun `direct channel and friend survive a round trip`() {
        roundTrip(DirectChannel("c1", user), DirectChannel::toJson, DirectChannel::from)
        roundTrip(
            Friend(user, FriendshipStatus.PENDING, "incoming"),
            Friend::toJson,
            Friend::from,
        )
        roundTrip(Friend(user, FriendshipStatus.ACCEPTED, null), Friend::toJson, Friend::from)
    }

    @Test
    fun `a voice note survives a round trip, waveform and all`() {
        val voice = MessageAttachment(
            key = "k1",
            url = "/api/v1/uploads/k1",
            name = "voice_20260830_011311.ogg",
            contentType = "audio/ogg",
            size = 97_280,
            iv = "aXY",
            epoch = 2,
            duration = 5.4f,
            waveform = listOf(0.08f, 0.5f, 1f, 0.25f),
        )
        roundTrip(voice, MessageAttachment::toJson, MessageAttachment::from)

        // The two signals that make something a voice note rather than a file
        // with a player stapled to it. Either is enough, and neither may catch
        // a music track somebody chose to share.
        assertTrue(voice.isVoiceNote)
        assertTrue(voice.copy(waveform = emptyList()).isVoiceNote)
        assertFalse(voice.copy(name = "interview.mp3", waveform = emptyList()).isVoiceNote)
        assertFalse(voice.copy(contentType = "video/mp4", waveform = emptyList()).isVoiceNote)
        // The name check must not match something merely starting with the word.
        assertFalse(voice.copy(name = "voice_memo.ogg", waveform = emptyList()).isVoiceNote)

        // Audio picked off the phone has no waveform and must survive as none -
        // an empty list that came back as a single zero bar would draw a
        // waveform claiming the recording was silent.
        val picked = voice.copy(name = "song.mp3", contentType = "audio/mpeg", waveform = emptyList(), duration = null)
        roundTrip(picked, MessageAttachment::toJson, MessageAttachment::from)
        assertTrue(MessageAttachment.from(picked.toJson()).waveform.isEmpty())
    }

    @Test
    fun `message survives a round trip, envelope and all`() {
        val message = Message(
            id = "m1",
            channelId = "c1",
            content = """{"v":1,"epoch":2,"iv":"aXY","ct":"Y3Q"}""",
            author = user,
            createdAt = "2026-08-15T10:00:00.000Z",
            editedAt = "2026-08-15T10:01:00.000Z",
            deletedAt = null,
            deletedBy = null,
            pinnedAt = "2026-08-15T10:02:00.000Z",
            reactions = listOf(MessageReaction("👍", listOf("u1", "u2"))),
        )
        roundTrip(message, Message::toJson, Message::from)

        val tombstone = message.copy(
            content = "",
            editedAt = null,
            deletedAt = "2026-08-15T10:03:00.000Z",
            deletedBy = user,
            pinnedAt = null,
            reactions = emptyList(),
        )
        roundTrip(tombstone, Message::toJson, Message::from)

        // A one-time message with a window on it. Both fields decide whether
        // something is drawn or destroyed, so both have to survive the cache:
        // a `viewOnce` that came back false would draw a picture the sender
        // was promised nobody would get twice.
        val fleeting = message.copy(
            expiresAt = "2026-08-16T10:00:00.000Z",
            viewOnce = true,
            viewedBy = listOf("u2", "u3"),
        )
        roundTrip(fleeting, Message::toJson, Message::from)

        // Whose look has been spent decides whether this device draws the card
        // or the word "Opened", so an empty list has to survive as an empty
        // list. Coming back as a single blank id would tell one account it had
        // already looked at something it had never been shown.
        val untouched = fleeting.copy(viewedBy = emptyList())
        roundTrip(untouched, Message::toJson, Message::from)
        assertTrue(Message.from(untouched.toJson()).viewedBy.isEmpty())
    }

    @Test
    fun `a window that has closed is one the screen stops drawing`() {
        val at = java.time.Instant.parse("2026-08-15T12:00:00.000Z").toEpochMilli()
        val message = Message(
            id = "m2",
            channelId = "c1",
            content = "",
            author = user,
            createdAt = "2026-08-15T10:00:00.000Z",
            editedAt = null,
            deletedAt = null,
            deletedBy = null,
            pinnedAt = null,
            reactions = emptyList(),
        )

        // No window at all is the common case, and it never expires.
        assertFalse(message.expired(at))

        // A stamp in the past has closed; one in the future has not.
        assertTrue(message.copy(expiresAt = "2026-08-15T11:59:59.000Z").expired(at))
        assertFalse(message.copy(expiresAt = "2026-08-15T12:00:01.000Z").expired(at))
        // The boundary itself counts as closed, matching the server's `lte`.
        assertTrue(message.copy(expiresAt = "2026-08-15T12:00:00.000Z").expired(at))

        // A stamp that cannot be read counts as not expired. One malformed
        // field must not make a conversation disappear - far worse than one
        // message outstaying its welcome until the next refetch drops it.
        assertFalse(message.copy(expiresAt = "not a date").expired(at))
    }

    @Test
    fun `the cached envelope is still the envelope`() {
        val sealed = """{"v":1,"epoch":1,"iv":"aXY","ct":"Y3Q"}"""
        val stored = Message(
            id = "m1",
            channelId = "c1",
            content = sealed,
            author = user,
            createdAt = "2026-08-15T10:00:00.000Z",
            editedAt = null,
            deletedAt = null,
            deletedBy = null,
            pinnedAt = null,
            reactions = emptyList(),
        ).toJson().toString()

        // No plaintext is written, and the ciphertext is not re-encoded on the
        // way through - a stored row is byte for byte what the server holds.
        assertEquals(sealed, JSONObject(stored).getString("content"))
    }
}
