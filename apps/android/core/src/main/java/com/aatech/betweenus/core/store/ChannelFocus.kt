package com.aatech.betweenus.core.store

import com.aatech.betweenus.core.data.PresenceSocket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Telling the server which conversation is on this screen.
 *
 * The other half of the rule [PushGate] applies locally, and the half only a
 * server can apply: a message in a channel somebody is reading on their laptop
 * should not wake the phone in their pocket. `notification-service` asks
 * presence-service who has a channel focused before it fans a push out - see
 * `push-suppression.md`.
 *
 * Two facts make a focus, and both already exist here: which conversation is
 * open ([Conversation.visibleChannelId]) and whether the app is in front of
 * anybody ([AppForeground]). A phone locked mid-conversation is not somebody
 * reading it - the chat screen is still composed behind the lock screen, which
 * is exactly the case that would otherwise go silent forever.
 *
 * ponytail: no lifecycle observers of its own. Both facts are already tracked
 * for the local rule; this only reports them.
 */
object ChannelFocus {

    /**
     * Well inside presence-service's 90-second staleness window. The socket's
     * own heartbeat refreshes the entry too; this covers a reconnect that
     * landed on a different presence instance.
     */
    private const val HEARTBEAT_MS = 60_000L

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** What the server has been told, so nothing is said twice. */
    @Volatile
    private var reported: String? = null

    private var started = false

    fun init() {
        if (started) return
        started = true

        // Re-asserted on every reconnect, like the status and the call join: the
        // server keeps nothing across connections, and a focus that is not
        // re-sent ages out into a phone that starts buzzing for a conversation
        // that is still on screen.
        PresenceSocket.onReconnect = {
            reported = null
            apply()
        }

        scope.launch {
            while (true) {
                delay(HEARTBEAT_MS)
                // Re-sent rather than skipped when nothing has changed: this is
                // the heartbeat, and saying the same thing again is its job.
                reported?.let { PresenceSocket.focus(it) }
            }
        }
    }

    /**
     * Called whenever either half of the fact changes - a channel opened or
     * closed, or the app coming to the front or going away.
     */
    fun apply() {
        val next = if (AppForeground.visible) Conversation.visibleChannelId else null
        val previous = reported
        if (next == previous) return

        // The old channel is blurred rather than left to expire: ninety seconds
        // of a stale focus is ninety seconds of missed notifications for a
        // conversation this phone has already left.
        if (previous != null) PresenceSocket.blur(previous)
        if (next != null) PresenceSocket.focus(next)
        reported = next
    }

    /** Signing out: this account is not reading anything any more. */
    fun forget() {
        reported?.let { PresenceSocket.blur(it) }
        reported = null
    }
}
