package com.aktech.nexora.core.store

import com.aktech.nexora.core.crypto.E2ee
import com.aktech.nexora.core.data.ChatSocket
import com.aktech.nexora.core.data.Message
import com.aktech.nexora.core.data.MessageAttachment
import com.aktech.nexora.core.data.MessageBody
import com.aktech.nexora.core.data.NexoraApi
import com.aktech.nexora.core.data.Session
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * One message, ready to draw: the stored row plus whatever came out of the
 * envelope. Decryption happens once, here, rather than in a composable that
 * would redo it on every recomposition.
 */
data class ReadableMessage(
    val message: Message,
    val body: MessageBody,
) {
    val id: String get() = message.id
    val text: String get() = body.text
    val attachments: List<MessageAttachment> get() = body.attachments
}

/**
 * Message history, per channel.
 *
 * The port of the message half of `apps/desktop/src/stores/chat.ts`. It holds
 * every channel that has been opened this session, because coming back to a
 * conversation should not be a spinner, and because a socket event for a
 * channel that is not on screen still has to update the count in the sidebar.
 */
object Conversation {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _messages = MutableStateFlow<Map<String, List<ReadableMessage>>>(emptyMap())
    val messages: StateFlow<Map<String, List<ReadableMessage>>> = _messages.asStateFlow()

    private val _loading = MutableStateFlow<Set<String>>(emptySet())
    val loading: StateFlow<Set<String>> = _loading.asStateFlow()

    /** The oldest id fetched per channel, which is what "load more" asks before. */
    private val cursors = ConcurrentHashMap<String, String>()
    private val exhausted = ConcurrentHashMap.newKeySet<String>()

    /** The channel currently on screen; its messages are read, not counted. */
    @Volatile
    var visibleChannelId: String? = null
        private set

    private var wired = false

    fun start() {
        if (wired) return
        wired = true
        ChatSocket.on { event -> scope.launch { onEvent(event) } }
    }

    fun stop() {
        _messages.value = emptyMap()
        cursors.clear()
        exhausted.clear()
        visibleChannelId = null
    }

    private suspend fun onEvent(event: JSONObject) {
        val message = event.optJSONObject("message")?.let { Message.from(it) } ?: return
        when (event.optString("type")) {
            "message.created" -> {
                // Only decrypt for a channel already open: a message arriving in
                // a channel nobody has looked at costs a key fetch, and the
                // badge does not need the text.
                if (_messages.value.containsKey(message.channelId)) {
                    insert(read(message))
                }
                val mine = message.author.id == (Session.state.value as? com.aktech.nexora.core.data.AuthPhase.SignedIn)?.user?.id
                if (!mine && message.channelId != visibleChannelId) {
                    Workspace.noteUnread(message.channelId, 1)
                }
            }
            // An edit, a deletion, a pin and a reaction are all "this message is
            // not what you last saw", so they share one event carrying the whole
            // message.
            "message.updated" -> if (_messages.value.containsKey(message.channelId)) {
                replace(read(message))
            }
        }
    }

    /** Opens a channel: history, key sync, and the read marker. */
    fun open(channelId: String) {
        visibleChannelId = channelId
        Workspace.markRead(channelId)
        if (_messages.value.containsKey(channelId)) return
        scope.launch {
            _loading.update { it + channelId }
            runCatching {
                // Re-wrap the key for anyone who joined since it was minted, so
                // they can read without waiting for a restart.
                launch { runCatching { E2ee.syncChannelKeys(channelId) } }
                val page = NexoraApi.messages(channelId)
                page.items.lastOrNull()?.let { cursors[channelId] = it.id }
                if (page.nextCursor == null && page.items.size < 2) exhausted.add(channelId)
                val readable = page.items.map { read(it) }
                _messages.update { it + (channelId to readable.sortedBy { m -> m.message.createdAt }) }
            }
            _loading.update { it - channelId }
        }
    }

    fun close(channelId: String) {
        if (visibleChannelId == channelId) visibleChannelId = null
    }

    fun loadOlder(channelId: String) {
        if (channelId in exhausted || channelId in _loading.value) return
        val before = _messages.value[channelId]?.firstOrNull()?.id ?: return
        scope.launch {
            _loading.update { it + channelId }
            runCatching { NexoraApi.messages(channelId, before) }.onSuccess { page ->
                if (page.items.isEmpty()) {
                    exhausted.add(channelId)
                } else {
                    val older = page.items.map { read(it) }
                    _messages.update { all ->
                        val existing = all[channelId].orEmpty()
                        val ids = existing.map { it.id }.toSet()
                        all + (channelId to (older.filter { it.id !in ids } + existing)
                            .sortedBy { it.message.createdAt })
                    }
                }
            }
            _loading.update { it - channelId }
        }
    }

    // --- sending ---

    suspend fun send(channelId: String, text: String, attachments: List<MessageAttachment>) {
        val body = MessageBody(text, attachments).encode()
        val sealed = E2ee.encryptForChannel(channelId, body)
        val message = NexoraApi.sendMessage(channelId, sealed)
        insert(read(message))
    }

    suspend fun edit(message: Message, text: String) {
        val existing = _messages.value[message.channelId]?.firstOrNull { it.id == message.id }
        val body = MessageBody(text, existing?.attachments.orEmpty()).encode()
        val sealed = E2ee.encryptForChannel(message.channelId, body)
        replace(read(NexoraApi.editMessage(message.id, sealed)))
    }

    suspend fun delete(message: Message) {
        NexoraApi.deleteMessage(message.id)
        // The tombstone arrives on the socket; nothing to do locally but wait.
    }

    suspend fun react(message: Message, emoji: String) {
        replace(read(NexoraApi.reactToMessage(message.id, emoji)))
    }

    suspend fun pin(message: Message, pinned: Boolean) {
        replace(read(NexoraApi.pinMessage(message.id, pinned)))
    }

    suspend fun pins(channelId: String): List<ReadableMessage> =
        NexoraApi.pins(channelId).map { read(it) }

    /** Seals a file under the channel key and uploads the ciphertext. */
    suspend fun uploadAttachment(
        channelId: String,
        name: String,
        contentType: String,
        bytes: ByteArray,
    ): MessageAttachment {
        val (sealed, epoch) = E2ee.encryptFileForChannel(channelId, bytes)
        val stored = NexoraApi.uploadAttachment(sealed.ciphertext)
        return MessageAttachment(
            key = stored.key,
            url = stored.url,
            name = name,
            contentType = contentType,
            size = bytes.size.toLong(),
            iv = sealed.iv,
            epoch = epoch,
        )
    }

    suspend fun openAttachment(channelId: String, attachment: MessageAttachment): ByteArray =
        E2ee.decryptFileForChannel(
            channelId,
            NexoraApi.fetchObject(attachment.url),
            attachment.iv,
            attachment.epoch,
        )

    // --- plumbing ---

    private suspend fun read(message: Message): ReadableMessage {
        if (message.deleted) return ReadableMessage(message, MessageBody(""))
        val plaintext = E2ee.decryptForChannel(message.channelId, message.content)
        return ReadableMessage(message, MessageBody.decode(plaintext))
    }

    private fun insert(readable: ReadableMessage) {
        _messages.update { all ->
            val channelId = readable.message.channelId
            val existing = all[channelId] ?: return@update all
            if (existing.any { it.id == readable.id }) return@update all
            all + (channelId to (existing + readable).sortedBy { it.message.createdAt })
        }
    }

    private fun replace(readable: ReadableMessage) {
        _messages.update { all ->
            val channelId = readable.message.channelId
            val existing = all[channelId] ?: return@update all
            all + (channelId to existing.map { if (it.id == readable.id) readable else it })
        }
    }
}
