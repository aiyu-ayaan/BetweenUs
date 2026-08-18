package com.aatech.betweenus.core.crypto

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import java.util.UUID

/**
 * Which machine this is, as far as the key directory is concerned.
 *
 * Minted here and never by the server: it identifies an installation, and an
 * installation is the only thing that knows it is one. It survives sign-out and
 * a change of account on purpose - the phone has not changed - and it is not a
 * secret, it is published beside a public key.
 *
 * Deliberately not `ANDROID_ID` or anything else the platform hands out. Those
 * are stable across reinstalls and shared with every app on the device, which
 * makes them a tracking identifier; this one is ours, is scoped to this app,
 * and goes when the app's data does. Losing it means the next launch looks like
 * a new device and is wrapped for as one, which is the correct answer rather
 * than a failure.
 */
object DeviceIdentity {
    private const val PREFS = "betweenus.device"
    private const val KEY = "deviceId"

    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    fun id(): String {
        prefs.getString(KEY, null)?.let { return it }
        return UUID.randomUUID().toString().also { prefs.edit().putString(KEY, it).apply() }
    }

    /**
     * What to call this phone in a list of machines. A label to recognise a row
     * by, not identity - the server treats it as the untrusted string it is.
     */
    fun label(): String = "${Build.MANUFACTURER} ${Build.MODEL}".trim()
}
