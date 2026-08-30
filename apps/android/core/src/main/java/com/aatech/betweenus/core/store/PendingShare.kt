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

    /**
     * The channel these files have been aimed at, once somebody has said.
     *
     * Null until then, and that is the whole of it: a share with no target has
     * not been answered yet and no conversation may take it. Without this the
     * picker could not be seen. A share arriving while a channel was already
     * open put the files in front of two things at once - the picker, and that
     * channel's chat screen, which claimed them on sight and cleared the list
     * the picker was being shown for. The picker appeared and vanished inside
     * a frame, and the files landed in whichever conversation happened to be
     * open, which is exactly the behaviour the picker was added to end.
     */
    private val _target = MutableStateFlow<String?>(null)
    val target: StateFlow<String?> = _target.asStateFlow()

    /** Appended, not replaced: two shares in a row are two lots of files. */
    fun offer(incoming: List<Uri>) {
        if (incoming.isEmpty()) return
        _uris.value = _uris.value + incoming
        // A second share is a second question. Whatever the last one was aimed
        // at, this one has not been answered.
        _target.value = null
    }

    /** Where the picker said they are going. */
    fun aim(channelId: String) {
        _target.value = channelId
    }

    /** Taken once, by the conversation they were aimed at. */
    fun clear() {
        _uris.value = emptyList()
        _target.value = null
    }
}
