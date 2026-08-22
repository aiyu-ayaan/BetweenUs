package com.aatech.betweenus.feature.update

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.aatech.betweenus.MainActivity
import com.aatech.betweenus.R
import java.util.concurrent.TimeUnit

/**
 * The check that happens while the app is closed.
 *
 * The launch check covers somebody who opens BetweenUs every day. It covers
 * nobody else - and "nobody else" is exactly who a security fix has to reach,
 * because a phone that has not opened the app in three weeks is a phone running
 * a three-week-old build and nothing is going to tell it so.
 *
 * So: once a day, on unmetered network, and it draws a notification only when
 * there is genuinely a newer release for this device. It does not download
 * anything - a background download would spend somebody's storage on a decision
 * they have not made - and it does not install anything, because nothing here
 * ever does.
 *
 * ponytail: `PeriodicWorkRequest`, not an alarm and not a job scheduled by
 * hand. WorkManager already survives reboots, doze and process death, which is
 * the entire hard part of this.
 */
class UpdateWorker(context: Context, parameters: WorkerParameters) :
    CoroutineWorker(context, parameters) {

    override suspend fun doWork(): Result {
        // Read now rather than when the work was scheduled: the switch may have
        // been turned off since, and a snooze is a snooze whichever check finds
        // the release.
        if (!Updates.enabled || Updates.snoozed()) return Result.success()

        return when (val state = Updates.check()) {
            is UpdateState.Available -> {
                notify(applicationContext, state)
                Result.success()
            }
            // A failed check is a network that was worse than WorkManager
            // thought, not an error worth telling anybody about. The next run
            // is tomorrow, and retrying now would be retrying into the same
            // network.
            is UpdateState.Failed -> Result.success()
            else -> Result.success()
        }
    }

    private fun notify(context: Context, available: UpdateState.Available) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        ensureChannel(context)

        // Opens the auto update screen, which is where the decision is made and
        // where the download it needs can be watched.
        val open = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID,
            Intent(context, MainActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse("betweenus://update"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_betweenus_notification)
            .setContentTitle("BetweenUs ${available.release.name} is available")
            .setContentText("You are on ${Updates.installedName}. Tap to update.")
            .setContentIntent(open)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        // One id, always. A phone that was off for a fortnight has no business
        // showing a fortnight of releases.
        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    }

    companion object {
        private const val WORK = "betweenus.update.check"
        private const val CHANNEL = "betweenus.updates"
        private const val NOTIFICATION_ID = 90_001

        /**
         * Once a day while auto update is on, and cancelled the moment it is
         * off - a switch that says "no" and leaves a daily job running is a
         * switch that lied.
         */
        fun schedule(context: Context) {
            val work = WorkManager.getInstance(context)
            if (!Updates.enabled) {
                work.cancelUniqueWork(WORK)
                return
            }

            val request = PeriodicWorkRequestBuilder<UpdateWorker>(1, TimeUnit.DAYS)
                .setConstraints(
                    Constraints.Builder()
                        // Unmetered, because the point of the check is to lead
                        // to a download of tens of megabytes. Finding an update
                        // on somebody's mobile data and telling them about it
                        // is fine; it is the next step that is expensive, and
                        // this is the honest place to be careful about it.
                        .setRequiredNetworkType(NetworkType.UNMETERED)
                        .setRequiresBatteryNotLow(true)
                        .build(),
                )
                // A day is not a deadline. Letting WorkManager pick the moment
                // inside it is what keeps this off the battery.
                .setInitialDelay(6, TimeUnit.HOURS)
                .build()

            // KEEP, not UPDATE: replacing the request on every launch resets
            // its period, and an app opened daily would then never reach the
            // end of one.
            work.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK)
        }

        /** Taken out of the shade once the app has shown the offer itself. */
        fun clearNotification(context: Context) {
            NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
        }

        private fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            if (manager.getNotificationChannel(CHANNEL) != null) return
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL,
                    "App updates",
                    // Low: a new version is worth seeing, and is never worth
                    // interrupting anything for.
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "A newer BetweenUs release is available"
                },
            )
        }
    }
}
