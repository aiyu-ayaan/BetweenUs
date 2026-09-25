package com.aatech.betweenus.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.CopyOnWriteArraySet
import kotlin.math.min
import kotlin.math.pow

/**
 * A reconnecting JSON WebSocket.
 *
 * All four of BetweenUs's sockets - chat, presence, call signalling and remote -
 * are the same thing with different vocabularies: a token in the query string
 * (a WebSocket cannot set an Authorization header), JSON objects with a `type`,
 * and a close code of 4401 meaning the token was rejected and reconnecting
 * would only loop.
 *
 * The queue matters more here than on the desktop. A phone loses its connection
 * constantly - a lift, a train, a screen that went off - and a `send` that
 * silently did nothing while reconnecting is a message that vanishes.
 */
open class JsonSocket(private val path: String) {
    private var socket: WebSocket? = null
    private var token: String? = null
    private var attempt = 0
    private var closedByUs = false

    /**
     * Which attempt a callback belongs to.
     *
     * OkHttp goes on delivering from a socket that has been replaced: a
     * cancelled connection reports its failure whenever the far end gets round
     * to it, which is routinely after the connection that replaced it is up.
     * Without this it nulled the live socket's reference and scheduled a
     * reconnect on top of a working connection - one blip, and from then on two
     * sockets taking turns to report different states.
     *
     * Taken inside [open]'s lock, before OkHttp can deliver anything, so it is
     * an answer every callback can trust even while the field assignment behind
     * it is still happening on the thread that started the attempt.
     */
    @Volatile
    private var generation = 0

    /** Set while a [probe] is waiting for an answer, cleared by any frame. */
    @Volatile
    private var awaitingPong = false
    /** When this socket was last up, which is what the deadline measures from. */
    private var downSince: Long? = null
    private val listeners = CopyOnWriteArraySet<(JSONObject) -> Unit>()
    private val connectionListeners = CopyOnWriteArraySet<(Boolean) -> Unit>()

    /** Sent the moment the socket opens, in order. */
    private val pending = ArrayDeque<String>()

    @Volatile
    var connected: Boolean = false
        private set

    fun connect(token: String) {
        this.token = token
        closedByUs = false
        if (downSince == null && !connected) downSince = System.currentTimeMillis()
        open()
    }

    /**
     * Try now: the banner's button, and the app coming back to the screen.
     *
     * Whatever the backoff had climbed to belonged to a network that has been
     * replaced, so the ladder starts again at the bottom.
     *
     * A socket that is not *connected* is dropped and opened again, and that
     * part is the fix rather than an optimisation. A phone in the background is
     * one Android may stop from running anything at all: the reconnect thread
     * is held in doze, the keepalive ping never fires, and the connection dies
     * with neither end told. What comes back to the foreground is then either a
     * backoff frozen since last night or a `WebSocket` object that is a corpse
     * nothing has noticed - and the old test, `if (socket == null)`, did
     * nothing in both cases while having just announced "Reconnecting…". That
     * is a banner that stays up until the app is killed, and a button that
     * makes it worse.
     *
     * A socket that claims to be connected is asked to prove it rather than
     * believed. `connected` is a flag this process set when the socket last
     * opened, and a phone that has been asleep for an hour is exactly where it
     * is a lie: the OS tore the connection down, OkHttp's keepalive was frozen
     * with the rest of the process, and nothing has run since to notice. One
     * frame settles it - see [probe].
     */
    @Synchronized
    fun retry() {
        if (closedByUs || token == null) return
        attempt = 0
        if (connected) {
            probe()
            return
        }
        reopen()
    }

    /**
     * Throw away whatever is there and start again from the bottom of the
     * ladder.
     *
     * Cancelled rather than closed: a close is a handshake, and there may be
     * nothing at the other end left to complete it. The cancelled socket's
     * failure arrives later against a generation that has moved on and is
     * ignored, which is why what it was carrying is cleared here instead.
     */
    @Synchronized
    private fun reopen() {
        if (closedByUs || token == null) return
        val had = connected
        attempt = 0
        socket?.cancel()
        socket = null
        connected = false
        awaitingPong = false
        downSince = System.currentTimeMillis()
        log("retry")
        Connectivity.report(path, Connectivity.State.RECONNECTING)
        if (had) connectionListeners.forEach { it(false) }
        open()
    }

    /**
     * Asks the gateway to say something, and treats silence as a dead socket.
     *
     * All four gateways answer a `ping` with a `pong`, which makes it the one
     * question whose answer is visible from here: OkHttp's keepalive is a
     * protocol ping the application never sees, and a socket that stopped being
     * a socket while the phone was asleep goes on calling itself open until
     * something is actually written to it.
     *
     * Sent straight down the wire rather than through [send], because a ping
     * that gets queued for the next connection is a question nobody asked.
     */
    @Synchronized
    private fun probe() {
        val live = socket ?: return
        if (awaitingPong) return
        awaitingPong = true
        log("probe")
        live.send(JSONObject().put("type", "ping").toString())
        Thread {
            Thread.sleep(PONG_TIMEOUT_MS)
            synchronized(this) {
                if (!awaitingPong || socket !== live) return@synchronized
                log("probe unanswered")
                reopen()
            }
        }.apply { isDaemon = true }.start()
    }

    /**
     * Never the token, never a message body - see section 23 of CLAUDE.md. Just
     * enough to tell a socket that is refusing to open from one that opened and
     * was never spoken to, which is a distinction that cost a day.
     */
    private fun log(what: String) = android.util.Log.i("betweenus.socket", "$path $what")

    @Synchronized
    private fun open() {
        val token = this.token ?: return
        if (socket != null) return
        val mine = ++generation

        // The device goes with the token. `call-service` hangs a peer id on it,
        // so a peer keeps its name across a reconnect instead of arriving as a
        // stranger and making everybody rebuild their connection to it. Every
        // socket carries it; the ones that have no use for it ignore it.
        val url = buildString {
            append(Endpoint.webSocket())
            append(path)
            append("?token=")
            append(URLEncoder.encode(token, "UTF-8"))
            deviceId()?.let {
                append("&device=")
                append(URLEncoder.encode(it, "UTF-8"))
            }
        }
        socket = Http.client.newWebSocket(
            Request.Builder().url(url).build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    synchronized(this@JsonSocket) {
                        // An attempt that has already been replaced, arriving
                        // late. Letting it through would hand the app a second
                        // live socket delivering every message twice.
                        if (stale(mine)) {
                            webSocket.cancel()
                            return
                        }
                        log("open")
                        attempt = 0
                        downSince = null
                        awaitingPong = false
                        connected = true
                    }
                    Connectivity.report(path, Connectivity.State.ONLINE)
                    onConnected()
                    synchronized(this@JsonSocket) {
                        while (pending.isNotEmpty()) webSocket.send(pending.removeFirst())
                    }
                    connectionListeners.forEach { it(true) }
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (stale(mine)) return
                    // Any frame at all is proof of life, which is why a busy
                    // socket is never really probed: the messages are the
                    // answer, and the `pong` is nothing else's business.
                    awaitingPong = false
                    val event = runCatching { JSONObject(text) }.getOrNull() ?: return
                    listeners.forEach { it(event) }
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (stale(mine)) return
                    log("closed code=$code reason=$reason")
                    drop(mine, code)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (stale(mine)) return
                    log("failed http=${response?.code ?: 0} ${t.javaClass.simpleName}: ${t.message}")
                    drop(mine, response?.code ?: 0)
                }
            },
        )
    }

    /** Whether a callback belongs to an attempt that has since been replaced. */
    private fun stale(mine: Int): Boolean = mine != generation

    @Synchronized
    private fun drop(mine: Int, code: Int) {
        // Checked again under the lock: a retry may have replaced this socket
        // between the callback's own check and here, and a `drop` that lands
        // then takes the *new* socket's reference away with it.
        if (stale(mine)) return
        socket = null
        connected = false
        awaitingPong = false
        connectionListeners.forEach { it(false) }
        if (closedByUs) return
        // 4401 is the token being rejected, not the connection failing. A socket
        // carries the access token in its URL, so it outlives it - fifteen
        // minutes in, or over any doze longer than that - and a socket that gave
        // up here stayed down until the app was restarted: no messages, no
        // presence, an app that looks signed out while the session behind it is
        // fine. Ask for a fresh token (a refresh that works calls connect()
        // itself) and still fall through to the backoff, so a refresh that
        // cannot happen right now is retried rather than being the end of it.
        if (code == 4401) Session.renewAccessToken()
        scheduleReconnect()
    }

    private fun scheduleReconnect() {
        val since = downSince ?: System.currentTimeMillis().also { downSince = it }
        // Past the deadline the app says it is disconnected - a backoff that
        // never stops is a spinner that never stops - but keeps one quiet
        // attempt every OFFLINE_RETRY_MS underneath. A full stop left a client
        // nobody was looking at deaf until somebody opened it again, which is
        // the desktop's minimised-window bug; the policy is shared.
        val delay: Long
        if (System.currentTimeMillis() - since >= RECONNECT_DEADLINE_MS) {
            log("offline after ${RECONNECT_DEADLINE_MS}ms, retrying every ${OFFLINE_RETRY_MS}ms")
            Connectivity.report(path, Connectivity.State.OFFLINE)
            delay = OFFLINE_RETRY_MS
        } else {
            Connectivity.report(path, Connectivity.State.RECONNECTING)
            delay = min(1000.0 * 2.0.pow(attempt), 30_000.0).toLong()
            attempt += 1
        }
        Thread {
            Thread.sleep(delay)
            if (!closedByUs) open()
        }.apply { isDaemon = true }.start()
    }

    init {
        // The phone has a connection again, so stop waiting out a timer that
        // was measuring a problem which no longer exists - including one that
        // had already been given up on, because a socket the app stopped
        // retrying is exactly the one a returning network should try again.
        //
        // [retry] rather than an unconditional reconnect: a handover leaves
        // plenty of sockets that are still perfectly good, and the probe is
        // what tells those apart from the ones the old network took with it.
        // The backoff still handles the other case - a server refusing
        // connections, where hammering it is exactly wrong - because this only
        // ever fires when the *phone* changed.
        NetworkWatch.onAvailable { retry() }
    }

    /**
     * This installation's id, or null before it exists.
     *
     * Null is not a failure: a socket opened before `DeviceIdentity.init` has
     * run gets the old behaviour - a random peer id per connection - rather
     * than a crash on a `lateinit`.
     */
    private fun deviceId(): String? =
        runCatching { com.aatech.betweenus.core.crypto.DeviceIdentity.id() }.getOrNull()

    /** Overridden to re-subscribe: the server keeps nothing across connections. */
    protected open fun onConnected() = Unit

    @Synchronized
    fun send(event: JSONObject) {
        val text = event.toString()
        val live = socket
        if (connected && live != null) {
            live.send(text)
        } else {
            log("queued ${event.optString("type")} (not connected)")
            pending.addLast(text)
        }
    }

    fun on(listener: (JSONObject) -> Unit): () -> Unit {
        listeners.add(listener)
        return { listeners.remove(listener) }
    }

    fun onConnection(listener: (Boolean) -> Unit): () -> Unit {
        connectionListeners.add(listener)
        return { connectionListeners.remove(listener) }
    }

    @Synchronized
    fun disconnect() {
        closedByUs = true
        downSince = null
        pending.clear()
        socket?.close(1000, null)
        socket = null
        connected = false
        // A deliberate sign-out is not a connection problem, and a banner left
        // up over the login form is a lie about a socket nothing wants open.
        Connectivity.forget(path)
    }

    companion object {
        /**
         * How long a socket may keep retrying before it is given up on.
         *
         * Thirty seconds of "Reconnecting…" is already longer than anybody
         * waits before deciding the app is broken. Past it the app says so and
         * offers the retry as a button, which somebody who has just walked back
         * into wifi presses and is back in a second - an exponential backoff
         * sitting on its thirty-second step is not.
         */
        const val RECONNECT_DEADLINE_MS = 30_000L

        /**
         * How often a socket past [RECONNECT_DEADLINE_MS] still tries again on
         * its own. Matches `OFFLINE_RETRY_MS` on the desktop.
         */
        const val OFFLINE_RETRY_MS = 30_000L

        /**
         * How long a [probe] waits for an answer before the socket it was sent
         * on is treated as gone. Matches `PONG_TIMEOUT_MS` on the desktop: the
         * two clients ask the same question and give it the same time.
         */
        const val PONG_TIMEOUT_MS = 10_000L
    }
}

/**
 * Whether this app can reach the backend, for the reconnecting banner.
 *
 * Every socket reports into it and the worst answer wins: presence being down
 * with chat up is still an app that is missing events, and saying so is the
 * whole point. Call and remote sockets only exist during a session of their
 * own, so they report too and stop counting the moment they are closed.
 */
object Connectivity {
    enum class State { ONLINE, RECONNECTING, OFFLINE }

    private val perSocket = mutableMapOf<String, State>()
    private val _state = MutableStateFlow(State.ONLINE)
    val state: StateFlow<State> = _state.asStateFlow()

    @Synchronized
    internal fun report(path: String, state: State) {
        perSocket[path] = state
        publish()
    }

    @Synchronized
    internal fun forget(path: String) {
        perSocket.remove(path)
        publish()
    }

    private fun publish() {
        val states = perSocket.values
        _state.value = when {
            states.contains(State.OFFLINE) -> State.OFFLINE
            states.contains(State.RECONNECTING) -> State.RECONNECTING
            else -> State.ONLINE
        }
    }

    /**
     * Every socket starts its ladder again, and any that is not really up is
     * opened again rather than waited on. The banner's button, and what the app
     * does the moment it is back on screen. See [JsonSocket.retry].
     */
    fun retry() {
        ChatSocket.retry()
        PresenceSocket.retry()
        CallSocket.retry()
        RemoteSocket.retry()
    }
}

/**
 * `/ws/chat`: messages, and the announcements that a friend list or a member
 * list has changed.
 *
 * The client stays subscribed to every text channel it can read, not only the
 * one on screen - otherwise a message in another channel never arrives and
 * there is nothing to badge or notify about.
 */
object ChatSocket : JsonSocket("/ws/chat") {
    private val channels = LinkedHashSet<String>()
    private val servers = LinkedHashSet<String>()

    /**
     * Run once the subscriptions are back.
     *
     * Re-subscribing does not replay anything: the server sends what happens
     * next, not what happened while nobody was listening. Whatever missed the
     * gap has to be re-read over REST, and `Conversation` is what knows which
     * channel that is - a callback rather than a direct call, because that
     * lives in `core.store` and this is `core.data`.
     */
    @Volatile
    var onReconnect: (() -> Unit)? = null

    override fun onConnected() {
        synchronized(channels) {
            channels.forEach { send(JSONObject().put("type", "channel.subscribe").put("channelId", it)) }
        }
        synchronized(servers) {
            servers.forEach { send(JSONObject().put("type", "server.subscribe").put("serverId", it)) }
        }
        onReconnect?.invoke()
    }

    /** Subscribes to exactly these channels, dropping anything else. */
    fun syncSubscriptions(channelIds: Collection<String>) = synchronized(channels) {
        val wanted = channelIds.toSet()
        (channels - wanted).forEach {
            channels.remove(it)
            send(JSONObject().put("type", "channel.unsubscribe").put("channelId", it))
        }
        (wanted - channels).forEach {
            channels.add(it)
            send(JSONObject().put("type", "channel.subscribe").put("channelId", it))
        }
    }

    /**
     * Watches exactly these servers. Separate from channel subscriptions
     * because a member joining or leaving is not news about any one channel.
     */
    fun syncServers(serverIds: Collection<String>) = synchronized(servers) {
        val wanted = serverIds.toSet()
        (servers - wanted).forEach {
            servers.remove(it)
            send(JSONObject().put("type", "server.unsubscribe").put("serverId", it))
        }
        (wanted - servers).forEach {
            servers.add(it)
            send(JSONObject().put("type", "server.subscribe").put("serverId", it))
        }
    }

    fun forget() {
        synchronized(channels) { channels.clear() }
        synchronized(servers) { servers.clear() }
    }
}

/** `/ws/presence`: online status, typing indicators, voice-channel membership. */
object PresenceSocket : JsonSocket("/ws/presence") {
    private var status: PresenceStatus = PresenceStatus.ONLINE

    /**
     * Run on every connection, after the status has been re-sent.
     *
     * `ChannelFocus` sets it, and a callback rather than a direct call because
     * that lives in `core.store` and this is `core.data`: the socket is not
     * allowed to know what a channel focus is.
     */
    @Volatile
    var onReconnect: (() -> Unit)? = null

    override fun onConnected() {
        // The server defaults a new connection to online; say so explicitly, so
        // a status chosen before a reconnect survives it.
        setStatus(status)
        // Nothing survives a reconnect on the server side, so anything this
        // client had claimed has to be claimed again.
        onReconnect?.invoke()
    }

    fun setStatus(next: PresenceStatus) {
        if (next == PresenceStatus.OFFLINE) return
        status = next
        send(JSONObject().put("type", "status.set").put("status", next.wire))
    }

    fun typing(channelId: String) =
        send(JSONObject().put("type", "typing.start").put("channelId", channelId))

    /**
     * "When were these people last here?"
     *
     * Asked when a conversation opens or a profile sheet does. The answers come
     * back as ordinary `presence.changed` events, so nothing waits on a reply
     * and the store has one road in rather than two.
     */
    fun query(userIds: List<String>) {
        if (userIds.isEmpty()) return
        send(
            JSONObject()
                .put("type", "presence.query")
                .put("userIds", JSONArray().also { array -> userIds.forEach(array::put) }),
        )
    }

    /**
     * "This conversation is on screen in front of me."
     *
     * What stops a push waking this account's other devices for a message it
     * is already reading here. See `core/store/ChannelFocus.kt`.
     */
    fun focus(channelId: String) =
        send(JSONObject().put("type", "channel.focus").put("channelId", channelId))

    fun blur(channelId: String) =
        send(JSONObject().put("type", "channel.blur").put("channelId", channelId))

    fun joinVoice(channelId: String) =
        send(JSONObject().put("type", "voice.join").put("channelId", channelId))

    fun leaveVoice(channelId: String) =
        send(JSONObject().put("type", "voice.leave").put("channelId", channelId))
}

/**
 * `/ws/call`: the switchboard. It carries the roster, the offers, the answers
 * and the ICE candidates, and never a byte of media - see section 28 of
 * CLAUDE.md, which is the rule the whole design is built around.
 *
 * The server keeps nothing across connections, so a call has to be rejoined on
 * every reconnect exactly as chat has to be resubscribed. Without that, a phone
 * losing its signal for a moment - a lift, a train, a screen that went off -
 * came back on a socket the call service had never heard of: still showing a
 * call, absent from everybody else's roster, and never told why.
 */
object CallSocket : JsonSocket("/ws/call") {
    @Volatile
    private var channelId: String? = null

    override fun onConnected() {
        channelId?.let { send(JSONObject().put("type", "join").put("channelId", it)) }
    }

    /**
     * Joins, and remembers the call for as long as it lasts.
     *
     * Nothing is queued when the socket is down: [onConnected] sends it on the
     * way up, and queuing as well would arrive as two joins.
     */
    fun join(channelId: String) {
        this.channelId = channelId
        if (connected) send(JSONObject().put("type", "join").put("channelId", channelId))
    }

    /**
     * Goodbye, with what this client measured on it.
     *
     * The report is built by the caller because the caller is the only thing
     * holding the peer connections: media is peer to peer, so a byte counted
     * anywhere else does not exist. A leave with no report - an older path, or
     * a call nothing was measured in - is still a leave.
     */
    fun leave(report: JSONObject? = null) {
        channelId = null
        send(report ?: JSONObject().put("type", "leave"))
    }

    /**
     * "I am about to share my screen" and "I have stopped".
     *
     * One share at a time in a call, and the gateway is what decides whose: two
     * people pressing the button at the same moment need one answer, and a mesh
     * has no ordering to give one. Everybody is then told who holds it, and
     * whoever was sharing before stops.
     */
    fun claimScreen() = send(JSONObject().put("type", "screen.claim"))

    fun releaseScreen() = send(JSONObject().put("type", "screen.release"))
}

/** `/ws/remote`: remote-session handshake, input and signalling. Never the screen. */
object RemoteSocket : JsonSocket("/ws/remote")
