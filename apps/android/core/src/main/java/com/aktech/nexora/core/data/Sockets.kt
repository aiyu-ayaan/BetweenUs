package com.aktech.nexora.core.data

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
 * All four of Nexora's sockets - chat, presence, call signalling and remote -
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
        open()
    }

    /**
     * Never the token, never a message body - see section 23 of CLAUDE.md. Just
     * enough to tell a socket that is refusing to open from one that opened and
     * was never spoken to, which is a distinction that cost a day.
     */
    private fun log(what: String) = android.util.Log.i("nexora.socket", "$path $what")

    @Synchronized
    private fun open() {
        val token = this.token ?: return
        if (socket != null) return

        val url = "${Endpoint.webSocket()}$path?token=${URLEncoder.encode(token, "UTF-8")}"
        socket = Http.client.newWebSocket(
            Request.Builder().url(url).build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    log("open")
                    attempt = 0
                    connected = true
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
        // 4401 is the token being rejected. Reconnecting would loop; the session
        // refresh is what fixes it, and it will call connect() again.
        if (closedByUs || code == 4401) return
        scheduleReconnect()
    }

    private fun scheduleReconnect() {
        val delay = min(1000.0 * 2.0.pow(attempt), 30_000.0).toLong()
        attempt += 1
        Thread {
            Thread.sleep(delay)
            if (!closedByUs) open()
        }.apply { isDaemon = true }.start()
    }

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
        pending.clear()
        socket?.close(1000, null)
        socket = null
        connected = false
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

    override fun onConnected() {
        synchronized(channels) {
            channels.forEach { send(JSONObject().put("type", "channel.subscribe").put("channelId", it)) }
        }
        synchronized(servers) {
            servers.forEach { send(JSONObject().put("type", "server.subscribe").put("serverId", it)) }
        }
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

    override fun onConnected() {
        // The server defaults a new connection to online; say so explicitly, so
        // a status chosen before a reconnect survives it.
        setStatus(status)
    }

    fun setStatus(next: PresenceStatus) {
        if (next == PresenceStatus.OFFLINE) return
        status = next
        send(JSONObject().put("type", "status.set").put("status", next.wire))
    }

    fun typing(channelId: String) =
        send(JSONObject().put("type", "typing.start").put("channelId", channelId))

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

    fun leave() {
        channelId = null
        send(JSONObject().put("type", "leave"))
    }
}

/** `/ws/remote`: remote-session handshake, input and signalling. Never the screen. */
object RemoteSocket : JsonSocket("/ws/remote")
