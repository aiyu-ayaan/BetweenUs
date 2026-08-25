package com.aatech.betweenus.core.store

import android.app.Activity
import android.app.Application
import android.os.Bundle
import com.aatech.betweenus.core.data.Connectivity

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
                    val returning = resumed == 0
                    resumed += 1
                    // Coming back to the app, rather than moving between two of
                    // its screens. The sockets are asked whether they are really
                    // up before anything else is: a background Android froze
                    // leaves a connection that is dead and a backoff that never
                    // ran, and both look like a banner that says "Reconnecting…"
                    // for as long as the app is left open.
                    if (returning) Connectivity.retry()
                    // A phone that has come back to the app is a phone reading
                    // whatever is on screen, and the server has to hear so.
                    ChannelFocus.apply()
                    // It is also a phone whose socket Android was free to drop
                    // while nobody was looking, so what is on screen may be
                    // several messages behind. Coming back is the other moment
                    // - besides a reconnect - when it has to be re-read.
                    Conversation.resumeVisible()
                }

                override fun onActivityPaused(activity: Activity) {
                    resumed = (resumed - 1).coerceAtLeast(0)
                    ChannelFocus.apply()
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
