package com.aatech.betweenus.ui.components

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper

/**
 * The activity behind a composable's context.
 *
 * `LocalContext.current as? Activity` is the obvious line and it is wrong: the
 * context Compose hands out is wrapped - by the theme, by the view tree, and by
 * the window a dialog or a modal bottom sheet composes into - so the cast
 * quietly produces null and whatever was going to be asked of the activity
 * never happens.
 *
 * It has cost this app two visible bugs already: the share stage's landscape
 * button, and the server picker, whose `recreate()` after switching deployments
 * silently did nothing. One helper, so the next caller does not find out the
 * same way.
 */
tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
