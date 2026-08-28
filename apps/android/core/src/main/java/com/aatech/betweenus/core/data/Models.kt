package com.aatech.betweenus.core.data

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

/**
 * A sign-in method this deployment has actually enabled.
 *
 * The login screen draws a button per entry and none of its own: a Google
 * button on a deployment with no Google credentials configured is a button that
 * ends in an error nobody watching can act on.
 */
data class OAuthProvider(val provider: String, val label: String) {
    companion object {
        fun from(json: JSONObject) = OAuthProvider(
            provider = json.optString("provider"),
            label = json.optString("label"),
        )
    }
}

/**
 * One part of a large upload, as the server acknowledged it.
 *
 * The etag is the server's word for "I have this part"; completion is the list
 * of them handed back, which is what lets the storage driver - local disk or
 * S3 - assemble the object without either end holding it whole.
 */
data class UploadedPart(val partNumber: Int, val etag: String) {
    fun toJson(): JSONObject = JSONObject().put("partNumber", partNumber).put("etag", etag)

    companion object {
        fun from(json: JSONObject) = UploadedPart(
            partNumber = json.optInt("partNumber"),
            etag = json.optString("etag"),
        )
    }
}

/**
 * A multipart upload the server has opened.
 *
 * The ticket is sealed server-side and carries the account it was opened by and
 * an expiry, so it is state the client holds rather than state a replica has to
 * remember - any of them can accept the next part.
 */
data class MultipartTicket(val ticket: String, val maxPartBytes: Int)

/**
 * What an invite leads to, before it is accepted.
 *
 * A link that joins the moment it is opened tells the person following it
 * nothing about whose server it is until they are already in it. This is what
 * the card asks for instead. `onlineCount` is null when presence could not be
 * reached, which is not the same as nobody being there - so the card leaves the
 * line out rather than reading zero.
 */
data class InvitePreview(
    val code: String,
    val serverId: String,
    val name: String,
    val iconUrl: String?,
    val memberCount: Int,
    val onlineCount: Int?,
    val member: Boolean,
) {
    companion object {
        fun from(json: JSONObject) = InvitePreview(
            code = json.optString("code"),
            serverId = json.optString("serverId"),
            name = json.optString("name"),
            iconUrl = json.stringOrNull("iconUrl"),
            memberCount = json.optInt("memberCount"),
            onlineCount = if (json.isNull("onlineCount")) null else json.optInt("onlineCount"),
            member = json.optBoolean("member"),
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
    /** Ids of the custom roles this member holds, highest rank first. */
    val roleIds: List<String>,
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
        .put("roleIds", jsonArrayOf(roleIds))

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
            roleIds = json.strings("roleIds"),
        )
    }
}

/**
 * A role a server invented for itself.
 *
 * Additive on top of the five built-in rungs rather than replacing them: the
 * built-in role is still the hierarchy - who may edit whom - and this carries a
 * name, a colour and a bundle of permissions. [rank] orders the list and grants
 * nothing on its own.
 */
data class ServerCustomRole(
    val id: String,
    val serverId: String,
    val name: String,
    /** `#rrggbb`, or null for the default colour. */
    val colour: String?,
    val rank: Int,
    val permissions: List<String>,
    val memberCount: Int,
) {
    companion object {
        fun from(json: JSONObject) = ServerCustomRole(
            id = json.optString("id"),
            serverId = json.optString("serverId"),
            name = json.optString("name"),
            colour = json.stringOrNull("colour"),
            rank = json.optInt("rank"),
            permissions = json.strings("permissions"),
            memberCount = json.optInt("memberCount"),
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

// --- blocking ---

/**
 * Somebody this account has blocked.
 *
 * The row on the server is directional - "A blocked B" is not "B blocked A" -
 * but only one direction is ever listed here: this is the list the owner
 * manages, and being blocked by somebody is deliberately not something the
 * other side is told.
 */
data class BlockedUser(val user: UserSummary, val blockedAt: String) {
    companion object {
        fun from(json: JSONObject) = BlockedUser(
            user = UserSummary.from(json.getJSONObject("user")),
            blockedAt = json.optString("blockedAt"),
        )
    }
}

// --- recovering a password ---

/**
 * What the deployment can do about a forgotten password, which is a fact about
 * the deployment rather than about the account.
 *
 * [EMAILED] is also what an account that does not exist gets, and what a
 * disabled one gets. That is not an oversight to be tidied up later: telling
 * them apart would turn the forgot-password form into a way to find out who has
 * an account here.
 */
enum class ForgotPasswordOutcome { EMAILED, RESET, UNAVAILABLE }

data class ForgotPasswordAnswer(
    val outcome: ForgotPasswordOutcome,
    /** Only for [ForgotPasswordOutcome.RESET]: the single-use token to spend. */
    val resetToken: String?,
    /** Only for [ForgotPasswordOutcome.UNAVAILABLE]: what to tell the person. */
    val message: String?,
) {
    companion object {
        fun from(json: JSONObject) = ForgotPasswordAnswer(
            outcome = when (json.optString("outcome")) {
                "reset" -> ForgotPasswordOutcome.RESET
                "unavailable" -> ForgotPasswordOutcome.UNAVAILABLE
                // Anything unrecognised reads as "we said something reassuring
                // and nothing happened", which is the safe way to be wrong: it
                // never claims a reset is authorised when it is not.
                else -> ForgotPasswordOutcome.EMAILED
            },
            resetToken = json.stringOrNull("resetToken"),
            message = json.stringOrNull("message"),
        )
    }
}

/**
 * Whether a username can be registered.
 *
 * The server answers this from a Bloom filter in front of the unique index, so
 * it is cheap enough to ask while somebody is still typing. [available] false
 * with no [reason] cannot happen from a current server; it is treated as
 * "taken" by the one caller, which is the conservative reading.
 */
data class UsernameAvailability(
    val username: String,
    val available: Boolean,
    /** `taken` or `invalid`, when it is not available. */
    val reason: String?,
) {
    companion object {
        fun from(json: JSONObject) = UsernameAvailability(
            username = json.optString("username"),
            available = json.optBoolean("available"),
            reason = json.stringOrNull("reason"),
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

/** One of a server's own emoji, as the directory lists it. */
data class ServerEmoji(
    val id: String,
    val serverId: String,
    val name: String,
    val url: String,
    val animated: Boolean,
) {
    companion object {
        fun from(json: JSONObject) = ServerEmoji(
            id = json.optString("id"),
            serverId = json.optString("serverId"),
            name = json.optString("name"),
            url = json.optString("url"),
            animated = json.optBoolean("animated"),
        )
    }
}

/**
 * A custom emoji carried inside a message.
 *
 * The text keeps the literal `:name:` and this says what to draw for it, so a
 * client that has never heard of custom emoji shows the word somebody meant,
 * and a reader who is not in the server that owns the emoji still sees the
 * picture. Byte for byte the desktop's `MessageCustomEmoji`.
 */
data class MessageCustomEmoji(val name: String, val url: String, val animated: Boolean) {
    fun toJson(): JSONObject = JSONObject()
        .put("name", name)
        .put("url", url)
        .put("animated", animated)

    companion object {
        fun from(json: JSONObject) = MessageCustomEmoji(
            name = json.optString("name"),
            url = json.optString("url"),
            animated = json.optBoolean("animated"),
        )
    }
}

data class MessageBody(
    val text: String,
    val attachments: List<MessageAttachment> = emptyList(),
    val replyTo: MessageReply? = null,
    val emoji: List<MessageCustomEmoji> = emptyList(),
) {
    fun encode(): String =
        if (attachments.isEmpty() && replyTo == null && emoji.isEmpty()) {
            text
        } else {
            BODY_MARKER + JSONObject()
                .put("text", text)
                .put("attachments", JSONArray().also { a -> attachments.forEach { a.put(it.toJson()) } })
                .apply { replyTo?.let { put("replyTo", it.toJson()) } }
                .apply {
                    if (emoji.isNotEmpty()) {
                        put("emoji", JSONArray().also { a -> emoji.forEach { a.put(it.toJson()) } })
                    }
                }
                .toString()
        }

    companion object {
        /** Byte for byte the desktop's `BODY_MARKER`. Changing one changes both. */
        const val BODY_MARKER = "\u0000betweenus-body:1\n"

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
                    emoji = json.optJSONArray("emoji")
                        ?.map { MessageCustomEmoji.from(it) }
                        .orEmpty(),
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
    /**
     * The same question asked of every epoch, for machines whose owner already
     * holds that epoch somewhere else. Filling these is what lets a phone that
     * signed in today read what was said before it existed, instead of a screen
     * of padlocks - see `development/E2EE.md`.
     *
     * Empty against a server older than this field, which is the correct
     * reading: nothing to repair that this client knows about.
     */
    val gaps: List<EpochGap>,
) {
    companion object {
        fun from(json: JSONObject) = ChannelKeys(
            epoch = json.optInt("epoch"),
            keys = json.optJSONArray("keys")?.map { ChannelKeyEntry.from(it) }.orEmpty(),
            missingRecipients =
                json.optJSONArray("missingRecipients")?.map { DeviceKey.from(it) }.orEmpty(),
            gaps = json.optJSONArray("gaps")?.map { EpochGap.from(it) }.orEmpty(),
        )
    }
}

/** One epoch, and the machines still missing it. */
data class EpochGap(val epoch: Int, val devices: List<DeviceKey>) {
    companion object {
        fun from(json: JSONObject) = EpochGap(
            epoch = json.optInt("epoch"),
            devices = json.optJSONArray("devices")?.map { DeviceKey.from(it) }.orEmpty(),
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
    /**
     * People this account has muted. Silent wherever they write, mentions
     * included - a mute any mention can bypass is a mute the loud person
     * controls.
     */
    val mutedUserIds: List<String>,
) {
    companion object {
        fun from(json: JSONObject) = NotificationPreferences(
            enabled = json.optBoolean("enabled", true),
            quietStartMinute = if (json.isNull("quietStartMinute")) null else json.optInt("quietStartMinute"),
            quietEndMinute = if (json.isNull("quietEndMinute")) null else json.optInt("quietEndMinute"),
            mutedChannelIds = json.strings("mutedChannelIds"),
            mutedUserIds = json.strings("mutedUserIds"),
        )
    }
}

data class ChannelUnread(val channelId: String, val count: Int) {
    companion object {
        fun from(json: JSONObject) =
            ChannelUnread(json.optString("channelId"), json.optInt("count"))
    }
}

/**
 * Somebody else's read marker in a channel: who has read it, and up to when.
 *
 * Read receipts are derived from these rather than stored per message. A
 * marker is one row per person per channel and only ever moves forwards, so
 * "who has seen this message" is "whose marker is at or past its timestamp".
 * See [com.aatech.betweenus.core.store.Receipts].
 */
data class ChannelReadReceipt(val user: UserSummary, val readAt: String) {
    companion object {
        fun from(json: JSONObject) = ChannelReadReceipt(
            user = UserSummary.from(json.getJSONObject("user")),
            readAt = json.optString("readAt"),
        )
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

/**
 * One call this account was in, as its own log reads it back.
 *
 * The times and the roster are the gateway's own knowledge of when the socket
 * joined and left. The data figures are not: media is peer to peer, so no
 * server is in the path to count a byte and the client reports its own on the
 * way out. A call the app was killed in has none, which is a real answer and is
 * drawn as one.
 */
data class CallHistoryEntry(
    val id: String,
    val channelId: String,
    val channelName: String,
    val serverId: String?,
    val serverName: String?,
    val joinedAt: String,
    val endedAt: String?,
    val durationSeconds: Int?,
    val peers: List<CallHistoryPeer>,
    val bytes: Long,
    val bytesSent: Long,
    val bytesReceived: Long,
    val links: List<CallLinkReport>,
) {
    companion object {
        fun from(json: JSONObject) = CallHistoryEntry(
            id = json.optString("id"),
            channelId = json.optString("channelId"),
            channelName = json.optString("channelName"),
            serverId = json.stringOrNull("serverId"),
            serverName = json.stringOrNull("serverName"),
            joinedAt = json.optString("joinedAt"),
            endedAt = json.stringOrNull("endedAt"),
            durationSeconds =
                if (json.isNull("durationSeconds")) null else json.optInt("durationSeconds"),
            peers = json.optJSONArray("peers")?.map { CallHistoryPeer.from(it) }.orEmpty(),
            bytes = json.optLong("bytes"),
            bytesSent = json.optLong("bytesSent"),
            bytesReceived = json.optLong("bytesReceived"),
            links = json.optJSONArray("links")?.map { CallLinkReport.from(it) }.orEmpty(),
        )
    }
}

data class CallHistoryPeer(val id: String, val username: String, val displayName: String) {
    val label: String get() = displayName.ifBlank { username }

    companion object {
        fun from(json: JSONObject) = CallHistoryPeer(
            id = json.optString("id"),
            username = json.optString("username"),
            displayName = json.optString("displayName"),
        )
    }
}

/**
 * What one peer connection in a call did.
 *
 * The unit of a mesh call is the link and not the call: two people in the same
 * call can have completely different answers about whether it went direct, and
 * an expensive call is nearly always one link doing something the others were
 * not.
 */
data class CallLinkReport(
    val userId: String,
    val username: String,
    val bytesSent: Long,
    val bytesReceived: Long,
    val roundTripMs: Int?,
    val packetsLost: Long,
    val packetsReceived: Long,
    /** "direct", "relay", or null when the client never worked it out. */
    val transport: String?,
) {
    companion object {
        fun from(json: JSONObject) = CallLinkReport(
            userId = json.optString("userId"),
            username = json.optString("username"),
            bytesSent = json.optLong("bytesSent"),
            bytesReceived = json.optLong("bytesReceived"),
            roundTripMs = if (json.isNull("roundTripMs")) null else json.optInt("roundTripMs"),
            packetsLost = json.optLong("packetsLost"),
            packetsReceived = json.optLong("packetsReceived"),
            transport = json.stringOrNull("transport"),
        )
    }
}

/** The same calls added up over a window of days. */
data class CallAnalytics(
    val days: Int,
    val totals: CallUsageTotals,
    /**
     * Oldest first, one per day including the empty ones - so a chart drawn
     * from it has no gaps to invent.
     */
    val daily: List<CallUsageDay>,
    val channels: List<CallUsageChannel>,
    val peers: List<CallUsagePeer>,
    val transport: CallTransportSplit,
) {
    companion object {
        fun from(json: JSONObject) = CallAnalytics(
            days = json.optInt("days"),
            totals = CallUsageTotals.from(json.optJSONObject("totals") ?: JSONObject()),
            daily = json.optJSONArray("daily")?.map { CallUsageDay.from(it) }.orEmpty(),
            channels = json.optJSONArray("channels")?.map { CallUsageChannel.from(it) }.orEmpty(),
            peers = json.optJSONArray("peers")?.map { CallUsagePeer.from(it) }.orEmpty(),
            transport = CallTransportSplit.from(json.optJSONObject("transport") ?: JSONObject()),
        )
    }
}

data class CallUsageTotals(
    val calls: Int,
    val seconds: Int,
    val bytesSent: Long,
    val bytesReceived: Long,
) {
    val bytes: Long get() = bytesSent + bytesReceived

    companion object {
        fun from(json: JSONObject) = CallUsageTotals(
            calls = json.optInt("calls"),
            seconds = json.optInt("seconds"),
            bytesSent = json.optLong("bytesSent"),
            bytesReceived = json.optLong("bytesReceived"),
        )
    }
}

data class CallUsageDay(val date: String, val totals: CallUsageTotals) {
    companion object {
        fun from(json: JSONObject) =
            CallUsageDay(date = json.optString("date"), totals = CallUsageTotals.from(json))
    }
}

data class CallUsageChannel(
    val channelId: String,
    val channelName: String,
    val serverName: String?,
    val totals: CallUsageTotals,
) {
    companion object {
        fun from(json: JSONObject) = CallUsageChannel(
            channelId = json.optString("channelId"),
            channelName = json.optString("channelName"),
            serverName = json.stringOrNull("serverName"),
            totals = CallUsageTotals.from(json),
        )
    }
}

data class CallUsagePeer(
    val id: String,
    val username: String,
    val displayName: String,
    val calls: Int,
    val seconds: Int,
) {
    val label: String get() = displayName.ifBlank { username }

    companion object {
        fun from(json: JSONObject) = CallUsagePeer(
            id = json.optString("id"),
            username = json.optString("username"),
            displayName = json.optString("displayName"),
            calls = json.optInt("calls"),
            seconds = json.optInt("seconds"),
        )
    }
}

/** How the media got there, across every link reported in the window. */
data class CallTransportSplit(val direct: Int, val relay: Int, val unknown: Int) {
    val known: Int get() = direct + relay

    companion object {
        fun from(json: JSONObject) = CallTransportSplit(
            direct = json.optInt("direct"),
            relay = json.optInt("relay"),
            unknown = json.optInt("unknown"),
        )
    }
}

// --- remote desktop ---

/**
 * Somebody's standing access to a machine.
 *
 * An empty [permissions] is how access is taken away - there is no separate
 * delete, on the wire or here.
 */
data class RemoteGrant(
    val userId: String,
    val username: String,
    val displayName: String,
    val avatarUrl: String?,
    val permissions: List<String>,
    /** When it lapses. Null is open-ended, which is a decision, not a default. */
    val expiresAt: String?,
) {
    val label: String get() = displayName.ifBlank { username }

    companion object {
        fun from(json: JSONObject) = RemoteGrant(
            userId = json.optString("userId"),
            username = json.optString("username"),
            displayName = json.optString("displayName"),
            avatarUrl = json.stringOrNull("avatarUrl"),
            permissions = json.strings("permissions"),
            expiresAt = json.stringOrNull("expiresAt"),
        )
    }
}

/**
 * One line of a machine's audit trail.
 *
 * Remote access is the one part of this system where what happened matters as
 * much as who may do it, which is why the trail exists at all and why it is
 * readable from the phone rather than only from a desktop.
 */
data class RemoteAuditEntry(
    val id: String,
    val action: String,
    val actorUsername: String?,
    val createdAt: String,
) {
    companion object {
        fun from(json: JSONObject) = RemoteAuditEntry(
            id = json.optString("id"),
            action = json.optString("action"),
            actorUsername = json.stringOrNull("actorUsername"),
            createdAt = json.optString("createdAt"),
        )
    }
}

/** Remote permissions, in the order every client lists them. */
val REMOTE_PERMISSIONS = listOf(
    "REMOTE_VIEW",
    "REMOTE_CONTROL",
    "REMOTE_FILE_TRANSFER",
    "REMOTE_CLIPBOARD",
    "REMOTE_AUDIO",
    "REMOTE_ADMIN",
)

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
