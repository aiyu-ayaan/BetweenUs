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

        /**
         * Somebody is on one of this account's machines.
         *
         * It leads to the machine list rather than to the session. A session
         * that has already started is somebody else's, and joining it from a
         * notification is not what the notification is telling you about -
         * what it is telling you is that you may want to end it.
         */
        data object Remote : Place

        /**
         * A newer release, found by the daily check while the app was closed.
         * It leads to the auto update screen rather than straight to an
         * install: the decision is still somebody's to make.
         */
        data object AutoUpdate : Place
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
