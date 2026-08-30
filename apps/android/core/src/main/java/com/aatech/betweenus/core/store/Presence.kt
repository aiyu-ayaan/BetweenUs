package com.aatech.betweenus.core.store

import com.aatech.betweenus.core.data.PresenceSocket
import com.aatech.betweenus.core.data.PresenceStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Who is online, who is typing, and who is in which voice channel.
 *
 * The port of `apps/desktop/src/stores/presence.ts`. A typing indicator is
 * given a lifetime here rather than by the server: the protocol only says
 * "somebody typed", and a client that never expires that shows a phantom
 * indicator forever if the person closes their laptop mid-word.
 */
object Presence {
    private const val TYPING_LIFETIME_MS = 6_000L

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val _statuses = MutableStateFlow<Map<String, PresenceStatus>>(emptyMap())
    val statuses: StateFlow<Map<String, PresenceStatus>> = _statuses.asStateFlow()

    /** Usernames typing, per channel. */
    private val _typing = MutableStateFlow<Map<String, Set<String>>>(emptyMap())
    val typing: StateFlow<Map<String, Set<String>>> = _typing.asStateFlow()

    /** User ids in each voice channel. */
    private val _voice = MutableStateFlow<Map<String, List<String>>>(emptyMap())
    val voice: StateFlow<Map<String, List<String>>> = _voice.asStateFlow()

    /**
     * userId -> when that person was last here, ISO-8601.
     *
     * Only filled for people who are away: the server sends no timestamp for
     * anybody online, because "online, last seen a moment ago" says one thing
     * twice and the second half is the half that goes stale.
     */
    private val _lastSeen = MutableStateFlow<Map<String, String>>(emptyMap())
    val lastSeen: StateFlow<Map<String, String>> = _lastSeen.asStateFlow()

    private val _self = MutableStateFlow(PresenceStatus.ONLINE)
    val self: StateFlow<PresenceStatus> = _self.asStateFlow()

    private var wired = false
    private var lastTypingSentAt = 0L

    fun start() {
        if (wired) return
        wired = true
        PresenceSocket.on { event ->
            when (event.optString("type")) {
                "status.self" -> _self.value = PresenceStatus.of(event.optString("status"))

                "presence.sync" -> {
                    val users = event.optJSONArray("users")
                    val next = mutableMapOf<String, PresenceStatus>()
                    if (users != null) {
                        for (index in 0 until users.length()) {
                            val user = users.getJSONObject(index)
                            next[user.optString("userId")] =
                                PresenceStatus.of(user.optString("status"))
                        }
                    }
                    _statuses.value = next

                    val voice = event.optJSONArray("voice")
                    val rooms = mutableMapOf<String, List<String>>()
                    if (voice != null) {
                        for (index in 0 until voice.length()) {
                            val room = voice.getJSONObject(index)
                            val ids = room.optJSONArray("userIds")
                            rooms[room.optString("channelId")] =
                                (0 until (ids?.length() ?: 0)).map { ids!!.getString(it) }
                        }
                    }
                    _voice.value = rooms
                }

                "presence.changed" -> event.optJSONObject("user")?.let { user ->
                    val userId = user.optString("userId")
                    _statuses.update { it + (userId to PresenceStatus.of(user.optString("status"))) }

                    // Kept rather than replaced when the event carries nothing:
                    // somebody coming online sends no timestamp, and dropping
                    // the old one would leave the line under their name blank
                    // for the rest of the session once they went away again.
                    val seen = user.optString("lastSeenAt")
                    if (seen.isNotBlank()) _lastSeen.update { it + (userId to seen) }
                }

                "voice.changed" -> event.optJSONObject("voice")?.let { room ->
                    val ids = room.optJSONArray("userIds")
                    _voice.update {
                        it + (room.optString("channelId") to
                            (0 until (ids?.length() ?: 0)).map { index -> ids!!.getString(index) })
                    }
                }

                "typing" -> {
                    val channelId = event.optString("channelId")
                    val username = event.optString("username")
                    _typing.update { it + (channelId to (it[channelId].orEmpty() + username)) }
                    scope.launch {
                        delay(TYPING_LIFETIME_MS)
                        _typing.update { it + (channelId to (it[channelId].orEmpty() - username)) }
                    }
                }
            }
        }
    }

    fun stop() {
        _statuses.value = emptyMap()
        _typing.value = emptyMap()
        _voice.value = emptyMap()
        _lastSeen.value = emptyMap()
    }

    fun statusOf(userId: String): PresenceStatus = _statuses.value[userId] ?: PresenceStatus.OFFLINE

    fun lastSeenOf(userId: String): String? = _lastSeen.value[userId]

    /**
     * "When were these people last here?"
     *
     * Called when a conversation goes on screen or a profile sheet opens. A
     * `presence.sync` carries only the people who *are* here, so the one case
     * a last-seen line exists for is the one case the socket says nothing about
     * until it is asked.
     */
    fun askLastSeen(userIds: List<String>) = PresenceSocket.query(userIds.filter { it.isNotBlank() })

    fun setStatus(status: PresenceStatus) {
        _self.value = status
        PresenceSocket.setStatus(status)
    }

    /**
     * Throttled: the composer calls this on every keystroke, and the indicator
     * lives for six seconds, so one event every three is more than enough.
     */
    fun noteTyping(channelId: String) {
        val now = System.currentTimeMillis()
        if (now - lastTypingSentAt < 3_000) return
        lastTypingSentAt = now
        PresenceSocket.typing(channelId)
    }

    fun voiceMembers(channelId: String): List<String> = _voice.value[channelId].orEmpty()
}
