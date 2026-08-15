package com.aktech.nexora.core.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** What the app shows: the splash, the sign-in form, or the app itself. */
sealed interface AuthPhase {
    /** Cold start, with a refresh token to try. Nothing is drawn but the mark. */
    data object Restoring : AuthPhase

    /** No session. [reason] is set when the last attempt failed for a reason
     *  worth repeating - a server that was unreachable, not a wrong password. */
    data class SignedOut(val reason: String? = null) : AuthPhase

    data class SignedIn(val user: PublicUser) : AuthPhase
}

/**
 * The one session this process has.
 *
 * The access token lives in memory only - it is short-lived and a process
 * death is a refresh away. The refresh token is what survives a restart, and
 * the email is remembered so signing in again does not mean typing it again.
 * A password is never stored anywhere.
 *
 * Both are in plain `SharedPreferences` for now, which is private to the app
 * but readable on a rooted device. Moving the refresh token into the Keystore
 * is the hardening phase in development/ANDROID_TODO.md.
 */
object Session {
    private const val REFRESH_KEY = "refreshToken"
    private const val EMAIL_KEY = "lastEmail"

    private lateinit var prefs: SharedPreferences
    private val refreshLock = Mutex()

    @Volatile
    var accessToken: String? = null
        private set

    private val _state = MutableStateFlow<AuthPhase>(AuthPhase.SignedOut())
    val state: StateFlow<AuthPhase> = _state.asStateFlow()

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences("nexora.session", Context.MODE_PRIVATE)
        // A stored refresh token means there is something to restore, and the
        // splash should stay up until it is known whether it still works.
        if (prefs.getString(REFRESH_KEY, null) != null) _state.value = AuthPhase.Restoring
    }

    /** Prefills the sign-in form. Empty on a device nobody has signed in on. */
    fun rememberedEmail(): String = prefs.getString(EMAIL_KEY, "").orEmpty()

    private var refreshToken: String?
        get() = prefs.getString(REFRESH_KEY, null)
        set(value) = prefs.edit().apply {
            if (value == null) remove(REFRESH_KEY) else putString(REFRESH_KEY, value)
        }.apply()

    /** A sign-in or a registration that worked. */
    fun start(response: AuthResponse, email: String? = null) {
        accessToken = response.tokens.accessToken
        refreshToken = response.tokens.refreshToken
        if (email != null) prefs.edit().putString(EMAIL_KEY, email).apply()
        _state.value = AuthPhase.SignedIn(response.user)
    }

    /**
     * Cold start. A missing token is simply a signed-out app; a token the
     * server rejects is a session that ended while the app was closed.
     */
    suspend fun restore() {
        if (refreshToken == null) {
            _state.value = AuthPhase.SignedOut()
            return
        }
        _state.value = AuthPhase.Restoring
        val token = refreshAccessToken()
        if (token == null) return
        try {
            _state.value = AuthPhase.SignedIn(NexoraApi.me())
        } catch (error: Exception) {
            _state.value = AuthPhase.SignedOut(messageOf(error))
        }
    }

    /**
     * Rotating refresh, single-flight: two calls racing would each spend the
     * stored token and one of them would lose the session.
     *
     * Only the server *rejecting* the token ends the session. A network
     * failure, a 502, or a backend that has not finished starting says nothing
     * about whether this session is still good, and throwing the token away
     * there signs people out permanently the first time the phone opens the app
     * before the server is up.
     */
    suspend fun refreshAccessToken(): String? = refreshLock.withLock {
        val stored = refreshToken ?: run {
            clear()
            return@withLock null
        }
        try {
            val tokens = NexoraApi.refresh(stored)
            refreshToken = tokens.refreshToken
            accessToken = tokens.accessToken
            tokens.accessToken
        } catch (error: Exception) {
            val rejected = error is ApiError && error.status == 401
            if (rejected) refreshToken = null
            accessToken = null
            _state.value = AuthPhase.SignedOut(if (rejected) null else messageOf(error))
            null
        }
    }

    /**
     * Ends the session on the server while it can still be reached, then
     * locally regardless - a sign-out that fails because the network is down
     * still has to sign this device out.
     */
    suspend fun signOut() {
        val stored = refreshToken
        if (stored != null) runCatching { NexoraApi.logout(stored) }
        clear()
    }

    private fun clear() {
        accessToken = null
        refreshToken = null
        _state.value = AuthPhase.SignedOut()
    }

    fun messageOf(error: Throwable): String =
        error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong"
}
