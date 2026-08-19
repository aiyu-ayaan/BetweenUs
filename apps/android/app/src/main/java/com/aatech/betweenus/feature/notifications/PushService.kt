package com.aatech.betweenus.feature.notifications

import android.graphics.Bitmap
import com.aatech.betweenus.core.crypto.E2ee
import com.aatech.betweenus.core.data.AuthPhase
import com.aatech.betweenus.core.data.Http
import com.aatech.betweenus.core.data.MessageBody
import com.aatech.betweenus.core.data.PushTokens
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.store.Conversation
import com.aatech.betweenus.core.store.Workspace
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Where a push arrives.
 *
 * The payload is data-only and deliberately so: the words are sealed with the
 * channel key, so no server could write a notification worth reading, and no
 * server knows whether this phone is already showing the conversation. Both
 * decisions are made here, which is the same shape WhatsApp has and the reason
 * a message that arrives while you are reading it makes no sound.
 *
 * The order of the gates matters. Cheap and local first - my own message, the
 * channel on screen - then the session, then the key, then the picture. A push
 * that is going to be dropped should cost nothing.
 *
 * Five kinds arrive here. One of them - `message.deleted` - exists to take a
 * notification off the screen rather than put one on it, and is the only one
 * that is allowed to do its work with no session and no key: removing
 * something already drawn needs neither.
 */
class PushService : FirebaseMessagingService() {

    /**
     * FCM rotated the token: after a restore, a clear-data, or on its own
     * schedule. The old one is dead the moment this is called, so the row has
     * to be updated before the next message is sent to nowhere.
     */
    override fun onNewToken(token: String) {
        scope.launch { PushTokens.register() }
    }

    /**
     * `onMessageReceived` is given a background thread and a short window, and
     * the process may be killed the moment it returns - so the work is done
     * here and blocked on, rather than launched and hoped for.
     */
    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        runBlocking {
            withTimeoutOrNull(BUDGET_MS) {
                when (data["type"]) {
                    "message.created" -> handle(data)
                    "message.deleted" -> handleDeleted(data)
                    "friend.request" -> handleFriend(data, accepted = false)
                    "friend.accepted" -> handleFriend(data, accepted = true)
                    "server.member.added" -> handleServerAdded(data)
                    "call.roster" -> handleCallRoster(data)
                    else -> Unit
                }
            }
        }
    }

    /**
     * A message was deleted, so the notification drawn for it is a lie.
     *
     * No session, no channel key and no preferences: there is nothing to read
     * and nothing to decide. Either this device drew that message, in which
     * case the line goes, or it did not, in which case this costs one map
     * lookup. It is the one push that is never suppressed - a notification
     * standing for a message that no longer exists is the thing being fixed,
     * and every gate here is a way to leave it standing.
     */
    private fun handleDeleted(data: Map<String, String>) {
        val channelId = data["channelId"] ?: return
        val messageId = data["messageId"] ?: return
        MessageNotifications.remove(
            context = applicationContext,
            channelId = channelId,
            messageId = messageId,
            conversationTitle = PushGate.conversationTitle(channelId),
            isGroup = PushGate.isGroup(channelId),
            selfName = (Session.state.value as? AuthPhase.SignedIn)?.user?.label.orEmpty(),
        )
    }

    /** Somebody asked to be friends, or said yes. No words, so nothing to open. */
    private suspend fun handleFriend(data: Map<String, String>, accepted: Boolean) {
        val actorId = data["actorId"] ?: return
        if (!wanted()) return
        SocialNotifications.friend(
            context = applicationContext,
            actorId = actorId,
            actorName = data["actorName"].orEmpty().ifBlank { "Someone" },
            actorAvatar = avatar(data["actorAvatarUrl"]),
            accepted = accepted,
        )
        // The friends screen reads its list from the network, so it has to be
        // told there is something new to read.
        runCatching { withTimeoutOrNull(REFRESH_MS) { Workspace.refresh() } }
    }

    /** Added to a server. The workspace is refreshed so it is actually there. */
    private suspend fun handleServerAdded(data: Map<String, String>) {
        val serverId = data["serverId"] ?: return
        if (!wanted()) return
        runCatching { withTimeoutOrNull(REFRESH_MS) { Workspace.refresh() } }
        SocialNotifications.serverAdded(
            context = applicationContext,
            serverId = serverId,
            serverName = data["serverName"].orEmpty().ifBlank { "a server" },
            icon = avatar(data["serverIconUrl"]),
        )
    }

    /**
     * Who is in a call in a channel this account can hear and is not in.
     *
     * A roster of nobody is the call ending, and it cancels rather than posts -
     * so it runs before every gate below it. A phone that was told about a call
     * and then told nothing has a notification for a call that finished an hour
     * ago, which is worse than never having been told.
     */
    private suspend fun handleCallRoster(data: Map<String, String>) {
        val channelId = data["channelId"] ?: return
        val count = data["count"]?.toIntOrNull() ?: 0
        if (count == 0) {
            SocialNotifications.clearCall(applicationContext, channelId)
            return
        }
        if (!wanted()) return
        // The channel is open in front of somebody: the call is already on
        // their screen, in the roster under the channel.
        if (PushGate.shouldSuppress(channelId)) return
        runCatching { withTimeoutOrNull(REFRESH_MS) { Workspace.refresh() } }
        SocialNotifications.callRoster(
            context = applicationContext,
            channelId = channelId,
            channelName = Workspace.channel(channelId)?.name ?: "a channel",
            participants = data["participants"].orEmpty(),
            count = count,
        )
    }

    /**
     * The gates every notification-drawing push shares: a session to be sure
     * whose phone this is, and quiet hours, which are minutes on this phone's
     * clock and therefore nobody else's decision to make.
     *
     * The server has already refused the account that turned notifications off.
     */
    private suspend fun wanted(): Boolean {
        PushGate.ensureSession() ?: return false
        val preferences = PushGate.preferences()
        if (preferences?.enabled == false) return false
        return !PushGate.quiet(preferences)
    }

    private suspend fun handle(data: Map<String, String>) {
        val channelId = data["channelId"] ?: return
        val authorId = data["authorId"] ?: return
        val content = data["content"] ?: return

        // Somebody's own message, sent from their other machine. It is already
        // on their screen everywhere it matters.
        val selfId = (Session.state.value as? AuthPhase.SignedIn)?.user?.id
        if (selfId != null && authorId == selfId) return

        // The WhatsApp rule, and the reason a push is data-only at all: the
        // conversation is open, in front of somebody, right now. Both halves
        // are needed - a locked phone still has the chat screen composed.
        if (PushGate.shouldSuppress(channelId)) return

        val self = PushGate.ensureSession() ?: return
        if (authorId == self.id) return

        val preferences = PushGate.preferences()
        if (preferences?.enabled == false) return
        if (channelId in preferences?.mutedChannelIds.orEmpty()) return
        // Quiet hours are minutes on this phone's clock, which is why the
        // server sent the push and left the decision here.
        if (PushGate.quiet(preferences)) return

        // Names for the conversation come out of the workspace, which a cold
        // process fills from its local cache before it asks the network.
        runCatching { withTimeoutOrNull(REFRESH_MS) { Workspace.refresh() } }

        val plaintext = runCatching { E2ee.decryptForChannel(channelId, content) }.getOrNull()
        val body = plaintext?.let { MessageBody.decode(it) }

        // A mentions-only channel: the mention is inside the body, so this is
        // the first moment anybody could have checked. An unreadable body in
        // such a channel stays silent - guessing loudly is the worse mistake.
        if (data["mentionsOnly"] == "1") {
            val text = body?.text ?: return
            if (!PushGate.mentions(text, self)) return
        }

        val text = describe(body)
        val image = body?.attachments?.firstOrNull { it.isImage }?.let { attachment ->
            runCatching {
                withTimeoutOrNull(ATTACHMENT_MS) {
                    MessageNotifications.decodeForNotification(
                        Conversation.openAttachment(channelId, attachment),
                    )
                }
            }.getOrNull()
        }

        MessageNotifications.show(
            context = applicationContext,
            channelId = channelId,
            messageId = data["messageId"].orEmpty(),
            conversationTitle = PushGate.conversationTitle(channelId),
            isGroup = PushGate.isGroup(channelId),
            selfName = self.label,
            authorId = authorId,
            authorName = data["authorName"].orEmpty().ifBlank { "Someone" },
            authorAvatar = avatar(data["authorAvatarUrl"]),
            text = text,
            at = System.currentTimeMillis(),
            image = image,
        )

        // The badge, so opening the app agrees with the notification that woke
        // it. Harmless when the socket already counted it: the same channel is
        // marked read the moment it is opened.
        Workspace.noteUnread(channelId, 1)
    }

    /**
     * What to show when there are no words.
     *
     * An undecryptable body is not an error to hide: this device has not been
     * given the channel key yet, and saying so is better than a notification
     * that reads as an empty message.
     */
    private fun describe(body: MessageBody?): String {
        if (body == null) return "New message"
        val attachments = body.attachments
        if (body.text.isNotBlank()) return body.text
        val picture = attachments.count { it.isImage }
        val video = attachments.count { it.isVideo }
        return when {
            picture > 0 && video == 0 -> if (picture == 1) "Photo" else "$picture photos"
            video > 0 && picture == 0 -> if (video == 1) "Video" else "$video videos"
            attachments.isNotEmpty() -> "${attachments.size} attachments"
            else -> "New message"
        }
    }

    /** The sender's picture, which is stored in the clear and is just a URL. */
    private fun avatar(url: String?): Bitmap? {
        if (url.isNullOrBlank()) return null
        return runCatching {
            val response = Http.get(url)
            if (response.status !in 200..299) return null
            MessageNotifications.decodeForNotification(response.bytes, maxPixels = 128)
        }.getOrNull()
    }

    companion object {
        /**
         * FCM allows around twenty seconds of work for a high-priority message.
         * Fifteen leaves room to post the notification after the budget is up
         * rather than being killed mid-decrypt.
         */
        private const val BUDGET_MS = 15_000L
        private const val REFRESH_MS = 4_000L
        private const val ATTACHMENT_MS = 8_000L

        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    }
}
