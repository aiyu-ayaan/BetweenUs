package com.aatech.betweenus.core.store

import com.aatech.betweenus.core.crypto.E2ee
import com.aatech.betweenus.core.data.Channel
import com.aatech.betweenus.core.data.ChannelType
import com.aatech.betweenus.core.data.BlockedUser
import com.aatech.betweenus.core.data.ChatSocket
import com.aatech.betweenus.core.data.DirectChannel
import com.aatech.betweenus.core.data.Friend
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.ServerEmoji
import com.aatech.betweenus.core.data.ServerMember
import com.aatech.betweenus.core.data.ServerWithRole
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.data.UserSummary
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

    /**
     * Everyone this account has blocked.
     *
     * Not cached to disk, unlike the lists above. It is read on one settings
     * screen rather than drawn on every frame, so the one round trip it costs
     * to open that screen is cheaper than a codec and a round-trip test for a
     * list nobody is waiting on.
     */
    private val _blocked = MutableStateFlow<List<BlockedUser>>(emptyList())
    val blocked: StateFlow<List<BlockedUser>> = _blocked.asStateFlow()

    private val _members = MutableStateFlow<Map<String, List<ServerMember>>>(emptyMap())
    val members: StateFlow<Map<String, List<ServerMember>>> = _members.asStateFlow()

    private val _unread = MutableStateFlow<Map<String, Int>>(emptyMap())
    val unread: StateFlow<Map<String, Int>> = _unread.asStateFlow()

    /** serverId -> that server's own emoji. */
    private val _emoji = MutableStateFlow<Map<String, List<ServerEmoji>>>(emptyMap())
    val emoji: StateFlow<Map<String, List<ServerEmoji>>> = _emoji.asStateFlow()

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
                    // A request, an acceptance, a removal - and a block, which
                    // the server announces as a removal on purpose, so the far
                    // side is never told which of the two it was.
                    "friends.changed" -> scope.launch {
                        loadFriends()
                        // The conversation list too: a block hides a DM from
                        // both sides, and leaving a dead channel in the rail
                        // would leave a row that answers 404 when it is tapped.
                        loadDirectChannels()
                    }

                    // A picture or a name changed. Patched in place rather
                    // than refetched: the event carries the four fields every
                    // list here holds, and going back to the API for them would
                    // be three calls to learn what already arrived.
                    "user.updated" -> event.optJSONObject("user")
                        ?.let { UserSummary.from(it) }
                        ?.let {
                            patchProfile(it)
                            // Their own account, changed on another device: the
                            // avatar in the drawer is drawn from the session.
                            Session.applyProfile(it)
                        }

                    "server.updated" -> {
                        val serverId = event.optString("serverId")
                        val iconUrl =
                            if (event.isNull("iconUrl")) null else event.optString("iconUrl")
                        _servers.update { list ->
                            list.map {
                                if (it.id == serverId) {
                                    it.copy(name = event.optString("name"), iconUrl = iconUrl)
                                } else {
                                    it
                                }
                            }
                        }
                        scope.launch { Cache.putServers(_servers.value) }
                    }

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
        _blocked.value = emptyList()
        _members.value = emptyMap()
        _unread.value = emptyMap()
    }

    /** Re-reads everything. Cheap enough to call on resume and on reconnect. */
    suspend fun refresh() {
        _loading.value = true
        try {
            val servers = BetweenUsApi.servers()
            _servers.value = servers
            Cache.putServers(servers)
            ChatSocket.syncServers(servers.map { it.id })
            // Every server's channels, not only the one on screen: the socket
            // has to be subscribed to all of them or a message in another
            // channel never arrives and there is nothing to badge.
            servers.forEach { loadChannels(it.id) }
            servers.forEach { loadEmoji(it.id) }
            // And the member lists. Presence reports who is in a voice channel
            // as user ids, and the member list is the only thing that turns one
            // into a name - so without this every voice roster in the sidebar
            // read "Someone" until the members screen had been opened once.
            servers.forEach { loadMembers(it.id, force = true) }
            loadDirectChannels()
            loadFriends()
            loadBlocked()
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
        runCatching { BetweenUsApi.channels(serverId) }.onSuccess { channels ->
            _channels.update { it + (serverId to channels) }
            Cache.putChannels(_channels.value)
            resubscribe()
        }
    }

    suspend fun loadDirectChannels() {
        runCatching { BetweenUsApi.directChannels() }.onSuccess {
            _directChannels.value = it
            Cache.putDirectChannels(it)
            resubscribe()
        }
    }

    suspend fun loadFriends() {
        runCatching { BetweenUsApi.friends() }.onSuccess {
            _friends.value = it
            Cache.putFriends(it)
        }
    }

    suspend fun loadBlocked() {
        // A deployment that has not been redeployed yet answers 404 here, and a
        // missing block list is not a reason for a settings screen to fail.
        runCatching { BetweenUsApi.blocked() }.onSuccess { _blocked.value = it }
    }

    /**
     * Blocks somebody, and takes them out of every list this store holds.
     *
     * Done here rather than left to the announcement that follows, because that
     * announcement is deliberately indistinguishable from an ordinary removal -
     * so the screen the block was pressed on has to be right immediately, not a
     * round trip later.
     */
    suspend fun block(userId: String) {
        val entry = BetweenUsApi.blockUser(userId)
        _blocked.update { listOf(entry) + it.filterNot { existing -> existing.user.id == userId } }
        _friends.update { list -> list.filterNot { it.user.id == userId } }
        _directChannels.update { list -> list.filterNot { it.participant.id == userId } }
        Cache.putFriends(_friends.value)
        Cache.putDirectChannels(_directChannels.value)
        resubscribe()
    }

    /**
     * Lifts a block. It does not restore the friendship the block ended.
     *
     * The conversation comes back with its history, so the lists are re-read
     * rather than reconstructed - this phone stopped being told about that
     * channel while the block stood and has nothing to reconstruct from.
     */
    suspend fun unblock(userId: String) {
        BetweenUsApi.unblockUser(userId)
        _blocked.update { list -> list.filterNot { it.user.id == userId } }
        loadDirectChannels()
        loadFriends()
    }

    /**
     * A server's own emoji, kept per server.
     *
     * Fetched with the channels rather than lazily: the list decides what a
     * `:name:` in an arriving message means, so it has to be in hand before the
     * first message renders rather than after it.
     */
    suspend fun loadEmoji(serverId: String) {
        runCatching { BetweenUsApi.serverEmoji(serverId) }.onSuccess { list ->
            _emoji.value = _emoji.value + (serverId to list)
        }
    }

    /** What this phone knows for a server. Empty until it has been fetched. */
    fun emojiFor(serverId: String?): List<ServerEmoji> =
        serverId?.let { _emoji.value[it] }.orEmpty()

    suspend fun loadUnread() {
        runCatching { BetweenUsApi.unread() }.onSuccess { list ->
            _unread.value = list.associate { it.channelId to it.count }
            Cache.putUnread(_unread.value)
        }
    }

    suspend fun loadMembers(serverId: String, force: Boolean = false) {
        if (!force && _members.value.containsKey(serverId)) return
        runCatching { BetweenUsApi.members(serverId) }.onSuccess { members ->
            _members.update { it + (serverId to members) }
            Cache.putMembers(_members.value)
        }
    }

    /**
     * Repaint one account's face wherever this store holds a copy of it: the
     * member list of every server, the conversation list and the friend list.
     *
     * [Conversation] keeps the copies inside message history and does its own.
     */
    fun patchProfile(user: UserSummary) {
        _members.update { byServer ->
            byServer.mapValues { (_, list) ->
                list.map {
                    if (it.userId == user.id) {
                        it.copy(
                            username = user.username,
                            displayName = user.displayName,
                            avatarUrl = user.avatarUrl,
                        )
                    } else {
                        it
                    }
                }
            }
        }
        _directChannels.update { list ->
            list.map { if (it.participant.id == user.id) it.copy(participant = user) else it }
        }
        _friends.update { list ->
            list.map { if (it.user.id == user.id) it.copy(user = user) else it }
        }
        scope.launch {
            Cache.putMembers(_members.value)
            Cache.putDirectChannels(_directChannels.value)
            Cache.putFriends(_friends.value)
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

    /**
     * Sets a server's disappearing window, and puts the answer back in the
     * list every screen reads from.
     *
     * Patched here rather than waiting for a refetch, because `server.updated`
     * carries a name and a picture and not this - and adding it there would
     * broadcast one server's retention policy to every member on every change,
     * to update a control almost none of them are looking at.
     */
    suspend fun setServerMessageWindow(serverId: String, seconds: Int?) {
        val updated = BetweenUsApi.setServerMessageWindow(serverId, seconds)
        _servers.update { list -> list.map { if (it.id == updated.id) updated else it } }
        Cache.putServers(_servers.value)
    }

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
        scope.launch { runCatching { BetweenUsApi.markChannelRead(channelId) } }
    }

    /**
     * The same channel, read on one of this account's other devices.
     *
     * Everything [markRead] does except telling the server, which already knows
     * - it is what sent this. Posting the marker back would have every device
     * answering every other device's read with one of its own, for as long as
     * they are all awake.
     */
    fun noteReadElsewhere(channelId: String) {
        if (_unread.value[channelId] == null) return
        _unread.update { it - channelId }
        Cache.putUnread(_unread.value)
    }

    // --- mutations ---

    suspend fun createServer(name: String): ServerWithRole =
        BetweenUsApi.createServer(name).also { refresh() }

    suspend fun joinServer(code: String): ServerWithRole =
        BetweenUsApi.joinServer(code).also { refresh() }

    suspend fun leaveServer(serverId: String) {
        BetweenUsApi.leaveServer(serverId)
        refresh()
    }

    suspend fun deleteServer(serverId: String) {
        BetweenUsApi.deleteServer(serverId)
        refresh()
    }

    suspend fun createChannel(
        serverId: String,
        name: String,
        type: ChannelType,
        isPrivate: Boolean,
        memberIds: List<String>,
    ): Channel {
        val channel = BetweenUsApi.createChannel(serverId, name, type, isPrivate, memberIds)
        loadChannels(serverId)
        // Key it now, so it is usable by whoever opens it first rather than by
        // whoever happens to type in it first.
        if (channel.type == ChannelType.TEXT) runCatching { E2ee.keyChannel(channel.id) }
        return channel
    }

    suspend fun deleteChannel(channel: Channel) {
        BetweenUsApi.deleteChannel(channel.id)
        channel.serverId?.let { loadChannels(it) }
    }

    suspend fun openDirect(userId: String): DirectChannel =
        BetweenUsApi.openDirectChannel(userId).also { loadDirectChannels() }
}
