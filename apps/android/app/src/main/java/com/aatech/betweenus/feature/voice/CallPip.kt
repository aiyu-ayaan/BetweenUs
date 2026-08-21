package com.aatech.betweenus.feature.voice

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import android.util.Rational
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext

/**
 * Picture-in-picture for a call the user has walked away from.
 *
 * Leaving a call screen by the back gesture should not leave the call - it
 * should shrink it, the way every other phone call on the platform behaves.
 * The activity is the thing Android shrinks, so the call keeps running exactly
 * as it was and no renderer is rebuilt.
 */
object CallPip {

    /** True when the system took the request. Older platforms simply say no. */
    fun enter(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        val activity = context.activity() ?: return false
        val params = PictureInPictureParams.Builder()
            .setAspectRatio(Rational(9, 16))
            .build()
        // The system refuses in cases the app cannot see - PiP turned off for
        // the app, a device that has none. A refusal is not a crash.
        return runCatching { activity.enterPictureInPictureMode(params) }.getOrDefault(false)
    }

    private fun Context.activity(): Activity? {
        var current: Context? = this
        while (current is ContextWrapper) {
            if (current is Activity) return current
            current = current.baseContext
        }
        return null
    }
}

/**
 * Whether the call is currently the little floating window.
 *
 * Entering and leaving PiP is a configuration change, so a new
 * [LocalConfiguration] is exactly the moment the answer can differ - which
 * makes it the key, and saves listening for anything.
 */
@Composable
fun rememberInPictureInPicture(): Boolean {
    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    return remember(context, configuration) {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
            generateSequence(context) { (it as? ContextWrapper)?.baseContext }
                .filterIsInstance<Activity>()
                .firstOrNull()
                ?.isInPictureInPictureMode == true
    }
}
