package com.aatech.betweenus.feature.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.graphics.drawable.IconCompat
import com.aatech.betweenus.MainActivity
import com.aatech.betweenus.R
import com.aatech.betweenus.feature.voice.IncomingCallActivity
import java.util.concurrent.ConcurrentHashMap

/**
 * The notifications that are not a conversation: a friend request, a server
 * somebody was added to, and a call happening in a channel they can hear.
 *
 * Kept apart from [MessageNotifications] because none of them is a message.
 * There is no thread to hold, nothing to reply to, and no sealed body - a
 * friend request has no words, and a name and a server's name are public.
 *
 * A call is the one with a life of its own. It is one notification per channel,
 * rewritten as people come and go, and it is *cancelled* by a roster that has
 * emptied - which is the only way a phone told about a call ever finds out it
 * is over.
 */
object SocialNotifications {

    /** Friend requests and server invitations: worth seeing, not worth a fright. */
    const val CHANNEL_SOCIAL = "betweenus.social"

    /** Somebody is in a call you can join. Loud, like a call should be. */
    const val CHANNEL_CALLS = "betweenus.calls.incoming"

    /**
     * A call that is ringing at you personally, which is a different thing
     * from one happening nearby. Its own channel because it is the one that
     * takes over the screen and plays a ringtone, and somebody who wants the
     * quiet version has to be able to turn this off without losing the other.
     */
    const val CHANNEL_RINGING = "betweenus.calls.ringing"

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_SOCIAL) == null) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_SOCIAL,
                    "Friends and servers",
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply {
                    description = "Friend requests, and being added to a server"
                },
            )
        }
        if (manager.getNotificationChannel(CHANNEL_CALLS) == null) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_CALLS,
                    "Calls you can join",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Somebody started a call in a channel you can hear"
                    enableVibration(true)
                },
            )
        }
        if (manager.getNotificationChannel(CHANNEL_RINGING) == null) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_RINGING,
                    "Incoming calls",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Somebody is calling you"
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 700, 700, 700, 700)
                    setSound(
                        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build(),
                    )
                },
            )
        }
    }

    /**
     * Somebody is calling, and this phone is not looking at the conversation.
     *
     * A `CallStyle` notification with a full-screen intent, which is what puts
     * the answer screen over a locked phone rather than a line in the shade.
     * It rings for a direct conversation only: a call in a server's voice
     * channel is something happening nearby, and a phone that rings for every
     * one of those is a phone somebody turns notifications off on. Those keep
     * [callRoster], which is the quiet version and unchanged.
     *
     * Declined is remembered for as long as the call lasts, because the roster
     * changes every time anybody joins or leaves and each change is another
     * push: without it, saying no once means being asked again by the next
     * person to arrive.
     */
    fun ringing(
        context: Context,
        channelId: String,
        caller: String,
        callerPicture: Bitmap?,
    ) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        if (channelId in declined) return
        ensureChannels(context)

        val id = idOf(RING_BASE, channelId)
        val person = Person.Builder()
            .setName(caller)
            .apply { callerPicture?.let { setIcon(IconCompat.createWithBitmap(it)) } }
            .setImportant(true)
            .build()

        val answer = PendingIntent.getActivity(
            context,
            id,
            Intent(context, MainActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse("betweenus://call/$channelId"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        // The full-screen intent is its own activity rather than MainActivity:
        // showing over a locked phone is a property of an activity, and giving
        // it to the main one would give it to every launch of the app.
        val ring = PendingIntent.getActivity(
            context,
            id,
            IncomingCallActivity.intent(context, channelId, caller),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val decline = PendingIntent.getBroadcast(
            context,
            id,
            Intent(context, NotificationActionReceiver::class.java)
                .setAction(NotificationActionReceiver.ACTION_DECLINE_CALL)
                .putExtra(NotificationActionReceiver.EXTRA_CHANNEL_ID, channelId),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_RINGING)
            .setSmallIcon(R.drawable.ic_betweenus_notification)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, answer))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            // `true` is what lets it interrupt: without it the platform is
            // free to decide a heads-up notification was enough, which is
            // exactly what it decides for a phone that is in somebody's pocket.
            .setFullScreenIntent(ring, true)
            .setContentIntent(answer)
            .build()

        posted.add(id)
        NotificationManagerCompat.from(context).notify(id, notification)
    }

    /** Answered, declined, or the caller gave up. */
    fun clearRinging(context: Context, channelId: String) {
        val id = idOf(RING_BASE, channelId)
        posted.remove(id)
        NotificationManagerCompat.from(context).cancel(id)
    }

    /** Said no. Silent until this call ends, not until the app restarts. */
    fun declineCall(context: Context, channelId: String) {
        declined.add(channelId)
        clearRinging(context, channelId)
    }

    private val declined = java.util.Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())

    /** "Ana sent you a friend request", or "Ana accepted your friend request". */
    fun friend(
        context: Context,
        actorId: String,
        actorName: String,
        actorAvatar: Bitmap?,
        accepted: Boolean,
    ) {
        val text = if (accepted) {
            "$actorName accepted your friend request"
        } else {
            "$actorName sent you a friend request"
        }
        post(
            context = context,
            id = idOf(FRIEND_BASE, actorId),
            channel = CHANNEL_SOCIAL,
            title = if (accepted) "Friend request accepted" else "Friend request",
            text = text,
            picture = actorAvatar,
            link = "betweenus://friends",
        )
    }

    /** "You were added to Acme". */
    fun serverAdded(context: Context, serverId: String, serverName: String, icon: Bitmap?) {
        post(
            context = context,
            id = idOf(SERVER_BASE, serverId),
            channel = CHANNEL_SOCIAL,
            title = serverName,
            text = "You were added to $serverName",
            picture = icon,
            link = "betweenus://server/$serverId",
        )
    }

    /**
     * Somebody is on one of this account's machines.
     *
     * The one notification here that exists because of what it means when it
     * is unexpected. Remote access is the capability whose misuse is invisible
     * to the person it happens to - they are, by definition, not sitting at
     * the machine - so this is loud, it stays until it is dismissed, and
     * nothing but turning notifications off entirely can silence it.
     *
     * [started] false cancels it: the session is over and a standing
     * notification saying somebody is on your machine when nobody is would be
     * the same alarm, permanently, for nothing.
     */
    fun remoteSession(
        context: Context,
        sessionId: String,
        machineName: String,
        actorName: String,
        started: Boolean,
    ) {
        val id = idOf(REMOTE_BASE, sessionId)
        if (!started) {
            NotificationManagerCompat.from(context).cancel(id)
            return
        }
        post(
            context = context,
            id = id,
            channel = CHANNEL_SOCIAL,
            title = "Remote session on $machineName",
            text = "$actorName connected to $machineName",
            picture = null,
            link = "betweenus://remote",
            ongoing = true,
        )
    }

    /**
     * Who is in a call in [channelId], or nobody - and nobody cancels it.
     *
     * The whole roster rather than the arrival, so three people joining one
     * after another is one notification that keeps up rather than three.
     */
    fun callRoster(
        context: Context,
        channelId: String,
        channelName: String,
        participants: String,
        count: Int,
    ) {
        if (count == 0 || participants.isBlank()) {
            clearCall(context, channelId)
            return
        }
        post(
            context = context,
            id = idOf(CALL_BASE, channelId),
            channel = CHANNEL_CALLS,
            title = "Call in #$channelName",
            text = if (count == 1) "$participants is in a call" else "$participants are in a call",
            picture = null,
            link = "betweenus://channel/$channelId",
            ongoing = true,
        )
    }

    fun clearCall(context: Context, channelId: String) {
        // The call is over, so a refusal to answer it has expired with it.
        declined.remove(channelId)
        clearRinging(context, channelId)
        val id = idOf(CALL_BASE, channelId)
        posted.remove(id)
        NotificationManagerCompat.from(context).cancel(id)
    }

    /**
     * Sign-out: a friend request naming somebody must not survive into the next
     * account. Only what this object posted, tracked as it posts - `cancelAll`
     * would take the ongoing call notification with it, and that belongs to a
     * foreground service that is still running.
     */
    fun clearAll(context: Context) {
        val manager = NotificationManagerCompat.from(context)
        val ids = posted.toList()
        posted.clear()
        ids.forEach { manager.cancel(it) }
    }

    private val posted = java.util.Collections.newSetFromMap(ConcurrentHashMap<Int, Boolean>())

    private fun post(
        context: Context,
        id: Int,
        channel: String,
        title: String,
        text: String,
        picture: Bitmap?,
        link: String,
        ongoing: Boolean = false,
    ) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        val builder = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_betweenus_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setCategory(
                if (channel == CHANNEL_CALLS) {
                    NotificationCompat.CATEGORY_CALL
                } else {
                    NotificationCompat.CATEGORY_SOCIAL
                },
            )
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            // A call notification that is swiped away while the call is still
            // running would never come back: the roster only changes when
            // somebody arrives or leaves.
            .setOngoing(ongoing)
            .setAutoCancel(!ongoing)
            .setContentIntent(open(context, id, link))
        picture?.let { builder.setLargeIcon(it) }
        posted.add(id)
        NotificationManagerCompat.from(context).notify(id, builder.build())
    }

    private fun open(context: Context, id: Int, link: String): PendingIntent =
        PendingIntent.getActivity(
            context,
            id,
            Intent(context, MainActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse(link))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    /**
     * A stable id per subject, in a band per kind, so a second friend request
     * stacks beside the first and a changing call roster replaces itself. The
     * bands are a million apart, well clear of the ids `MessageNotifications`
     * and `CallService` hand out.
     */
    private fun idOf(base: Int, key: String): Int = base + (key.hashCode() and 0x0000FFFF)

    private const val FRIEND_BASE = 3_000_000
    private const val SERVER_BASE = 4_000_000
    private const val CALL_BASE = 5_000_000
    private const val REMOTE_BASE = 7_500_000
    private const val RING_BASE = 6_000_000
}
