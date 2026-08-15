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

// --- users ---

/** The public face of an account: a search result, a DM header, an author. */
data class UserSummary(
    val id: String,
    val username: String,
    val displayName: String,
    val avatarUrl: String?,
) {
    val label: String get() = displayName.ifBlank { username }

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
 * The plaintext inside a message once it carries files. A message with no
 * attachments is still written as bare text, so everything sent before
 * attachments existed keeps rendering.
 */
data class MessageBody(val text: String, val attachments: List<MessageAttachment> = emptyList()) {
    fun encode(): String =
        if (attachments.isEmpty()) {
            text
        } else {
            JSONObject()
                .put("text", text)
                .put("attachments", JSONArray().also { a -> attachments.forEach { a.put(it.toJson()) } })
                .toString()
        }

    companion object {
        fun decode(plaintext: String): MessageBody {
            if (!plaintext.startsWith("{")) return MessageBody(plaintext)
            return runCatching {
                val json = JSONObject(plaintext)
                if (!json.has("text")) return MessageBody(plaintext)
                MessageBody(
                    text = json.optString("text"),
                    attachments = json.optJSONArray("attachments")
                        ?.map { MessageAttachment.from(it) }
                        .orEmpty(),
                )
            }.getOrDefault(MessageBody(plaintext))
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
data class DeviceKey(val userId: String, val publicKey: String) {
    companion object {
        fun from(json: JSONObject) =
            DeviceKey(json.optString("userId"), json.optString("publicKey"))
    }
}

/** One channel key sealed for one recipient. */
data class ChannelKeyEntry(
    val recipientUserId: String,
    val senderUserId: String,
    val senderPublicKey: String,
    val wrappedKey: String,
    val iv: String,
    val epoch: Int,
) {
    companion object {
        fun from(json: JSONObject) = ChannelKeyEntry(
            recipientUserId = json.optString("recipientUserId"),
            senderUserId = json.optString("senderUserId"),
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
