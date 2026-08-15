package com.aktech.nexora.feature.voice

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
import com.aktech.nexora.MainActivity
import com.aktech.nexora.R

/**
 * Keeps a call alive while the app is not on screen.
 *
 * Android will kill a process that is only holding a microphone in the
 * background, and a call that dies when the screen locks is not a call. A
 * foreground service with an ongoing notification is the way to say "this is
 * still happening" - and the notification is not a nuisance here, it is the
 * honest disclosure that the microphone is open.
 */
class CallService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val label = intent?.getStringExtra(EXTRA_LABEL) ?: "In a call"
        startForeground(NOTIFICATION_ID, notification(label), foregroundTypes())
        return START_STICKY
    }

    private fun foregroundTypes(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        } else {
            0
        }

    private fun notification(label: String): Notification {
        ensureChannel(this)
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_nexora_notification)
            .setContentTitle(label)
            .setContentText("Tap to return to the call")
            .setContentIntent(open)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "nexora.calls"
        private const val NOTIFICATION_ID = 1001
        private const val EXTRA_LABEL = "label"

        /**
         * Its own channel, separate from messages, so somebody can silence one
         * without the other.
         */
        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager = context.getSystemService(NotificationManager::class.java)
            if (manager.getNotificationChannel(CHANNEL_ID) != null) return
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Calls", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shown while a voice or video call is running"
                    setShowBadge(false)
                },
            )
        }

        fun start(context: Context, label: String) {
            val intent = Intent(context, CallService::class.java).putExtra(EXTRA_LABEL, label)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, CallService::class.java))
        }
    }
}
