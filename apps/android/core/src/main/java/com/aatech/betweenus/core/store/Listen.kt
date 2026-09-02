package com.aatech.betweenus.core.store

import com.aatech.betweenus.core.data.CallSocket
import com.aatech.betweenus.core.data.ServerClock
import com.aatech.betweenus.core.data.map
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

/**
 * Listen Together, on the phone.
 *
 * The desktop's `apps/desktop/src/stores/listen.ts`, minus the player: this
 * phase gives the phone a seat at the table rather than a second sound system.
 * What arrives here is the whole session as the gateway holds it - the queue,
 * which track, whether it is paused and where the needle was - so the phone can
 * show what the room is listening to and take part in deciding it.
 *
 * The models, the formula and the store are one file on purpose. They are one
 * feature and the formula is the only part with a bug worth catching, so
 * keeping it beside what it describes is cheaper to read than a data class in
 * `Models.kt`, a store here and a helper somewhere third.
 *
 * ## Nothing here plays anything yet
 *
 * Deliberate, and it is the next item rather than an oversight. A phone that
 * can see the stage and skip a track it is tired of is most of the value of
 * being in the session; a player is a WebView, the IFrame API and a sync loop,
 * and shipping it half-built would mean audio that drifts silently - the one
 * failure mode a listening session cannot survive.
 */

/** One queue entry. The same video may be queued twice, so [id] is not [ref]. */
data class ListenTrack(
    val id: String,
    val provider: String,
    /** The provider's own id - for YouTube, the eleven-character video id. */
    val ref: String,
    /**
     * What to call it on screen, filled in by the first client whose player
     * learns it. Blank until then, and blank for ever if only phones are
     * present - nothing on the server may ask YouTube what a video is called.
     */
    val title: String,
    /** Milliseconds; 0 until some player has reported it. */
    val durationMs: Long,
    val addedByUserId: String,
    val addedByUsername: String,
) {
    companion object {
        fun from(json: JSONObject) = ListenTrack(
            id = json.optString("id"),
            provider = json.optString("provider"),
            ref = json.optString("ref"),
            title = json.optString("title"),
            durationMs = json.optLong("durationMs"),
            addedByUserId = json.optString("addedByUserId"),
            addedByUsername = json.optString("addedByUsername"),
        )
    }
}

/**
 * The session as the gateway holds it.
 *
 * [positionMs] is where the track was at [atServerMs], **not** where it is now.
 * That distinction is the whole design: a position that meant "now" would be
 * stale by its own network delay, and every client would be behind by a
 * different amount.
 */
data class ListenSession(
    /**
     * Bumped by the gateway on every change. A client drops any state carrying
     * a revision it has already seen, so its own echo cannot undo somebody
     * else's later change.
     */
    val rev: Int,
    val queue: List<ListenTrack>,
    val index: Int,
    val paused: Boolean,
    val positionMs: Long,
    /** The gateway's clock when this state was made. */
    val atServerMs: Long,
    /** Who last touched it, for the line that says who skipped. */
    val byUserId: String?,
) {
    val current: ListenTrack? get() = queue.getOrNull(index)

    companion object {
        fun from(json: JSONObject) = ListenSession(
            rev = json.optInt("rev"),
            queue = json.optJSONArray("queue")?.map { ListenTrack.from(it) }.orEmpty(),
            index = json.optInt("index"),
            paused = json.optBoolean("paused"),
            positionMs = json.optLong("positionMs"),
            atServerMs = json.optLong("atServerMs"),
            byUserId = if (json.isNull("byUserId")) null else json.optString("byUserId"),
        )
    }
}

/**
 * Where the needle is at [nowMs], on a clock shared with the gateway.
 *
 * The Kotlin half of `listenPositionAt` in `packages/shared-types`, and it has
 * to agree with it to the millisecond. It is the entire meaning of
 * [ListenSession.positionMs] and [ListenSession.atServerMs]: a client that
 * advanced the position differently from the others would be one where nobody
 * is wrong and nobody agrees.
 *
 * Clamped to the track's length once one is known, so a session left playing
 * while everybody was away does not report a position in the next hour.
 */
fun listenPositionAt(session: ListenSession, nowMs: Long): Long {
    val elapsed = if (session.paused) 0L else maxOf(0L, nowMs - session.atServerMs)
    val raw = session.positionMs + elapsed
    val duration = session.current?.durationMs ?: 0L
    return if (duration > 0) minOf(raw, duration) else maxOf(0L, raw)
}

/**
 * What the call is listening to, and the controls anybody in it may use.
 *
 * An object rather than a class because a call is a singleton on this client -
 * the same reasoning `VoiceEngine` and `Conversation` are built on.
 */
object Listen {
    private val _session = MutableStateFlow<ListenSession?>(null)
    val session: StateFlow<ListenSession?> = _session.asStateFlow()

    private var wired = false

    /**
     * Subscribes to the call socket. Idempotent: a reconnect must not add a
     * second listener, which would apply every state twice.
     */
    fun start() {
        if (wired) return
        wired = true
        CallSocket.on { event ->
            if (event.optString("type") != "listen.state") return@on
            val session = event.optJSONObject("session")?.let { ListenSession.from(it) }
            apply(session)
        }
    }

    /**
     * One state from the gateway.
     *
     * An older revision is dropped rather than applied. Two people pressing
     * pause at the same moment produce two states, and without this the one
     * that happens to arrive second wins regardless of which the gateway
     * decided - which is a queue that jumps backwards under somebody's thumb.
     *
     * A null session is the end of the session and always applies: there is no
     * revision on "there is nothing playing", and refusing it would leave a
     * dead track on screen for ever.
     */
    internal fun apply(session: ListenSession?) {
        if (session == null) {
            _session.value = null
            return
        }
        val held = _session.value
        if (held != null && session.rev <= held.rev) return
        _session.value = session
    }

    /** The call ended, or this client left it. Nothing is playing to anybody here. */
    fun clear() {
        _session.value = null
    }

    /** Where the needle is right now, on the server's clock rather than this phone's. */
    fun positionNow(): Long =
        _session.value?.let { listenPositionAt(it, ServerClock.nowMs()) } ?: 0L

    // --- what anybody in the call may do -------------------------------------
    //
    // Every one of these is a request, never a local change. The gateway is the
    // only thing that can order two people pressing skip at the same instant,
    // and a client that moved its own queue first would disagree with everyone
    // for as long as it took the answer to arrive.

    fun skip(delta: Int) = CallSocket.send(
        JSONObject().put("type", "listen.skip").put("delta", delta),
    )

    fun pause() = CallSocket.send(
        JSONObject().put("type", "listen.pause").put("positionMs", positionNow()),
    )

    fun resume() = CallSocket.send(JSONObject().put("type", "listen.play"))

    fun playAt(index: Int) = CallSocket.send(
        JSONObject().put("type", "listen.play").put("index", index),
    )

    fun remove(trackId: String) = CallSocket.send(
        JSONObject().put("type", "listen.remove").put("trackId", trackId),
    )

    fun stop() = CallSocket.send(JSONObject().put("type", "listen.stop"))

    /**
     * What a player learned about a track, for everybody who has not got one.
     *
     * Nothing on the server may ask YouTube what a video is called - that would
     * be a backend service with an API key, an egress rule and an opinion about
     * who is listening to what. So the first client whose player loads the
     * video fills the title and length in for the session, and now a phone can
     * be that client rather than only a desktop.
     *
     * Sent once per track by this client; the gateway ignores a second one for
     * a track that already has both, and telling it twice would only make every
     * other client re-read a state that did not change.
     */
    fun reportMeta(trackId: String, title: String?, durationMs: Long?) {
        val event = JSONObject().put("type", "listen.meta").put("trackId", trackId)
        title?.takeIf { it.isNotBlank() }?.let { event.put("title", it) }
        durationMs?.takeIf { it > 0 }?.let { event.put("durationMs", it) }
        CallSocket.send(event)
    }

    /**
     * This player reached the end of a track.
     *
     * Named rather than implied, because several clients finish within a second
     * of each other and the gateway has to advance the queue exactly once. It
     * ignores an `ended` for a track that is no longer current, which is what
     * makes the second and third reports harmless.
     */
    fun reportEnded(trackId: String) = CallSocket.send(
        JSONObject().put("type", "listen.ended").put("trackId", trackId),
    )
}
