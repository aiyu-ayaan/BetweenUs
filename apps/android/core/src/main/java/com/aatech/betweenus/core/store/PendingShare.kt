package com.aatech.betweenus.core.store

import android.net.Uri
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Files another app handed to BetweenUs through the system share sheet.
 *
 * The same shape [PendingChannel] and [PendingInvite] use, for the same
 * reason: `ACTION_SEND` arrives as an intent, and an intent is not a screen.
 * It cannot ask which conversation, and it must not answer that itself - so
 * the URIs are left here and the chat screen picks them up into the send
 * preview, which is the one place in this app where something about to be
 * sent is looked at first.
 *
 * Nothing is read, sealed or uploaded on the way through. A share is a list of
 * URIs and stays one until somebody presses send.
 *
 * Memory only. The read permission on these URIs is granted to the activity
 * that received the intent and dies with it; a list that outlived the process
 * would be a list of URIs this app is no longer allowed to open.
 */
object PendingShare {
    private val _uris = MutableStateFlow<List<Uri>>(emptyList())
    val uris: StateFlow<List<Uri>> = _uris.asStateFlow()

    /** Appended, not replaced: two shares in a row are two lots of files. */
    fun offer(incoming: List<Uri>) {
        if (incoming.isEmpty()) return
        _uris.value = _uris.value + incoming
    }

    /** Taken once, by the conversation they were dropped into. */
    fun clear() {
        _uris.value = emptyList()
    }
}
