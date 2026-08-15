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
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import com.aktech.nexora.MainActivity
import com.aktech.nexora.R

/**
 * The call, as Android understands one.
 *
 * A call is not an app that happens to be recording. It outlives the screen
 * going off, it is answerable from the lock screen, and it can be hung up
 * without going back into the app that started it - so it is a foreground
 * service with a `CallStyle` notification, which is the shape the system
 * reserves for exactly this and renders accordingly.
 *
 * The two actions on it are the two that matter away from the call screen:
 * mute, and hang up. They come back through [attach], because the engine owns
 * the call and this service only represents it.
 *
 * ## Foreground types are claims, not decorations
 *
 * Android 14 and later require every declared type to be genuinely in use, and
 * kill the process when one is not: a service claiming `mediaProjection`
 * without a projection, or claiming `camera` with the camera off, is a crash
 * rather than a warning. So the caller passes what is actually running right
 * now and the service restarts itself whenever that changes.
 */
class CallService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_HANG_UP -> {
                onHangUp?.invoke()
                stopSelf()
                return START_NOT_STICKY
            }

            ACTION_TOGGLE_MUTE -> {
                onToggleMute?.invoke()
                return START_STICKY
            }
        }

        val label = intent?.getStringExtra(EXTRA_LABEL) ?: "In a call"
        val muted = intent?.getBooleanExtra(EXTRA_MUTED, false) ?: false
        val types = intent?.getIntExtra(EXTRA_TYPES, TYPE_MICROPHONE) ?: TYPE_MICROPHONE
        startForeground(NOTIFICATION_ID, notification(label, muted), foregroundTypes(types))

        // Only now is the service genuinely carrying the type it was started
        // with, which is the moment a projection is allowed to begin. See
        // `startThen`.
        if (types and TYPE_PROJECTION != 0) {
            val ready = whenProjectionReady
            whenProjectionReady = null
            ready?.let { Handler(Looper.getMainLooper()).post(it) }
        }

        // Never START_STICKY. A call cannot be resumed by the system - the
        // sockets are gone, the peer connections are gone, and the person hung
        // up - so a restarted service is an ongoing call notification for a
        // call that ended, which is exactly what kept coming back.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    /** The manifest's types, filtered to what this platform version knows about. */
    private fun foregroundTypes(wanted: Int): Int {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        if (wanted and TYPE_CAMERA != 0) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        if (wanted and TYPE_PROJECTION != 0) {
            types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        }
        return types
    }

    private fun notification(label: String, muted: Boolean): Notification {
        ensureChannel(this)

        // Resumes the task that is already running rather than starting another
        // one on top of it. Both halves matter: the activity is `singleTask` in
        // the manifest and the intent has to say so too, or the system builds a
        // second one - which is a second navigation graph, on the home screen,
        // with the call screen destroyed underneath it.
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java)
                .setAction(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_nexora_notification)
            .setContentTitle(label)
            .setContentText("Tap to return to the call")
            .setContentIntent(open)
            .setOngoing(true)
            .setUsesChronometer(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            // The notification is the disclosure that the microphone is open,
            // not an announcement worth a sound every time it is rebuilt.
            .setSilent(true)
            .setStyle(
                NotificationCompat.CallStyle.forOngoingCall(
                    Person.Builder().setName(label).setImportant(true).build(),
                    action(ACTION_HANG_UP, REQUEST_HANG_UP),
                ),
            )
            .addAction(
                NotificationCompat.Action.Builder(
                    R.drawable.ic_nexora_notification,
                    if (muted) "Unmute" else "Mute",
                    action(ACTION_TOGGLE_MUTE, REQUEST_TOGGLE_MUTE),
                ).build(),
            )

        return builder.build()
    }

    private fun action(name: String, request: Int): PendingIntent = PendingIntent.getService(
        this,
        request,
        Intent(this, CallService::class.java).setAction(name),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    companion object {
        /**
         * A new id rather than the old `nexora.calls`: the importance of an
         * existing channel cannot be raised, and a `CallStyle` notification on
         * a low-importance channel is shown as an ordinary one.
         */
        private const val CHANNEL_ID = "nexora.calls.ongoing"
        private const val NOTIFICATION_ID = 1001
        private const val EXTRA_LABEL = "label"
        private const val EXTRA_MUTED = "muted"
        private const val EXTRA_TYPES = "types"
        private const val REQUEST_HANG_UP = 1
        private const val REQUEST_TOGGLE_MUTE = 2

        private const val ACTION_HANG_UP = "com.aktech.nexora.call.HANG_UP"
        private const val ACTION_TOGGLE_MUTE = "com.aktech.nexora.call.TOGGLE_MUTE"

        /** What the service may claim to be doing. See `foregroundTypes`. */
        const val TYPE_MICROPHONE = 1
        const val TYPE_CAMERA = 2
        const val TYPE_PROJECTION = 4

        private var onHangUp: (() -> Unit)? = null
        private var onToggleMute: (() -> Unit)? = null

        /** Run once the service is carrying the media-projection type. */
        private var whenProjectionReady: (() -> Unit)? = null

        /**
         * Wires the notification's buttons to the live call. Static because the
         * service is started by the system and there is exactly one call.
         */
        fun attach(onHangUp: () -> Unit, onToggleMute: () -> Unit) {
            this.onHangUp = onHangUp
            this.onToggleMute = onToggleMute
        }

        fun detach() {
            onHangUp = null
            onToggleMute = null
        }

        /**
         * Its own channel, separate from messages, so somebody can silence one
         * without the other.
         */
        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager = context.getSystemService(NotificationManager::class.java)
            if (manager.getNotificationChannel(CHANNEL_ID) != null) return
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Calls", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Shown while a voice or video call is running"
                    setShowBadge(false)
                    setSound(null, null)
                    enableVibration(false)
                },
            )
        }

        /** Starts the call notification, or updates it in place. */
        fun start(context: Context, label: String, types: Int = TYPE_MICROPHONE, muted: Boolean = false) {
            val intent = Intent(context, CallService::class.java)
                .putExtra(EXTRA_LABEL, label)
                .putExtra(EXTRA_MUTED, muted)
                .putExtra(EXTRA_TYPES, types)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        /**
         * Starts the service carrying the media-projection type and runs
         * [then] once it genuinely is.
         *
         * `startForegroundService` returns before the service has run a single
         * line, so starting a projection on the next statement is a race the
         * platform loses on purpose: "Media projections require a foreground
         * service of type FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION", thrown
         * straight through `onActivityResult` and taking the process with it.
         * The capture has to wait for `startForeground` to have happened.
         */
        fun startThen(context: Context, label: String, types: Int, muted: Boolean, then: () -> Unit) {
            whenProjectionReady = then
            start(context, label, types, muted)
        }

        fun stop(context: Context) {
            whenProjectionReady = null
            context.stopService(Intent(context, CallService::class.java))
        }
    }
}
