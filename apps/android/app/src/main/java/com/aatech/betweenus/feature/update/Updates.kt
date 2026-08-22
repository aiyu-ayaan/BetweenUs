package com.aatech.betweenus.feature.update

import android.content.Context
import android.content.Intent
import android.app.PendingIntent
import android.content.SharedPreferences
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.aatech.betweenus.BuildConfig
import com.aatech.betweenus.core.data.Http
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONArray
import java.io.File

/**
 * The app keeping itself up to date, from the GitHub releases it was built by.
 *
 * There is no Play Store in the loop: BetweenUs is self-hosted and its APKs are
 * published by `.github/workflows/release.yml`, so the app has to be the thing
 * that notices a new one. What it does is deliberately small - ask GitHub what
 * exists, work out whether any of it is newer than what is running, download
 * the build for this device's ABI, and hand the file to Android's own package
 * installer.
 *
 * It never installs anything on its own. Android has no silent install for an
 * app that is not the device owner, and it should not: the last screen is
 * always the system's, showing what is about to replace what.
 *
 * The check runs when the app is opened, and once a day while it is not - see
 * [UpdateWorker], which exists because the launch check reaches everybody
 * except the phone that has not opened BetweenUs in three weeks, and that is
 * precisely the phone running a three-week-old build.
 *
 * ponytail: SharedPreferences and one in-memory state, like the endpoint and
 * the audio settings. Six values do not need a database.
 */
object Updates {

    private const val FILE = "betweenus.updates"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_CHANNEL = "channel"
    private const val KEY_SNOOZE_DAYS = "snoozeDays"
    private const val KEY_SNOOZED_UNTIL = "snoozedUntil"
    private const val KEY_LAST_CHECKED = "lastChecked"

    /** One day, which is the point of a snooze: later today is not later. */
    const val DEFAULT_SNOOZE_DAYS = 1

    private const val DAY_MILLIS = 24L * 60 * 60 * 1000

    private lateinit var prefs: SharedPreferences
    private lateinit var downloads: File

    /**
     * The application context, held only so the switch can start and stop the
     * daily job. Nothing else here keeps a context: a settings screen turning
     * auto update off has no business passing one in.
     */
    private var scheduler: Context? = null

    /** What this build is, or null for a hand-built one that carries `0.0.0`. */
    val installed: Version? by lazy { Version.parse(BuildConfig.VERSION_NAME) }

    val installedName: String get() = BuildConfig.VERSION_NAME

    private val _state = MutableStateFlow<UpdateState>(UpdateState.Idle)
    val state: StateFlow<UpdateState> = _state.asStateFlow()

    fun init(context: Context) {
        val app = context.applicationContext
        scheduler = app
        prefs = app.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        downloads = File(app.cacheDir, "updates")
        // Idempotent: KEEP leaves an already-running period alone, so this is
        // safe to call on every launch and is the only place it has to be
        // called at all.
        runCatching { UpdateWorker.schedule(app) }
    }

    private val ready: Boolean get() = ::prefs.isInitialized

    /**
     * On by default. An app distributed as an APK has no store to tell anybody
     * a security fix exists, so the useful default is the one that notices.
     */
    var enabled: Boolean
        get() = !ready || prefs.getBoolean(KEY_ENABLED, true)
        set(value) {
            if (ready) prefs.edit().putBoolean(KEY_ENABLED, value).apply()
            if (!value) _state.value = UpdateState.Idle
            // A switch that says "no" and leaves a daily job running is a
            // switch that lied. [scheduler] is set by the application.
            scheduler?.let { context -> runCatching { UpdateWorker.schedule(context) } }
        }

    /**
     * Defaults to the channel this build came from: somebody running an alpha
     * asked for alphas, and defaulting them to stable would strand them on the
     * build they have until its version is released.
     */
    var channel: UpdateChannel
        get() = if (ready && prefs.contains(KEY_CHANNEL)) {
            UpdateChannel.of(prefs.getString(KEY_CHANNEL, null))
        } else {
            UpdateChannel.forVersion(installedName)
        }
        set(value) {
            if (ready) prefs.edit().putString(KEY_CHANNEL, value.name).apply()
            // What was on offer came from the old channel, and on a narrower
            // one it may not be on offer at all.
            _state.value = UpdateState.Idle
        }

    /** How long "not now" lasts. */
    var snoozeDays: Int
        get() = if (ready) prefs.getInt(KEY_SNOOZE_DAYS, DEFAULT_SNOOZE_DAYS) else DEFAULT_SNOOZE_DAYS
        set(value) {
            if (ready) prefs.edit().putInt(KEY_SNOOZE_DAYS, value.coerceIn(1, 30)).apply()
        }

    val lastChecked: Long get() = if (ready) prefs.getLong(KEY_LAST_CHECKED, 0) else 0

    private val snoozedUntil: Long get() = if (ready) prefs.getLong(KEY_SNOOZED_UNTIL, 0) else 0

    /**
     * Quiet until the snooze runs out. Asking again tomorrow is asking; asking
     * again on the next launch is nagging.
     */
    fun snoozed(now: Long = System.currentTimeMillis()): Boolean = now < snoozedUntil

    fun snooze(now: Long = System.currentTimeMillis()) {
        if (ready) {
            prefs.edit().putLong(KEY_SNOOZED_UNTIL, now + snoozeDays * DAY_MILLIS).apply()
        }
        _state.value = UpdateState.Idle
    }

    /** Dismissing the prompt without deciding. It comes back on the next launch. */
    fun dismiss() {
        _state.value = UpdateState.Idle
    }

    /**
     * Ask GitHub what exists.
     *
     * [manual] is the difference between the button on the settings screen and
     * the check on launch: the button says so when there is nothing new and
     * ignores a snooze, and the launch check stays silent.
     */
    suspend fun check(manual: Boolean = false): UpdateState = withContext(Dispatchers.IO) {
        if (!manual && (!enabled || snoozed())) return@withContext _state.value
        _state.value = UpdateState.Checking

        val next = runCatching {
            val response = Http.get(Releases.API)
            if (response.status !in 200..299) error("GitHub answered ${response.status}")
            val releases = parse(response.body)
            val pick = Releases.pick(releases, installed, channel)
                ?: return@runCatching UpdateState.UpToDate
            val apk = Releases.apkFor(pick, Build.SUPPORTED_ABIS.toList())
            // A release with no APK for this device is not an offer. It
            // happens: a release whose Android job failed still exists.
                ?: return@runCatching UpdateState.UpToDate
            UpdateState.Available(pick, apk)
        }.getOrElse { UpdateState.Failed(it.message ?: "The update check failed") }

        if (ready) prefs.edit().putLong(KEY_LAST_CHECKED, System.currentTimeMillis()).apply()
        _state.value = next
        next
    }

    /**
     * The releases GitHub returned, minus the drafts and anything whose tag is
     * not a version this app understands.
     */
    internal fun parse(body: String): List<Release> {
        val array = JSONArray(body)
        return (0 until array.length()).mapNotNull { index ->
            val json = array.getJSONObject(index)
            if (json.optBoolean("draft")) return@mapNotNull null
            val version = Version.parse(json.optString("tag_name")) ?: return@mapNotNull null
            val assets = json.optJSONArray("assets")
            Release(
                version = version,
                name = json.optString("name").ifBlank { json.optString("tag_name") },
                notes = json.optString("body"),
                publishedAt = json.optString("published_at"),
                assets = (0 until (assets?.length() ?: 0)).map { position ->
                    val asset = assets!!.getJSONObject(position)
                    ReleaseAsset(
                        name = asset.optString("name"),
                        url = asset.optString("browser_download_url"),
                        size = asset.optLong("size"),
                    )
                },
            )
        }
    }

    /**
     * Fetch the APK, reporting progress, and leave it in the cache.
     *
     * Streamed to disk rather than read into memory: an APK is tens of
     * megabytes and this app already asks for a large heap for a different
     * reason. The cache is the right place - an installed update has no further
     * use for the file, and Android may reclaim one that was never installed.
     */
    suspend fun download(
        release: Release,
        asset: ReleaseAsset,
        onProgress: (Float) -> Unit = {},
    ): File = withContext(Dispatchers.IO) {
        downloads.mkdirs()
        // Everything else in the directory is a previous attempt or a previous
        // version, and neither is worth keeping.
        downloads.listFiles()?.forEach { if (it.name != asset.name) it.delete() }
        val target = File(downloads, asset.name)
        if (asset.size > 0 && target.length() == asset.size) {
            _state.value = UpdateState.Ready(release, target)
            return@withContext target
        }

        _state.value = UpdateState.Downloading(release, 0f)
        val request = Request.Builder().url(asset.url).build()
        Http.client.newCall(request).execute().use { response ->
            val body = response.body
            if (!response.isSuccessful || body == null) error("The download failed (${response.code})")
            val total = if (asset.size > 0) asset.size else body.contentLength()
            var written = 0L
            body.byteStream().use { input ->
                target.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read == -1) break
                        output.write(buffer, 0, read)
                        written += read
                        if (total > 0) {
                            val fraction = (written.toFloat() / total).coerceIn(0f, 1f)
                            onProgress(fraction)
                            _state.value = UpdateState.Downloading(release, fraction)
                        }
                    }
                }
            }
        }
        _state.value = UpdateState.Ready(release, target)
        target
    }

    /**
     * Whether Android will let this app start an install at all.
     *
     * From API 26 "install unknown apps" is a per-app setting rather than a
     * device-wide one, and it is not a runtime permission: it cannot be asked
     * for with a dialog, only opened in settings. Below 26 the manifest
     * declaration is the whole of it.
     */
    fun canInstall(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    /** The settings page that grants it, for this app alone. */
    fun requestInstallPermission(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        context.startActivity(
            Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    /**
     * Hand the APK to Android's package installer, which shows what is about to
     * replace what and asks. That screen is the system's and is not skippable,
     * which is the correct end to this: nothing here installs anything behind
     * anybody's back.
     *
     * A `PackageInstaller` session rather than an `ACTION_VIEW` intent on a
     * `content://` URI. Both end at the same confirmation dialog, and the
     * difference is entirely what happens afterwards: the intent form is fire
     * and forget, so the most likely failure of all - an APK signed with a
     * different key from the installed build, which is what somebody
     * sideloading their first release hits - came back as a dialog that closed
     * and an app that had not changed. A session reports its outcome to
     * [UpdateInstallReceiver], and the reason can be said out loud.
     *
     * Suspending because it copies tens of megabytes into the session, which is
     * not something to do while a finger is still on the button.
     */
    suspend fun install(context: Context, apk: File): Unit = withContext(Dispatchers.IO) {
        val installer = context.applicationContext.packageManager.packageInstaller
        val parameters = PackageInstaller.SessionParams(
            PackageInstaller.SessionParams.MODE_FULL_INSTALL,
        ).apply {
            setAppPackageName(context.packageName)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setRequireUserAction(
                PackageInstaller.SessionParams.USER_ACTION_REQUIRED,
            )
        }

        val sessionId = installer.createSession(parameters)
        installer.openSession(sessionId).use { session ->
            session.openWrite(SESSION_FILE, 0, apk.length()).use { sink ->
                apk.inputStream().use { it.copyTo(sink) }
                session.fsync(sink)
            }
            // The receiver is where the answer arrives - including the one that
            // matters, which is "user action required": the system dialog is
            // handed back rather than shown, and something has to start it.
            val status = PendingIntent.getBroadcast(
                context.applicationContext,
                sessionId,
                Intent(context.applicationContext, UpdateInstallReceiver::class.java)
                    .setAction(UpdateInstallReceiver.ACTION_STATUS),
                PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            session.commit(status.intentSender)
        }
    }

    private const val SESSION_FILE = "betweenus.apk"

    fun fail(message: String) {
        _state.value = UpdateState.Failed(message)
    }
}

/** Where a check, a download or an install has got to. */
sealed interface UpdateState {
    data object Idle : UpdateState

    data object Checking : UpdateState

    data object UpToDate : UpdateState

    data class Available(val release: Release, val apk: ReleaseAsset) : UpdateState

    data class Downloading(val release: Release, val progress: Float) : UpdateState

    data class Ready(val release: Release, val file: File) : UpdateState

    data class Failed(val message: String) : UpdateState
}
