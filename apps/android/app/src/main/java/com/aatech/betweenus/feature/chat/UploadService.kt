package com.aatech.betweenus.feature.chat

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.aatech.betweenus.MainActivity
import com.aatech.betweenus.R

/**
 * The promise that a message with a video in it finishes.
 *
 * Without a foreground service, work that outlives the screen is work Android
 * is entitled to stop, and it does - so leaving the channel, or answering a
 * call, or putting the phone in a pocket, abandoned an upload with its parts
 * already in object storage. This is the ongoing notification that says a file
 * is going out, which is both the disclosure the platform requires and the
 * progress bar somebody actually wants.
 *
 * It knows nothing about uploading. [Outbox] owns the queue and pushes what to
 * draw; this only draws it.
 */
class UploadService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        live = this
        startForeground(NOTIFICATION_ID, notification(latest), foregroundType())
        // Never START_STICKY: a restarted service is an ongoing "sending…"
        // notification for a queue the process no longer has.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        if (live === this) live = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    private fun foregroundType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        } else {
            0
        }

    private fun notification(progress: Outbox.Progress?): Notification {
        ensureChannel(this)

        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java)
                .setAction(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val percent = ((progress?.fraction ?: 0f) * 100).toInt()
        val title = progress?.name ?: "Sending"
        val line = buildString {
            append("Encrypting and uploading… $percent%")
            if (progress != null && progress.total > 1) {
                append(" · ${progress.index} of ${progress.total}")
            }
            if (progress != null && progress.queued > 0) append(" · ${progress.queued} waiting")
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_betweenus_notification)
            .setContentTitle(title)
            .setContentText(line)
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            // Indeterminate until there is a number worth reading: a small file
            // is sealed and gone before a percentage would settle.
            .setProgress(100, percent, progress == null)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "betweenus.uploads"
        private const val NOTIFICATION_ID = 1002

        private var live: UploadService? = null
        private var latest: Outbox.Progress? = null

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager = context.getSystemService(NotificationManager::class.java)
            if (manager.getNotificationChannel(CHANNEL_ID) != null) return
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Sending files", NotificationManager.IMPORTANCE_LOW)
                    .apply {
                        description = "Shown while a message with files attached is going out"
                        setShowBadge(false)
                        setSound(null, null)
                        enableVibration(false)
                    },
            )
        }

        fun start(context: Context) {
            ensureChannel(context)
            val intent = Intent(context, UploadService::class.java)
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            }
            // A start refused because the app is in the background is not a
            // reason to lose the message: the queue runs either way, it simply
            // has no promise of surviving the process being trimmed.
        }

        /** Redraws the notification in place. Cheap, and called about once a second. */
        fun update(progress: Outbox.Progress) {
            latest = progress
            val service = live ?: return
            runCatching {
                service.getSystemService(NotificationManager::class.java)
                    .notify(NOTIFICATION_ID, service.notification(progress))
            }
        }

        fun stop(context: Context) {
            latest = null
            runCatching { context.stopService(Intent(context, UploadService::class.java)) }
        }
    }
}
