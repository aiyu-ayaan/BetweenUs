package com.aktech.nexora.core.store

import com.aktech.nexora.core.crypto.E2ee
import com.aktech.nexora.core.data.Channel
import com.aktech.nexora.core.data.ChannelType
import com.aktech.nexora.core.data.ChatSocket
import com.aktech.nexora.core.data.DirectChannel
import com.aktech.nexora.core.data.Friend
import com.aktech.nexora.core.data.NexoraApi
import com.aktech.nexora.core.data.ServerMember
import com.aktech.nexora.core.data.ServerWithRole
import com.aktech.nexora.core.data.Session
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * What the app is looking at: the servers this account is in, their channels,
 * the direct-message list, the friend list and the unread counts.
 *
 * The port of the parts of `apps/desktop/src/stores/chat.ts` that are not
 * messages. It is an object rather than a ViewModel because a socket event
 * about a server the user is not currently looking at still has to land
 * somewhere - a store scoped to a screen would miss every one of them.
 */
object Workspace {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _servers = MutableStateFlow<List<ServerWithRole>>(emptyList())
    val servers: StateFlow<List<ServerWithRole>> = _servers.asStateFlow()

    /** Channels by server id. Loaded when a server is first opened, then kept. */
    private val _channels = MutableStateFlow<Map<String, List<Channel>>>(emptyMap())
    val channels: StateFlow<Map<String, List<Channel>>> = _channels.asStateFlow()

    private val _directChannels = MutableStateFlow<List<DirectChannel>>(emptyList())
    val directChannels: StateFlow<List<DirectChannel>> = _directChannels.asStateFlow()

    private val _friends = MutableStateFlow<List<Friend>>(emptyList())
    val friends: StateFlow<List<Friend>> = _friends.asStateFlow()

    private val _members = MutableStateFlow<Map<String, List<ServerMember>>>(emptyMap())
    val members: StateFlow<Map<String, List<ServerMember>>> = _members.asStateFlow()

    private val _unread = MutableStateFlow<Map<String, Int>>(emptyMap())
    val unread: StateFlow<Map<String, Int>> = _unread.asStateFlow()

    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private var wired = false

    /** Called once a session exists. Idempotent - a reconnect must not re-wire. */
    fun start() {
        if (!wired) {
            wired = true
            ChatSocket.on { event ->
                when (event.optString("type")) {
                    "friends.changed" -> scope.launch { loadFriends() }

                    "server.members.changed" -> scope.launch {
                        val serverId = event.optString("serverId")
                        // The event goes to everyone watching the server *and*
                        // to whoever joined or left it - so a server we have
                        // never heard of means this account was just added to
                        // one. Refreshing the member list of a server that is
                        // not in our list yet does nothing visible, which is
                        // why being added from another client used to need the
                        // app restarting before it showed up.
                        if (_servers.value.none { it.id == serverId }) refresh()
                        else loadMembers(serverId, force = true)
                    }
                }
            }

            // A socket that has been away has missed whatever happened while it
            // was gone, and nothing replays it. Re-reading on every reconnect is
            // one round trip and covers every event that was dropped - which on
            // a phone, going in and out of signal, is the common case rather
            // than the exception.
            ChatSocket.onConnection { up -> if (up) scope.launch { refresh() } }
        }
        scope.launch {
            hydrate()
            refresh()
        }
    }

    /**
     * Puts last session's workspace on screen before the network is asked for
     * anything. Everything here is replaced by [refresh] a moment later - the
     * point is only that the moment has something in it other than an empty rail.
     */
    private suspend fun hydrate() {
        if (_servers.value.isNotEmpty()) return
        Cache.servers()?.let { _servers.value = it }
        Cache.channels()?.let { _channels.value = it }
        Cache.directChannels()?.let { _directChannels.value = it }
        Cache.friends()?.let { _friends.value = it }
        Cache.members()?.let { _members.value = it }
        Cache.unread()?.let { _unread.value = it }
    }

    fun stop() {
        _servers.value = emptyList()
        _channels.value = emptyMap()
        _directChannels.value = emptyList()
        _friends.value = emptyList()
        _members.value = emptyMap()
        _unread.value = emptyMap()
    }

    /** Re-reads everything. Cheap enough to call on resume and on reconnect. */
    suspend fun refresh() {
        _loading.value = true
        try {
            val servers = NexoraApi.servers()
            _servers.value = servers
            Cache.putServers(servers)
            ChatSocket.syncServers(servers.map { it.id })
            // Every server's channels, not only the one on screen: the socket
            // has to be subscribed to all of them or a message in another
            // channel never arrives and there is nothing to badge.
            servers.forEach { loadChannels(it.id) }
            loadDirectChannels()
            loadFriends()
            loadUnread()
            resubscribe()
            _error.value = null
        } catch (error: Exception) {
            _error.value = Session.messageOf(error)
        } finally {
            _loading.value = false
        }
    }

    suspend fun loadChannels(serverId: String) {
        runCatching { NexoraApi.channels(serverId) }.onSuccess { channels ->
            _channels.update { it + (serverId to channels) }
            Cache.putChannels(_channels.value)
            resubscribe()
        }
    }

    suspend fun loadDirectChannels() {
        runCatching { NexoraApi.directChannels() }.onSuccess {
            _directChannels.value = it
            Cache.putDirectChannels(it)
            resubscribe()
        }
    }

    suspend fun loadFriends() {
        runCatching { NexoraApi.friends() }.onSuccess {
            _friends.value = it
            Cache.putFriends(it)
        }
    }

    suspend fun loadUnread() {
        runCatching { NexoraApi.unread() }.onSuccess { list ->
            _unread.value = list.associate { it.channelId to it.count }
            Cache.putUnread(_unread.value)
        }
    }

    suspend fun loadMembers(serverId: String, force: Boolean = false) {
        if (!force && _members.value.containsKey(serverId)) return
        runCatching { NexoraApi.members(serverId) }.onSuccess { members ->
            _members.update { it + (serverId to members) }
            Cache.putMembers(_members.value)
        }
    }

    /** Subscribes the socket to every text channel this account can read. */
    private fun resubscribe() {
        val text = _channels.value.values.flatten()
            .filter { it.type == ChannelType.TEXT }
            .map { it.id }
        ChatSocket.syncSubscriptions(text + _directChannels.value.map { it.channelId })
    }

    fun channelsOf(serverId: String): List<Channel> = _channels.value[serverId].orEmpty()

    fun channel(channelId: String): Channel? =
        _channels.value.values.flatten().firstOrNull { it.id == channelId }

    fun server(serverId: String?): ServerWithRole? =
        serverId?.let { id -> _servers.value.firstOrNull { it.id == id } }

    fun directChannel(channelId: String): DirectChannel? =
        _directChannels.value.firstOrNull { it.channelId == channelId }

    fun unreadOf(channelId: String): Int = _unread.value[channelId] ?: 0

    fun unreadOfServer(serverId: String): Int =
        channelsOf(serverId).sumOf { unreadOf(it.id) }

    fun noteUnread(channelId: String, delta: Int) {
        _unread.update { it + (channelId to ((it[channelId] ?: 0) + delta)) }
        Cache.putUnread(_unread.value)
    }

    fun markRead(channelId: String) {
        _unread.update { it - channelId }
        Cache.putUnread(_unread.value)
        scope.launch { runCatching { NexoraApi.markChannelRead(channelId) } }
    }

    // --- mutations ---

    suspend fun createServer(name: String): ServerWithRole =
        NexoraApi.createServer(name).also { refresh() }

    suspend fun joinServer(slug: String): ServerWithRole =
        NexoraApi.joinServer(slug).also { refresh() }

    suspend fun leaveServer(serverId: String) {
        NexoraApi.leaveServer(serverId)
        refresh()
    }

    suspend fun deleteServer(serverId: String) {
        NexoraApi.deleteServer(serverId)
        refresh()
    }

    suspend fun createChannel(
        serverId: String,
        name: String,
        type: ChannelType,
        isPrivate: Boolean,
        memberIds: List<String>,
    ): Channel {
        val channel = NexoraApi.createChannel(serverId, name, type, isPrivate, memberIds)
        loadChannels(serverId)
        // Key it now, so it is usable by whoever opens it first rather than by
        // whoever happens to type in it first.
        if (channel.type == ChannelType.TEXT) runCatching { E2ee.keyChannel(channel.id) }
        return channel
    }

    suspend fun deleteChannel(channel: Channel) {
        NexoraApi.deleteChannel(channel.id)
        channel.serverId?.let { loadChannels(it) }
    }

    suspend fun openDirect(userId: String): DirectChannel =
        NexoraApi.openDirectChannel(userId).also { loadDirectChannels() }
}
