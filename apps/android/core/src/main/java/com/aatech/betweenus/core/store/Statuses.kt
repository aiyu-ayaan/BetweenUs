package com.aatech.betweenus.core.store

import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.ChatSocket
import com.aatech.betweenus.core.data.AuthPhase
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.data.StatusEntry
import com.aatech.betweenus.core.data.StatusKind
import com.aatech.betweenus.core.data.StatusRun
import com.aatech.betweenus.core.data.StatusViewer
import com.aatech.betweenus.core.crypto.E2ee
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The status tray: posts that expire after a day, from accepted friends.
 *
 * The port of `apps/desktop/src/stores/status.ts`, and an object rather than a
 * ViewModel for the same reason [Workspace] is - a socket saying somebody
 * posted has to land somewhere whatever screen is in front of the user.
 *
 * The whole tray is one call and it is re-read rather than patched, which is
 * the bargain the friend list already makes: it is small, it changes rarely,
 * and `seen` and `viewCount` differ per reader - so a carried event would be a
 * different payload per recipient composed on the server.
 *
 * The one thing held locally is which posts *this* device has opened. The
 * server is told immediately, but the ring has to stop glowing under the
 * reader's thumb rather than a round trip later.
 */
object Statuses {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** This account's own live posts, oldest first. */
    private val _mine = MutableStateFlow<List<StatusEntry>>(emptyList())
    val mine: StateFlow<List<StatusEntry>> = _mine.asStateFlow()

    private val _runs = MutableStateFlow<List<StatusRun>>(emptyList())

    /** Everybody else's runs, unopened first, with this device's looks folded in. */
    val runs: StateFlow<List<StatusRun>> = _runs.asStateFlow()

    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    private val _loaded = MutableStateFlow(false)

    /** Whether the tray has been read once, so an empty one can say it is empty. */
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    /** Posts this device has opened since it started. See the note above. */
    private val seenHere = MutableStateFlow<Set<String>>(emptySet())

    /**
     * The tray exactly as the server sent it, before this device's own looks
     * are folded in. Kept apart from [runs] so a fresh look re-derives rather
     * than editing what the server said - which is what makes a refresh and a
     * local look compose instead of overwriting each other.
     */
    private var _received: List<StatusRun> = emptyList()

    private var wired = false

    /** Called once a session exists. Idempotent - a reconnect must not re-wire. */
    fun start() {
        if (!wired) {
            wired = true
            ChatSocket.on { event ->
                if (event.optString("type") == "status.changed") scope.launch { refresh() }
            }
            // A phone that was out of signal missed whatever was announced while
            // it was, and nothing replays it. One call covers all of it.
            ChatSocket.onConnection { up -> if (up) scope.launch { refresh() } }
        }
        scope.launch { refresh() }
    }

    fun stop() {
        _mine.value = emptyList()
        _received = emptyList()
        _runs.value = emptyList()
        _loaded.value = false
        _error.value = null
        seenHere.value = emptySet()
    }

    /** Re-reads the tray. Cheap enough to call on resume and on reconnect. */
    suspend fun refresh() {
        _loading.value = true
        runCatching { BetweenUsApi.statusFeed() }
            .onSuccess { feed ->
                // Captions are opened once, here, rather than where each is
                // drawn: decryption suspends and the tray, the player and the
                // content descriptions do not. A post this phone holds no key
                // for keeps the padlock and is drawn like any other, because a
                // friendship younger than the post is not an error.
                _mine.value = feed.mine.map { open(it) }
                _received = feed.others.map { run -> run.copy(statuses = run.statuses.map { open(it) }) }
                _error.value = null
            }
            // A deployment that has not been migrated yet answers 404 here, and
            // a missing tray is not a reason for the home screen to fail.
            .onFailure { _error.value = it.message }
        _loading.value = false
        _loaded.value = true
        recompute()
    }

    /**
     * Posts one, and puts it in the tray without waiting for the announcement
     * to come back around - the poster is looking at the row they posted into.
     */
    suspend fun post(
        kind: StatusKind,
        caption: String? = null,
        background: String? = null,
        durationMs: Long? = null,
        media: ByteArray? = null,
        mediaContentType: String? = null,
    ) {
        // Normalised before it is sealed, never after: once it is ciphertext
        // nobody - here or on the server - can tell what it was. A phone camera
        // writes HEIC, no browser has ever decoded one, and a moment posted
        // from here drew as a broken image on the desktop for exactly as long
        // as this line was missing. See [Photos.asJpeg], which the attachment
        // sender has always gone through.
        val photo = media?.let { Photos.asJpeg(it, mediaContentType.orEmpty()) }
        val payload = photo?.bytes ?: media
        // The directory is read now rather than held: this list is the
        // audience, as it stands at the moment of posting, which is what makes
        // a friendship made afterwards not a way into what was posted before
        // it. See `E2ee.sealStatus`.
        val sealed = E2ee.sealStatus(caption, payload, BetweenUsApi.statusAudience())
        val entry = BetweenUsApi.postStatus(
            kind = kind,
            caption = sealed.caption,
            background = background,
            durationMs = durationMs,
            media = sealed.media?.ciphertext,
            mediaIv = sealed.media?.iv,
            // What was converted has to say so: the type is the only hint the
            // reader's decoder gets, and one that lies is worse than none.
            mediaType = if (photo != null) "image/jpeg" else mediaContentType,
            senderDeviceId = sealed.senderDeviceId,
            keys = sealed.keys,
        )
        // With the caption that was typed, not the envelope that came back:
        // this phone has the words already.
        _mine.update { it + entry.copy(caption = caption) }
    }

    /**
     * How many posts are still going up. Nothing waits on this - it is what the
     * tray puts under "My moments" while the uplink catches up.
     */
    private val _posting = MutableStateFlow(0)
    val posting: StateFlow<Int> = _posting.asStateFlow()

    /**
     * Posts on the store's own scope rather than the composer's.
     *
     * Sealing and uploading a photo is seconds, and a clip is minutes. That
     * used to run on the composer's scope, which meant the composer had to stay
     * on screen saying "Posting…" for the whole of it - and cancelled the
     * upload if the user backed out of it. The screen is free the moment this
     * is called; what is left of the work outlives it, and each post appears in
     * the tray as it lands.
     *
     * [work] must not close over a Composable's state or an Activity: it is
     * still running after both are gone.
     */
    fun postInBackground(work: suspend () -> Unit) {
        _posting.update { it + 1 }
        scope.launch {
            runCatching { work() }
                .onFailure { _error.value = it.message ?: "That could not be posted" }
            _posting.update { it - 1 }
        }
    }

    /** One post with its caption opened. See the note in [refresh]. */
    private suspend fun open(post: StatusEntry): StatusEntry =
        post.copy(caption = E2ee.openStatusCaption(post))

    /**
     * Records a look, here and on the server.
     *
     * Locally first and unconditionally: the ring has to stop glowing as the
     * post opens. The call behind it is fire-and-forget - a failed marker means
     * the run reads as unwatched again next launch, which is smaller than a
     * viewer that will not advance because a request is in flight.
     */
    fun markSeen(statusId: String) {
        if (statusId in seenHere.value) return
        seenHere.update { it + statusId }
        recompute()
        scope.launch { runCatching { BetweenUsApi.markStatusSeen(statusId) } }
    }

    /**
     * Says one symbol back to somebody's post, or takes it back by sending the
     * same one again.
     *
     * Applied here as well as sent: what is drawn as picked is the reader's own
     * [StatusEntry.myReaction], and a picker that waits for a round trip to
     * light up feels broken on a slow line. The author's tally is recomputed
     * from the announcement this write causes.
     */
    suspend fun react(statusId: String, emoji: String) {
        toggle(statusId, emoji)
        // Applying the same toggle twice is what undoes it, so a failure only
        // has to run it again.
        runCatching { BetweenUsApi.reactToStatus(statusId, emoji) }
            .onFailure { toggle(statusId, emoji) }
    }

    private fun toggle(statusId: String, emoji: String) {
        fun at(posts: List<StatusEntry>) = posts.map { post ->
            if (post.id != statusId) {
                post
            } else {
                post.copy(myReaction = if (post.myReaction == emoji) null else emoji)
            }
        }
        _mine.update { at(it) }
        _received = _received.map { run -> run.copy(statuses = at(run.statuses)) }
        recompute()
    }

    /** Who opened one of your posts, newest first, and what they said. */
    suspend fun viewersOf(statusId: String): List<StatusViewer> =
        BetweenUsApi.statusViewers(statusId)

    /** Takes one of your own down early. */
    suspend fun remove(statusId: String) {
        BetweenUsApi.deleteStatus(statusId)
        _mine.update { posts -> posts.filterNot { it.id == statusId } }
    }

    /** One person's run, or null when they have posted nothing live. */
    fun runOf(userId: String): StatusRun? = _runs.value.firstOrNull { it.author.id == userId }

    /**
     * One post by id, wherever it is - this account's own run or somebody
     * else's.
     *
     * Null is the ordinary answer here, not a failure: a moment lives for a day
     * and a message answering one lives as long as the conversation does, so a
     * conversation read next week is full of pointers at posts that are gone.
     * What draws for those is the other half of the block in the bubble.
     */
    fun entry(statusId: String): StatusEntry? =
        _mine.value.firstOrNull { it.id == statusId }
            ?: _runs.value.firstNotNullOfOrNull { run ->
                run.statuses.firstOrNull { it.id == statusId }
            }

    /**
     * How many posts to draw a ring around this person for, and whether any of
     * them is unopened. Zero means no ring at all.
     *
     * Asked by every avatar in the app, including ones that have never heard of
     * statuses, so it is a cheap lookup rather than a subscription per row.
     */
    fun ringFor(userId: String): Pair<Int, Boolean> {
        if (userId == (Session.state.value as? AuthPhase.SignedIn)?.user?.id) {
            return _mine.value.size to false
        }
        val run = runOf(userId) ?: return 0 to false
        return run.statuses.size to run.unseen
    }

    /**
     * Folds this device's own looks into the server's answer, and orders the
     * tray: unopened runs first, then newest first inside each half.
     *
     * That order is not a preference. Sorted purely by time, a run you have
     * already watched jumps above one you have not the moment its author posts
     * again, and the thing under your thumb stops being the thing you opened
     * the screen for.
     */
    private fun recompute() {
        val looked = seenHere.value
        _runs.value = _received
            .map { run ->
                val statuses = run.statuses.map { it.copy(seen = it.seen || it.id in looked) }
                run.copy(statuses = statuses, unseen = statuses.any { !it.seen })
            }
            // ISO-8601 in UTC sorts lexicographically, so the timestamps are
            // compared as strings rather than parsed back into instants.
            .sortedWith(compareByDescending<StatusRun> { it.unseen }.thenByDescending { it.latestAt })
    }
}
