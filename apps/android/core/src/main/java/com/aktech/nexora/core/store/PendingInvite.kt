package com.aktech.nexora.core.store

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * An invite this app was opened by, waiting for somewhere to show it.
 *
 * The link arrives as an intent, which is not a screen and cannot ask anybody
 * anything. It is left here instead, and the shell picks it up and opens the
 * card - so a link never joins a server on its own, exactly as on the desktop.
 *
 * Memory only, unlike the desktop's, which survives a page reload because
 * signing in reloads the page there. Here the process stays up across a
 * sign-in, so there is nothing to survive; a link tapped and then abandoned is
 * meant to be forgotten.
 */
object PendingInvite {
    private val _code = MutableStateFlow<String?>(null)
    val code: StateFlow<String?> = _code.asStateFlow()

    fun offer(value: String) {
        _code.value = value
    }

    /** Taken once. A card that was closed must not reopen on the next redraw. */
    fun clear() {
        _code.value = null
    }
}
