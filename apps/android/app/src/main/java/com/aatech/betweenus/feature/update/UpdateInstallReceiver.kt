package com.aatech.betweenus.feature.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller

/**
 * How an install ended.
 *
 * A `PackageInstaller` session answers here, and there are only three answers
 * worth acting on:
 *
 *   PENDING_USER_ACTION  the system's confirmation dialog, handed back rather
 *                        than shown. Somebody has to start it, and that is the
 *                        whole reason this receiver exists.
 *   SUCCESS              nothing to do: this process is about to be replaced.
 *   anything else        a reason, said out loud on the update screen.
 *
 * The failure this is really for is `INSTALL_FAILED_UPDATE_INCOMPATIBLE`: an
 * APK signed with a different key from the installed build. It is what somebody
 * sideloading their first release hits, and with the older `ACTION_VIEW` install
 * it appeared as a dialog that closed and an app that had not changed.
 *
 * Not exported. The only thing that may send this is the platform, answering a
 * session this app created.
 */
class UpdateInstallReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_STATUS) return

        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, Int.MIN_VALUE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = intent.extra(Intent.EXTRA_INTENT) ?: return
                // Started from a receiver, so it has no task of its own to
                // live in.
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runCatching { context.startActivity(confirm) }
                    .onFailure { Updates.fail(it.message ?: "Android would not show the install screen") }
            }

            // The new build is being written over this one. There is nothing
            // useful to say and nobody left to say it to.
            PackageInstaller.STATUS_SUCCESS -> Unit

            PackageInstaller.STATUS_FAILURE_ABORTED -> Updates.dismiss()

            PackageInstaller.STATUS_FAILURE_CONFLICT -> Updates.fail(
                "Android refused the update: this APK is signed with a different key from the " +
                    "installed build. Uninstall this copy first, and note that uninstalling " +
                    "takes its data with it.",
            )

            else -> Updates.fail(
                intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                    ?: "The install failed",
            )
        }
    }

    @Suppress("DEPRECATION")
    private fun Intent.extra(name: String): Intent? =
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            getParcelableExtra(name, Intent::class.java)
        } else {
            getParcelableExtra(name)
        }

    companion object {
        const val ACTION_STATUS = "com.aatech.betweenus.UPDATE_INSTALL_STATUS"
    }
}
