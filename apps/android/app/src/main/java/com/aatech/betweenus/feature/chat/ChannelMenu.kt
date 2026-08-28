package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.IconAction
import kotlinx.coroutines.launch

/**
 * The overflow menu at the end of the chat top bar.
 *
 * It exists so there is somewhere to put an action that is not worth a
 * permanent icon. The bar already carries three, and every one of them is
 * something people reach for constantly - pins, members, call. Clearing a
 * conversation is the opposite: rare, deliberate, and destructive-looking
 * enough that a button sitting in a phone top bar waiting to be brushed against
 * is the wrong shape for it.
 *
 * The port of `apps/desktop/src/features/chat/ChannelMenu.tsx`.
 */
@Composable
fun ChannelMenu(channelId: String, title: String, isDirect: Boolean) {
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var confirming by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Box {
        IconAction(BetweenUsIcons.More, "More options", { open = true })

        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = {
                    Text("Clear chat", color = MaterialTheme.colorScheme.error)
                },
                leadingIcon = {
                    BetweenUsIcon(BetweenUsIcons.Trash, tint = MaterialTheme.colorScheme.error)
                },
                onClick = {
                    open = false
                    error = null
                    confirming = true
                },
            )
        }
    }

    // The whole point of this dialog is its second paragraph. "Clear chat"
    // reads, to almost everybody, like it might delete the conversation for
    // both people - which is the one thing it does not and cannot do. So the
    // button says "Delete for me" rather than "Delete", and the body says who
    // keeps their copy. A dialog that only asked "are you sure?" would be a
    // speed bump in front of a misunderstanding rather than a correction of it.
    if (confirming) {
        AlertDialog(
            onDismissRequest = { if (!busy) confirming = false },
            title = { Text("Clear this chat?") },
            text = {
                Text(
                    "Every message you can currently see in " +
                        (if (isDirect) "@$title" else "#$title") +
                        " disappears from your screens, on every device you are signed in " +
                        "on.\n\n" +
                        (if (isDirect) "The other person keeps their copy" else "Everyone else keeps their copy") +
                        " - nothing is deleted for them, and new messages still arrive here." +
                        (error?.let { "\n\n$it" } ?: ""),
                )
            },
            confirmButton = {
                TextButton(
                    enabled = !busy,
                    onClick = {
                        busy = true
                        scope.launch {
                            val failure = runCatching { BetweenUsApi.clearChats(channelId) }
                                .exceptionOrNull()
                            busy = false
                            if (failure == null) {
                                // The server publishes the cut back to this
                                // account's own sockets, and Conversation empties
                                // the screen and the cache when it lands - here
                                // and on every other device. Nothing to do but
                                // get out of the way.
                                confirming = false
                            } else {
                                error = Session.messageOf(failure)
                            }
                        }
                    },
                ) {
                    Text(
                        text = if (busy) "Clearing…" else "Delete for me",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            },
            dismissButton = {
                TextButton(enabled = !busy, onClick = { confirming = false }) { Text("Cancel") }
            },
        )
    }
}
