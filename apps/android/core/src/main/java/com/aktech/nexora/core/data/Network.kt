package com.aktech.nexora.core.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import java.util.concurrent.CopyOnWriteArraySet

/**
 * When this phone has a usable connection again.
 *
 * Every socket already reconnects on its own, with a backoff that doubles to
 * thirty seconds. That is the right shape for a server that is down and the
 * wrong one for a phone: the connection comes back the instant a lift door
 * opens or wifi is reached, and the app then sat there for up to half a minute
 * waiting out a timer that was measuring a problem which no longer existed.
 *
 * The backoff is still what handles a server that is refusing connections. This
 * is the other half - the moment the *phone* changed - and it makes the wait
 * nothing rather than shortening it.
 *
 * `onAvailable` fires per network, and a handover from mobile data to wifi
 * fires it again while the old one is still up, so a listener here has to be
 * idempotent. Every one of them is: opening a socket that is already open is a
 * no-op, and `NET_CAPABILITY_VALIDATED` is what separates "attached to a wifi
 * access point" from "that access point reaches the internet" - a captive
 * portal is the case where the difference is the whole story.
 */
object NetworkWatch {
    private val listeners = CopyOnWriteArraySet<() -> Unit>()

    @Volatile
    private var registered = false

    /** True once the system has told us about a validated network. */
    @Volatile
    var online: Boolean = true
        private set

    fun init(context: Context) {
        if (registered) return
        val manager = context.applicationContext.getSystemService(ConnectivityManager::class.java)
            ?: return

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            .build()

        runCatching {
            manager.registerNetworkCallback(
                request,
                object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) {
                        online = true
                        listeners.forEach { runCatching { it() } }
                    }

                    override fun onLost(network: Network) {
                        // Not "offline" on its own - a handover loses the old
                        // network while the new one is already carrying
                        // traffic. What this is for is not pretending the app
                        // is fine when the last network really has gone, and
                        // the sockets notice that themselves within a ping.
                        online = manager.activeNetwork != null
                    }
                },
            )
            registered = true
        }
    }

    /** Calls back whenever a usable network arrives. Returns the unsubscribe. */
    fun onAvailable(listener: () -> Unit): () -> Unit {
        listeners.add(listener)
        return { listeners.remove(listener) }
    }
}
