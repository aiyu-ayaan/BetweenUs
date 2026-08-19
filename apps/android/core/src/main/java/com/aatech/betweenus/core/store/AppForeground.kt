package com.aatech.betweenus.core.store

import android.app.Activity
import android.app.Application
import android.os.Bundle

/**
 * Whether somebody is actually looking at the app.
 *
 * Half of the WhatsApp rule. A push for the channel already on screen must not
 * become a notification - but "on screen" is two facts, not one:
 * `Conversation.visibleChannelId` says which conversation the app is showing,
 * and this says whether the app is being shown at all. Without the second, a
 * phone locked mid-conversation goes silent for that channel forever, because
 * the chat screen is still composed behind the lock screen.
 *
 * Counted rather than flagged: a `startActivity` resumes the new activity
 * before pausing the old one, so a boolean flickers false in the middle of a
 * navigation that never left the app.
 */
object AppForeground {
    @Volatile
    private var resumed = 0

    val visible: Boolean get() = resumed > 0

    fun init(application: Application) {
        application.registerActivityLifecycleCallbacks(
            object : Application.ActivityLifecycleCallbacks {
                override fun onActivityResumed(activity: Activity) {
                    resumed += 1
                }

                override fun onActivityPaused(activity: Activity) {
                    resumed = (resumed - 1).coerceAtLeast(0)
                }

                override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit
                override fun onActivityStarted(activity: Activity) = Unit
                override fun onActivityStopped(activity: Activity) = Unit
                override fun onActivitySaveInstanceState(activity: Activity, out: Bundle) = Unit
                override fun onActivityDestroyed(activity: Activity) = Unit
            },
        )
    }
}
