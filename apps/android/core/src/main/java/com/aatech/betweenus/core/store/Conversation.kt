package com.aatech.betweenus.core.store

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import com.aatech.betweenus.core.crypto.E2ee
import com.aatech.betweenus.core.data.AuthPhase
import com.aatech.betweenus.core.data.ChannelReadReceipt
import com.aatech.betweenus.core.data.ChatSocket
import com.aatech.betweenus.core.data.Message
import com.aatech.betweenus.core.data.MessageAttachment
import com.aatech.betweenus.core.data.MessageBody
import com.aatech.betweenus.core.data.MessageCustomEmoji
import com.aatech.betweenus.core.data.MessageReply
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.UploadedObject
import com.aatech.betweenus.core.data.UploadedPart
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.data.UserSummary
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.time.Instant
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
    val replyTo: MessageReply? get() = body.replyTo

    /** What a reply to this message quotes. */
    fun quote(): MessageReply = MessageReply(
        id = message.id,
        author = message.author.label,
        preview = when {
            text.isNotBlank() -> MessageReply.preview(text)
            attachments.isNotEmpty() -> "${attachments.size} file" +
                if (attachments.size == 1) "" else "s"
            else -> ""
        },
    )
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

    /**
     * channelId -> everyone else's read marker in it. The "seen by" row under
     * your own messages is derived from these; see [Receipts]. Loaded when a
     * channel is opened and kept current by the `channel.read` event.
     */
    private val _receipts = MutableStateFlow<Map<String, List<ChannelReadReceipt>>>(emptyMap())
    val receipts: StateFlow<Map<String, List<ChannelReadReceipt>>> = _receipts.asStateFlow()

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
        // A socket that was down missed every message that arrived while it
        // was, and re-subscribing does not deliver them - the server sends what
        // happens next, not what happened. A phone is down constantly (a lift,
        // a lock screen, an OS that dropped the connection while the app was in
        // the background), so coming back has to re-read rather than assume.
        ChatSocket.onReconnect = { resumeVisible() }
    }

    fun stop() {
        _messages.value = emptyMap()
        _receipts.value = emptyMap()
        cursors.clear()
        exhausted.clear()
        visibleChannelId = null
    }

    private suspend fun onEvent(event: JSONObject) {
        // Somebody read a channel this client is subscribed to. It carries no
        // message, so it is answered before the message is even looked for.
        if (event.optString("type") == "channel.read") {
            onChannelRead(event.optString("channelId"), event.optString("userId"), event.optString("at"))
            return
        }
        // Somebody changed their picture or their name. Every message they ever
        // sent in an open channel is signed with a copy of it, as is every read
        // receipt, so the copies are rewritten rather than the history refetched.
        if (event.optString("type") == "user.updated") {
            event.optJSONObject("user")?.let { patchProfile(UserSummary.from(it)) }
            return
        }
        // This account cleared its own history, here or on another of its
        // devices. Everything held goes: the cache is full of sealed envelopes
        // the server will no longer hand back, and the open channel is full of
        // the decrypted ones. Re-reading is what fills both again, with
        // whatever arrived after the cut.
        if (event.optString("type") == "chats.cleared") {
            val cleared = if (event.isNull("channelId")) null else event.optString("channelId")
            if (cleared == null) {
                Cache.clear()
                _messages.value = emptyMap()
                _receipts.value = emptyMap()
                cursors.clear()
                exhausted.clear()
            } else {
                // One conversation leaves the rest of the cache alone. Throwing
                // it all away would turn "clear this chat" into a spinner on the
                // next four things the person opens, for a reason they could not
                // connect to what they just did.
                Cache.forgetChannel(cleared)
                _messages.update { it - cleared }
                _receipts.update { it - cleared }
                cursors.remove(cleared)
                exhausted.remove(cleared)
            }
            Workspace.loadUnread()
            // Re-opened only when it is the one on screen; anything else is
            // fetched when somebody actually goes there.
            visibleChannelId?.let { if (cleared == null || cleared == it) open(it) }
            return
        }
        // A message that left no tombstone: a one-time message somebody opened,
        // or one whose disappearing window closed. Handled before the message
        // is read out of the frame, because this frame carries none - there is
        // nothing to draw in its place, only something to forget.
        if (event.optString("type") == "message.gone") {
            val goneId = event.optString("messageId")
            if (goneId.isEmpty()) return
            // Not while somebody is looking at it. A one-time message is
            // burned as its viewer opens, and the viewer is drawn inside the
            // message row - so removing the message here took the row down,
            // and the row took the viewer with it. That was a one-time picture
            // vanishing the instant it was opened.
            if (heldOpen.contains(goneId)) {
                goneWhileOpen.add(goneId)
                return
            }
            forget(setOf(goneId))
            return
        }
        val message = event.optJSONObject("message")?.let { Message.from(it) } ?: return
        // Cached whether or not the channel is open. A conversation nobody has
        // looked at this session is exactly the one that should not be a spinner
        // when the badge is finally tapped.
        Cache.putMessages(listOf(message))
        when (event.optString("type")) {
            "message.created" -> {
                // Only decrypt for a channel already open: a message arriving in
                // a channel nobody has looked at costs a key fetch, and the
                // badge does not need the text.
                if (_messages.value.containsKey(message.channelId)) {
                    insert(read(message))
                }
                val mine = message.author.id == (Session.state.value as? com.aatech.betweenus.core.data.AuthPhase.SignedIn)?.user?.id
                if (!mine) {
                    // On screen *and* in front of somebody. The chat screen is
                    // still composed behind a lock screen, so `visibleChannelId`
                    // alone would count a message nobody has seen as read.
                    if (message.channelId == visibleChannelId && AppForeground.visible) {
                        // Read as soon as it is drawn, so the marker moves on
                        // the account too. Without this the marker only moved
                        // when the channel was opened, and a conversation held
                        // open never told anyone it had been read.
                        markReadSoon(message.channelId)
                    } else {
                        Workspace.noteUnread(message.channelId, 1)
                    }
                }
            }
            // An edit, a deletion, a pin and a reaction are all "this message is
            // not what you last saw", so they share one event carrying the whole
            // message.
            "message.updated" -> if (_messages.value.containsKey(message.channelId)) {
                // A tombstone carries no manifest - the body is empty - so the
                // keys are read off the copy still held here, before it is
                // replaced. After the swap nothing names the files, and the
                // decrypted photo would sit in the media cache with nothing
                // left that could ever remove it.
                if (message.deleted) {
                    val keys = _messages.value[message.channelId]
                        ?.firstOrNull { it.id == message.id }
                        ?.attachments
                        ?.map { it.key }
                        .orEmpty()
                    if (keys.isNotEmpty()) onAttachmentsGone?.invoke(keys)
                }
                replace(read(message))
            }
        }
    }

    /**
     * Rewrite one account's face in every message and receipt held here.
     *
     * `replyTo.author` is deliberately left alone: it is how the quoted message
     * was signed when the reply was written, not a live reference to anybody.
     */
    private fun patchProfile(user: UserSummary) {
        _messages.update { byChannel ->
            byChannel.mapValues { (_, list) ->
                list.map { readable ->
                    val message = readable.message
                    val author =
                        if (message.author.id == user.id) user else message.author
                    val deletedBy =
                        if (message.deletedBy?.id == user.id) user else message.deletedBy
                    if (author === message.author && deletedBy === message.deletedBy) {
                        readable
                    } else {
                        readable.copy(
                            message = message.copy(author = author, deletedBy = deletedBy),
                        )
                    }
                }
            }
        }
        _receipts.update { byChannel ->
            byChannel.mapValues { (_, list) ->
                list.map { if (it.user.id == user.id) it.copy(user = user) else it }
            }
        }
    }

    /** Opens a channel: history, key sync, and the read marker. */
    fun open(channelId: String) {
        visibleChannelId = channelId
        // The server is told too: it is what keeps this account's other devices
        // from being woken for a conversation being read here.
        ChannelFocus.apply()
        Workspace.markRead(channelId)
        // Who has read it, for the "seen by" row. Per open channel rather than
        // for every channel at sign-in: it is only ever drawn for the one on
        // screen, and it goes stale the moment somebody reads anyway.
        loadReceipts(channelId)
        // Already in memory, but not necessarily current: whatever arrived
        // while the socket was down is missing from it, and re-opening the
        // channel is exactly when somebody expects to see it.
        if (_messages.value.containsKey(channelId)) {
            refresh(channelId)
            return
        }
        scope.launch {
            _loading.update { it + channelId }
            // What was on screen last time, before anything is asked of the
            // network. A conversation that has been read before opens at once,
            // and opens at all with no signal.
            val cached = Cache.messages(channelId).map { read(it) }
            if (cached.isNotEmpty() && !_messages.value.containsKey(channelId)) {
                _messages.update { it + (channelId to cached) }
            }
            runCatching {
                // Re-wrap the key for anyone who joined since it was minted, so
                // they can read without waiting for a restart.
                launch { runCatching { E2ee.syncChannelKeys(channelId) } }
                val page = BetweenUsApi.messages(channelId)
                page.items.lastOrNull()?.let { cursors[channelId] = it.id }
                if (page.nextCursor == null && page.items.size < 2) exhausted.add(channelId)
                Cache.putMessages(page.items)
                val readable = page.items.map { read(it) }
                // Merged over what came out of the cache rather than replacing
                // it: the fresh page is the newest 50, and dropping everything
                // else would throw away history somebody had already scrolled to.
                _messages.update { all -> all + (channelId to merge(all[channelId], readable)) }
            }
            _loading.update { it - channelId }
        }
    }

    /**
     * The newest page again, merged over what is held.
     *
     * Deliberately not [open]'s fetch: that one sets the cursor, and setting it
     * from the newest page would throw away how far back somebody had already
     * scrolled. This only fills in what is missing at the end.
     */
    fun refresh(channelId: String) {
        scope.launch {
            runCatching {
                val page = BetweenUsApi.messages(channelId)
                Cache.putMessages(page.items)
                val readable = page.items.map { read(it) }
                _messages.update { all -> all + (channelId to merge(all[channelId], readable)) }
            }
        }
    }

    /**
     * The app came back to the front, or the socket did.
     *
     * Three things go stale together while a phone is asleep: the messages that
     * arrived, who has read them, and the fact that this account is looking at
     * the channel again. All three are re-asserted here, and nowhere else needs
     * to know which of the two events it was.
     */
    fun resumeVisible() {
        val channelId = visibleChannelId ?: return
        if (!AppForeground.visible) return
        refresh(channelId)
        loadReceipts(channelId)
        Workspace.markRead(channelId)
    }

    /** The pending "this channel has been read", if a burst is still arriving. */
    private var readJob: Job? = null

    /**
     * Ten messages landing at once are one read, not ten POSTs. Coalesced
     * rather than rate-limited: the last one wins, which is the marker that is
     * actually true.
     */
    private fun markReadSoon(channelId: String) {
        readJob?.cancel()
        readJob = scope.launch {
            delay(700)
            Workspace.markRead(channelId)
        }
    }

    /** Who else has read this channel. Quiet on failure: it is a decoration. */
    fun loadReceipts(channelId: String) {
        scope.launch {
            runCatching { BetweenUsApi.channelReads(channelId) }.onSuccess { rows ->
                _receipts.update { it + (channelId to rows) }
            }
        }
    }

    /**
     * A marker moved. One marker per person, replaced rather than appended: it
     * only ever moves forwards, and keeping the old one would draw a face
     * against a message they have since read past.
     */
    private fun onChannelRead(channelId: String, userId: String, at: String) {
        if (channelId.isBlank() || userId.isBlank()) return
        // Your own marker, from another of your devices. Not a receipt: the row
        // is about who else has seen your message.
        val self = (Session.state.value as? com.aatech.betweenus.core.data.AuthPhase.SignedIn)?.user
        if (userId == self?.id) return

        // A channel this client has never opened has no list to patch, and one
        // is fetched whole when it is opened.
        val known = _receipts.value[channelId] ?: return
        if (known.none { it.user.id == userId }) {
            // Somebody who had never read this channel before: their name is on
            // no list here, so the whole thing is re-read rather than invented.
            loadReceipts(channelId)
            return
        }
        _receipts.update { all ->
            all + (channelId to known.map { if (it.user.id == userId) it.copy(readAt = at) else it })
        }
    }

    fun close(channelId: String) {
        if (visibleChannelId == channelId) visibleChannelId = null
        ChannelFocus.apply()
    }

    fun loadOlder(channelId: String) {
        if (channelId in exhausted || channelId in _loading.value) return
        val oldest = _messages.value[channelId]?.firstOrNull()?.message ?: return
        scope.launch {
            _loading.update { it + channelId }

            // History already on this device first. Anything fetched once is
            // kept, so scrolling back through a conversation a second time is
            // a database read and not a round trip - which is the difference
            // between a list that moves and one that stutters.
            val local = Cache.messagesBefore(channelId, oldest.createdAt)
            if (local.isNotEmpty()) {
                val older = local.map { read(it) }
                _messages.update { all -> all + (channelId to merge(all[channelId], older)) }
            } else {
                runCatching { BetweenUsApi.messages(channelId, oldest.id) }.onSuccess { page ->
                    if (page.items.isEmpty()) {
                        exhausted.add(channelId)
                    } else {
                        Cache.putMessages(page.items)
                        val older = page.items.map { read(it) }
                        _messages.update { all -> all + (channelId to merge(all[channelId], older)) }
                    }
                }
            }
            _loading.update { it - channelId }
        }
    }

    // --- sending ---

    suspend fun send(
        channelId: String,
        text: String,
        attachments: List<MessageAttachment>,
        replyTo: MessageReply? = null,
        /**
         * One-time: the files may be opened once by somebody other than the
         * author, and that opening destroys the message and its blobs.
         *
         * Travels outside the envelope because the server has to act on it,
         * and a server that cannot read the body cannot be told by the body.
         */
        viewOnce: Boolean = false,
    ) {
        // The pictures for whatever custom emoji the text uses, taken from the
        // server this channel belongs to. They travel inside the envelope, so a
        // reader who is not in that server still sees them.
        val body = MessageBody(text, attachments, replyTo, usedEmoji(channelId, text)).encode()
        val sealed = E2ee.encryptForChannel(channelId, body)
        // The keys go outside the envelope as well as inside it: the server
        // cannot read the manifest, and without them nothing could ever sweep
        // these blobs when the message is deleted.
        val message = BetweenUsApi.sendMessage(
            channelId,
            sealed,
            attachments.map { it.key },
            // A message with no files cannot be one-time: there would be
            // nothing to open once, and the text is in everybody's history
            // either way.
            viewOnce = viewOnce && attachments.isNotEmpty(),
        )
        insert(read(message))
    }

    suspend fun edit(message: Message, text: String) {
        val existing = _messages.value[message.channelId]?.firstOrNull { it.id == message.id }
        // An edit changes the words. What the message was answering is not one
        // of them, so the quote rides along untouched.
        val body = MessageBody(
            text,
            existing?.attachments.orEmpty(),
            existing?.body?.replyTo,
            // An edit may introduce a shortcode that was not there before, so
            // the manifest is recomputed rather than carried over.
            usedEmoji(message.channelId, text),
        ).encode()
        val sealed = E2ee.encryptForChannel(message.channelId, body)
        replace(read(BetweenUsApi.editMessage(message.id, sealed)))
    }

    suspend fun delete(message: Message) {
        BetweenUsApi.deleteMessage(message.id)
        // The tombstone arrives on the socket; nothing to do locally but wait.
    }

    suspend fun react(message: Message, emoji: String) {
        replace(read(BetweenUsApi.reactToMessage(message.id, emoji)))
    }

    suspend fun pin(message: Message, pinned: Boolean) {
        replace(read(BetweenUsApi.pinMessage(message.id, pinned)))
    }

    suspend fun pins(channelId: String): List<ReadableMessage> =
        BetweenUsApi.pins(channelId).map { read(it) }

    /**
     * Seals a file under the channel key and uploads the ciphertext.
     *
     * [onProgress] is called with 0..1 across the upload, counted in parts. A
     * hundred megabytes over a phone's uplink is minutes, and minutes with no
     * sign of movement is a send that looks stuck.
     */
    suspend fun uploadAttachment(
        channelId: String,
        name: String,
        contentType: String,
        bytes: ByteArray,
        onProgress: ((Float) -> Unit)? = null,
        /** Seconds, for a recording. See [MessageAttachment.duration]. */
        duration: Float? = null,
        /** Bar heights, for a recording. See [MessageAttachment.waveform]. */
        waveform: List<Float> = emptyList(),
    ): MessageAttachment {
        val photo = asJpeg(bytes, contentType)
        val payload = photo?.bytes ?: bytes
        val (sealed, epoch) = E2ee.encryptFileForChannel(channelId, payload)
        val stored = putBytes(sealed.ciphertext, onProgress)
        val pixels = if (contentType.startsWith("image/")) pixelSize(payload) else null
        return MessageAttachment(
            key = stored.key,
            url = stored.url,
            // What was converted has to say so. A JPEG called .heic is a file
            // that lies about itself to every client that opens it.
            name = if (photo != null) withExtension(name, "jpg") else name,
            contentType = if (photo != null) "image/jpeg" else contentType,
            size = payload.size.toLong(),
            iv = sealed.iv,
            epoch = epoch,
            width = pixels?.first,
            height = pixels?.second,
            duration = duration,
            waveform = waveform,
        )
    }

    /**
     * One part of a large upload. Comfortably over S3's 5 MiB minimum and under
     * the server's own per-request cap, with room for the multipart form
     * framing. The same number the desktop uses.
     */
    private const val PART_BYTES = 8 * 1024 * 1024

    /**
     * One request when it fits in one; otherwise a part at a time.
     *
     * The phone used to only have the first branch, and a 25 MB ceiling to go
     * with it - so a file the desktop sent happily was refused here, and the
     * refusal was the client's, not the deployment's. The server has taken
     * multipart uploads all along.
     *
     * A few parts at a time, exactly as on the desktop. One at a time was the
     * old answer and it was the wrong one: a single request spends most of its
     * life waiting - the round trip to the gateway, the tunnel, the store's own
     * acknowledgement - and none of that is uplink. [UPLOAD_LANES] slices held
     * at once is the cost, which is why it is a small number.
     */
    private suspend fun putBytes(
        ciphertext: ByteArray,
        onProgress: ((Float) -> Unit)?,
    ): UploadedObject {
        if (ciphertext.size <= PART_BYTES) {
            return BetweenUsApi.uploadAttachment(ciphertext).also { onProgress?.invoke(1f) }
        }

        val opened = BetweenUsApi.startMultipart(ciphertext.size)
        val partSize = minOf(PART_BYTES, opened.maxPartBytes)
        val total = (ciphertext.size + partSize - 1) / partSize

        try {
            val parts = arrayOfNulls<UploadedPart>(total)
            val next = java.util.concurrent.atomic.AtomicInteger(0)
            val done = java.util.concurrent.atomic.AtomicInteger(0)

            coroutineScope {
                repeat(minOf(UPLOAD_LANES, total)) {
                    launch {
                        while (true) {
                            val index = next.getAndIncrement()
                            if (index >= total) break
                            val from = index * partSize
                            val to = minOf(ciphertext.size, from + partSize)
                            parts[index] = BetweenUsApi.uploadPart(
                                ticket = opened.ticket,
                                partNumber = index + 1,
                                bytes = ciphertext.copyOfRange(from, to),
                            )
                            onProgress?.invoke(done.incrementAndGet().toFloat() / total)
                        }
                    }
                }
            }
            return BetweenUsApi.completeMultipart(opened.ticket, parts.filterNotNull())
        } catch (error: Throwable) {
            // Leave no half-uploaded parts behind for a file nobody will send.
            runCatching { BetweenUsApi.abortMultipart(opened.ticket) }
            throw error
        }
    }

    /**
     * How many parts are in flight at once.
     *
     * Three rather than one, and not many more: past this the parts start
     * competing for the same uplink instead of covering each other's latency,
     * and each one in flight is another slice of the ciphertext held in memory
     * on a phone that already asks for `largeHeap` to seal one file.
     */
    private const val UPLOAD_LANES = 3

    /** Matches MAX_IMAGE_EDGE in `apps/desktop/src/services/attachments.ts`. */
    private const val MAX_IMAGE_EDGE = 1920

    /** Below this a JPEG is left alone; re-encoding it would only cost quality. */
    private const val KEEP_JPEG_UNDER_BYTES = 512 * 1024

    private class Photo(val bytes: ByteArray, val width: Int, val height: Int)

    /**
     * A picture, normalised to JPEG - and HEIC is why this exists.
     *
     * A phone camera writes HEIC by default. This platform decodes it natively,
     * so a photo sent from here looked perfectly fine *here*, and arrived on
     * desktop and web as a broken image: Chromium has never shipped a HEIF
     * decoder. Those clients can now decode one they are given, but a picture
     * no browser can read has no business being sent in the first place, so the
     * sender converts.
     *
     * Everything else a camera or a screenshot produces goes the same way, for
     * the same reason the desktop re-encodes: a 12 megapixel photo is several
     * megabytes of detail nobody will look at in a message list. GIF and SVG
     * are left alone - a bitmap would flatten an animation to its first frame,
     * and rasterise a drawing that was meant to scale.
     *
     * Returns null when there is nothing worth doing, and when anything at all
     * goes wrong: sending the file as it came is better than not sending it. On
     * API 24 to 27, where the platform cannot decode HEIC, that is the path a
     * HEIC takes - and those releases predate the cameras that write one.
     */
    private fun asJpeg(bytes: ByteArray, contentType: String): Photo? = try {
        val type = contentType.lowercase()
        val heic = type.startsWith("image/hei")
        val size = pixelSize(bytes)
        val longest = maxOf(size?.first ?: 0, size?.second ?: 0)
        when {
            !type.startsWith("image/") -> null
            type == "image/gif" || type == "image/svg+xml" -> null
            // A small JPEG is already what this would have produced. A HEIC is
            // never that, whatever its size.
            !heic && type == "image/jpeg" && longest <= MAX_IMAGE_EDGE &&
                bytes.size <= KEEP_JPEG_UNDER_BYTES -> null
            else -> encode(bytes, longest)
        }
    } catch (_: Throwable) {
        // OutOfMemoryError included: a photo too big for the heap is still a
        // photo somebody asked to send.
        null
    }

    private fun encode(bytes: ByteArray, longest: Int): Photo? {
        // `inSampleSize` throws whole powers of two away during the decode, so
        // the full-size bitmap never has to exist. It only halves, so it lands
        // at or above the target and the exact fit is done afterwards.
        val options = BitmapFactory.Options().apply {
            var sample = 1
            while (longest > 0 && longest / (sample * 2) >= MAX_IMAGE_EDGE) sample *= 2
            inSampleSize = sample
        }
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
        val upright = upright(decoded, bytes)
        val scale = minOf(1f, MAX_IMAGE_EDGE.toFloat() / maxOf(upright.width, upright.height))
        val scaled = if (scale < 1f) {
            Bitmap.createScaledBitmap(
                upright,
                (upright.width * scale).toInt().coerceAtLeast(1),
                (upright.height * scale).toInt().coerceAtLeast(1),
                true,
            )
        } else {
            upright
        }

        val out = ByteArrayOutputStream(bytes.size / 2 + 1024)
        scaled.compress(Bitmap.CompressFormat.JPEG, 85, out)
        val photo = Photo(out.toByteArray(), scaled.width, scaled.height)
        if (scaled !== upright) scaled.recycle()
        if (upright !== decoded) upright.recycle()
        decoded.recycle()
        return photo
    }

    /**
     * The picture the right way up.
     *
     * A phone stores a photo in the sensor's own orientation and records how to
     * turn it in an EXIF tag, which every viewer honours. Re-encoding drops the
     * tag, so a photo that was upright before the conversion would be on its
     * side after it. The rotation is baked into the pixels instead.
     */
    private fun upright(bitmap: Bitmap, bytes: ByteArray): Bitmap {
        val turn = when (
            runCatching {
                ExifInterface(ByteArrayInputStream(bytes))
                    .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
        ) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> return bitmap
        }
        return Bitmap.createBitmap(
            bitmap,
            0,
            0,
            bitmap.width,
            bitmap.height,
            Matrix().apply { postRotate(turn) },
            true,
        )
    }

    /** The port of `withExtension` in `services/attachments.ts`. */
    private fun withExtension(name: String, extension: String): String {
        val dot = name.lastIndexOf('.')
        return (if (dot > 0) name.substring(0, dot) else name) + "." + extension
    }

    /**
     * A picture's pixel size, recorded in the manifest so the receiver can
     * reserve its space.
     *
     * Every client draws a placeholder while an attachment is still ciphertext,
     * and without a size that placeholder is one line tall and then jumps to
     * three hundred as the picture arrives - which moves every message below it
     * under a scroll that had already finished. The desktop has recorded this
     * since it started shrinking images on the way out; a picture sent from a
     * phone carried nothing, so it was the one that always jumped, on every
     * client including this one.
     *
     * `inJustDecodeBounds` reads the header alone: no pixels are decoded and no
     * bitmap is allocated. It reports -1 for anything it cannot parse, and a
     * size that is not a size is not recorded.
     */
    private fun pixelSize(bytes: ByteArray): Pair<Int, Int>? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth > 0 && bounds.outHeight > 0) {
            bounds.outWidth to bounds.outHeight
        } else {
            null
        }
    }.getOrNull()

    suspend fun openAttachment(channelId: String, attachment: MessageAttachment): ByteArray =
        E2ee.decryptFileForChannel(
            channelId,
            BetweenUsApi.fetchObject(attachment.url),
            attachment.iv,
            attachment.epoch,
        )

    /**
     * The emoji a message actually uses, and nothing else.
     *
     * A server with two hundred of them must not put two hundred URLs into
     * every "ok". Deduplicated, because the same one three times is one
     * picture. The port of `usedEmoji` in `services/server-emoji.ts`.
     */
    private fun usedEmoji(channelId: String, text: String): List<MessageCustomEmoji> {
        val serverId = Workspace.channel(channelId)?.serverId ?: return emptyList()
        val available = Workspace.emojiFor(serverId)
        if (available.isEmpty()) return emptyList()

        val byName = available.associateBy { it.name }
        return Regex(":([a-z0-9_]{2,32}):")
            .findAll(text)
            .mapNotNull { byName[it.groupValues[1]] }
            .distinctBy { it.name }
            .map { MessageCustomEmoji(it.name, it.url, it.animated) }
            .toList()
    }

    // --- plumbing ---

    private suspend fun read(message: Message): ReadableMessage {
        if (message.deleted) return ReadableMessage(message, MessageBody(""))
        val plaintext = E2ee.decryptForChannel(message.channelId, message.content)
        return ReadableMessage(message, MessageBody.decode(plaintext))
    }

    /** One channel's list with [arrivals] laid over it, oldest first. */
    private fun merge(
        existing: List<ReadableMessage>?,
        arrivals: List<ReadableMessage>,
    ): List<ReadableMessage> {
        val fresh = arrivals.map { it.id }.toSet()
        return (existing.orEmpty().filterNot { it.id in fresh } + arrivals)
            .sortedBy { it.message.createdAt }
    }

    /**
     * Told the storage keys of every message that has just gone, so whoever is
     * holding decrypted copies of its files can drop them.
     *
     * A hook rather than a direct call because the decrypted media lives in
     * the app module and this store is in core - and because "who is holding
     * plaintext" is a question this store should not have to know the answer
     * to. The app wires `MediaCache` to it once, at startup.
     */
    var onAttachmentsGone: ((List<String>) -> Unit)? = null

    /**
     * Messages a viewer is currently open over, and the ones the server
     * destroyed while that was true.
     *
     * The problem these solve is a lifecycle one. A one-time message is burned
     * as its viewer opens - deliberately, because closing the viewer is not a
     * promise anybody can keep - and the server answers by destroying the row
     * and saying so. The viewer is drawn inside the message row, so acting on
     * that at once unmounted the very thing somebody had just spent their one
     * look on.
     *
     * Plain sets rather than state: nothing draws from them, and a screen that
     * recomposed every row when a picture was opened would be worse than the
     * bug.
     */
    private val heldOpen = java.util.Collections.synchronizedSet(mutableSetOf<String>())
    private val goneWhileOpen = java.util.Collections.synchronizedSet(mutableSetOf<String>())

    /** Keeps a message on screen while its viewer is open, whatever the server says. */
    fun holdMessage(messageId: String) {
        heldOpen.add(messageId)
    }

    /** Lets it go again, and applies the removal if one arrived in the meantime. */
    fun releaseMessage(messageId: String) {
        heldOpen.remove(messageId)
        if (goneWhileOpen.remove(messageId)) forget(setOf(messageId))
    }

    /**
     * Removes messages from every list this store keeps one in, and tells
     * whoever is holding their decrypted files to let go.
     *
     * The keys have to be read before the rows are dropped: the manifest lives
     * inside the encrypted body, so once the copy here is gone nothing is left
     * that names the files.
     */
    private fun forget(ids: Set<String>) {
        if (ids.isEmpty()) return

        val keys = _messages.value.values
            .flatten()
            .filter { it.id in ids }
            .flatMap { readable -> readable.attachments.map { it.key } }
        if (keys.isNotEmpty()) onAttachmentsGone?.invoke(keys)

        _messages.update { all -> all.mapValues { (_, list) -> list.filterNot { it.id in ids } } }
        scope.launch { Cache.forgetMessages(ids.toList()) }
    }

    /**
     * Drops whatever has outlived a disappearing window - either of them.
     *
     * The server destroys what is past its own stamp and says so, but only to
     * a client connected to hear it, and this one is holding decrypted copies
     * no event can reach if it was asleep. A phone that has been in a pocket
     * since yesterday is exactly the case this exists for.
     *
     * The account's own window is never enforced by deletion anywhere, because
     * it is one-sided - the rows are somebody else's history too. The server
     * leaves them out of a history page; this leaves them out of what has
     * already been fetched, without which switching the setting on appeared to
     * do nothing.
     */
    fun pruneExpired(now: Long = System.currentTimeMillis()) {
        val personal = (Session.state.value as? AuthPhase.SignedIn)?.user?.messageTtlSeconds
        val floor = personal?.let { now - it * 1000L }

        val gone = _messages.value.values.flatten().filter { readable ->
            readable.message.expired(now) ||
                (floor != null && olderThan(readable.message.createdAt, floor))
        }.map { it.id }.toSet()

        forget(gone)
    }

    /**
     * Spends a one-time message: this account has opened it, which is what
     * destroys it.
     *
     * Quiet on failure. The picture has already been looked at - that is what
     * triggered this - and an error over a viewer somebody is about to close
     * changes nothing they can act on. The message stays unburned and the next
     * opening tries again.
     */
    fun burn(messageId: String) {
        scope.launch { runCatching { BetweenUsApi.burnMessage(messageId) } }
    }

    /** Whether an ISO stamp is at or before [floor]. Unparseable counts as not. */
    private fun olderThan(iso: String, floor: Long): Boolean =
        runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()?.let { it <= floor } ?: false

    private fun insert(readable: ReadableMessage) {
        Cache.putMessages(listOf(readable.message))
        _messages.update { all ->
            val channelId = readable.message.channelId
            val existing = all[channelId] ?: return@update all
            if (existing.any { it.id == readable.id }) return@update all
            all + (channelId to (existing + readable).sortedBy { it.message.createdAt })
        }
    }

    private fun replace(readable: ReadableMessage) {
        Cache.putMessages(listOf(readable.message))
        _messages.update { all ->
            val channelId = readable.message.channelId
            val existing = all[channelId] ?: return@update all
            all + (channelId to existing.map { if (it.id == readable.id) readable else it })
        }
    }
}
