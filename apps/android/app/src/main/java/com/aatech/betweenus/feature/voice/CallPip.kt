package com.aatech.betweenus.feature.voice

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.PackageManager
import android.os.Build
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.activity.PictureInPictureModeChangedInfo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.util.Consumer
import androidx.lifecycle.Lifecycle

/**
 * Picture-in-picture for a call the user has walked away from.
 *
 * Leaving a call screen by the back gesture should not leave the call - it
 * should shrink it, the way every other phone call on the platform behaves.
 * The activity is the thing Android shrinks, so the call keeps running exactly
 * as it was and no renderer is rebuilt.
 *
 * **Picture-in-picture needs no permission.** There is no manifest permission
 * to declare and no runtime permission to ask for; the two things it does need
 * are already in AndroidManifest.xml on MainActivity -
 * `android:supportsPictureInPicture="true"` and a `configChanges` list wide
 * enough that entering the little window does not rebuild the activity.
 *
 * What it does have is three ways to be refused, none of which the app can ask
 * about in advance and all of which are ordinary rather than exceptional:
 *
 *  - the device has no picture-in-picture at all (Android Go, some TVs);
 *  - the user turned it off for this app, under Settings → Apps → Special app
 *    access → Picture-in-picture. That switch is on by default and there is no
 *    public API to read it, so the only way to learn the answer is to ask and
 *    be told no;
 *  - the activity is not in a state Android will shrink - finishing, stopped,
 *    or already gone.
 *
 * So [enter] answers a question rather than performing an action: it returns
 * whether the call was shrunk, and every refusal - including the ones that
 * arrive as an exception - comes back as `false` for the caller to handle.
 * Backing out of a call on a phone with no PiP therefore just leaves the
 * screen, which is the right thing to happen and not an error.
 */
object CallPip {

    /** True when the system took the request; false for every refusal. */
    fun enter(context: Context): Boolean {
        // enterPictureInPictureMode(params) arrived in O. Older platforms have
        // the mode but no way to state an aspect ratio, and are not worth a
        // second code path for a floating window nobody on 24 or 25 expects.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false

        val activity = context.activity() ?: return false

        // A device without the feature throws rather than returning false, and
        // an exception thrown on a perfectly ordinary phone is not a useful way
        // to find out the phone is ordinary.
        if (!activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
            return false
        }

        // Android refuses to shrink an activity that is on its way out or not
        // in front, and says so by throwing. Backing out of a call twice
        // quickly is enough to be here with the activity already finishing.
        if (activity.isFinishing || activity.isDestroyed) return false
        val resumed = (activity as? ComponentActivity)
            ?.lifecycle
            ?.currentState
            ?.isAtLeast(Lifecycle.State.RESUMED)
        if (resumed == false) return false

        // Portrait, and legal: Android rejects anything outside 1:2.39 .. 2.39:1
        // by throwing, and 9:16 is 0.5625, comfortably inside it.
        val params = PictureInPictureParams.Builder()
            .setAspectRatio(Rational(9, 16))
            .build()

        // The last net. Everything above turns a known refusal into a plain
        // false; this catches the ones only the system knows about - the
        // per-app switch being off, a manufacturer's own policy, a race with
        // the activity going away between the check above and the call.
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
 * The activity tells us, rather than being inferred from a new
 * [android.content.res.Configuration]. Configuration was the obvious key and
 * the wrong one: it is compared by value, so the answer only changes when some
 * field of it does, and it arrives on its own schedule relative to the mode
 * change. Listening to the mode change itself is both exact and earlier, and
 * `ComponentActivity` has carried the listener since activity 1.5.
 *
 * A context that is not a `ComponentActivity` - a preview, a test - simply
 * never reports being in PiP, which is true.
 */
@Composable
fun rememberInPictureInPicture(): Boolean {
    val context = LocalContext.current
    val activity = remember(context) {
        generateSequence(context) { (it as? ContextWrapper)?.baseContext }
            .filterIsInstance<ComponentActivity>()
            .firstOrNull()
    }

    var inPip by remember(activity) {
        mutableStateOf(activity?.isInPictureInPictureMode == true)
    }

    DisposableEffect(activity) {
        if (activity == null) return@DisposableEffect onDispose { }

        // Re-read on subscribe: the mode can have changed between the initial
        // state above and this effect running.
        inPip = activity.isInPictureInPictureMode

        val listener = Consumer<PictureInPictureModeChangedInfo> { info ->
            inPip = info.isInPictureInPictureMode
        }
        activity.addOnPictureInPictureModeChangedListener(listener)
        onDispose { activity.removeOnPictureInPictureModeChangedListener(listener) }
    }

    return inPip
}
