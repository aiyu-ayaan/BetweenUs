package com.aatech.betweenus.core.data

import com.aatech.betweenus.core.crypto.DeviceIdentity

/**
 * This installation's push registration, as far as the session is concerned.
 *
 * The token itself comes from Firebase, which lives in `:app` - `:core` has no
 * business depending on Google Play services to make an HTTP call. So the token
 * arrives through [provider], set once at startup by whoever does own Firebase,
 * and this object is what the *session* calls: registered when a session
 * begins, and unregistered while there is still an access token to unregister
 * with. A row left behind pushes one account's messages at whoever signs in on
 * the phone next, which is the failure this ordering exists to prevent.
 *
 * With no provider - a build with no `google-services.json` - every call here
 * is a no-op and nothing else changes.
 */
object PushTokens {
    /** Set by `:app`. Returns the FCM registration token, or null if it cannot. */
    @Volatile
    var provider: (suspend () -> String?)? = null

    /** What the server should call this phone in a list of devices. */
    @Volatile
    var label: String? = null

    /** The client build, so a push a version cannot render can be skipped. */
    @Volatile
    var appVersion: String? = null

    /**
     * Called on sign-in, on restore, and on every rotation. Failure is not
     * worth surfacing: it means this phone gets nothing while it is closed,
     * which the next successful registration fixes on its own.
     */
    suspend fun register() {
        val token = runCatching { provider?.invoke() }.getOrNull() ?: return
        runCatching {
            BetweenUsApi.registerDevice(
                token = token,
                deviceId = DeviceIdentity.id(),
                label = label,
                appVersion = appVersion,
            )
        }
    }

    /** Called before the tokens are discarded, which is the only moment it works. */
    suspend fun unregister() {
        if (provider == null) return
        runCatching { BetweenUsApi.unregisterDevice(DeviceIdentity.id()) }
    }
}
