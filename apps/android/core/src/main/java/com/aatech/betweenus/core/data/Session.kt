package com.aatech.betweenus.core.data

import android.content.Context
import android.content.SharedPreferences
import com.aatech.betweenus.core.crypto.SecureStore
import com.aatech.betweenus.core.crypto.BackupSecret
import com.aatech.betweenus.core.crypto.E2ee
import com.aatech.betweenus.core.store.Cache
import com.aatech.betweenus.core.store.Conversation
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.Statuses
import com.aatech.betweenus.core.store.Workspace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.math.min

/**
 * Whether a failed token exchange means this session is over.
 *
 * Exactly one thing does: the server refusing the credential. Everything else -
 * a host that will not resolve, a gateway that has not finished starting, a
 * phone in a tunnel, a coroutine cancelled because an activity was recreated -
 * says nothing about whether the refresh token is still good, and treating it
 * as an ending is what signed people out at random while holding a token valid
 * for another month.
 *
 * Pure, and separate from [Session], so the rule can be checked without an
 * Android device to run it on.
 */
fun endsSession(error: Throwable): Boolean = error is ApiError && error.status == 401

/** What the app shows: the splash, the sign-in form, or the app itself. */
sealed interface AuthPhase {
    /**
     * Cold start, with a refresh token to try. Nothing is drawn but the mark.
     *
     * [problem] is set once a restore has failed for a reason that is not the
     * token being refused - an unreachable server, a gateway still starting.
     * The session is not over in that case and the token is kept, so the splash
     * says what is wrong and keeps trying rather than dropping somebody onto a
     * sign-in form for a credential nobody rejected.
     */
    data class Restoring(val problem: String? = null) : AuthPhase

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
 * The refresh token is sealed by the Keystore rather than written in the
 * clear: preferences are private to the app and readable on a rooted device,
 * and a refresh token is a sign-in that lasts. It is keyed per deployment, so
 * a phone that has used two servers holds a token for each and switching
 * deployments cannot present one server's token to another. The email is not
 * a secret and stays where it was.
 *
 * A token written by an older build is moved on the first launch that finds
 * it, and the plaintext removed - which is the only reason [REFRESH_KEY] still
 * exists.
 */
object Session {
    private const val REFRESH_KEY = "refreshToken"
    private const val EMAIL_KEY = "lastEmail"

    private lateinit var prefs: SharedPreferences
    private lateinit var secure: SecureStore
    private val refreshLock = Mutex()

    @Volatile
    var accessToken: String? = null
        private set

    private val _state = MutableStateFlow<AuthPhase>(AuthPhase.SignedOut())
    val state: StateFlow<AuthPhase> = _state.asStateFlow()

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences("betweenus.session", Context.MODE_PRIVATE)
        secure = SecureStore(context)

        // A build before this one wrote the token in the clear. Move it once
        // and delete it, rather than leaving a readable copy behind for the
        // life of the install.
        prefs.getString(REFRESH_KEY, null)?.let { legacy ->
            secure.put(secureKey(), legacy)
            prefs.edit().remove(REFRESH_KEY).apply()
        }

        // A stored refresh token means there is something to restore, and the
        // splash should stay up until it is known whether it still works.
        if (refreshToken != null) _state.value = AuthPhase.Restoring()
    }

    /**
     * One entry per deployment.
     *
     * A phone that has signed into two servers holds a token for each, and
     * switching between them cannot present one server's token to the other -
     * which the old single key did, once, per switch.
     */
    private fun secureKey(): String = "refreshToken:" + Endpoint.current()

    /** Prefills the sign-in form. Empty on a device nobody has signed in on. */
    fun rememberedEmail(): String = prefs.getString(EMAIL_KEY, "").orEmpty()

    private var refreshToken: String?
        get() = secure.get(secureKey())
        set(value) {
            if (value == null) secure.remove(secureKey()) else secure.put(secureKey(), value)
        }

    /**
     * A sign-in or a registration that worked.
     *
     * The password is passed through rather than stored: it is the secret that
     * opens this account's identity backup, so a sign-in is the one moment
     * where a new device can recover its keys without asking for anything. It
     * is used here and dropped.
     */
    fun start(response: AuthResponse, email: String? = null, password: String? = null) {
        accessToken = response.tokens.accessToken
        refreshToken = response.tokens.refreshToken
        if (email != null) prefs.edit().putString(EMAIL_KEY, email).apply()
        _state.value = AuthPhase.SignedIn(response.user)
        begin(response.user, password?.let { BackupSecret.password(it) })
    }

    /**
     * Everything a live session needs running: both sockets, and the identity
     * key that makes messages readable.
     *
     * The identity is allowed to fail without ending the session. A locked one
     * puts [E2ee.status] into `Locked` and the app asks for the secret; an
     * offline one is retried the next time a channel needs a key. Neither is a
     * reason to throw somebody back to a login form they have just filled in.
     */
    private fun begin(user: PublicUser, secret: BackupSecret?) {
        val token = accessToken ?: return
        // Before either store starts reading from it: a cache belonging to
        // another account has to be gone, not merely about to be.
        Cache.claim(user.id)
        ChatSocket.connect(token)
        PresenceSocket.connect(token)
        Presence.start()
        Conversation.start()
        Workspace.start()
        Statuses.start()
        scope.launch { runCatching { E2ee.initIdentity(user.id, secret) } }
        // The push registration belongs to the account, not to the app: it is
        // made here on every sign-in and every restore, so a token that rotated
        // while the app was closed is put back under the right user.
        scope.launch { PushTokens.register() }
    }

    /**
     * Cold start.
     *
     * A missing token is simply a signed-out app, and a token the server
     * *rejects* is a session that ended while the app was closed. Nothing else
     * is: an unreachable server, a gateway that has not finished starting, a
     * phone that woke up in a tunnel - none of them say anything about whether
     * this session is still good, and signing out over one is what put somebody
     * back on a login form holding a refresh token that was valid the whole
     * time.
     *
     * So a failure that is not a refusal keeps the token, stays on the splash
     * with the reason on it, and tries again - on a backoff, and immediately
     * whenever the phone gets a network back.
     *
     * Single-flight, and owned by [scope] rather than by whoever asked. A
     * restore driven from an activity's scope died with the activity - a
     * rotation, a themed recreate, a process the system paused - and the
     * `CancellationException` that came out of it was being read as a failed
     * sign-in. That is the whole of "Job was cancelled" on a login form.
     */
    suspend fun restore() {
        current().join()
    }

    /** The same restore, for a caller with no coroutine to wait in. */
    fun restoreAsync() {
        current()
    }

    @Synchronized
    private fun current(): Job =
        restoring?.takeIf { it.isActive } ?: scope.launch { runRestore() }.also { restoring = it }

    /** The restore in flight, so two callers do not spend the token twice. */
    @Volatile
    private var restoring: Job? = null

    private suspend fun runRestore() {
        var attempt = 0
        while (true) {
            if (refreshToken == null) {
                _state.value = AuthPhase.SignedOut()
                return
            }
            if (_state.value !is AuthPhase.SignedIn) _state.value = AuthPhase.Restoring()

            val problem = attemptRestore() ?: return

            // Still restoring, still holding the token, now saying why.
            _state.value = AuthPhase.Restoring(problem)
            attempt += 1
            waitBeforeRetry(attempt)
        }
    }

    /**
     * One go. Returns null when the session is settled either way - restored,
     * or genuinely signed out - and the reason to show when it is worth trying
     * again.
     */
    private suspend fun attemptRestore(): String? {
        val token = refreshAccessToken()
        if (token == null) {
            // A refusal has already cleared the token and moved the state on;
            // anything else left both alone and is worth retrying.
            if (refreshToken == null) return null
            return lastRefreshProblem ?: "Could not reach ${Http.hostOf(Endpoint.current())}"
        }
        return try {
            val user = BetweenUsApi.me()
            _state.value = AuthPhase.SignedIn(user)
            begin(user, secret = null)
            null
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            // The same rule as the refresh: only a refusal ends the session.
            if (endsSession(error)) {
                refreshToken = null
                accessToken = null
                _state.value = AuthPhase.SignedOut()
                null
            } else {
                messageOf(error)
            }
        }
    }

    /**
     * Backoff, cut short by a network coming back.
     *
     * The wait is for a server that is down, where hammering it is exactly
     * wrong. A phone that has just found wifi is the other case entirely, and
     * making it wait out a timer measuring a problem it no longer has is how a
     * splash screen sits there for half a minute after the lift doors open.
     */
    private suspend fun waitBeforeRetry(attempt: Int) {
        val delayMs = min(2_000L shl min(attempt - 1, 4), 30_000L)
        val woken = CompletableDeferred<Unit>()
        val stop = NetworkWatch.onAvailable { woken.complete(Unit) }
        try {
            withTimeoutOrNull(delayMs) { woken.await() }
        } finally {
            stop()
        }
    }

    /**
     * The button on the splash: try the whole thing again now.
     *
     * The retry loop is already waiting on a backoff, so this is only ever
     * shortening a wait - the job is replaced rather than raced, because two
     * restores would each spend the stored refresh token and one would lose.
     */
    @Synchronized
    fun retryRestore() {
        if (_state.value !is AuthPhase.Restoring) return
        restoring?.cancel()
        restoring = scope.launch { runRestore() }
    }

    /** Somebody would rather sign in again than watch a splash keep trying. */
    @Synchronized
    fun abandonRestore() {
        if (_state.value !is AuthPhase.Restoring) return
        restoring?.cancel()
        restoring = null
        _state.value = AuthPhase.SignedOut()
    }

    /** Why the last refresh failed, when it failed for something retryable. */
    @Volatile
    private var lastRefreshProblem: String? = null

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
            val tokens = BetweenUsApi.refresh(stored)
            refreshToken = tokens.refreshToken
            accessToken = tokens.accessToken
            // Both sockets carry the access token in their URL, so a rotation
            // is a reconnect. They are idempotent when already open.
            ChatSocket.connect(tokens.accessToken)
            PresenceSocket.connect(tokens.accessToken)
            lastRefreshProblem = null
            tokens.accessToken
        } catch (cancelled: CancellationException) {
            // A cancelled coroutine is not a refused credential. It used to be
            // caught below and turned into "Job was cancelled" on a sign-in
            // form - a session thrown away because an activity was recreated.
            throw cancelled
        } catch (error: Exception) {
            if (!endsSession(error)) {
                // The credential was never refused - the network was - so the
                // stored token stays and the next request refreshes again.
                // Nothing about the session ends here, whatever phase it is in:
                // ending it over a lift, a handover or a gateway restart is
                // what signed people out at random, and it did so on the one
                // path that had no guard: a cold start.
                lastRefreshProblem = messageOf(error)
                return@withLock null
            }
            refreshToken = null
            accessToken = null
            lastRefreshProblem = null
            _state.value = AuthPhase.SignedOut()
            null
        }
    }

    /**
     * Fire-and-forget refresh, for a caller with no coroutine of its own.
     *
     * A socket whose token was rejected is the only one that needs this: it is
     * the one thing holding an access token that nothing else will notice has
     * expired.
     */
    fun renewAccessToken() {
        scope.launch { runCatching { refreshAccessToken() } }
    }

    /**
     * Ends the session on the server while it can still be reached, then
     * locally regardless - a sign-out that fails because the network is down
     * still has to sign this device out.
     */
    suspend fun signOut() {
        val stored = refreshToken
        // Before the tokens go, because unregistering needs one. A row left
        // behind delivers this account's messages to whoever signs in next.
        PushTokens.unregister()
        if (stored != null) runCatching { BetweenUsApi.logout(stored) }
        clear()
        // Only a deliberate sign-out empties the cache. A session that expired
        // on its own is coming back, and should come back instantly.
        Cache.clear()
    }

    /**
     * The account changed something about itself.
     *
     * A display name or an avatar is drawn from `AuthPhase.SignedIn`, which was
     * written once at sign-in and never again - so changing either updated the
     * server and nothing on screen until the next launch. Ignored while signed
     * out, where there is nobody to update.
     */
    fun updateUser(user: PublicUser) {
        if (_state.value !is AuthPhase.SignedIn) return
        _state.value = AuthPhase.SignedIn(user)
    }

    /**
     * The same profile, changed on another of this account's devices, arriving
     * over the socket. Only the three public fields move - the address and the
     * platform role are not in the event and are not what changed.
     */
    fun applyProfile(summary: UserSummary) {
        val signedIn = _state.value as? AuthPhase.SignedIn ?: return
        if (signedIn.user.id != summary.id) return
        _state.value = AuthPhase.SignedIn(
            signedIn.user.copy(
                username = summary.username,
                displayName = summary.displayName,
                avatarUrl = summary.avatarUrl,
            ),
        )
    }

    /**
     * A sign-in that failed with no form on screen to put the error on.
     *
     * The provider hand-off comes back through an intent rather than through a
     * button, so there is no view model holding the attempt when it goes wrong.
     * Ignored while signed in: a stale callback must not throw somebody out of
     * a session they already have.
     */
    fun reportSignInFailure(message: String) {
        if (_state.value is AuthPhase.SignedIn) return
        _state.value = AuthPhase.SignedOut(message)
    }

    private fun clear() {
        accessToken = null
        refreshToken = null
        ChatSocket.forget()
        ChatSocket.disconnect()
        PresenceSocket.disconnect()
        CallSocket.disconnect()
        RemoteSocket.disconnect()
        E2ee.reset()
        Workspace.stop()
        Statuses.stop()
        Conversation.stop()
        Presence.stop()
        _state.value = AuthPhase.SignedOut()
    }

    /** Outlives any one screen: sockets and key setup belong to the session. */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun messageOf(error: Throwable): String =
        error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong"
}
