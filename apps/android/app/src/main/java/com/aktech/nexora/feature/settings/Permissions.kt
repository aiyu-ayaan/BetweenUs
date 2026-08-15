package com.aktech.nexora.feature.settings

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat

/**
 * Android's runtime permissions, asked for at the moment they mean something.
 *
 * Nothing here is requested on launch. A microphone prompt before anybody has
 * joined a call is a prompt with no context, and the honest answer to it is
 * "no" - which then has to be undone in system settings rather than by tapping
 * the thing again. So each one is tied to the action that needs it:
 *
 *   RECORD_AUDIO      joining a voice channel
 *   CAMERA            turning the camera on inside a call, or taking a photo
 *                     to send
 *   READ_MEDIA_*      opening the attachment sheet, for the grid of recent
 *                     photos - and only for that; the system photo picker and
 *                     the document browser need nothing
 *   POST_NOTIFICATIONS  the first time a notification would be worth showing
 *
 * A permanently refused permission is not asked for twice; the caller is told,
 * and offers the settings screen instead.
 */
object NexoraPermissions {
    const val MICROPHONE = Manifest.permission.RECORD_AUDIO
    const val CAMERA = Manifest.permission.CAMERA

    /** Only exists from API 33; before that a notification needs no permission. */
    val NOTIFICATIONS: String? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.POST_NOTIFICATIONS
        } else {
            null
        }

    /** Only needed on API <= 28 for writing to public storage; API 29+ uses Scoped MediaStore without permission. */
    val WRITE_STORAGE: String? =
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            Manifest.permission.WRITE_EXTERNAL_STORAGE
        } else {
            null
        }

    /**
     * What it takes to read the phone's photos, which changed twice.
     *
     * API 33 split storage into per-type permissions; API 34 added a third that
     * means "these photos and no others", granted precisely when the first two
     * are refused. So this is a list and the test is [anyGranted]: holding only
     * the user-selected one is real access to a real set of photos, and calling
     * that "no" would show an empty grid to somebody who had just chosen what
     * to share.
     */
    val MEDIA: List<String> = when {
        Build.VERSION.SDK_INT >= 34 -> listOf(
            Manifest.permission.READ_MEDIA_IMAGES,
            Manifest.permission.READ_MEDIA_VIDEO,
            Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED,
        )

        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> listOf(
            Manifest.permission.READ_MEDIA_IMAGES,
            Manifest.permission.READ_MEDIA_VIDEO,
        )

        else -> listOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }

    fun granted(context: Context, permission: String?): Boolean =
        permission == null ||
            ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    /** True when at least one of [permissions] is held. See [MEDIA]. */
    fun anyGranted(context: Context, permissions: List<String>): Boolean =
        permissions.any { granted(context, it) }

    fun openSettings(context: Context) {
        context.startActivity(
            Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", context.packageName, null),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}

/**
 * Asks for one permission when the action that needs it is taken.
 *
 * Returns a function to call at that moment: it runs [onGranted] straight away
 * if the permission is already held, and otherwise asks and runs it on the way
 * back. [refused] turns true once the system has stopped showing the dialog, so
 * a screen can say what is missing rather than appearing to do nothing.
 */
@Composable
fun rememberPermission(
    permission: String?,
    onGranted: () -> Unit,
): PermissionRequest {
    val context = LocalContext.current
    var refused by remember { mutableStateOf(false) }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { allowed ->
        refused = !allowed
        if (allowed) onGranted()
    }

    return PermissionRequest(
        refused = refused,
        onRequest = {
            if (NexoraPermissions.granted(context, permission)) {
                onGranted()
            } else {
                refused = false
                launcher.launch(permission!!)
            }
        },
        onOpenSettings = { NexoraPermissions.openSettings(context) },
    )
}

/**
 * Asks for several permissions at once, where only [required] decides whether
 * the action goes ahead.
 *
 * Joining a call is the case this exists for. It needs the microphone, and it
 * wants notifications - a call that cannot show its ongoing notification still
 * works, it is just harder to get back to - so refusing the second must not
 * refuse the first. Android shows the prompts one after another and reports
 * them together.
 */
@Composable
fun rememberPermissions(
    permissions: List<String>,
    required: String,
    onGranted: () -> Unit,
): PermissionRequest {
    val context = LocalContext.current
    var refused by remember { mutableStateOf(false) }
    val asked = remember(permissions) { permissions.distinct() }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
        val allowed = results[required] ?: NexoraPermissions.granted(context, required)
        refused = !allowed
        if (allowed) onGranted()
    }

    return PermissionRequest(
        refused = refused,
        onRequest = {
            val missing = asked.filterNot { NexoraPermissions.granted(context, it) }
            if (missing.isEmpty()) {
                onGranted()
            } else {
                refused = false
                launcher.launch(missing.toTypedArray())
            }
        },
        onOpenSettings = { NexoraPermissions.openSettings(context) },
    )
}

/**
 * Functions, not `() -> Unit` properties, and that is the point.
 *
 * As properties, `camera.request` compiled - it is a perfectly good lambda
 * value - and did nothing, so the camera button in a call silently never asked
 * for the permission and never turned the camera on. As a member function the
 * same line will not compile. Anywhere one is genuinely wanted as a callback,
 * `{ camera.request() }` says so.
 */
/**
 * Asks for a set of permissions where holding any one of them is enough.
 *
 * Reading photos is the case this exists for: on API 34 "only these photos" is
 * a different permission from "all photos", and somebody who chose the first
 * has granted access, not refused it. See [NexoraPermissions.MEDIA].
 */
@Composable
fun rememberAnyPermission(
    permissions: List<String>,
    onGranted: () -> Unit,
): PermissionRequest {
    val context = LocalContext.current
    var refused by remember { mutableStateOf(false) }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        // The results map is not consulted: what matters is what is held now,
        // and on API 34 the system can grant a permission that was not asked
        // for in place of one that was.
        val allowed = NexoraPermissions.anyGranted(context, permissions)
        refused = !allowed
        if (allowed) onGranted()
    }

    return PermissionRequest(
        refused = refused,
        onRequest = {
            if (NexoraPermissions.anyGranted(context, permissions)) {
                onGranted()
            } else {
                refused = false
                launcher.launch(permissions.toTypedArray())
            }
        },
        onOpenSettings = { NexoraPermissions.openSettings(context) },
    )
}

class PermissionRequest(
    val refused: Boolean,
    private val onRequest: () -> Unit,
    private val onOpenSettings: () -> Unit,
) {
    fun request() = onRequest()

    fun openSettings() = onOpenSettings()
}
