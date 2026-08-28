package com.aatech.betweenus.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.ForgotPasswordOutcome
import com.aatech.betweenus.core.data.OAuthProvider
import com.aatech.betweenus.core.data.Session
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class AuthMode { LOGIN, REGISTER, FORGOT }

/** Naming the account, then choosing the password. */
enum class RecoveryStep { NAME, CHOOSE }

data class RecoveryState(
    val step: RecoveryStep = RecoveryStep.NAME,
    val identifier: String = "",
    val token: String = "",
    val password: String = "",
    /**
     * False when the token came from an administrator's reset window, which is
     * carried across rather than shown - there is nothing for anybody to paste.
     */
    val tokenNeeded: Boolean = true,
    val notice: String? = null,
)

/**
 * Whether the typed username is free, as the server last answered.
 *
 * Null is "nothing has been asked", which is also what a name shorter than the
 * minimum gets. A server that cannot answer leaves it null rather than
 * inventing a refusal: the registration is still gated by the unique index.
 */
data class NameCheck(val available: Boolean, val reason: String?)

data class AuthFormState(
    val mode: AuthMode = AuthMode.LOGIN,
    val email: String = "",
    val username: String = "",
    val password: String = "",
    val busy: Boolean = false,
    val error: String? = null,
    /** The host this form is signing in to, for the line under it. */
    val serverLabel: String = "",
    /**
     * The providers this deployment actually has credentials for. Empty until
     * they have been asked for, and on a deployment that enables none - which
     * is most of them, and the reason nothing is drawn without an answer.
     */
    val providers: List<OAuthProvider> = emptyList(),
    /** Only meaningful in [AuthMode.FORGOT]. */
    val recovery: RecoveryState = RecoveryState(),
    val nameCheck: NameCheck? = null,
)

class AuthViewModel : ViewModel() {
    private val _state = MutableStateFlow(
        AuthFormState(email = Session.rememberedEmail(), serverLabel = Endpoint.label()),
    )
    val state: StateFlow<AuthFormState> = _state.asStateFlow()

    init {
        loadProviders()
    }

    /**
     * Which sign-in buttons to draw.
     *
     * Failure is silence on purpose: the password form works either way, and an
     * error about a list of buttons nobody asked for would be the first thing
     * somebody saw on a deployment that offers none.
     */
    fun loadProviders() {
        viewModelScope.launch {
            val found = runCatching { BetweenUsApi.oauthProviders() }.getOrDefault(emptyList())
            _state.update { it.copy(providers = found) }
        }
    }

    fun setEmail(value: String) = _state.update { it.copy(email = value, error = null) }

    fun setUsername(value: String) {
        _state.update { it.copy(username = value, error = null, nameCheck = null) }
        checkUsername(value)
    }

    fun setPassword(value: String) = _state.update { it.copy(password = value, error = null) }

    fun toggleMode() = _state.update {
        it.copy(
            mode = if (it.mode == AuthMode.LOGIN) AuthMode.REGISTER else AuthMode.LOGIN,
            error = null,
            nameCheck = null,
        )
    }

    /** Opens the forgot-password screen, prefilled with whatever was typed. */
    fun forgotPassword() = _state.update {
        it.copy(
            mode = AuthMode.FORGOT,
            error = null,
            recovery = RecoveryState(identifier = it.email.trim()),
        )
    }

    fun backToSignIn() = _state.update {
        it.copy(mode = AuthMode.LOGIN, error = null, recovery = RecoveryState())
    }

    private var nameCheckJob: Job? = null

    /**
     * Asks whether a username is free, while it is still being typed.
     *
     * The server can afford it: a Bloom filter answers the common case - a name
     * nobody has - without touching the database. Debounced anyway, so a name is
     * checked once rather than once per keystroke, and the previous ask is
     * cancelled so a slow answer cannot land after a faster one about a
     * different name.
     */
    private fun checkUsername(value: String) {
        nameCheckJob?.cancel()
        val name = value.trim()
        if (name.length < 3) return
        nameCheckJob = viewModelScope.launch {
            delay(250)
            val answer = runCatching { BetweenUsApi.usernameAvailable(name) }.getOrNull() ?: return@launch
            // The field may have moved on while the request was in flight.
            if (_state.value.username.trim() != name) return@launch
            _state.update { it.copy(nameCheck = NameCheck(answer.available, answer.reason)) }
        }
    }

    // --- forgotten passwords ---

    fun setRecoveryIdentifier(value: String) =
        _state.update { it.copy(recovery = it.recovery.copy(identifier = value), error = null) }

    fun setRecoveryToken(value: String) =
        _state.update { it.copy(recovery = it.recovery.copy(token = value), error = null) }

    fun setRecoveryPassword(value: String) =
        _state.update { it.copy(recovery = it.recovery.copy(password = value), error = null) }

    /**
     * Names the account, and does whatever this deployment can about it.
     *
     * A `reset` answer means an administrator authorised it, so the token is
     * carried straight into the form. `emailed` moves to the same form with a
     * box to paste the code into - and says the same sentence whether or not
     * the account exists. `unavailable` is a deployment with no mail server,
     * which is a fact about the deployment and is said plainly.
     */
    fun startRecovery() {
        val form = _state.value
        if (form.busy || form.recovery.identifier.isBlank()) return
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val answer = BetweenUsApi.forgotPassword(form.recovery.identifier.trim())
                _state.update {
                    when (answer.outcome) {
                        ForgotPasswordOutcome.RESET -> it.copy(
                            busy = false,
                            recovery = it.recovery.copy(
                                step = RecoveryStep.CHOOSE,
                                token = answer.resetToken.orEmpty(),
                                tokenNeeded = false,
                                notice = "Your administrator has authorised a reset. " +
                                    "Choose a new password.",
                            ),
                        )

                        ForgotPasswordOutcome.UNAVAILABLE -> it.copy(
                            busy = false,
                            error = answer.message
                                ?: "This server cannot send email. Ask your administrator.",
                        )

                        ForgotPasswordOutcome.EMAILED -> it.copy(
                            busy = false,
                            recovery = it.recovery.copy(
                                step = RecoveryStep.CHOOSE,
                                tokenNeeded = true,
                                notice = "If that account exists, a reset link is on its way. " +
                                    "Paste the code from the email below.",
                            ),
                        )
                    }
                }
            } catch (error: Exception) {
                _state.update { it.copy(busy = false, error = Session.messageOf(error)) }
            }
        }
    }

    /**
     * Spends the token and signs in on the new password.
     *
     * The password is handed to [Session.start] for the same reason a sign-in
     * hands it over: it is the secret that opens this account's identity
     * backup. After a reset that backup is sealed with the *old* password and
     * will not open, so this machine keeps the key it already holds and a new
     * one starts fresh - which is the price of a password nobody remembers.
     */
    fun finishRecovery() {
        val form = _state.value
        if (form.busy) return
        val token = form.recovery.token.trim()
        val password = form.recovery.password
        if (token.isEmpty() || password.length < 8) {
            _state.update {
                it.copy(
                    error = if (token.isEmpty()) {
                        "Paste the code from the email first."
                    } else {
                        "A password needs at least 8 characters."
                    },
                )
            }
            return
        }
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val response = BetweenUsApi.resetPassword(token, password)
                Session.start(response, email = response.user.email, password = password)
                _state.update {
                    it.copy(busy = false, mode = AuthMode.LOGIN, recovery = RecoveryState())
                }
            } catch (error: Exception) {
                _state.update { it.copy(busy = false, error = Session.messageOf(error)) }
            }
        }
    }

    fun submit() {
        val form = _state.value
        if (form.busy) return
        // The recovery screen has its own two buttons; this one never runs for it.
        if (form.mode == AuthMode.FORGOT) return
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val response = when (form.mode) {
                    AuthMode.REGISTER ->
                        BetweenUsApi.register(form.email.trim(), form.username.trim(), form.password)
                    else -> BetweenUsApi.login(form.email.trim(), form.password)
                }
                // The password is dropped here and never stored: Session takes
                // the tokens, and the field is cleared with the rest of the form.
                // The password goes with it. It is the secret that opens this
                // account's identity backup, and sign-in is the one moment it
                // is in hand - without it every sign-in ended in a prompt for
                // the password that had just been typed, and a registration
                // uploaded no backup at all.
                Session.start(response, email = form.email.trim(), password = form.password)
                _state.update { it.copy(busy = false, password = "") }
            } catch (error: Exception) {
                _state.update { it.copy(busy = false, error = Session.messageOf(error)) }
            }
        }
    }
}
