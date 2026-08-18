package com.aktech.nexora.core.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

data class AuthTokens(val accessToken: String, val refreshToken: String)

data class AuthResponse(val user: PublicUser, val tokens: AuthTokens)

/** The signed-in account. A superset of [UserSummary]; the account's own view. */
data class PublicUser(
    val id: String,
    val email: String,
    val username: String,
    val displayName: String,
    val avatarUrl: String?,
    val role: String,
) {
    val label: String get() = displayName.ifBlank { username }
    val summary: UserSummary get() = UserSummary(id, username, displayName, avatarUrl)

    companion object {
        fun from(json: JSONObject) = PublicUser(
            id = json.getString("id"),
            email = json.optString("email"),
            username = json.optString("username"),
            displayName = json.optString("displayName"),
            avatarUrl = json.stringOrNull("avatarUrl"),
            role = json.optString("role", "USER"),
        )
    }
}

/** The shape every service answers an error with. See section 24 of CLAUDE.md. */
class ApiError(val code: String, message: String, val status: Int) : Exception(message)

/**
 * The client for the whole REST surface, matching
 * `apps/desktop/src/services/api.ts`: bearer access token, one refresh on a
 * 401, one retry.
 *
 * Every path is resolved against [Endpoint.current] at call time rather than
 * captured, so switching servers does not leave a stale base behind. Every call
 * moves itself to the IO dispatcher, so a caller never has to remember to.
 */
object NexoraApi {

    // --- auth ---

    suspend fun login(email: String, password: String): AuthResponse =
        authResponse("/api/v1/auth/login", obj("email" to email, "password" to password))

    suspend fun register(email: String, username: String, password: String): AuthResponse =
        authResponse(
            "/api/v1/auth/register",
            obj("email" to email, "username" to username, "password" to password),
        )

    suspend fun refresh(refreshToken: String): AuthTokens = io {
        tokensOf(public("POST", "/api/v1/auth/refresh", obj("refreshToken" to refreshToken)))
    }

    suspend fun logout(refreshToken: String): Unit = io {
        public("POST", "/api/v1/auth/logout", obj("refreshToken" to refreshToken))
    }

    suspend fun me(): PublicUser = io { PublicUser.from(authed("GET", "/api/v1/auth/me")) }

    suspend fun updateAccount(displayName: String?, username: String?, avatarUrl: String?): PublicUser =
        io {
            val body = JSONObject()
            displayName?.let { body.put("displayName", it) }
            username?.let { body.put("username", it) }
            avatarUrl?.let { body.put("avatarUrl", it) }
            PublicUser.from(authed("PATCH", "/api/v1/auth/account", body))
        }

    /** Signs every other session out; this one keeps its tokens. */
    suspend fun changePassword(currentPassword: String, newPassword: String): Unit = io {
        authed(
            "POST",
            "/api/v1/auth/account/password",
            obj("currentPassword" to currentPassword, "newPassword" to newPassword),
        )
    }

    // --- servers ---

    suspend fun servers(): List<ServerWithRole> = io {
        authedArray("GET", "/api/v1/servers").map { ServerWithRole.from(it) }
    }

    suspend fun createServer(name: String): ServerWithRole = io {
        ServerWithRole.from(authed("POST", "/api/v1/servers", obj("name" to name)))
    }

    /** An invite code, not a slug: a slug is a name and no longer opens a door. */
    suspend fun joinServer(code: String): ServerWithRole = io {
        ServerWithRole.from(authed("POST", "/api/v1/servers/join", obj("code" to code)))
    }

    /** Whose server a code leads to, and how big it is, before joining it. */
    suspend fun invitePreview(code: String): InvitePreview = io {
        InvitePreview.from(authed("GET", "/api/v1/servers/invites/${enc(code)}"))
    }

    suspend fun serverInvites(serverId: String): List<ServerInvite> = io {
        authedArray("GET", "/api/v1/servers/$serverId/invites").map { ServerInvite.from(it) }
    }

    /** Null hours never expires; null uses is unlimited. */
    suspend fun createServerInvite(
        serverId: String,
        expiresInHours: Int?,
        maxUses: Int?,
    ): ServerInvite = io {
        val body = JSONObject()
        expiresInHours?.let { body.put("expiresInHours", it) }
        maxUses?.let { body.put("maxUses", it) }
        ServerInvite.from(authed("POST", "/api/v1/servers/$serverId/invites", body))
    }

    suspend fun revokeServerInvite(serverId: String, code: String): ServerInvite = io {
        ServerInvite.from(authed("DELETE", "/api/v1/servers/$serverId/invites/${enc(code)}"))
    }

    suspend fun updateServer(serverId: String, name: String?, iconUrl: String?): ServerWithRole = io {
        val body = JSONObject()
        name?.let { body.put("name", it) }
        iconUrl?.let { body.put("iconUrl", it) }
        ServerWithRole.from(authed("PATCH", "/api/v1/servers/$serverId", body))
    }

    suspend fun deleteServer(serverId: String): Unit = io {
        authed("DELETE", "/api/v1/servers/$serverId")
    }

    suspend fun leaveServer(serverId: String): Unit = io {
        authed("POST", "/api/v1/servers/$serverId/leave")
    }

    suspend fun members(serverId: String): List<ServerMember> = io {
        authedArray("GET", "/api/v1/servers/$serverId/members").map { ServerMember.from(it) }
    }

    suspend fun addMember(serverId: String, username: String): ServerMember = io {
        ServerMember.from(
            authed("POST", "/api/v1/servers/$serverId/members", obj("username" to username)),
        )
    }

    suspend fun removeMember(serverId: String, userId: String): Unit = io {
        authed("DELETE", "/api/v1/servers/$serverId/members/$userId")
    }

    suspend fun updateMember(
        serverId: String,
        userId: String,
        role: ServerRole? = null,
        granted: List<String>? = null,
        denied: List<String>? = null,
        roleIds: List<String>? = null,
    ): ServerMember = io {
        val body = JSONObject()
        role?.let { body.put("role", it.name) }
        granted?.let { body.put("grantedPermissions", jsonArrayOf(it)) }
        denied?.let { body.put("deniedPermissions", jsonArrayOf(it)) }
        // Replaces the whole set rather than adding to it, which is what the
        // server does with it: an empty list takes every custom role away.
        roleIds?.let { body.put("roleIds", jsonArrayOf(it)) }
        ServerMember.from(authed("PATCH", "/api/v1/servers/$serverId/members/$userId", body))
    }

    // --- custom roles ---

    suspend fun serverRoles(serverId: String): List<ServerCustomRole> = io {
        authedArray("GET", "/api/v1/servers/$serverId/roles").map { ServerCustomRole.from(it) }
    }

    suspend fun createServerRole(
        serverId: String,
        name: String,
        colour: String?,
        permissions: List<String>,
    ): ServerCustomRole = io {
        val body = JSONObject().put("name", name).put("permissions", jsonArrayOf(permissions))
        colour?.let { body.put("colour", it) }
        ServerCustomRole.from(authed("POST", "/api/v1/servers/$serverId/roles", body))
    }

    /** Only what is passed is changed; anything null is left as it was. */
    suspend fun updateServerRole(
        serverId: String,
        roleId: String,
        name: String? = null,
        colour: String? = null,
        permissions: List<String>? = null,
        rank: Int? = null,
    ): ServerCustomRole = io {
        val body = JSONObject()
        name?.let { body.put("name", it) }
        colour?.let { body.put("colour", it) }
        permissions?.let { body.put("permissions", jsonArrayOf(it)) }
        rank?.let { body.put("rank", it) }
        ServerCustomRole.from(authed("PATCH", "/api/v1/servers/$serverId/roles/$roleId", body))
    }

    suspend fun deleteServerRole(serverId: String, roleId: String): Unit = io {
        authed("DELETE", "/api/v1/servers/$serverId/roles/$roleId")
    }

    // --- channels ---

    suspend fun channels(serverId: String): List<Channel> = io {
        authedArray("GET", "/api/v1/channels?serverId=${enc(serverId)}").map { Channel.from(it) }
    }

    suspend fun createChannel(
        serverId: String,
        name: String,
        type: ChannelType,
        isPrivate: Boolean,
        memberIds: List<String>,
    ): Channel = io {
        val body = JSONObject()
            .put("serverId", serverId)
            .put("name", name)
            .put("type", type.name)
            .put("isPrivate", isPrivate)
        if (memberIds.isNotEmpty()) body.put("memberIds", jsonArrayOf(memberIds))
        Channel.from(authed("POST", "/api/v1/channels", body))
    }

    suspend fun updateChannel(channelId: String, name: String?, topic: String?): Channel = io {
        val body = JSONObject()
        name?.let { body.put("name", it) }
        topic?.let { body.put("topic", it) }
        Channel.from(authed("PATCH", "/api/v1/channels/$channelId", body))
    }

    suspend fun deleteChannel(channelId: String): Unit = io {
        authed("DELETE", "/api/v1/channels/$channelId")
    }

    suspend fun channelMembers(channelId: String): List<ChannelMember> = io {
        authedArray("GET", "/api/v1/channels/$channelId/members").map { ChannelMember.from(it) }
    }

    suspend fun setChannelMembers(channelId: String, userIds: List<String>): List<ChannelMember> =
        io {
            authedArray(
                "PUT",
                "/api/v1/channels/$channelId/members",
                JSONObject().put("userIds", jsonArrayOf(userIds)),
            ).map { ChannelMember.from(it) }
        }

    // --- messages ---

    suspend fun messages(channelId: String, before: String? = null): Page<Message> = io {
        val path = "/api/v1/messages?channelId=${enc(channelId)}" +
            (before?.let { "&before=${enc(it)}" } ?: "")
        val json = authed("GET", path)
        Page(
            items = json.optJSONArray("items")?.map { Message.from(it) }.orEmpty(),
            nextCursor = json.stringOrNull("nextCursor"),
        )
    }

    /**
     * `content` is the sealed envelope; this client never sends a plaintext body.
     *
     * `attachmentKeys` names the blobs that envelope carries. The server cannot
     * read the manifest inside it, so this is the only way an upload is ever
     * tied to a message - and the only way a deleted message takes its files.
     */
    suspend fun sendMessage(
        channelId: String,
        content: String,
        attachmentKeys: List<String> = emptyList(),
    ): Message = io {
        Message.from(
            authed(
                "POST",
                "/api/v1/messages",
                obj(
                    "channelId" to channelId,
                    "content" to content,
                    "attachmentKeys" to JSONArray(attachmentKeys),
                ),
            ),
        )
    }

    suspend fun editMessage(messageId: String, content: String): Message = io {
        Message.from(authed("PATCH", "/api/v1/messages/$messageId", obj("content" to content)))
    }

    suspend fun deleteMessage(messageId: String): Unit = io {
        authed("DELETE", "/api/v1/messages/$messageId")
    }

    suspend fun pins(channelId: String): List<Message> = io {
        authedArray("GET", "/api/v1/messages/pins?channelId=${enc(channelId)}")
            .map { Message.from(it) }
    }

    suspend fun pinMessage(messageId: String, pinned: Boolean): Message = io {
        Message.from(authed(if (pinned) "PUT" else "DELETE", "/api/v1/messages/$messageId/pin"))
    }

    /** Reacting with an emoji already chosen takes it back. */
    suspend fun reactToMessage(messageId: String, emoji: String): Message = io {
        Message.from(
            authed("POST", "/api/v1/messages/$messageId/reactions", obj("emoji" to emoji)),
        )
    }

    // --- oauth ---

    /** What this deployment offers. Public: it names no credentials. */
    suspend fun oauthProviders(): List<OAuthProvider> = io {
        JSONArray(checked(Http.get(url("/api/v1/auth/oauth/providers"))).ifEmpty { "[]" })
            .map { OAuthProvider.from(it) }
    }

    /**
     * Trades the one-time code from the callback for a session. The verifier is
     * what proves this app is the one that started the sign-in - see
     * [OAuthFlow].
     */
    suspend fun oauthExchange(code: String, verifier: String): AuthResponse = io {
        val json = public("POST", "/api/v1/auth/oauth/exchange", obj("code" to code, "verifier" to verifier))
        AuthResponse(PublicUser.from(json.getJSONObject("user")), tokensOf(json))
    }

    // --- uploads ---

    /** Avatars and server icons go up as they are: a picture is not a secret. */
    suspend fun uploadPicture(bytes: ByteArray, name: String, contentType: String): UploadedObject =
        io {
            val form = MultipartBody.Builder().setType(MultipartBody.FORM)
                .addFormDataPart("file", name, bytes.toRequestBody(contentType.toMediaTypeOrNull()))
                .build()
            UploadedObject.from(authedForm("/api/v1/uploads/picture", form))
        }

    /**
     * Opens a large upload. [size] is the whole object, and is checked again
     * when the parts are assembled - the declaration is a promise, not proof.
     */
    suspend fun startMultipart(size: Int): MultipartTicket = io {
        val json = authed("POST", "/api/v1/uploads/multipart", obj("size" to size))
        MultipartTicket(
            ticket = json.getString("ticket"),
            maxPartBytes = json.optInt("maxPartBytes", 8 * 1024 * 1024),
        )
    }

    /** One slice of the ciphertext. Parts are numbered from 1, as S3 has it. */
    suspend fun uploadPart(ticket: String, partNumber: Int, bytes: ByteArray): UploadedPart = io {
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("ticket", ticket)
            .addFormDataPart("partNumber", partNumber.toString())
            .addFormDataPart("file", "part", bytes.toRequestBody(OPAQUE))
            .build()
        UploadedPart.from(authedForm("/api/v1/uploads/multipart/part", form))
    }

    suspend fun completeMultipart(ticket: String, parts: List<UploadedPart>): UploadedObject = io {
        val body = JSONObject()
            .put("ticket", ticket)
            .put("parts", JSONArray(parts.map { it.toJson() }))
        UploadedObject.from(authed("POST", "/api/v1/uploads/multipart/complete", body))
    }

    /** Leaves no half-uploaded parts behind for a file nobody will ever send. */
    suspend fun abortMultipart(ticket: String): Unit = io {
        authed("DELETE", "/api/v1/uploads/multipart", obj("ticket" to ticket))
    }

    /** Attachments go up already sealed, which is why nothing here is told what they are. */
    suspend fun uploadAttachment(ciphertext: ByteArray): UploadedObject = io {
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", "blob", ciphertext.toRequestBody(OPAQUE))
            .build()
        UploadedObject.from(authedForm("/api/v1/uploads", form))
    }

    /** Fetches a stored object's bytes. Attachments come back as ciphertext. */
    suspend fun fetchObject(objectUrl: String): ByteArray = io {
        val result = Http.get(Endpoint.absolute(objectUrl), Session.accessToken)
        if (result.status !in 200..299) {
            throw ApiError("OBJECT_NOT_FOUND", "That file is no longer available", result.status)
        }
        result.bytes
    }

    // --- friends and direct messages ---

    /**
     * Finds people by name. [friendsOnly] is for anywhere that offers to add
     * somebody to a server: the service refuses to add a non-friend, so
     * offering one is offering a refusal.
     */
    suspend fun searchUsers(query: String, friendsOnly: Boolean = false): List<UserSummary> = io {
        val suffix = if (friendsOnly) "&friendsOnly=true" else ""
        authedArray("GET", "/api/v1/users/search?q=${enc(query)}$suffix").map { UserSummary.from(it) }
    }

    suspend fun friends(): List<Friend> = io {
        authedArray("GET", "/api/v1/friends").map { Friend.from(it) }
    }

    suspend fun addFriend(username: String): Friend = io {
        Friend.from(authed("POST", "/api/v1/friends", obj("username" to username)))
    }

    suspend fun acceptFriend(userId: String): Friend = io {
        Friend.from(authed("POST", "/api/v1/friends/$userId/accept"))
    }

    suspend fun removeFriend(userId: String): Unit = io {
        authed("DELETE", "/api/v1/friends/$userId")
    }

    suspend fun directChannels(): List<DirectChannel> = io {
        authedArray("GET", "/api/v1/dm").map { DirectChannel.from(it) }
    }

    suspend fun openDirectChannel(userId: String): DirectChannel = io {
        DirectChannel.from(authed("POST", "/api/v1/dm", obj("userId" to userId)))
    }

    /** A server's own emoji. Public within the server, and read on every render. */
    suspend fun serverEmoji(serverId: String): List<ServerEmoji> = io {
        authedArray("GET", "/api/v1/servers/${enc(serverId)}/emoji").map { ServerEmoji.from(it) }
    }

    // --- end-to-end encryption key directory ---

    suspend fun registerDeviceKey(
        deviceId: String,
        publicKey: String,
        label: String,
    ): DeviceKey = io {
        DeviceKey.from(
            authed(
                "POST",
                "/api/v1/e2ee/devices",
                obj("deviceId" to deviceId, "publicKey" to publicKey, "label" to label),
            ),
        )
    }

    /** This account's own machines, for the list that can revoke one. */
    suspend fun myDevices(): List<DeviceKey> = io {
        authedArray("GET", "/api/v1/e2ee/devices/mine").map { DeviceKey.from(it) }
    }

    suspend fun revokeDevice(deviceId: String): DeviceKey = io {
        DeviceKey.from(authed("DELETE", "/api/v1/e2ee/devices/${enc(deviceId)}"))
    }

    suspend fun identityBackup(): IdentityBackup? = io {
        val json = authed("GET", "/api/v1/e2ee/backup")
        json.optJSONObject("backup")?.let { IdentityBackup.from(it) }
    }

    suspend fun putIdentityBackup(backup: IdentityBackup): Unit = io {
        authed("PUT", "/api/v1/e2ee/backup", backup.toJson())
    }

    suspend fun channelDevices(channelId: String): List<DeviceKey> = io {
        authedArray("GET", "/api/v1/e2ee/devices?channelId=${enc(channelId)}")
            .map { DeviceKey.from(it) }
    }

    suspend fun channelKeys(channelId: String): ChannelKeys = io {
        ChannelKeys.from(authed("GET", "/api/v1/e2ee/keys/${enc(channelId)}"))
    }

    suspend fun publishChannelKeys(
        channelId: String,
        epoch: Int,
        senderDeviceId: String,
        entries: List<ChannelKeyEntry>,
    ): Unit = io {
        val array = JSONArray()
        entries.forEach {
            array.put(
                JSONObject()
                    .put("recipientUserId", it.recipientUserId)
                    .put("recipientDeviceId", it.recipientDeviceId)
                    .put("senderPublicKey", it.senderPublicKey)
                    .put("wrappedKey", it.wrappedKey)
                    .put("iv", it.iv),
            )
        }
        authed(
            "POST",
            "/api/v1/e2ee/keys",
            JSONObject().put("channelId", channelId).put("epoch", epoch).put("entries", array),
        )
    }

    // --- notifications ---

    suspend fun notificationPreferences(): NotificationPreferences = io {
        NotificationPreferences.from(authed("GET", "/api/v1/notifications/preferences"))
    }

    suspend fun updateNotificationPreferences(
        enabled: Boolean? = null,
        quietStartMinute: Int? = null,
        quietEndMinute: Int? = null,
        mutedChannelIds: List<String>? = null,
    ): NotificationPreferences = io {
        val body = JSONObject()
        enabled?.let { body.put("enabled", it) }
        body.put("quietStartMinute", quietStartMinute ?: JSONObject.NULL)
        body.put("quietEndMinute", quietEndMinute ?: JSONObject.NULL)
        mutedChannelIds?.let { body.put("mutedChannelIds", jsonArrayOf(it)) }
        NotificationPreferences.from(authed("PATCH", "/api/v1/notifications/preferences", body))
    }

    suspend fun unread(): List<ChannelUnread> = io {
        authedArray("GET", "/api/v1/notifications/unread").map { ChannelUnread.from(it) }
    }

    suspend fun markChannelRead(channelId: String): Unit = io {
        authed("POST", "/api/v1/notifications/read", obj("channelId" to channelId))
    }

    // --- calls ---

    /**
     * How to reach the other peers - STUN, and TURN when this deployment
     * configures one. Deliberately not "where the media server is": there is
     * not one, and nothing here ever hands a client an address to dial.
     */
    suspend fun callIce(channelId: String): List<IceServer> = io {
        authed("POST", "/api/v1/calls/ice", obj("channelId" to channelId))
            .optJSONArray("iceServers")?.map { IceServer.from(it) }.orEmpty()
    }

    // --- remote desktop ---

    suspend fun machines(): List<RemoteMachine> = io {
        authedArray("GET", "/api/v1/remote/machines").map { RemoteMachine.from(it) }
    }

    suspend fun startRemoteSession(machineId: String): RemoteSession = io {
        RemoteSession.from(
            authed("POST", "/api/v1/remote/sessions", obj("machineId" to machineId)),
        )
    }

    suspend fun endRemoteSession(sessionId: String): Unit = io {
        authed("DELETE", "/api/v1/remote/sessions/$sessionId")
    }

    // --- plumbing ---

    private suspend fun <T> io(block: suspend () -> T): T = withContext(Dispatchers.IO) { block() }

    /** What a sealed blob is called on the wire: bytes, and nothing claimed about them. */
    private val OPAQUE = "application/octet-stream".toMediaTypeOrNull()

    /**
     * A form post that survives a stale access token, the way every JSON call
     * already does.
     *
     * It matters most here and was missing here. A hundred megabytes goes up in
     * parts over minutes, and an access token that was fresh when the upload
     * started is not necessarily fresh when part nine goes out - which failed
     * the whole upload for a reason that had nothing to do with it. The body is
     * a byte array, so replaying it costs nothing.
     */
    private suspend fun authedForm(path: String, form: MultipartBody): JSONObject {
        val target = url(path)
        val first = Http.post(target, form, Session.accessToken, slow = true)
        if (first.status != 401) return parse(first)

        val refreshed = Session.refreshAccessToken() ?: return parse(first)
        return parse(Http.post(target, form, refreshed, slow = true))
    }

    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")

    private fun url(path: String) = Endpoint.current() + path

    private fun obj(vararg pairs: Pair<String, Any?>): JSONObject =
        JSONObject().apply { pairs.forEach { (key, value) -> put(key, value ?: JSONObject.NULL) } }

    private suspend fun authResponse(path: String, body: JSONObject): AuthResponse = io {
        val json = public("POST", path, body)
        AuthResponse(PublicUser.from(json.getJSONObject("user")), tokensOf(json))
    }

    private fun tokensOf(json: JSONObject) =
        AuthTokens(json.getString("accessToken"), json.getString("refreshToken"))

    /** A route that needs no session: sign in, register, refresh, sign out. */
    private fun public(method: String, path: String, body: JSONObject?): JSONObject =
        parse(Http.send(method, url(path), body?.toString()))

    /**
     * A route that needs one. A 401 is the access token having expired, which
     * is normal and not an error: refresh once, retry once, and only then give
     * up. Anything else is the caller's problem.
     */
    private suspend fun authed(
        method: String,
        path: String,
        body: JSONObject? = null,
    ): JSONObject = JSONObject(rawAuthed(method, path, body).ifEmpty { "{}" })

    private suspend fun authedArray(
        method: String,
        path: String,
        body: JSONObject? = null,
    ): JSONArray = JSONArray(rawAuthed(method, path, body).ifEmpty { "[]" })

    private suspend fun rawAuthed(method: String, path: String, body: JSONObject?): String {
        val target = url(path)
        val payload = body?.toString()
        val first = Http.send(method, target, payload, Session.accessToken)
        if (first.status != 401) return checked(first)

        val refreshed = Session.refreshAccessToken() ?: return checked(first)
        return checked(Http.send(method, target, payload, refreshed))
    }

    private fun checked(result: Http.Result): String {
        if (result.status !in 200..299) throw errorOf(result)
        return result.body.trim()
    }

    private fun parse(result: Http.Result): JSONObject {
        if (result.status !in 200..299) throw errorOf(result)
        return runCatching { JSONObject(result.body) }.getOrDefault(JSONObject())
    }

    private fun errorOf(result: Http.Result): ApiError {
        val error = runCatching { JSONObject(result.body).optJSONObject("error") }.getOrNull()
        return ApiError(
            error?.optString("code").orEmpty().ifEmpty { "REQUEST_FAILED" },
            error?.optString("message").orEmpty().ifEmpty { "Request failed" },
            result.status,
        )
    }
}
