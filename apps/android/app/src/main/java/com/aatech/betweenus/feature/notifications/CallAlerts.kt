package com.aatech.betweenus.feature.notifications

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat

/**
 * Whether this phone is set up to ring, and what to open when it is not.
 *
 * A push can be perfect and still not ring: the app cannot see any of what
 * decides it. Notifications switched off, the "Incoming calls" channel muted or
 * demoted to a quiet one, and - from Android 14 - the full-screen permission,
 * which a phone grants a calling app by default and an app like this one only
 * when somebody does. Each of those turns a ringing call into a line in the
 * shade, and nothing on screen says so.
 *
 * Stated here so the settings screen can say it, in the order somebody should
 * fix it.
 */
enum class CallAlertHealth {
    /** Rings, over the lock screen. */
    OK,

    /** Every notification from this app is off. */
    NOTIFICATIONS_OFF,

    /** Somebody switched the "Incoming calls" channel off. */
    CHANNEL_OFF,

    /** The channel is on but demoted: no heads-up, so no ring on a phone in use. */
    CHANNEL_QUIET,

    /** A ring is a heads-up notification, but cannot take over a locked screen. */
    NO_FULL_SCREEN,
}

object CallAlerts {

    /**
     * The first thing wrong, or [CallAlertHealth.OK]. Pure so every combination
     * can be pinned; [health] is the one that asks the phone.
     *
     * [channelImportance] is null when the channel has not been created yet,
     * which is a channel that will be created correctly and so is fine.
     */
    fun healthOf(
        notificationsEnabled: Boolean,
        channelImportance: Int?,
        fullScreenAllowed: Boolean,
    ): CallAlertHealth = when {
        !notificationsEnabled -> CallAlertHealth.NOTIFICATIONS_OFF
        channelImportance == NotificationManager.IMPORTANCE_NONE -> CallAlertHealth.CHANNEL_OFF
        channelImportance != null && channelImportance < NotificationManager.IMPORTANCE_HIGH ->
            CallAlertHealth.CHANNEL_QUIET
        !fullScreenAllowed -> CallAlertHealth.NO_FULL_SCREEN
        else -> CallAlertHealth.OK
    }

    fun health(context: Context): CallAlertHealth {
        SocialNotifications.ensureChannels(context)
        val manager = context.getSystemService(NotificationManager::class.java)
        val importance = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager?.getNotificationChannel(SocialNotifications.CHANNEL_RINGING)?.importance
        } else {
            null
        }
        val fullScreen = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
            manager?.canUseFullScreenIntent() != false
        return healthOf(NotificationManagerCompat.from(context).areNotificationsEnabled(), importance, fullScreen)
    }

    /** One sentence for the settings row. */
    fun describe(health: CallAlertHealth): String = when (health) {
        CallAlertHealth.OK -> "Calls ring, even over the lock screen"
        CallAlertHealth.NOTIFICATIONS_OFF -> "Notifications are off, so a call will not ring. Tap to turn them on."
        CallAlertHealth.CHANNEL_OFF -> "Incoming calls are switched off for this app. Tap to turn them on."
        CallAlertHealth.CHANNEL_QUIET -> "Incoming calls are set to a quiet alert. Tap to set them to urgent."
        CallAlertHealth.NO_FULL_SCREEN ->
            "Calls cannot take over a locked screen. Tap to allow full-screen alerts."
    }

    /** The system screen where [health] is put right. */
    fun fix(context: Context, health: CallAlertHealth): Intent {
        val app = context.packageName
        val intent = when (health) {
            CallAlertHealth.NO_FULL_SCREEN ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$app"))
                } else {
                    appNotificationSettings(app)
                }
            CallAlertHealth.CHANNEL_OFF, CallAlertHealth.CHANNEL_QUIET ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, app)
                        .putExtra(Settings.EXTRA_CHANNEL_ID, SocialNotifications.CHANNEL_RINGING)
                } else {
                    appNotificationSettings(app)
                }
            CallAlertHealth.NOTIFICATIONS_OFF, CallAlertHealth.OK -> appNotificationSettings(app)
        }
        return intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    private fun appNotificationSettings(app: String): Intent =
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, app)
}
