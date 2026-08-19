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
    private val _channelId = MutableStateFlow<String?>(null)
    val channelId: StateFlow<String?> = _channelId.asStateFlow()

    fun offer(id: String) {
        _channelId.value = id
    }

    /** Taken once, by whoever opened it. */
    fun clear() {
        _channelId.value = null
    }
}
