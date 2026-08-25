package com.aatech.betweenus.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
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
     * A socket that really is connected is left alone. If it turns out not to
     * be, the ping resumes with the app and finds out inside thirty seconds.
     */
    @Synchronized
    fun retry() {
        if (closedByUs || token == null) return
        attempt = 0
        if (connected) return
        // Cancelled rather than closed: a close is a handshake, and there may
        // be nothing at the other end left to complete it.
        socket?.cancel()
        socket = null
        downSince = System.currentTimeMillis()
        log("retry")
        Connectivity.report(path, Connectivity.State.RECONNECTING)
        open()
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
                    log("open")
                    attempt = 0
                    downSince = null
                    connected = true
                    Connectivity.report(path, Connectivity.State.ONLINE)
                    onConnected()
                    synchronized(this@JsonSocket) {
                        while (pending.isNotEmpty()) webSocket.send(pending.removeFirst())
                    }
                    connectionListeners.forEach { it(true) }
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val event = runCatching { JSONObject(text) }.getOrNull() ?: return
                    listeners.forEach { it(event) }
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    log("closed code=$code reason=$reason")
                    drop(code)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    log("failed http=${response?.code ?: 0} ${t.javaClass.simpleName}: ${t.message}")
                    drop(response?.code ?: 0)
                }
            },
        )
    }

    @Synchronized
    private fun drop(code: Int) {
        socket = null
        connected = false
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
        // Given up on rather than retried more slowly: past the deadline the app
        // says it is disconnected and waits to be told to try again. A backoff
        // that never stops is a spinner that never stops.
        if (System.currentTimeMillis() - since >= RECONNECT_DEADLINE_MS) {
            log("gave up after ${RECONNECT_DEADLINE_MS}ms")
            Connectivity.report(path, Connectivity.State.OFFLINE)
            return
        }
        Connectivity.report(path, Connectivity.State.RECONNECTING)

        val delay = min(1000.0 * 2.0.pow(attempt), 30_000.0).toLong()
        attempt += 1
        Thread {
            Thread.sleep(delay)
            if (!closedByUs) open()
        }.apply { isDaemon = true }.start()
    }

    /**
     * The phone has a connection again, so stop waiting out a timer that was
     * measuring a problem which no longer exists.
     *
     * The backoff still handles the other case - a server that is refusing
     * connections, where hammering it is exactly wrong. This is only ever
     * called when the *phone* changed, and `open()` is a no-op on a socket that
     * is already up, so a handover firing it twice costs nothing.
     */
    @Synchronized
    private fun networkReturned() {
        if (closedByUs || token == null || socket != null) return
        // The next failure starts the ladder from the bottom: whatever the
        // count had climbed to belonged to a network that has been replaced.
        // The deadline restarts with it - a socket that had been given up on
        // is exactly the one a returning network should try again.
        attempt = 0
        downSince = System.currentTimeMillis()
        log("network returned")
        Connectivity.report(path, Connectivity.State.RECONNECTING)
        open()
    }

    init {
        NetworkWatch.onAvailable { networkReturned() }
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
