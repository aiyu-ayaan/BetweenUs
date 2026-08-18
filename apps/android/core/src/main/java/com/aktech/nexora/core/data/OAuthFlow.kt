package com.aktech.nexora.core.data

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import okio.ByteString.Companion.encodeUtf8
import okio.ByteString.Companion.toByteString
import java.net.URLEncoder
import java.security.SecureRandom

/**
 * Signing in through a provider, from a phone.
 *
 * An account created through Google or GitHub has no password - the server
 * stores a hash nothing can match - so before this existed, such an account
 * could not get into this client by any route at all.
 *
 * The desktop finishes its sign-in on a loopback port, which nothing else on
 * the machine can take because it is already listening. A phone has no such
 * thing, so the provider hand-off comes back through `nexora://oauth`, and
 * Android will not promise that only this app is registered for that scheme.
 *
 * So the flow is bound to a secret rather than to the redirect. A random
 * verifier is minted here and kept here; only its SHA-256 goes to the server.
 * An app that registered the same scheme and intercepted the redirect gets a
 * one-time code it cannot spend, because exchanging it requires the verifier.
 * That is RFC 7636's S256, and `auth-service` checks it in constant time.
 */
object OAuthFlow {
    /** Where the finished sign-in comes back. Declared in the manifest too. */
    const val REDIRECT = "nexora://oauth"

    private const val VERIFIER_KEY = "oauthVerifier"

    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.applicationContext
            .getSharedPreferences("nexora.oauth", Context.MODE_PRIVATE)
    }

    /**
     * Where to send the browser, with a fresh verifier remembered for the
     * exchange.
     *
     * Written to storage rather than held in a field: the Custom Tab is another
     * app in front of this one, and Android may take this process down while it
     * is there. A verifier that did not survive that would turn every slow
     * sign-in into "that sign-in did not start here".
     */
    fun startUrl(provider: String): String {
        val verifier = randomVerifier()
        prefs.edit().putString(VERIFIER_KEY, verifier).apply()

        return Endpoint.current() +
            "/api/v1/auth/oauth/$provider/start" +
            "?redirect=" + encode(REDIRECT) +
            "&challenge=" + encode(challengeFor(verifier))
    }

    /** The one-time code in a callback, or null when that is not what this is. */
    fun codeIn(uri: Uri?): String? {
        if (uri == null || uri.scheme != "nexora" || uri.host != "oauth") return null
        return uri.getQueryParameter("code")?.takeIf { it.isNotBlank() }
    }

    /**
     * Trades the code for a session.
     *
     * The verifier is spent whatever happens: a sign-in that failed is not one
     * to retry with the same secret, and one left behind would be a secret
     * sitting in storage for no reason.
     */
    suspend fun complete(code: String) {
        val verifier = prefs.getString(VERIFIER_KEY, null)
        prefs.edit().remove(VERIFIER_KEY).apply()
        checkNotNull(verifier) { "That sign-in did not start on this device" }

        Session.start(NexoraApi.oauthExchange(code, verifier))
    }

    /**
     * 32 random bytes as base64url: 43 characters, which is the length the
     * server's challenge check insists on.
     */
    private fun randomVerifier(): String =
        ByteArray(32).also { SecureRandom().nextBytes(it) }.toByteString().base64Url().trimEnd('=')

    /** The base64url SHA-256 of [verifier] - `challengeFor` in `oauth.service.ts`. */
    fun challengeFor(verifier: String): String =
        verifier.encodeUtf8().sha256().base64Url().trimEnd('=')

    private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")
}
