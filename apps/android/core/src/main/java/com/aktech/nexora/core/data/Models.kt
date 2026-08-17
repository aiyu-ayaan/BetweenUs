package com.aktech.nexora.core.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * The wire contract, as far as this client uses it.
 *
 * These mirror `packages/shared-types/src/index.ts`, which is the single source
 * of truth for all three clients. Parsing is hand-written against org.json
 * rather than generated: the shapes are small, the alternative is a
 * serialization plugin plus annotations on every field, and a hand-written
 * `from` is where a tolerant default (a missing `avatarUrl`, a server that has
 * not been redeployed yet) can live without ceremony.
 */

// --- helpers ---

internal fun JSONObject.stringOrNull(key: String): String? =
    if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }

internal fun JSONObject.strings(key: String): List<String> {
    val array = optJSONArray(key) ?: return emptyList()
    return (0 until array.length()).map { array.getString(it) }
}

internal fun <T> JSONArray.map(parse: (JSONObject) -> T): List<T> =
    (0 until length()).map { parse(getJSONObject(it)) }

internal fun jsonArrayOf(values: Collection<String>): JSONArray =
    JSONArray().also { array -> values.forEach { array.put(it) } }

/**
 * The other direction, for the local cache.
 *
 * Only the types the cache stores carry a `toJson`, and every one of them is
 * covered by a round-trip test - a field added to a `from` and forgotten here
 * would come back off disk as a default and be very hard to see.
 */
internal fun <T> jsonArrayOfObjects(values: Collection<T>, toJson: (T) -> JSONObject): JSONArray =
    JSONArray().also { array -> values.forEach { array.put(toJson(it)) } }

// --- users ---

/** The public face of an account: a search result, a DM header, an author. */
data class UserSummary(
    val id: String,
    val username: String,
    val displayName: String,
    val avatarUrl: String?,
) {
    val label: String get() = displayName.ifBlank { username }

    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("username", username)
        .put("displayName", displayName)
        .put("avatarUrl", avatarUrl)

    companion object {
        fun from(json: JSONObject) = UserSummary(
            id = json.getString("id"),
            username = json.optString("username"),
            displayName = json.optString("displayName"),
            avatarUrl = json.stringOrNull("avatarUrl"),
        )
    }
}

// --- servers ---

enum class ServerRole { OWNER, ADMIN, MODERATOR, MEMBER, GUEST;

    companion object {
        fun of(value: String?): ServerRole =
            entries.firstOrNull { it.name == value?.uppercase() } ?: MEMBER
    }
}

data class ServerWithRole(
    val id: String,
    val name: String,
    val slug: String,
    val iconUrl: String?,
    val ownerId: String,
    val role: ServerRole,
    /** What the caller may do here, role defaults and overrides already applied. */
    val permissions: List<String>,
) {
    fun can(permission: String): Boolean =
        role == ServerRole.OWNER || permissions.contains(permission)

    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("name", name)
        .put("slug", slug)
        .put("iconUrl", iconUrl)
        .put("ownerId", ownerId)
        .put("role", role.name)
        .put("permissions", jsonArrayOf(permissions))

    companion object {
        fun from(json: JSONObject) = ServerWithRole(
            id = json.getString("id"),
            name = json.optString("name"),
            slug = json.optString("slug"),
            iconUrl = json.stringOrNull("iconUrl"),
            ownerId = json.optString("ownerId"),
            role = ServerRole.of(json.optString("role")),
            permissions = json.strings("permissions"),
        )
    }
}

/**
 * A way into a server that can expire, run out and be taken back.
 *
 * `active` is the server's answer rather than this client's: "expired or
 * revoked or spent" is three conditions and re-deriving them here would be
 * three chances to disagree with the service about who may join.
 */
data class ServerInvite(
    val code: String,
    val serverId: String,
    val createdById: String?,
    val expiresAt: String?,
    val maxUses: Int?,
    val uses: Int,
    val revokedAt: String?,
    val createdAt: String,
    val active: Boolean,
) {
    companion object {
        fun from(json: JSONObject) = ServerInvite(
            code = json.optString("code"),
            serverId = json.optString("serverId"),
            createdById = json.stringOrNull("createdById"),
            expiresAt = json.stringOrNull("expiresAt"),
            maxUses = if (json.isNull("maxUses")) null else json.optInt("maxUses"),
            uses = json.optInt("uses"),
            revokedAt = json.stringOrNull("revokedAt"),
            createdAt = json.optString("createdAt"),
            active = json.optBoolean("active"),
        )
    }
}

data class ServerMember(
    val userId: String,
    val username: String,
    val displayName: String,
    val avatarUrl: String?,
    val role: ServerRole,
    val permissions: List<String>,
    val grantedPermissions: List<String>,
    val deniedPermissions: List<String>,
) {
    val label: String get() = displayName.ifBlank { username }

    fun toJson(): JSONObject = JSONObject()
        .put("userId", userId)
        .put("username", username)
        .put("displayName", displayName)
        .put("avatarUrl", avatarUrl)
        .put("role", role.name)
        .put("permissions", jsonArrayOf(permissions))
        .put("grantedPermissions", jsonArrayOf(grantedPermissions))
        .put("deniedPermissions", jsonArrayOf(deniedPermissions))

    companion object {
        fun from(json: JSONObject) = ServerMember(
            userId = json.getString("userId"),
            username = json.optString("username"),
            displayName = json.optString("displayName"),
            avatarUrl = json.stringOrNull("avatarUrl"),
            role = ServerRole.of(json.optString("role")),
            permissions = json.strings("permissions"),
            grantedPermissions = json.strings("grantedPermissions"),
            deniedPermissions = json.strings("deniedPermissions"),
        )
    }
}

// --- channels ---

enum class ChannelType { TEXT, VOICE, DM;

    companion object {
        fun of(value: String?): ChannelType =
            entries.firstOrNull { it.name == value?.uppercase() } ?: TEXT
    }
}

data class Channel(
    val id: String,
    val serverId: String?,
    val name: String,
    val type: ChannelType,
    val topic: String?,
    val isPrivate: Boolean,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("serverId", serverId)
        .put("name", name)
        .put("type", type.name)
        .put("topic", topic)
        .put("isPrivate", isPrivate)

    companion object {
        fun from(json: JSONObject) = Channel(
            id = json.getString("id"),
            serverId = json.stringOrNull("serverId"),
            name = json.optString("name"),
            type = ChannelType.of(json.optString("type")),
            topic = json.stringOrNull("topic"),
            isPrivate = json.optBoolean("isPrivate"),
        )
    }
}

data class ChannelMember(val userId: String, val username: String, val displayName: String) {
    companion object {
        fun from(json: JSONObject) = ChannelMember(
            userId = json.getString("userId"),
            username = json.optString("username"),
            displayName = json.optString("displayName"),
        )
    }
}

/** A direct message channel, named by the person on the other end of it. */
data class DirectChannel(val channelId: String, val participant: UserSummary) {
    fun toJson(): JSONObject = JSONObject()
        .put("channelId", channelId)
        .put("participant", participant.toJson())

    companion object {
        fun from(json: JSONObject) = DirectChannel(
            channelId = json.getString("channelId"),
            participant = UserSummary.from(json.getJSONObject("participant")),
        )
    }
}

// --- friends ---

enum class FriendshipStatus { PENDING, ACCEPTED }

data class Friend(
    val user: UserSummary,
    val status: FriendshipStatus,
    /** Who asked, from the caller's side. Null once accepted. */
    val direction: String?,
) {
    val incoming: Boolean get() = status == FriendshipStatus.PENDING && direction == "incoming"
    val outgoing: Boolean get() = status == FriendshipStatus.PENDING && direction == "outgoing"

    fun toJson(): JSONObject = JSONObject()
        .put("user", user.toJson())
        .put("status", status.name)
        .put("direction", direction)

    companion object {
        fun from(json: JSONObject) = Friend(
            user = UserSummary.from(json.getJSONObject("user")),
            status = if (json.optString("status") == "ACCEPTED") {
                FriendshipStatus.ACCEPTED
            } else {
                FriendshipStatus.PENDING
            },
            direction = json.stringOrNull("direction"),
        )
    }
}

// --- messages ---

data class MessageReaction(val emoji: String, val userIds: List<String>) {
    fun toJson(): JSONObject = JSONObject()
        .put("emoji", emoji)
        .put("userIds", jsonArrayOf(userIds))

    companion object {
        fun from(json: JSONObject) = MessageReaction(
            emoji = json.optString("emoji"),
            userIds = json.strings("userIds"),
        )
    }
}

data class Message(
    val id: String,
    val channelId: String,
    /** The stored body: an encrypted envelope for anything written since E2EE. */
    val content: String,
    val author: UserSummary,
    val createdAt: String,
    val editedAt: String?,
    /**
     * Set once deleted. The row survives as a tombstone with an empty body, so a
     * conversation reads as "this was here and is gone" rather than silently
     * re-flowing around a hole.
     */
    val deletedAt: String?,
    val deletedBy: UserSummary?,
    val pinnedAt: String?,
    val reactions: List<MessageReaction>,
) {
    val deleted: Boolean get() = deletedAt != null
    val pinned: Boolean get() = pinnedAt != null

    /**
     * What the cache stores: the envelope, untouched. The plaintext is never
     * written to disk - the body is decrypted on the way to the screen and
     * nowhere else, so a copy of the database is worth exactly what a copy of
     * the server's rows is worth.
     */
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("channelId", channelId)
        .put("content", content)
        .put("author", author.toJson())
        .put("createdAt", createdAt)
        .put("editedAt", editedAt)
        .put("deletedAt", deletedAt)
        .put("deletedBy", deletedBy?.toJson())
        .put("pinnedAt", pinnedAt)
        .put("reactions", jsonArrayOfObjects(reactions) { it.toJson() })

    companion object {
        fun from(json: JSONObject) = Message(
            id = json.getString("id"),
            channelId = json.optString("channelId"),
            content = json.optString("content"),
            author = UserSummary.from(json.getJSONObject("author")),
            createdAt = json.optString("createdAt"),
            editedAt = json.stringOrNull("editedAt"),
            deletedAt = json.stringOrNull("deletedAt"),
            deletedBy = json.optJSONObject("deletedBy")?.let { UserSummary.from(it) },
            pinnedAt = json.stringOrNull("pinnedAt"),
            reactions = json.optJSONArray("reactions")?.map { MessageReaction.from(it) }.orEmpty(),
        )
    }
}

/** One page of history. `nextCursor` is the id to ask `before` for. */
data class Page<T>(val items: List<T>, val nextCursor: String?)

// --- attachments ---

/**
 * A file sealed under the channel key. What identifies it - the name, the real
 * content type, the nonce that opens it - travels inside the encrypted message
 * body, never as a column, so the server holds an opaque blob and knows neither
 * what the file is called nor what is in it.
 */
data class MessageAttachment(
    val key: String,
    val url: String,
    val name: String,
    val contentType: String,
    val size: Long,
    val iv: String,
    val epoch: Int,
    val width: Int? = null,
    val height: Int? = null,
) {
    val isImage: Boolean get() = contentType.startsWith("image/")
    val isVideo: Boolean get() = contentType.startsWith("video/")
    val isAudio: Boolean get() = contentType.startsWith("audio/")

    fun toJson(): JSONObject = JSONObject()
        .put("key", key)
        .put("url", url)
        .put("name", name)
        .put("contentType", contentType)
        .put("size", size)
        .put("iv", iv)
        .put("epoch", epoch)
        .apply {
            width?.let { put("width", it) }
            height?.let { put("height", it) }
        }

    companion object {
        fun from(json: JSONObject) = MessageAttachment(
            key = json.optString("key"),
            url = json.optString("url"),
            name = json.optString("name"),
            contentType = json.optString("contentType"),
            size = json.optLong("size"),
            iv = json.optString("iv"),
            epoch = json.optInt("epoch"),
            width = json.optInt("width").takeIf { it > 0 },
            height = json.optInt("height").takeIf { it > 0 },
        )
    }
}

/**
 * The plaintext inside a message once it carries files.
 *
 * The encoding is the contract between the clients, and it is
 * `apps/desktop/src/services/message-body.ts` - not something for each client
 * to arrive at on its own. This one did, and the result was a phone's photo
 * arriving on the web as a paragraph of raw JSON.
 *
 * A message with no files is still stored as the bare text somebody typed, so
 * every row written before attachments existed keeps rendering as it did. Only
 * a message carrying files becomes a JSON document, and it is hidden behind a
 * marker starting with a NUL: a character no text field can produce, so nobody
 * can type a message that pretends to be one. Sniffing for a leading `{`,
 * which is what this used to do, is exactly the hole the marker closes.
 */
/**
 * What a message is a reply to.
 *
 * The author and a snippet are copied in rather than looked up: the quoted
 * message may be a thousand messages back and not on this device at all, and a
 * reply has to render without fetching anything. It lives inside the encrypted
 * body, so the server learns nothing about who is answering whom.
 *
 * Byte for byte the desktop's `MessageReply`. Changing one changes both.
 */
data class MessageReply(val id: String, val author: String, val preview: String) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("author", author)
        .put("preview", preview)

    companion object {
        /** How much of the quoted message a reply carries with it. */
        const val PREVIEW_CHARS = 140

        /** Null for a quote with no id: it would be a block nothing can open. */
        fun from(json: JSONObject): MessageReply? {
            val id = json.optString("id")
            if (id.isEmpty()) return null
            return MessageReply(id, json.optString("author"), json.optString("preview"))
        }

        /** One line, however many the original had. */
        fun preview(text: String): String {
            val line = text.replace(Regex("\\s+"), " ").trim()
            return if (line.length > PREVIEW_CHARS) line.take(PREVIEW_CHARS - 1) + "…" else line
        }
    }
}

data class MessageBody(
    val text: String,
    val attachments: List<MessageAttachment> = emptyList(),
    val replyTo: MessageReply? = null,
) {
    fun encode(): String =
        if (attachments.isEmpty() && replyTo == null) {
            text
        } else {
            BODY_MARKER + JSONObject()
                .put("text", text)
                .put("attachments", JSONArray().also { a -> attachments.forEach { a.put(it.toJson()) } })
                .apply { replyTo?.let { put("replyTo", it.toJson()) } }
                .toString()
        }

    companion object {
        /** Byte for byte the desktop's `BODY_MARKER`. Changing one changes both. */
        const val BODY_MARKER = "\u0000nexora-body:1\n"

        fun decode(plaintext: String): MessageBody {
            if (!plaintext.startsWith(BODY_MARKER)) return MessageBody(plaintext)
            return runCatching {
                val json = JSONObject(plaintext.removePrefix(BODY_MARKER))
                MessageBody(
                    text = json.optString("text"),
                    attachments = json.optJSONArray("attachments")
                        ?.map { MessageAttachment.from(it) }
                        .orEmpty(),
                    replyTo = json.optJSONObject("replyTo")?.let { MessageReply.from(it) },
                )
            }
                // A body we cannot read is still a message; show it rather than
                // nothing.
                .getOrDefault(MessageBody(plaintext))
        }
    }
}

data class UploadedObject(val key: String, val url: String, val size: Long) {
    companion object {
        fun from(json: JSONObject) = UploadedObject(
            key = json.optString("key"),
            url = json.optString("url"),
            size = json.optLong("size"),
        )
    }
}

// --- end-to-end encryption ---

/** A user's published ECDH P-256 public key, JWK-serialised. */
/**
 * One machine's published identity key.
 *
 * A list per user rather than one key per account: the single key was copied to
 * every machine the account signed in on, so revoking a phone meant rotating
 * the identity the laptop was also using. Byte for byte the desktop's
 * `DeviceKey`.
 */
data class DeviceKey(
    val userId: String,
    val deviceId: String,
    val publicKey: String,
    val label: String? = null,
    val revokedAt: String? = null,
    val lastSeenAt: String = "",
    val createdAt: String = "",
) {
    companion object {
        fun from(json: JSONObject) = DeviceKey(
            userId = json.optString("userId"),
            deviceId = json.optString("deviceId"),
            publicKey = json.optString("publicKey"),
            label = json.stringOrNull("label"),
            revokedAt = json.stringOrNull("revokedAt"),
            lastSeenAt = json.optString("lastSeenAt"),
            createdAt = json.optString("createdAt"),
        )
    }
}

/** One channel key sealed for one recipient. */
data class ChannelKeyEntry(
    val recipientUserId: String,
    /** Which of that user's machines this copy is sealed for. */
    val recipientDeviceId: String,
    val senderUserId: String,
    val senderDeviceId: String,
    val senderPublicKey: String,
    val wrappedKey: String,
    val iv: String,
    val epoch: Int,
) {
    companion object {
        fun from(json: JSONObject) = ChannelKeyEntry(
            recipientUserId = json.optString("recipientUserId"),
            recipientDeviceId = json.optString("recipientDeviceId"),
            senderUserId = json.optString("senderUserId"),
            senderDeviceId = json.optString("senderDeviceId"),
            senderPublicKey = json.optString("senderPublicKey"),
            wrappedKey = json.optString("wrappedKey"),
            iv = json.optString("iv"),
            epoch = json.optInt("epoch"),
        )
    }
}

data class ChannelKeys(
    val epoch: Int,
    val keys: List<ChannelKeyEntry>,
    /** Members with a device key but no entry at `epoch` - they need a re-wrap. */
    val missingRecipients: List<DeviceKey>,
) {
    companion object {
        fun from(json: JSONObject) = ChannelKeys(
            epoch = json.optInt("epoch"),
            keys = json.optJSONArray("keys")?.map { ChannelKeyEntry.from(it) }.orEmpty(),
            missingRecipients =
                json.optJSONArray("missingRecipients")?.map { DeviceKey.from(it) }.orEmpty(),
        )
    }
}

/**
 * The device identity key, sealed with a key derived from a secret the server
 * never receives. Restoring it on a second device is what makes an account and
 * its history portable rather than tied to one installation.
 */
data class IdentityBackup(
    val kind: String,
    val iterations: Int,
    val salt: String,
    val iv: String,
    val ct: String,
    val publicKey: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("v", 1)
        .put("kind", kind)
        .put("kdf", "PBKDF2-SHA256")
        .put("iterations", iterations)
        .put("salt", salt)
        .put("iv", iv)
        .put("ct", ct)
        .put("publicKey", publicKey)

    companion object {
        fun from(json: JSONObject) = IdentityBackup(
            kind = json.optString("kind", "password"),
            iterations = json.optInt("iterations"),
            salt = json.optString("salt"),
            iv = json.optString("iv"),
            ct = json.optString("ct"),
            publicKey = json.optString("publicKey"),
        )
    }
}

// --- presence ---

enum class PresenceStatus { ONLINE, IDLE, DND, INVISIBLE, OFFLINE;

    /** What the wire calls it: lowercase, the way the other clients send it. */
    val wire: String get() = name.lowercase()

    companion object {
        fun of(value: String?): PresenceStatus =
            entries.firstOrNull { it.wire == value?.lowercase() } ?: OFFLINE
    }
}

// --- notifications ---

data class NotificationPreferences(
    val enabled: Boolean,
    val quietStartMinute: Int?,
    val quietEndMinute: Int?,
    val mutedChannelIds: List<String>,
) {
    companion object {
        fun from(json: JSONObject) = NotificationPreferences(
            enabled = json.optBoolean("enabled", true),
            quietStartMinute = if (json.isNull("quietStartMinute")) null else json.optInt("quietStartMinute"),
            quietEndMinute = if (json.isNull("quietEndMinute")) null else json.optInt("quietEndMinute"),
            mutedChannelIds = json.strings("mutedChannelIds"),
        )
    }
}

data class ChannelUnread(val channelId: String, val count: Int) {
    companion object {
        fun from(json: JSONObject) =
            ChannelUnread(json.optString("channelId"), json.optInt("count"))
    }
}

// --- calls ---

data class IceServer(val urls: List<String>, val username: String?, val credential: String?) {
    companion object {
        fun from(json: JSONObject) = IceServer(
            urls = json.optJSONArray("urls")
                ?.let { a -> (0 until a.length()).map { a.getString(it) } }
                ?: listOfNotNull(json.stringOrNull("urls")),
            username = json.stringOrNull("username"),
            credential = json.stringOrNull("credential"),
        )
    }
}

/**
 * Somebody else in a call. Keyed by `peerId`, not `userId`: one account can
 * have two clients open and each is a separate end of a separate connection.
 */
data class CallPeer(val peerId: String, val userId: String, val username: String) {
    companion object {
        fun from(json: JSONObject) = CallPeer(
            peerId = json.optString("peerId"),
            userId = json.optString("userId"),
            username = json.optString("username"),
        )
    }
}

// --- remote desktop ---

data class RemoteMachine(
    val id: String,
    val name: String,
    val platform: String,
    val ownerId: String,
    val ownerUsername: String,
    val online: Boolean,
    val permissions: List<String>,
    val expiresAt: String?,
) {
    fun may(permission: String): Boolean = permissions.contains(permission)

    companion object {
        fun from(json: JSONObject) = RemoteMachine(
            id = json.getString("id"),
            name = json.optString("name"),
            platform = json.optString("platform"),
            ownerId = json.optString("ownerId"),
            ownerUsername = json.optString("ownerUsername"),
            online = json.optBoolean("online"),
            permissions = json.strings("permissions"),
            expiresAt = json.stringOrNull("expiresAt"),
        )
    }
}

data class RemoteSession(
    val sessionId: String,
    val machineId: String,
    val machineName: String,
    val permissions: List<String>,
    val iceServers: List<IceServer>,
) {
    companion object {
        fun from(json: JSONObject) = RemoteSession(
            sessionId = json.optString("sessionId"),
            machineId = json.optString("machineId"),
            machineName = json.optString("machineName"),
            permissions = json.strings("permissions"),
            iceServers = json.optJSONArray("iceServers")?.map { IceServer.from(it) }.orEmpty(),
        )
    }
}

data class RemoteScreen(
    val id: String,
    val label: String,
    val width: Int,
    val height: Int,
    val primary: Boolean,
) {
    companion object {
        fun from(json: JSONObject) = RemoteScreen(
            id = json.optString("id"),
            label = json.optString("label"),
            width = json.optInt("width"),
            height = json.optInt("height"),
            primary = json.optBoolean("primary"),
        )
    }
}
