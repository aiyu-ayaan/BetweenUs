package com.aktech.nexora.core.store

import android.content.Context
import android.content.SharedPreferences

/**
 * Where the app was when it was last closed.
 *
 * A phone is not a desktop: it is left and come back to twenty times a day, and
 * Android kills the process in between whenever it feels like it. Coming back
 * to the friends list every time is coming back to the wrong place - the
 * conversation you were in the middle of is the one you are returning for.
 *
 * Only a text conversation is remembered, and deliberately so. Restoring into a
 * voice channel would rejoin a call the moment the launcher icon is tapped,
 * which is not a thing anybody asked for; restoring into settings or a remote
 * session would be restoring a detour rather than a place.
 *
 * ponytail: `SharedPreferences`, like the session and the endpoint. Three
 * strings do not need a database, and the file is private to the app.
 */
object LastPlace {
    private lateinit var prefs: SharedPreferences

    private const val KEY_SERVER = "serverId"
    private const val KEY_CHANNEL = "channelId"

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences("nexora.place", Context.MODE_PRIVATE)
    }

    /** Null before [init], so a screen can read it without ordering itself. */
    val serverId: String? get() = if (::prefs.isInitialized) prefs.getString(KEY_SERVER, null) else null

    val channelId: String? get() = if (::prefs.isInitialized) prefs.getString(KEY_CHANNEL, null) else null

    fun remember(serverId: String?, channelId: String?) {
        if (!::prefs.isInitialized) return
        prefs.edit().putString(KEY_SERVER, serverId).putString(KEY_CHANNEL, channelId).apply()
    }

    /** Signing out takes the place with it: it belongs to an account. */
    fun forget() {
        if (!::prefs.isInitialized) return
        prefs.edit().remove(KEY_SERVER).remove(KEY_CHANNEL).apply()
    }
}
