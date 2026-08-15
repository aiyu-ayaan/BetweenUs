package com.aktech.nexora.core.data

import android.content.Context
import android.content.SharedPreferences
import com.aktech.nexora.core.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URI

/**
 * Which deployment this install talks to.
 *
 * The port of `apps/desktop/src/services/endpoint.ts`. Nexora is meant to be
 * self-hosted, so the address the build shipped with is a default and not a
 * decision: [BuildConfig.DEFAULT_SERVER_URL] comes from `nexora.serverUrl` in
 * `local.properties`, and the server picker overrides it at runtime.
 *
 * The address is checked before it is stored - a typo should be a line under
 * the field, not an app that no longer starts.
 */
object Endpoint {
    private const val KEY = "serverUrl"

    private lateinit var prefs: SharedPreferences
    private var cached: String? = null

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences("nexora.endpoint", Context.MODE_PRIVATE)
    }

    /** The address the build shipped with. Never ends in `/`. */
    fun default(): String = trimTrailingSlash(BuildConfig.DEFAULT_SERVER_URL)

    /** The gateway base for every request this install makes. */
    fun current(): String {
        cached?.let { return it }
        val stored = prefs.getString(KEY, null)
        return (if (stored.isNullOrBlank()) default() else trimTrailingSlash(stored)).also { cached = it }
    }

    /** True while this install is on the address the build shipped with. */
    fun isDefault(): Boolean = current() == default()

    /** Stores a chosen address; `null` goes back to the one the build shipped. */
    fun set(url: String?) {
        prefs.edit().apply { if (url == null) remove(KEY) else putString(KEY, trimTrailingSlash(url)) }.apply()
        cached = null
    }

    /**
     * Resolves a URL the server handed back - an avatar, a server icon, an
     * attachment - against the current deployment. They come back rooted at
     * `/api/v1/uploads/...`, which is not a URL anything can fetch on its own.
     */
    fun absolute(url: String): String = when {
        Regex("^(https?|blob|data):", RegexOption.IGNORE_CASE).containsMatchIn(url) -> url
        url.startsWith("/") -> current() + url
        else -> current() + "/" + url
    }

    /** Base for the WebSockets. Same host, same path, ws scheme. */
    fun webSocket(): String =
        current().replaceFirst(Regex("^http", RegexOption.IGNORE_CASE), "ws")

    /** The host, for a line under a sign-in form. */
    fun label(): String = current().replace(Regex("^https?://", RegexOption.IGNORE_CASE), "")

    private fun trimTrailingSlash(url: String): String = url.trim().trimEnd('/')

    /**
     * What a person types, turned into a base URL.
     *
     * No scheme means https, because a bare hostname on the internet is not
     * http in 2025. A query or a fragment is not part of a base and is dropped;
     * a path is kept, because a deployment can live under one.
     */
    fun normalize(raw: String): String {
        val trimmed = raw.trim()
        require(trimmed.isNotEmpty()) { "Enter a server address" }

        val withScheme = if (Regex("^[a-z][a-z0-9+.-]*://", RegexOption.IGNORE_CASE).containsMatchIn(trimmed)) {
            trimmed
        } else {
            "https://$trimmed"
        }

        val uri = try {
            URI(withScheme)
        } catch (_: Exception) {
            throw IllegalArgumentException("That is not a valid address")
        }

        val scheme = uri.scheme?.lowercase()
        require(scheme == "http" || scheme == "https") { "Only http:// and https:// addresses work" }
        require(!uri.host.isNullOrBlank()) { "That address has no host" }

        val port = if (uri.port == -1) "" else ":${uri.port}"
        return trimTrailingSlash("$scheme://${uri.host}$port${uri.rawPath.orEmpty()}")
    }

    /**
     * The provider list is the probe because it is the one route that is
     * public, always present, and answers with something recognisably Nexora.
     */
    private const val PROBE_PATH = "/api/v1/auth/oauth/providers"

    /**
     * The base a request actually landed on, given the URL the probe ended at.
     *
     * A deployment that redirects http to https, or bare to www, would
     * otherwise have its Authorization header stripped on every later request:
     * the redirect crosses an origin and the header does not follow. Storing
     * where the probe ended means nothing is ever redirected again.
     */
    fun baseFromProbeUrl(probeUrl: String, fallback: String): String =
        if (probeUrl.endsWith(PROBE_PATH)) trimTrailingSlash(probeUrl.removeSuffix(PROBE_PATH))
        else trimTrailingSlash(fallback)

    /** Returns the address to store, which is where the probe ended up. */
    suspend fun probe(base: String): String = withContext(Dispatchers.IO) {
        val result = Http.get(base + PROBE_PATH)
        if (result.status !in 200..299) throw IllegalArgumentException("That address answered ${result.status}")
        if (!result.body.trimStart().startsWith("[")) {
            throw IllegalArgumentException("That address is not a Nexora server")
        }
        baseFromProbeUrl(result.finalUrl, base)
    }
}
