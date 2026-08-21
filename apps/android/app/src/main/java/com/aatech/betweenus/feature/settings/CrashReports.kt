package com.aatech.betweenus.feature.settings

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import androidx.core.content.FileProvider
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * What happened the last time this app died, kept only if it was asked for.
 *
 * Off by default and local: nothing is uploaded, nothing is sent anywhere, and
 * no third party is involved. A crash reporting SDK would mean an account with
 * somebody else, a network call from a self-hosted app to a service its
 * operator did not choose, and a stack trace leaving the device before anybody
 * saw it - which is a strange default for a product whose whole shape is that
 * the deployment belongs to whoever runs it.
 *
 * What this does instead is write the stack trace to a file in the app's own
 * storage and offer to share it, so a person reporting a bug has something to
 * attach. Sharing is the moment it leaves, and it is a deliberate one.
 *
 * ponytail: the last crash, not a ring buffer of them. The one that just
 * happened is the one being reported; add a history when somebody is actually
 * chasing an intermittent.
 */
object CrashReports {

    private const val FILE = "betweenus.crash"
    private const val KEY_ENABLED = "enabled"
    private const val REPORT = "last-crash.txt"

    private lateinit var prefs: SharedPreferences
    private lateinit var directory: File

    /** Installed from the application, before anything else can throw. */
    fun init(context: Context) {
        val app = context.applicationContext
        prefs = app.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        directory = File(app.filesDir, "crash").apply { mkdirs() }

        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            // The switch is read at the moment of the crash, not at install:
            // turning it on and then crashing has to record, and turning it off
            // has to stop recording without a restart.
            if (enabled) runCatching { write(thread, error) }
            // Always handed on. Swallowing it would leave the process alive in
            // a state nobody designed, which is worse than the crash.
            previous?.uncaughtException(thread, error)
        }
    }

    var enabled: Boolean
        get() = ::prefs.isInitialized && prefs.getBoolean(KEY_ENABLED, false)
        set(value) {
            if (!::prefs.isInitialized) return
            prefs.edit().putBoolean(KEY_ENABLED, value).apply()
            // Turning it off throws away what was already kept. Leaving a
            // stack trace on disk after somebody says stop is not what stop
            // means.
            if (!value) report()?.delete()
        }

    /** The last crash, if there is one and it was being recorded when it happened. */
    fun report(): File? = if (::directory.isInitialized) {
        File(directory, REPORT).takeIf { it.exists() }
    } else {
        null
    }

    /** Hands the file to whatever the person picks. Nothing sends it on its own. */
    fun share(context: Context): Intent? {
        val file = report() ?: return null
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        return Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, "BetweenUs crash report")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    private fun write(thread: Thread, error: Throwable) {
        val when_ = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
        val trace = StringWriter().also { error.printStackTrace(PrintWriter(it)) }
        // Deliberately no account, no email, no server address and no token:
        // what makes a crash report useful is the stack, and everything else
        // here would be something the person did not offer.
        File(directory, REPORT).writeText(
            buildString {
                appendLine("BetweenUs crash report")
                appendLine(when_)
                appendLine("thread: ${thread.name}")
                appendLine("android: ${android.os.Build.VERSION.SDK_INT}")
                appendLine("device: ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
                appendLine()
                append(trace.toString())
            },
        )
    }
}
