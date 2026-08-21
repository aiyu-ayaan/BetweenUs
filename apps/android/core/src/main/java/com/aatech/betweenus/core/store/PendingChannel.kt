package com.aatech.betweenus.core.store

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A channel this app was asked to open, waiting for a screen to open it.
 *
 * Tapping a notification is an intent, and an intent is not a navigation
 * controller. It leaves the channel id here and the shell picks it up - the
 * same shape [PendingInvite] uses, for the same reason. Memory only: a tap that
 * has already been honoured must not reopen on the next launch.
 */
object PendingChannel {

    /**
     * [join] is set only when somebody answered a ringing call. Opening a
     * voice channel from a tapped notification is not consent to open a
     * microphone; pressing Answer on a ringing one is exactly that, and the
     * two arrive down the same path.
     */
    data class Target(val channelId: String, val join: Boolean = false)

    private val _target = MutableStateFlow<Target?>(null)
    val target: StateFlow<Target?> = _target.asStateFlow()

    fun offer(id: String, join: Boolean = false) {
        _target.value = Target(id, join)
    }

    /** Taken once, by whoever opened it. */
    fun clear() {
        _target.value = null
    }
}
