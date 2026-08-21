package com.aatech.betweenus.feature.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import com.aatech.betweenus.core.data.AuthPhase
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.store.Conversation
import com.aatech.betweenus.feature.chat.Outbox
import com.aatech.betweenus.core.store.Workspace
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * What the buttons on a message notification do.
 *
 * All three are broadcasts and none of them opens the app: replying from the
 * shade that opens a chat screen is not replying from the shade. `goAsync` is
 * what buys the time to seal the reply and post it - a receiver's `onReceive`
 * returning is Android's cue that the process may go, and encrypting and
 * sending is a network round trip.
 */
class NotificationActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val channelId = intent.getStringExtra(EXTRA_CHANNEL_ID) ?: return
        val application = context.applicationContext

        when (intent.action) {
            ACTION_DISMISS -> {
                // Swiped away: forget the thread so the next message starts a
                // fresh one rather than re-posting what was dismissed.
                MessageNotifications.clear(application, channelId)
                return
            }

            ACTION_MARK_READ -> {
                val pending = goAsync()
                scope.launch {
                    try {
                        withTimeoutOrNull(TIMEOUT_MS) {
                            PushGate.ensureSession()
                            Workspace.markRead(channelId)
                        }
                        MessageNotifications.clear(application, channelId)
                    } finally {
                        pending.finish()
                    }
                }
                return
            }

            ACTION_REPLY -> {
                val text = RemoteInput.getResultsFromIntent(intent)
                    ?.getCharSequence(MessageNotifications.REPLY_KEY)
                    ?.toString()
                    ?.trim()
                    .orEmpty()
                if (text.isEmpty()) return

                val pending = goAsync()
                scope.launch {
                    try {
                        val sent = withTimeoutOrNull(TIMEOUT_MS) {
                            PushGate.ensureSession() ?: return@withTimeoutOrNull false
                            runCatching { Conversation.send(channelId, text, emptyList()) }.isSuccess
                        } ?: false

                        // Offline, or the send failed: the words are kept on
                        // disk and go out on the next network rather than
                        // disappearing, which is what used to happen and
                        // happened without a word.
                        if (!sent) Outbox.enqueueText(application, channelId, text)

                        val self = (Session.state.value as? AuthPhase.SignedIn)?.user
                        if (self != null) {
                            // Shown back in the thread, which is what makes a
                            // reply from the shade feel like it went anywhere.
                            MessageNotifications.noteOwnReply(
                                context = application,
                                channelId = channelId,
                                conversationTitle = PushGate.conversationTitle(channelId),
                                isGroup = PushGate.isGroup(channelId),
                                selfName = self.label,
                                // Said plainly while it is still queued: a
                                // reply shown as sent and then not sent is the
                                // failure this whole change is about.
                                text = if (sent) text else "$text (sending…)",
                            )
                            // The reply is the read: nobody replies to a
                            // conversation and then wants it still unread.
                            if (sent) Workspace.markRead(channelId)
                        }
                    } finally {
                        pending.finish()
                    }
                }
            }
        }
    }

    companion object {
        const val ACTION_REPLY = "com.aatech.betweenus.notification.REPLY"
        const val ACTION_MARK_READ = "com.aatech.betweenus.notification.MARK_READ"
        const val ACTION_DISMISS = "com.aatech.betweenus.notification.DISMISS"
        const val EXTRA_CHANNEL_ID = "channelId"

        /**
         * A broadcast receiver is given about ten seconds. Sealing a message
         * and posting it is well inside that on any working connection, and
         * giving up is better than being killed halfway.
         */
        private const val TIMEOUT_MS = 8_000L

        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    }
}
