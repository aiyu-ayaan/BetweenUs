package com.aatech.betweenus.core.store

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import com.aatech.betweenus.core.crypto.E2ee
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
import kotlinx.coroutines.CoroutineScope
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

    fun close(channelId: String) {
        if (visibleChannelId == channelId) visibleChannelId = null
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
    ) {
        // The pictures for whatever custom emoji the text uses, taken from the
        // server this channel belongs to. They travel inside the envelope, so a
        // reader who is not in that server still sees them.
        val body = MessageBody(text, attachments, replyTo, usedEmoji(channelId, text)).encode()
        val sealed = E2ee.encryptForChannel(channelId, body)
        // The keys go outside the envelope as well as inside it: the server
        // cannot read the manifest, and without them nothing could ever sweep
        // these blobs when the message is deleted.
        val message = BetweenUsApi.sendMessage(channelId, sealed, attachments.map { it.key })
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
