package com.aatech.betweenus.core.data

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
    /** The wide band behind the name on a profile. See [UserSummary.coverUrl]. */
    val coverUrl: String? = null,
    /** The line under the name on a profile card. See `ABOUT_MAX_LENGTH`. */
    val about: String = "",
    /** Who may read this account's last-seen time. Reciprocal at NOBODY. */
    val lastSeenVisibility: LastSeenVisibility = LastSeenVisibility.EVERYONE,
    val role: String,
    /**
     * This account's own disappearing window in seconds, or null for "keep
     * everything".
     *
     * One-sided and personal: history older than the window is not returned to
     * this account on any of its devices, and every other participant's copy is
     * untouched. A server's own window outranks it - that one deletes the row.
     */
    val messageTtlSeconds: Int? = null,
) {
    val label: String get() = displayName.ifBlank { username }
    val summary: UserSummary
        get() = UserSummary(id, username, displayName, avatarUrl, coverUrl, about)

    /** The "@name" line, or null when it would only repeat [label]. */
    val handle: String? get() = summary.handle

    companion object {
        fun from(json: JSONObject) = PublicUser(
            id = json.getString("id"),
            email = json.optString("email"),
            username = json.optString("username"),
            displayName = json.optString("displayName"),
            avatarUrl = json.stringOrNull("avatarUrl"),
            coverUrl = json.stringOrNull("coverUrl"),
            about = json.optString("about"),
            lastSeenVisibility = LastSeenVisibility.of(json.optString("lastSeenVisibility")),
            role = json.optString("role", "USER"),
            messageTtlSeconds = if (json.isNull("messageTtlSeconds")) null
            else json.optInt("messageTtlSeconds").takeIf { it > 0 },
        )
    }
}

data class LinkPreview(
    val url: String,
    val title: String?,
    val description: String?,
    val image: String?,
    val siteName: String?,
    val favicon: String?,
) {
    companion object {
        fun from(json: JSONObject) = LinkPreview(
            url = json.optString("url"),
            title = json.stringOrNull("title"),
            description = json.stringOrNull("description"),
            image = json.stringOrNull("image"),
            siteName = json.stringOrNull("siteName"),
            favicon = json.stringOrNull("favicon"),
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
object BetweenUsApi {

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

    suspend fun updateAccount(
        displayName: String?,
        username: String?,
        avatarUrl: String?,
        about: String? = null,
    ): PublicUser =
        io {
            val body = JSONObject()
            displayName?.let { body.put("displayName", it) }
            username?.let { body.put("username", it) }
            avatarUrl?.let { body.put("avatarUrl", it) }
            // An empty string is a value here - "draw no line under my name" -
            // so it is null that means "leave it alone", as it does above.
            about?.let { body.put("about", it) }
            PublicUser.from(authed("PATCH", "/api/v1/auth/account", body))
        }

    /**
     * Who may see when this account was last here.
     *
     * Its own call rather than a field on [updateAccount] because it is a
     * switch and not a field being edited: it is saved the moment it is
     * pressed, and a privacy switch that waits for a Save button is one people
     * believe they have set when they have not.
     */
    suspend fun setLastSeenVisibility(visibility: LastSeenVisibility): PublicUser = io {
        val body = JSONObject().put("lastSeenVisibility", visibility.wire)
        PublicUser.from(authed("PATCH", "/api/v1/auth/account", body))
    }

    /**
     * Sets this account's own disappearing window, or clears it with null.
     *
     * Its own call for the same reason [setAvatar] is: null means "switch it
     * off" here and "leave it alone" in [updateAccount], and one function
     * cannot mean both.
     */
    suspend fun setMessageWindow(seconds: Int?): PublicUser = io {
        val body = JSONObject().put("messageTtlSeconds", seconds ?: JSONObject.NULL)
        PublicUser.from(authed("PATCH", "/api/v1/auth/account", body))
    }

    /**
     * Sets or clears this account's picture.
     *
     * Separate from [updateAccount] because null means two different things
     * there: that call leaves out what it is not changing, so it can never send
     * "no avatar". This one always sends the field, and null clears it.
     */
    suspend fun setAvatar(url: String?): PublicUser = io {
        val body = JSONObject().put("avatarUrl", url ?: JSONObject.NULL)
        PublicUser.from(authed("PATCH", "/api/v1/auth/account", body))
    }

    /** Sets or clears the wide band behind the name. Null clears, as in [setAvatar]. */
    suspend fun setCover(url: String?): PublicUser = io {
        val body = JSONObject().put("coverUrl", url ?: JSONObject.NULL)
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

    /**
     * Whether a username can be registered.
     *
     * Public, because the form that asks is the one filled in before there is
     * an account. Cheap on the server - a Bloom filter answers the common case
     * without touching the database - so the sign-up form asks while somebody
     * is typing rather than when they press the button.
     */
    suspend fun usernameAvailable(username: String): UsernameAvailability = io {
        UsernameAvailability.from(
            public("GET", "/api/v1/auth/username-available?username=${enc(username)}", null),
        )
    }

    /**
     * What can be done about a forgotten password on this deployment.
     *
     * Three answers, and only one of them is about the account: a link was sent
     * (which is also what an account that does not exist gets), an
     * administrator has already authorised a reset and here is the token, or
     * this deployment has no mail server at all.
     */
    suspend fun forgotPassword(identifier: String): ForgotPasswordAnswer = io {
        ForgotPasswordAnswer.from(
            public("POST", "/api/v1/auth/forgot-password", obj("identifier" to identifier)),
        )
    }

    /** Spends a reset token. The one path that sets a password without the old one. */
    suspend fun resetPassword(token: String, newPassword: String): AuthResponse =
        authResponse(
            "/api/v1/auth/reset-password",
            obj("token" to token, "newPassword" to newPassword),
        )

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

    /** Sets a server's disappearing window, or clears it with null. MANAGE_SERVER. */
    suspend fun setServerMessageWindow(serverId: String, seconds: Int?): ServerWithRole = io {
        val body = JSONObject().put("messageTtlSeconds", seconds ?: JSONObject.NULL)
        ServerWithRole.from(authed("PATCH", "/api/v1/servers/$serverId", body))
    }

    /** Sets or clears a server's icon. Null clears it, as [setAvatar] does. */
    suspend fun setServerIcon(serverId: String, url: String?): ServerWithRole = io {
        val body = JSONObject().put("iconUrl", url ?: JSONObject.NULL)
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

    /**
     * [shareHistory] is whether they arrive able to read what was said before
     * they got here. Off is the default and is what the encryption does on its
     * own: they hold no earlier channel key and nothing offers them one. On, the
     * key directory starts listing every epoch as missing for their devices and
     * a machine that already holds them seals them across. See E2EE.md.
     */
    suspend fun addMember(
        serverId: String,
        username: String,
        shareHistory: Boolean = false,
    ): ServerMember = io {
        ServerMember.from(
            authed(
                "POST",
                "/api/v1/servers/$serverId/members",
                obj("username" to username, "shareHistory" to shareHistory),
            ),
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

    // --- webhooks ---
    //
    // A URL an outside system posts into a channel with. Every call here needs
    // MANAGE_WEBHOOK on the channel's server; the URL itself comes back exactly
    // twice in a webhook's life - at creation and at rotation - because the
    // server keeps only a hash of the token.

    suspend fun webhooks(channelId: String): List<Webhook> = io {
        authedArray("GET", "/api/v1/webhooks?channelId=${enc(channelId)}").map { Webhook.from(it) }
    }

    suspend fun createWebhook(channelId: String, name: String): WebhookWithToken = io {
        val body = JSONObject().put("channelId", channelId).put("name", name)
        WebhookWithToken.from(authed("POST", "/api/v1/webhooks", body))
    }

    /** A new URL, invalidating the old one. The way back from a leak, and from a URL nobody kept. */
    suspend fun rotateWebhook(webhookId: String): WebhookWithToken = io {
        WebhookWithToken.from(authed("POST", "/api/v1/webhooks/$webhookId/rotate", JSONObject()))
    }

    suspend fun deleteWebhook(webhookId: String): Unit = io {
        authed("DELETE", "/api/v1/webhooks/$webhookId")
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
        viewOnce: Boolean = false,
    ): Message = io {
        Message.from(
            authed(
                "POST",
                "/api/v1/messages",
                obj(
                    "channelId" to channelId,
                    "content" to content,
                    "attachmentKeys" to JSONArray(attachmentKeys),
                    "viewOnce" to viewOnce,
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

    /**
     * Reports that a one-time message has been opened, which is what destroys
     * it. A POST rather than a DELETE: the caller is usually not allowed to
     * delete this message and is not claiming to be - they are saying they
     * looked at it, and the destruction is the server's consequence.
     */
    suspend fun burnMessage(messageId: String): Unit = io {
        authed("POST", "/api/v1/messages/$messageId/burn")
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

    /** Fetch rich social OpenGraph details and link preview metadata for a URL. */
    suspend fun unfurl(targetUrl: String): LinkPreview? = io {
        runCatching {
            val json = authed("GET", "/api/v1/messages/unfurl?url=${enc(targetUrl)}")
            LinkPreview.from(json)
        }.getOrNull()
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

    // --- statuses ---
    //
    // A post that expires after a day, sealed the way a message is. What
    // differs is where the audience comes from: a channel has members, a status
    // has the friend list as it stood when it was written. See the note in
    // Models.kt.

    /** Your own run, and one entry per friend who has posted. */
    suspend fun statusFeed(): StatusFeed = io {
        StatusFeed.from(authed("GET", "/api/v1/statuses"))
    }

    /**
     * Every device a post may be sealed for: this account's own, and every
     * friend's.
     *
     * Read immediately before posting rather than cached - this list is the
     * audience, and a friend added a minute ago belongs in it.
     */
    suspend fun statusAudience(): List<DeviceKey> = io {
        authedArray("GET", "/api/v1/statuses/audience").map { DeviceKey.from(it) }
    }

    /**
     * Posts one.
     *
     * The media travels with the caption in the same request, unlike an
     * attachment, which is uploaded first and claimed by a message later. A
     * status is one file and one button, and a two-step version leaves an
     * orphaned blob every time somebody changes their mind in between.
     *
     * Everything here is already sealed by the caller: `caption` is an
     * envelope, `media` is ciphertext, and `keys` is the bundle of wraps that
     * decides who can open either.
     */
    suspend fun postStatus(
        kind: StatusKind,
        caption: String? = null,
        background: String? = null,
        durationMs: Long? = null,
        media: ByteArray? = null,
        mediaIv: String? = null,
        mediaType: String? = null,
        senderDeviceId: String,
        keys: List<StatusKeyEntry>,
    ): StatusEntry = io {
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("kind", kind.name)
        caption?.takeIf { it.isNotBlank() }?.let { form.addFormDataPart("caption", it) }
        background?.let { form.addFormDataPart("background", it) }
        durationMs?.let { form.addFormDataPart("durationMs", it.toString()) }
        mediaIv?.let { form.addFormDataPart("mediaIv", it) }
        mediaType?.let { form.addFormDataPart("mediaType", it) }
        form.addFormDataPart("senderDeviceId", senderDeviceId)
        // Multipart has no arrays, so the bundle travels as JSON in one field
        // and is parsed back by the DTO on the other side.
        form.addFormDataPart("keys", JSONArray(keys.map { it.toJson() }).toString())
        if (media != null) {
            // Ciphertext, so the part is opaque whatever the picture used to
            // be. What it is once opened travels as `mediaType`.
            form.addFormDataPart("file", "status", media.toRequestBody(OPAQUE))
        }
        StatusEntry.from(authedForm("/api/v1/statuses", form.build()))
    }

    /** Records that this account opened one. Idempotent on the server. */
    suspend fun markStatusSeen(statusId: String): Unit = io {
        authed("POST", "/api/v1/statuses/$statusId/view")
    }

    /** Who opened one of yours. Refused to everybody but its author. */
    suspend fun statusViewers(statusId: String): List<StatusViewer> = io {
        authedArray("GET", "/api/v1/statuses/$statusId/views").map { StatusViewer.from(it) }
    }

    suspend fun deleteStatus(statusId: String): Unit = io {
        authed("DELETE", "/api/v1/statuses/$statusId")
    }

    // --- blocking ---

    /** Everyone this account has blocked, most recent first. */
    suspend fun blocked(): List<BlockedUser> = io {
        authedArray("GET", "/api/v1/blocks").map { BlockedUser.from(it) }
    }

    /**
     * Blocks somebody.
     *
     * It also ends the friendship, and closes the conversation for both sides -
     * the messages stay where they are, so unblocking brings the whole thing
     * back. The far side is not told: their friend list simply gets shorter,
     * which is the same event an ordinary removal sends.
     */
    suspend fun blockUser(userId: String): BlockedUser = io {
        BlockedUser.from(authed("POST", "/api/v1/blocks", obj("userId" to userId)))
    }

    suspend fun unblockUser(userId: String): Unit = io {
        authed("DELETE", "/api/v1/blocks/${enc(userId)}")
    }

    /**
     * Hides messages from this account's own view, on every device it is signed
     * in on: one conversation when [channelId] is given, every one of them when
     * it is not.
     *
     * Nothing is deleted. The other side of each conversation keeps their copy,
     * because a message has two ends and this reaches one of them. The server
     * publishes the cut back as `chats.cleared`, which is what tells this phone
     * and everything else signed in to drop what they are holding.
     */
    suspend fun clearChats(channelId: String? = null): Unit = io {
        authed(
            "POST",
            "/api/v1/messages/clear",
            if (channelId != null) obj("channelId" to channelId) else null,
        )
    }

    /** A server's own emoji. Public within the server, and read on every render. */
    suspend fun serverEmoji(serverId: String): List<ServerEmoji> = io {
        authedArray("GET", "/api/v1/servers/${enc(serverId)}/emoji").map { ServerEmoji.from(it) }
    }

    /**
     * Adds one. [url] is a picture already uploaded through
     * `/api/v1/uploads/picture` - emoji are stored in the clear, like avatars,
     * because an image tag cannot carry a password.
     */
    suspend fun addServerEmoji(
        serverId: String,
        name: String,
        url: String,
        animated: Boolean,
    ): ServerEmoji = io {
        val body = obj("name" to name, "url" to url, "animated" to animated)
        ServerEmoji.from(authed("POST", "/api/v1/servers/${enc(serverId)}/emoji", body))
    }

    suspend fun removeServerEmoji(serverId: String, emojiId: String): Unit = io {
        authed("DELETE", "/api/v1/servers/${enc(serverId)}/emoji/${enc(emojiId)}")
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

    /**
     * Every sealed identity this account holds, at most one per secret kind.
     *
     * Falls back to the single blob a server older than per-kind backups sends,
     * so an updated app against an old deployment still recovers rather than
     * deciding the account has nothing and minting a key of its own.
     */
    /**
     * "I said no to that, here."
     *
     * Reaches this account's own other devices and nobody else - the caller is
     * deliberately not told, and a ring rings out for them either way. See
     * `CallsService.decline`.
     */
    suspend fun declineCall(channelId: String): Unit = io {
        authed("POST", "/api/v1/calls/decline", obj("channelId" to channelId))
    }

    suspend fun identityBackups(): List<IdentityBackup> = io {
        val json = authed("GET", "/api/v1/e2ee/backup")
        json.optJSONArray("backups")?.map { IdentityBackup.from(it) }
            ?: json.optJSONObject("backup")?.let { listOf(IdentityBackup.from(it)) }
            ?: emptyList()
    }

    suspend fun putIdentityBackup(backup: IdentityBackup): Unit = io {
        authed("PUT", "/api/v1/e2ee/backup", backup.toJson())
    }

    /** Drops one kind of backup. See `E2ee.disablePasswordRecovery`. */
    suspend fun deleteIdentityBackup(kind: String): Unit = io {
        authed("DELETE", "/api/v1/e2ee/backup/${enc(kind)}")
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
            JSONObject()
                .put("channelId", channelId)
                .put("epoch", epoch)
                // Required by the endpoint. Leaving it out failed validation on
                // every publish, so this client could never mint a channel's
                // first epoch - only read one some other client had minted.
                .put("senderDeviceId", senderDeviceId)
                .put("entries", array),
        )
    }

    // --- notifications ---

    suspend fun notificationPreferences(): NotificationPreferences = io {
        NotificationPreferences.from(authed("GET", "/api/v1/notifications/preferences"))
    }

    /**
     * A patch, and only of what is named.
     *
     * [quiet] is a pair rather than two nullable minutes because null has to
     * mean two different things: leaving the field out means "as they were",
     * and a pair of nulls means "clear them". Sending the two minutes as plain
     * nullable arguments made every other change to these preferences - the
     * on/off switch, a mute - quietly wipe somebody's quiet hours.
     */
    suspend fun updateNotificationPreferences(
        enabled: Boolean? = null,
        quiet: Pair<Int?, Int?>? = null,
        mutedChannelIds: List<String>? = null,
        mutedUserIds: List<String>? = null,
    ): NotificationPreferences = io {
        val body = JSONObject()
        enabled?.let { body.put("enabled", it) }
        quiet?.let {
            body.put("quietStartMinute", it.first ?: JSONObject.NULL)
            body.put("quietEndMinute", it.second ?: JSONObject.NULL)
        }
        mutedChannelIds?.let { body.put("mutedChannelIds", jsonArrayOf(it)) }
        mutedUserIds?.let { body.put("mutedUserIds", jsonArrayOf(it)) }
        NotificationPreferences.from(authed("PATCH", "/api/v1/notifications/preferences", body))
    }

    suspend fun unread(): List<ChannelUnread> = io {
        authedArray("GET", "/api/v1/notifications/unread").map { ChannelUnread.from(it) }
    }

    /** Who else has read this channel, and up to when. */
    suspend fun channelReads(channelId: String): List<ChannelReadReceipt> = io {
        authedArray("GET", "/api/v1/notifications/channels/${enc(channelId)}/reads")
            .map { ChannelReadReceipt.from(it) }
    }

    suspend fun markChannelRead(channelId: String): Unit = io {
        authed("POST", "/api/v1/notifications/read", obj("channelId" to channelId))
    }

    // --- push devices ---

    /**
     * Register this installation for push, and re-register whenever FCM rotates
     * the token. The same call for both: the server upserts on the device id,
     * so there is nothing for the client to know about which one this is.
     *
     * The token is a credential that can push to this phone. It goes in a body
     * and is never logged - see section 23 of CLAUDE.md.
     */
    suspend fun registerDevice(
        token: String,
        deviceId: String,
        platform: String = "android",
        label: String? = null,
        appVersion: String? = null,
    ): Unit = io {
        authed(
            "POST",
            "/api/v1/notifications/devices",
            JSONObject()
                .put("token", token)
                .put("deviceId", deviceId)
                .put("platform", platform)
                .apply { label?.let { put("label", it) } }
                .apply { appVersion?.let { put("appVersion", it) } },
        )
    }

    /** Sign-out. Called while there is still an access token to call it with. */
    suspend fun unregisterDevice(deviceId: String): Unit = io {
        authed("DELETE", "/api/v1/notifications/devices/${enc(deviceId)}")
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

    /**
     * "Come into this call."
     *
     * Answers 204, or a 403 saying why not: they cannot see the channel, or
     * they were rung a moment ago and the cooldown holds.
     */
    suspend fun callRing(channelId: String, userId: String): Unit = io {
        authed("POST", "/api/v1/calls/ring", obj("channelId" to channelId, "userId" to userId))
    }

    /**
     * This account's own call log, newest first. Whose is never a parameter -
     * the server decides, so there is nothing here to get wrong.
     */
    suspend fun callHistory(): List<CallHistoryEntry> = io {
        authedArray("GET", "/api/v1/calls/history").map { CallHistoryEntry.from(it) }
    }

    /** The same calls added up over a window of days. */
    suspend fun callAnalytics(days: Int = 30): CallAnalytics = io {
        CallAnalytics.from(authed("GET", "/api/v1/calls/analytics?days=$days"))
    }

    // --- remote desktop ---

    suspend fun machines(): List<RemoteMachine> = io {
        authedArray("GET", "/api/v1/remote/machines").map { RemoteMachine.from(it) }
    }

    suspend fun renameMachine(machineId: String, name: String): RemoteMachine = io {
        RemoteMachine.from(
            authed("PATCH", "/api/v1/remote/machines/${enc(machineId)}", obj("name" to name)),
        )
    }

    /** Forgets the machine and every grant on it. Its agent has to enrol again. */
    suspend fun removeMachine(machineId: String): Unit = io {
        authed("DELETE", "/api/v1/remote/machines/${enc(machineId)}")
    }

    suspend fun machineGrants(machineId: String): List<RemoteGrant> = io {
        authedArray("GET", "/api/v1/remote/machines/${enc(machineId)}/grants")
            .map { RemoteGrant.from(it) }
    }

    /**
     * Grants, changes or revokes one person's access. An empty [permissions]
     * revokes: there is no separate delete.
     */
    suspend fun setMachineGrant(
        machineId: String,
        userId: String,
        permissions: List<String>,
        expiresAt: String? = null,
    ): List<RemoteGrant> = io {
        val body = JSONObject()
            .put("userId", userId)
            .put("permissions", jsonArrayOf(permissions))
            .put("expiresAt", expiresAt ?: JSONObject.NULL)
        authedArray("PUT", "/api/v1/remote/machines/${enc(machineId)}/grants", body)
            .map { RemoteGrant.from(it) }
    }

    suspend fun machineAudit(machineId: String): List<RemoteAuditEntry> = io {
        authedArray("GET", "/api/v1/remote/machines/${enc(machineId)}/audit")
            .map { RemoteAuditEntry.from(it) }
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
