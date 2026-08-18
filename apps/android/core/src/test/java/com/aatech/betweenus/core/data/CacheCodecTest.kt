package com.aatech.betweenus.core.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
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
            role = ServerRole.ADMIN,
            permissions = listOf("SEND_MESSAGE", "MANAGE_ROLE"),
        )
        roundTrip(server, ServerWithRole::toJson, ServerWithRole::from)
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
