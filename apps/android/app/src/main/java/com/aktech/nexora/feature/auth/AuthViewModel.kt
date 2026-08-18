package com.aktech.nexora.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aktech.nexora.core.data.Endpoint
import com.aktech.nexora.core.data.NexoraApi
import com.aktech.nexora.core.data.OAuthProvider
import com.aktech.nexora.core.data.Session
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class AuthMode { LOGIN, REGISTER }

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
            val found = runCatching { NexoraApi.oauthProviders() }.getOrDefault(emptyList())
            _state.update { it.copy(providers = found) }
        }
    }

    fun setEmail(value: String) = _state.update { it.copy(email = value, error = null) }
    fun setUsername(value: String) = _state.update { it.copy(username = value, error = null) }
    fun setPassword(value: String) = _state.update { it.copy(password = value, error = null) }

    fun toggleMode() = _state.update {
        it.copy(mode = if (it.mode == AuthMode.LOGIN) AuthMode.REGISTER else AuthMode.LOGIN, error = null)
    }

    fun submit() {
        val form = _state.value
        if (form.busy) return
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val response = when (form.mode) {
                    AuthMode.LOGIN -> NexoraApi.login(form.email.trim(), form.password)
                    AuthMode.REGISTER ->
                        NexoraApi.register(form.email.trim(), form.username.trim(), form.password)
                }
                // The password is dropped here and never stored: Session takes
                // the tokens, and the field is cleared with the rest of the form.
                Session.start(response, email = form.email.trim())
                _state.update { it.copy(busy = false, password = "") }
            } catch (error: Exception) {
                _state.update { it.copy(busy = false, error = Session.messageOf(error)) }
            }
        }
    }
}
