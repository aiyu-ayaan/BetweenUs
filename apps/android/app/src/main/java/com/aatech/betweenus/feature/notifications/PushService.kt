package com.aatech.betweenus.feature.notifications

import android.graphics.Bitmap
import com.aatech.betweenus.core.crypto.E2ee
import com.aatech.betweenus.core.data.Http
import com.aatech.betweenus.core.data.MessageBody
import com.aatech.betweenus.core.data.PushTokens
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
        if (data["type"] != "message.created") return
        runBlocking { withTimeoutOrNull(BUDGET_MS) { handle(data) } }
    }

    private suspend fun handle(data: Map<String, String>) {
        val channelId = data["channelId"] ?: return
        val authorId = data["authorId"] ?: return
        val content = data["content"] ?: return

        // Somebody's own message, sent from their other machine. It is already
        // on their screen everywhere it matters.
        val selfId = (com.aatech.betweenus.core.data.Session.state.value
            as? com.aatech.betweenus.core.data.AuthPhase.SignedIn)?.user?.id
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
