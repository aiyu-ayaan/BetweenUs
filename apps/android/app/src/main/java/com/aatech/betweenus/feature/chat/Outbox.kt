package com.aatech.betweenus.feature.chat

import android.content.Context
import android.net.Uri
import com.aatech.betweenus.core.data.MessageAttachment
import com.aatech.betweenus.core.data.MessageReply
import com.aatech.betweenus.core.data.NetworkWatch
import com.aatech.betweenus.core.store.Conversation
import com.aatech.betweenus.feature.notifications.PushGate
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Messages that carry files, sent in the background.
 *
 * Sending used to happen in the coroutine scope of the chat screen, which is
 * the one place it must not: a minute-long video is a minute of holding one
 * screen open, and leaving the channel - or the app - abandoned the upload
 * with the parts already in storage and nothing to finish them. What the
 * screenshot showed was the honest version of that, a preview dialog pinned
 * open at 14%.
 *
 * So it is a queue instead. Handing a message over returns at once, the preview
 * closes, and the send carries on under [UploadService] - a foreground service,
 * because that is the only promise Android makes about work outliving the
 * screen. Progress comes back through [progress], which the composer draws as a
 * bar and the notification draws as a percentage.
 *
 * One at a time, deliberately: two videos sealing at once is twice the heap on
 * a phone that already asks for `largeHeap` to manage one, and the uplink is
 * the bottleneck either way. Parallelism that helps is inside a single upload,
 * where the parts go up together - see `Conversation.putBytes`.
 */
object Outbox {

    /** What is happening to one queued message, for the bar and the notification. */
    data class Progress(
        val channelId: String,
        /** The file being worked on now. */
        val name: String,
        /** 1-based, within this message. */
        val index: Int,
        val total: Int,
        /** Across the whole message, 0 to 1. */
        val fraction: Float,
        /** Messages still waiting behind this one. */
        val queued: Int,
    )

    private data class Item(val uri: Uri, val name: String, val contentType: String)

    private data class Send(
        val channelId: String,
        val caption: String,
        val items: List<Item>,
        val replyTo: MessageReply?,
        /** Set for a text-only message that is on disk until it is sent. */
        val pendingId: Long? = null,
    )

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val queue = Channel<Send>(Channel.UNLIMITED)

    private val _progress = MutableStateFlow<Progress?>(null)
    val progress: StateFlow<Progress?> = _progress.asStateFlow()

    /** The last thing that went wrong, per channel, for the screen to show. */
    private val _failures = MutableStateFlow<Map<String, String>>(emptyMap())
    val failures: StateFlow<Map<String, String>> = _failures.asStateFlow()

    private var waiting = 0
    private var started = false

    /** Called once, from the application. Idempotent. */
    fun init(context: Context) {
        if (started) return
        started = true
        val app = context.applicationContext
        PendingReplies.init(app)
        scope.launch {
            for (send in queue) {
                waiting = (waiting - 1).coerceAtLeast(0)
                runSend(app, send)
            }
        }
        // Anything a previous run could not send, and anything that failed
        // while the phone had no network. `onAvailable` fires again on a
        // handover, so this has to be safe to run twice - it is, because a
        // send that succeeds takes its row off the disk first.
        replay(app)
        NetworkWatch.onAvailable { replay(app) }
    }

    /**
     * A text message queued to disk first, then sent.
     *
     * This is what a reply typed into the notification shade uses. It used to
     * be sent inline by the broadcast receiver and dropped - without a word -
     * when that failed, which is every reply written in a lift or on a train.
     */
    fun enqueueText(context: Context, channelId: String, text: String) {
        init(context)
        val pending = PendingReplies.add(channelId, text)
        waiting += 1
        queue.trySend(
            Send(
                channelId = channelId,
                caption = text,
                items = emptyList(),
                replyTo = null,
                pendingId = pending.id,
            ),
        )
    }

    /** Whether anything is still waiting to go out, for a screen to say so. */
    fun pendingFor(channelId: String): Int =
        PendingReplies.all().count { it.channelId == channelId }

    /** Sign-out throws unsent words away rather than sending them as somebody else. */
    fun forgetPending() {
        PendingReplies.clear()
    }

    private fun replay(context: Context) {
        val rows = PendingReplies.all()
        if (rows.isEmpty()) return
        rows.forEach { row ->
            waiting += 1
            queue.trySend(
                Send(
                    channelId = row.channelId,
                    caption = row.text,
                    items = emptyList(),
                    replyTo = null,
                    pendingId = row.id,
                ),
            )
        }
    }

    fun clearFailure(channelId: String) {
        _failures.update { it - channelId }
    }

    /**
     * Queues a message. Returns immediately - the caller closes its preview and
     * gets on with something else, which is the whole point.
     */
    fun enqueue(
        context: Context,
        channelId: String,
        caption: String,
        items: List<PickedPreview>,
        replyTo: MessageReply? = null,
    ) {
        init(context)
        _failures.update { it - channelId }
        waiting += 1
        UploadService.start(context.applicationContext)
        queue.trySend(
            Send(
                channelId = channelId,
                caption = caption,
                items = items.map { Item(it.uri, it.name, it.contentType) },
                replyTo = replyTo,
            ),
        )
    }

    private suspend fun runSend(context: Context, send: Send) {
        if (send.pendingId != null) {
            runTextSend(send)
            return
        }
        val total = send.items.size
        try {
            val uploaded = ArrayList<MessageAttachment>(total)
            send.items.forEachIndexed { index, item ->
                report(send.channelId, item.name, index + 1, total, index.toFloat() / total)

                // A video is re-encoded before it is sealed, and that is minutes
                // rather than seconds, so it gets its own half of this file's
                // share of the bar. Anything else has nothing to prepare and
                // the whole share is the upload.
                val video = item.contentType.startsWith("video/")
                val prepared = prepareForSending(
                    context = context,
                    uri = item.uri,
                    name = item.name,
                    contentType = item.contentType,
                    onCompress = { fraction ->
                        report(
                            send.channelId,
                            item.name,
                            index + 1,
                            total,
                            (index + fraction * 0.5f) / total,
                        )
                    },
                )
                require(prepared.bytes.size <= MAX_ATTACHMENT_BYTES) {
                    "${prepared.name} is larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB"
                }
                uploaded += Conversation.uploadAttachment(
                    channelId = send.channelId,
                    name = prepared.name,
                    contentType = prepared.contentType,
                    bytes = prepared.bytes,
                    // Across the whole batch rather than per file: three files
                    // is one wait, and a bar that restarts twice reads as a
                    // send that has gone wrong.
                    onProgress = { fraction ->
                        val within = if (video) 0.5f + fraction * 0.5f else fraction
                        report(send.channelId, prepared.name, index + 1, total, (index + within) / total)
                    },
                )
            }
            Conversation.send(send.channelId, send.caption.trim(), uploaded, send.replyTo)
        } catch (error: Throwable) {
            _failures.update {
                it + (send.channelId to (error.message ?: "That message could not be sent"))
            }
        } finally {
            _progress.value = null
            if (waiting == 0) UploadService.stop(context)
        }
    }

    /**
     * A message with no files in it, which is a send and a row to delete.
     *
     * The row goes first only on success: a failure leaves it on disk, and the
     * next validated network - or the next launch - tries it again. A duplicate
     * would be worse than a delay, so nothing here retries in a loop.
     */
    private suspend fun runTextSend(send: Send) {
        val sent = runCatching {
            // A replay at launch runs before anything has signed in, and a
            // send with no session fails for a reason that has nothing to do
            // with the network.
            requireNotNull(PushGate.ensureSession()) { "not signed in" }
            Conversation.send(send.channelId, send.caption.trim(), emptyList())
        }
        if (sent.isSuccess) {
            PendingReplies.remove(send.pendingId ?: return)
            _failures.update { it - send.channelId }
        } else {
            _failures.update {
                it + (send.channelId to "Waiting to send - this phone is offline")
            }
        }
    }

    private fun report(channelId: String, name: String, index: Int, total: Int, fraction: Float) {
        val progress = Progress(
            channelId = channelId,
            name = name,
            index = index,
            total = total,
            fraction = fraction.coerceIn(0f, 1f),
            queued = waiting,
        )
        _progress.value = progress
        UploadService.update(progress)
    }
}
