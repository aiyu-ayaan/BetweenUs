package com.aatech.betweenus.core.store

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Somewhere other than a channel this app was asked to open.
 *
 * The same shape [PendingChannel] uses and for the same reason - an intent is
 * not a navigation controller - but for the two places a notification can lead
 * that are not a conversation: a friend request, which belongs on the friends
 * screen, and a server somebody was just added to.
 */
object PendingPlace {

    sealed interface Place {
        /** A friend request, or somebody accepting one. */
        data object Friends : Place

        /** Added to a server: its first text channel is where anybody lands. */
        data class Server(val serverId: String) : Place
    }

    private val _place = MutableStateFlow<Place?>(null)
    val place: StateFlow<Place?> = _place.asStateFlow()

    fun offer(place: Place) {
        _place.value = place
    }

    /** Taken once, by whoever went there. */
    fun clear() {
        _place.value = null
    }
}
