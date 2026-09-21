package com.aatech.betweenus.feature.schedule

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.aatech.betweenus.MainActivity
import com.aatech.betweenus.R
import com.aatech.betweenus.core.crypto.SecureStore
import com.aatech.betweenus.core.data.ApiError
import com.aatech.betweenus.core.data.ServerClock
import com.aatech.betweenus.core.store.Conversation
import com.aatech.betweenus.core.store.Scheduling
import com.aatech.betweenus.feature.notifications.PushGate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Scheduled messages and reminders, held and fired by this phone.
 *
 * Local on purpose - `Scheduling.kt` and the desktop's `schedule.ts` say why:
 * the server must never hold an unsent message, and holding sealed ciphertext
 * for later release would be a new server capability. So the words stay here
 * and are sealed and sent at the due time through the ordinary send path
 * (`Conversation.send`), under whatever key the channel has then.
 *
 * What makes "the device must be running" true on a phone is [ScheduledWorker]:
 * WorkManager persists the wake-up across process death and reboots and runs
 * it in the background, which is the same promise the update check and the
 * upload service lean on. A phone that was off or out of range at the time runs
 * the worker on the next chance; a send that goes more than five minutes late
 * is followed by a notification saying so.
 *
 * At rest the list is sealed with [SecureStore] - the Keystore-wrapped store the
 * identity keys use - rather than sitting in preferences as plaintext, because
 * unsent words are the one thing here the server has never seen.
 * Sign-out drops the lot.
 */
object Scheduled {
    private const val KEY = "scheduled.items"
    private const val WORK = "betweenus.scheduled.fire"

    private lateinit var secure: SecureStore
    private val _items = MutableStateFlow<List<Scheduling.Item>>(emptyList())

    /** Everything waiting, soonest first. */
    val items: StateFlow<List<Scheduling.Item>> = _items.asStateFlow()

    /** Called once, from the application. Idempotent. */
    fun init(context: Context) {
        if (::secure.isInitialized) return
        val app = context.applicationContext
        secure = SecureStore(app)
        _items.value = Scheduling.decode(secure.get(KEY)).sortedBy { it.dueAt }
        arm(app)
    }

    private fun initialised() = ::secure.isInitialized

    @Synchronized
    private fun write(context: Context, items: List<Scheduling.Item>) {
        val sorted = items.sortedBy { it.dueAt }
        _items.value = sorted
        if (initialised()) secure.put(KEY, Scheduling.encode(sorted))
        arm(context.applicationContext)
    }

    @Synchronized
    private fun current(): List<Scheduling.Item> =
        if (initialised()) Scheduling.decode(secure.get(KEY)).sortedBy { it.dueAt } else _items.value

    private fun newId() = UUID.randomUUID().toString()

    fun scheduleMessage(
        context: Context,
        channelId: String,
        channelName: String,
        serverId: String?,
        text: String,
        dueAt: Long,
    ) {
        val item = Scheduling.Item(
            kind = Scheduling.Kind.MESSAGE,
            id = newId(),
            channelId = channelId,
            channelName = channelName,
            serverId = serverId,
            dueAt = dueAt,
            createdAt = ServerClock.nowMs(),
            text = text.trim(),
        )
        write(context, current() + item)
    }

    fun remind(
        context: Context,
        channelId: String,
        channelName: String,
        serverId: String?,
        messageId: String,
        author: String,
        text: String,
        dueAt: Long,
    ) {
        val item = Scheduling.Item(
            kind = Scheduling.Kind.REMINDER,
            id = newId(),
            channelId = channelId,
            channelName = channelName,
            serverId = serverId,
            dueAt = dueAt,
            createdAt = ServerClock.nowMs(),
            messageId = messageId,
            author = author,
            excerpt = Scheduling.excerptOf(text),
        )
        write(context, current() + item)
    }

    fun reschedule(context: Context, id: String, dueAt: Long) =
        write(context, current().map { if (it.id == id) Scheduling.rescheduled(it, dueAt) else it })

    /** Also how a failed one is tried again. */
    fun sendNow(context: Context, id: String) =
        write(
            context,
            current().map {
                if (it.id == id && it.kind == Scheduling.Kind.MESSAGE) {
                    Scheduling.sendingNow(it, ServerClock.nowMs())
                } else {
                    it
                }
            },
        )

    fun cancel(context: Context, id: String) =
        write(context, current().filterNot { it.id == id })

    /** Sign-out: unsent words and reminders go with the account they were written for. */
    fun clear(context: Context) {
        if (initialised()) secure.remove(KEY)
        _items.value = emptyList()
        WorkManager.getInstance(context.applicationContext).cancelUniqueWork(WORK)
    }

    /**
     * Points WorkManager at the soonest thing waiting. One unique piece of
     * work, replaced each time, so however many items there are there is one
     * wake-up pending. Nothing waiting, nothing pending.
     */
    private fun arm(context: Context) {
        val work = WorkManager.getInstance(context)
        val wait = Scheduling.nextWake(_items.value, ServerClock.nowMs())
        if (wait == null) {
            work.cancelUniqueWork(WORK)
            return
        }
        work.enqueueUniqueWork(
            WORK,
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<ScheduledWorker>()
                .setInitialDelay(wait, TimeUnit.MILLISECONDS)
                .build(),
        )
    }

    /** Acts on everything due. Called by the worker, and safe to call twice. */
    internal suspend fun fireDue(context: Context) {
        val app = context.applicationContext
        val due = Scheduling.ready(current(), ServerClock.nowMs())
        for (item in due) {
            // Re-read: the row may have been cancelled or sent while the last
            // one was going out.
            if (current().none { it.id == item.id }) continue
            when (item.kind) {
                Scheduling.Kind.REMINDER -> {
                    ScheduledNotifications.reminder(app, item, ServerClock.nowMs())
                    write(app, current().filterNot { it.id == item.id })
                }

                Scheduling.Kind.MESSAGE -> send(app, item)
            }
        }
        arm(app)
    }

    private suspend fun send(context: Context, item: Scheduling.Item) {
        val result = runCatching {
            // A wake-up at boot runs before anything has signed in.
            requireNotNull(PushGate.ensureSession()) { "This phone is not signed in" }
            Conversation.send(item.channelId, item.text, emptyList())
        }
        val now = ServerClock.nowMs()
        val error = result.exceptionOrNull()
        if (error == null) {
            write(context, current().filterNot { it.id == item.id })
            ScheduledNotifications.sentLate(context, item, now)
            return
        }
        val status = (error as? ApiError)?.status?.takeIf { it > 0 }
        val failed = Scheduling.afterFailure(
            item,
            now,
            status,
            error.message ?: "The message could not be sent",
        )
        write(context, current().map { if (it.id == item.id) failed else it })
        if (failed.retryAt == null) ScheduledNotifications.notSent(context, failed)
    }
}

/** WorkManager's wake-up for [Scheduled]. */
class ScheduledWorker(context: Context, parameters: WorkerParameters) :
    CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        Scheduled.init(applicationContext)
        Scheduled.fireDue(applicationContext)
        return Result.success()
    }
}

/**
 * The notifications scheduling raises. Their own channel, so somebody who finds
 * reminders too much can turn them off without losing message notifications.
 * They ignore per-channel mutes and quiet-hour rules for the same reason the
 * desktop's do: a reminder is a person talking to their future self, and one a
 * mute could swallow did not remind.
 */
object ScheduledNotifications {
    const val CHANNEL = "betweenus.reminders"

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Reminders and scheduled messages", NotificationManager.IMPORTANCE_HIGH)
                .apply { description = "Reminders you set, and scheduled messages that went out late" },
        )
    }

    /** Opens the channel, the same `betweenus://channel/<id>` link a message notification uses. */
    private fun open(context: Context, id: Int, channelId: String): PendingIntent =
        PendingIntent.getActivity(
            context,
            id,
            Intent(context, MainActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse("betweenus://channel/$channelId"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    private fun post(context: Context, item: Scheduling.Item, title: String, body: String) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        ensureChannel(context)
        val id = item.id.hashCode()
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_betweenus_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(open(context, id, item.channelId))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(id, notification) }
    }

    fun reminder(context: Context, item: Scheduling.Item, firedAt: Long) {
        val (title, body) = Scheduling.reminderNotice(item, firedAt)
        post(context, item, title, body)
    }

    fun sentLate(context: Context, item: Scheduling.Item, firedAt: Long) {
        val (title, body) = Scheduling.sentNotice(item, firedAt) ?: return
        post(context, item, title, body)
    }

    fun notSent(context: Context, item: Scheduling.Item) {
        val where = if (item.serverId != null) "#${item.channelName}" else item.channelName
        post(
            context,
            item,
            "Scheduled message to $where was not sent",
            "${item.error ?: "It could not be sent"}. \"${Scheduling.excerptOf(item.text, 80)}\"",
        )
    }
}
