package com.aatech.betweenus.feature.notifications

import android.content.Context
import com.aatech.betweenus.BuildConfig
import com.aatech.betweenus.core.crypto.DeviceIdentity
import com.aatech.betweenus.core.data.PushTokens
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await

/**
 * Firebase, and the one place that knows about it.
 *
 * `:core` holds the session and makes the registration call, but it must not
 * depend on Play services to do it - a web or a desktop build of the same logic
 * would never have them. So the token is fetched here and handed over through
 * [PushTokens.provider], and everything above this file is transport-agnostic.
 *
 * [enabled] is false in a checkout with no `google-services.json`: there is no
 * project to get a token from, the plugin was not applied, and the whole app
 * still builds and runs without push. That is deliberate - see FCM/README.md.
 */
object Push {
    val enabled: Boolean get() = BuildConfig.HAS_FIREBASE

    fun init(context: Context) {
        MessageNotifications.ensureChannels(context)
        if (!enabled) return

        PushTokens.label = DeviceIdentity.label()
        PushTokens.appVersion = BuildConfig.VERSION_NAME
        PushTokens.provider = {
            // Suspends until Firebase has one. It mints a token per install and
            // hands back the same one until it rotates, so this is cheap after
            // the first call.
            runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull()
        }
    }
}
