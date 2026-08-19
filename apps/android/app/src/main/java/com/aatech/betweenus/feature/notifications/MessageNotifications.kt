package com.aatech.betweenus.feature.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.graphics.drawable.IconCompat
import com.aatech.betweenus.MainActivity
import com.aatech.betweenus.R
import java.util.concurrent.ConcurrentHashMap

/**
 * The message notification: what a push actually turns into.
 *
 * One notification per channel, not per message, built with `MessagingStyle` -
 * which is the shape Android reserves for conversations and the only one that
 * gets the sender's face, the thread of what was said, and a reply box in the
 * shade. Three messages in a channel is one notification with three lines, not
 * three notifications.
 *
 * The history is held here, in memory, because that is the only place it can
 * be: the words come out of a sealed body and have no business on disk beside
 * the ciphertext. A process death loses the older lines and the next push
 * starts a fresh thread, which is the right trade - the conversation itself is
 * one tap away and is the real record.
 */
object MessageNotifications {

    /** Ordinary conversation. Silenced on its own, without touching calls. */
    const val CHANNEL_MESSAGES = "betweenus.messages"

    /** Remote-access requests and sessions - loud, and separate on purpose. */
    const val CHANNEL_REMOTE = "betweenus.remote"

    /** Enough to read the thread, few enough that the shade stays a shade. */
    private const val MAX_LINES = 6

    const val REPLY_KEY = "betweenus.reply"

    private data class Line(
        val text: String,
        val author: String,
        val authorId: String,
        val at: Long,
        val image: Bitmap? = null,
        val mine: Boolean = false,
    )

    private val history = ConcurrentHashMap<String, ArrayDeque<Line>>()

    /**
     * The channels this app posts to.
     *
     * Created up front rather than at the first notification: a person should
     * be able to find "Messages" in the system settings and turn it down before
     * the first one arrives, not after. Calls make their own - see `CallService`
     * - because their importance is not this one's.
     */
    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_MESSAGES) == null) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_MESSAGES,
                    "Messages",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Messages in channels and direct messages"
                    enableVibration(true)
                },
            )
        }
        if (manager.getNotificationChannel(CHANNEL_REMOTE) == null) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_REMOTE,
                    "Remote access",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Somebody asking to view or control this device"
                },
            )
        }
    }

    /**
     * Add one message to a channel's thread and post it.
     *
     * [image] is a picture already decrypted by the caller - the only kind
     * there is, since an attachment is ciphertext until a channel key opens it.
     * A single picture becomes the expanded view; anything else is named in the
     * line, because a notification is not a file browser.
     */
    fun show(
        context: Context,
        channelId: String,
        conversationTitle: String,
        isGroup: Boolean,
        selfName: String,
        authorId: String,
        authorName: String,
        authorAvatar: Bitmap?,
        text: String,
        at: Long,
        image: Bitmap? = null,
    ) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return

        val lines = history.getOrPut(channelId) { ArrayDeque() }
        synchronized(lines) {
            lines.addLast(Line(text, authorName, authorId, at, image))
            while (lines.size > MAX_LINES) lines.removeFirst()
        }
        post(context, channelId, conversationTitle, isGroup, selfName, authorAvatar)
    }

    /**
     * A reply that was sent from the shade.
     *
     * Appended to the thread rather than clearing it, which is what every other
     * messaging app does and what makes a reply feel like it went somewhere.
     */
    fun noteOwnReply(
        context: Context,
        channelId: String,
        conversationTitle: String,
        isGroup: Boolean,
        selfName: String,
        text: String,
    ) {
        val lines = history[channelId] ?: return
        synchronized(lines) {
            lines.addLast(Line(text, selfName, "", System.currentTimeMillis(), mine = true))
            while (lines.size > MAX_LINES) lines.removeFirst()
        }
        post(context, channelId, conversationTitle, isGroup, selfName, authorAvatar = null)
    }

    /** The channel is open, or was read elsewhere. Its thread goes with it. */
    fun clear(context: Context, channelId: String) {
        history.remove(channelId)
        NotificationManagerCompat.from(context).cancel(idOf(channelId))
    }

    /** Sign-out: another account's conversations must not survive into the next. */
    fun clearAll(context: Context) {
        val ids = history.keys.toList()
        history.clear()
        val manager = NotificationManagerCompat.from(context)
        ids.forEach { manager.cancel(idOf(it)) }
    }

    private fun post(
        context: Context,
        channelId: String,
        conversationTitle: String,
        isGroup: Boolean,
        selfName: String,
        authorAvatar: Bitmap?,
    ) {
        val lines = history[channelId]?.let { synchronized(it) { it.toList() } }.orEmpty()
        if (lines.isEmpty()) return

        val self = Person.Builder().setName(selfName).setKey("self").build()
        val style = NotificationCompat.MessagingStyle(self)
            .setConversationTitle(conversationTitle.takeIf { isGroup })
            .setGroupConversation(isGroup)

        lines.forEach { line ->
            val person = if (line.mine) {
                null
            } else {
                Person.Builder()
                    .setName(line.author)
                    .setKey(line.authorId)
                    .apply { if (authorAvatar != null) setIcon(IconCompat.createWithBitmap(authorAvatar)) }
                    .build()
            }
            val message = NotificationCompat.MessagingStyle.Message(line.text, line.at, person)
            // A picture is attached to the line it arrived on, which is what
            // puts it in the expanded view instead of a "1 attachment" label.
            line.image?.let { message.setData("image/jpeg", bitmapUri(context, channelId, it)) }
            style.addMessage(message)
        }

        val builder = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_betweenus_notification)
            .setStyle(style)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openChannel(context, channelId))
            .setDeleteIntent(dismissed(context, channelId))
            .addAction(replyAction(context, channelId))
            .addAction(markReadAction(context, channelId))

        // The picture, once more, as the big view - `MessagingStyle` shows the
        // newest one there, and a photo somebody sent is the whole message.
        lines.lastOrNull()?.image?.let { builder.setLargeIcon(it) }

        NotificationManagerCompat.from(context).notify(idOf(channelId), builder.build())
    }

    /**
     * The direct-reply box.
     *
     * `FLAG_MUTABLE` because that is the point: the system fills the reply text
     * into this intent. It is a broadcast rather than an activity, so answering
     * from the shade never opens the app - which is the entire reason anybody
     * uses it.
     */
    private fun replyAction(context: Context, channelId: String): NotificationCompat.Action {
        val remote = RemoteInput.Builder(REPLY_KEY).setLabel("Reply").build()
        val intent = PendingIntent.getBroadcast(
            context,
            idOf(channelId),
            Intent(context, NotificationActionReceiver::class.java)
                .setAction(NotificationActionReceiver.ACTION_REPLY)
                .putExtra(NotificationActionReceiver.EXTRA_CHANNEL_ID, channelId),
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Action.Builder(R.drawable.ic_betweenus_notification, "Reply", intent)
            .addRemoteInput(remote)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .build()
    }

    private fun markReadAction(context: Context, channelId: String): NotificationCompat.Action {
        val intent = PendingIntent.getBroadcast(
            context,
            idOf(channelId) + 1,
            Intent(context, NotificationActionReceiver::class.java)
                .setAction(NotificationActionReceiver.ACTION_MARK_READ)
                .putExtra(NotificationActionReceiver.EXTRA_CHANNEL_ID, channelId),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Action.Builder(
            R.drawable.ic_betweenus_notification,
            "Mark as read",
            intent,
        )
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
            .setShowsUserInterface(false)
            .build()
    }

    /**
     * Swiping the notification away drops the thread with it. Without this the
     * next message re-posts a conversation somebody has already dismissed.
     */
    private fun dismissed(context: Context, channelId: String): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            idOf(channelId) + 2,
            Intent(context, NotificationActionReceiver::class.java)
                .setAction(NotificationActionReceiver.ACTION_DISMISS)
                .putExtra(NotificationActionReceiver.EXTRA_CHANNEL_ID, channelId),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    /**
     * Tapping opens the conversation, through the same `betweenus://` scheme an
     * invite link uses - so there is one way into a channel from outside the
     * app rather than a second one that only notifications know about.
     */
    private fun openChannel(context: Context, channelId: String): PendingIntent = PendingIntent.getActivity(
        context,
        idOf(channelId) + 3,
        Intent(context, MainActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse("betweenus://channel/$channelId"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /**
     * A picture the shade can read.
     *
     * `MessagingStyle.Message.setData` takes a URI, and the system UI is a
     * different process: it cannot be handed a bitmap or a path into this app's
     * data. The plaintext is written into the cache directory the `FileProvider`
     * already publishes, under a name per channel so a channel holds one at a
     * time rather than one per message forever.
     */
    private fun bitmapUri(context: Context, channelId: String, bitmap: Bitmap): Uri? = runCatching {
        val directory = java.io.File(context.cacheDir, "notifications").apply { mkdirs() }
        val file = java.io.File(directory, "${idOf(channelId)}.jpg")
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
        val uri = androidx.core.content.FileProvider.getUriForFile(
            context,
            "${context.packageName}.files",
            file,
        )
        // A notification is drawn by the system UI, which holds no permission
        // on this app's provider unless it is given one. Without this the
        // picture is simply absent, with nothing in the log to say why.
        context.grantUriPermission(
            "com.android.systemui",
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION,
        )
        uri
    }.getOrNull()

    /**
     * A stable id per channel, so the next message in a conversation replaces
     * its notification instead of stacking beside it.
     */
    fun idOf(channelId: String): Int = 2000 + (channelId.hashCode() and 0x0000FFFF)

    /** Decodes a downloaded picture down to something a notification can hold. */
    fun decodeForNotification(bytes: ByteArray, maxPixels: Int = 1024): Bitmap? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > maxPixels) sample *= 2
        BitmapFactory.decodeByteArray(
            bytes,
            0,
            bytes.size,
            BitmapFactory.Options().apply { inSampleSize = sample },
        )
    }.getOrNull()
}
