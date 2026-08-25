package com.aatech.betweenus.feature.notifications

import com.aatech.betweenus.core.data.AuthPhase
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.NotificationPreferences
import com.aatech.betweenus.core.data.PublicUser
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.store.AppForeground
import com.aatech.betweenus.core.store.Conversation
import com.aatech.betweenus.core.store.Workspace
import kotlinx.coroutines.withTimeoutOrNull
import java.time.LocalTime

/**
 * The decisions a push has to make before it is allowed to become a sound.
 *
 * The server already refused the ones it could answer - the account with
 * notifications off, a muted channel, a muted person. What is left here is
 * everything a server cannot know: whether this conversation is on screen right
 * now, whether it is the middle of the night *where this phone is*, and whether
 * a mentions-only channel actually mentioned anybody - which is inside the
 * ciphertext and therefore nobody's business but this device's.
 */
object PushGate {

    /**
     * A cold process woken by a push has a session on disk and none in memory.
     *
     * Restoring it is what makes the message readable at all: without an access
     * token there is no channel key to fetch and no way to answer a reply. It
     * is one refresh round trip and only happens when the app was not already
     * running.
     *
     * Bounded, because a restore is no longer a single attempt: a server that
     * cannot be reached is retried rather than treated as a session that ended,
     * and a push handler must not sit inside that loop. The system gives this
     * callback seconds, not minutes. Giving up here costs one notification's
     * decryption and nothing else - the retry carries on in the background and
     * the session is there by the time anybody opens the app.
     */
    suspend fun ensureSession(): PublicUser? {
        (Session.state.value as? AuthPhase.SignedIn)?.let { return it.user }
        withTimeoutOrNull(RESTORE_BUDGET_MS) { Session.restore() }
        return (Session.state.value as? AuthPhase.SignedIn)?.user
    }

    /** How long a push may wait for a cold session before it goes on without one. */
    private const val RESTORE_BUDGET_MS = 10_000L

    /** The name at the top of the notification: `#general`, or a person. */
    fun conversationTitle(channelId: String): String =
        Workspace.channel(channelId)?.name?.let { "#$it" }
            ?: Workspace.directChannel(channelId)?.participant?.label
            ?: "New message"

    /**
     * A channel is a group conversation and a DM is not, which is what decides
     * whether Android draws the conversation title above the messages.
     */
    fun isGroup(channelId: String): Boolean = Workspace.channel(channelId)?.serverId != null

    /**
     * The account's preferences, cached briefly.
     *
     * They are fetched over the network, and a push is exactly the moment a
     * network call is expensive - the phone is asleep and every millisecond is
     * one the system may not give back. A few minutes of staleness costs one
     * notification somebody has just muted; fetching on every message costs a
     * round trip per message.
     */
    private const val PREFERENCES_TTL_MS = 5 * 60 * 1000L

    @Volatile
    private var preferences: NotificationPreferences? = null

    @Volatile
    private var fetchedAt = 0L

    suspend fun preferences(): NotificationPreferences? {
        val cached = preferences
        if (cached != null && System.currentTimeMillis() - fetchedAt < PREFERENCES_TTL_MS) return cached
        val fresh = runCatching { BetweenUsApi.notificationPreferences() }.getOrNull() ?: return cached
        preferences = fresh
        fetchedAt = System.currentTimeMillis()
        return fresh
    }

    fun forgetPreferences() {
        preferences = null
        fetchedAt = 0L
    }

    /**
     * Quiet hours, on this phone's clock.
     *
     * Stored as minutes from midnight precisely so the server never has to know
     * a timezone - which means this is the only side that can apply them. A
     * window is allowed to wrap midnight: 1320 to 480 is 22:00 to 08:00, and
     * the comparison flips when it does.
     */
    fun quiet(preferences: NotificationPreferences?, now: LocalTime = LocalTime.now()): Boolean {
        val start = preferences?.quietStartMinute ?: return false
        val end = preferences.quietEndMinute ?: return false
        val minute = now.hour * 60 + now.minute
        return if (start <= end) minute in start until end else minute >= start || minute < end
    }

    /**
     * Whether a message mentions this account.
     *
     * `@username`, `@display name`, and the two everybody-shaped ones. Decided
     * here because it can only be decided here: the body is sealed, so no
     * service has ever seen these words.
     */
    fun mentions(text: String, self: PublicUser): Boolean {
        val body = text.lowercase()
        return named(body, "everyone") ||
            named(body, "here") ||
            named(body, self.username) ||
            named(body, self.displayName)
    }

    /**
     * `@name`, where the name ends. Without the boundary, `@adam` mentions Ada
     * and every message from a colleague with a longer name wakes her phone.
     */
    private fun named(body: String, name: String): Boolean {
        if (name.isBlank()) return false
        return Regex("@${Regex.escape(name.lowercase())}(?![a-z0-9_.-])").containsMatchIn(body)
    }

    /**
     * The WhatsApp rule: whether a push for [channelId] should be suppressed because
     * the user is actively viewing that exact chat right now in the foreground.
     *
     * If the user is looking at Server 1 #general (visibleChannelId == "chan_general_1"),
     * a message in that same channel is dropped silently because it's already rendered on screen.
     * A message in Server 2 #general (channelId == "chan_general_2") or any other channel
     * is not suppressed and will post a push notification.
     */
    fun shouldSuppress(
        channelId: String,
        isForeground: Boolean = AppForeground.visible,
        visibleChannelId: String? = Conversation.visibleChannelId,
    ): Boolean = isForeground && visibleChannelId == channelId
}

