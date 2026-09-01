package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aatech.betweenus.core.data.AuthPhase
import com.aatech.betweenus.core.store.Conversation
import com.aatech.betweenus.core.store.Workspace
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
 * Everything the conversation can be asked to do except start a call. The bar
 * used to carry pins, members, call and this, and on a phone four controls plus
 * an avatar leave nothing for the name: it ellipsed to "A..." with "last..."
 * under it. A name is what a chat header is for, so the bar keeps one button -
 * the call, the only one that starts something - and the rest live here.
 *
 * The port of `apps/desktop/src/features/chat/ChannelMenu.tsx`.
 */
@Composable
fun ChannelMenu(
    channelId: String,
    title: String,
    isDirect: Boolean,
    onOpenPins: () -> Unit,
    onOpenMembers: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var confirming by remember { mutableStateOf(false) }
    var windows by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Box {
        IconAction(BetweenUsIcons.More, "More options", { open = true })

        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            // Pins and members used to be permanent icons in the bar. Four
            // controls beside a name left the name three characters wide -
            // "A..." over "last..." - which is the one thing in that bar
            // somebody actually reads. They are both "show me something"
            // rather than "do something", so they moved in here and the bar
            // kept the call button, which is the only one that starts
            // anything.
            DropdownMenuItem(
                text = { Text("Pinned messages") },
                leadingIcon = { BetweenUsIcon(BetweenUsIcons.Pin) },
                onClick = {
                    open = false
                    onOpenPins()
                },
            )

            DropdownMenuItem(
                text = { Text(if (isDirect) "Profile" else "Members") },
                leadingIcon = { BetweenUsIcon(BetweenUsIcons.Users) },
                onClick = {
                    open = false
                    onOpenMembers()
                },
            )

            // Above "clear chat", because it is the same subject arrived at
            // from the other end: one draws a line once, the other keeps
            // drawing it. Both belong to the conversation somebody is looking
            // at rather than to a settings screen two taps away.
            DropdownMenuItem(
                text = { Text("Disappearing messages") },
                leadingIcon = { BetweenUsIcon(BetweenUsIcons.Clock) },
                onClick = {
                    open = false
                    windows = true
                },
            )

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

    if (windows) {
        DisappearingSheet(
            channelId = channelId,
            title = title,
            isDirect = isDirect,
            onDismiss = { windows = false },
        )
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

/**
 * Both disappearing windows, in the conversation they apply to.
 *
 * They are shown together because the question people actually have is "how
 * long do messages last here", and that has two answers which interact. Split
 * across two settings screens the interaction was invisible: somebody could
 * set an hour for themselves, sit in a server that keeps nothing for a week,
 * and have no way to find out which was winning.
 *
 * So both are here, in priority order, with the effect stated at the bottom.
 * The server's window is a deletion and binds everybody; a personal one is a
 * filter over your own screens. Shorter wins, which falls out of what they are
 * rather than being a rule anybody has to remember: you cannot see a row that
 * has been deleted, and you have asked not to see one older than your window.
 *
 * A direct message has no server, so it has one window and says so.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DisappearingSheet(channelId: String, title: String, isDirect: Boolean, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val scheme = MaterialTheme.colorScheme
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    val servers by Workspace.servers.collectAsStateWithLifecycle()
    val session by Session.state.collectAsStateWithLifecycle()

    val serverId = Workspace.channel(channelId)?.serverId
    val server = servers.firstOrNull { it.id == serverId }
    val canManage = server?.can("MANAGE_SERVER") == true

    val mine = (session as? AuthPhase.SignedIn)?.user?.messageTtlSeconds
    val theirs = server?.messageTtlSeconds

    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // Whichever closes first, treating "off" as no limit rather than as zero.
    val effective = when {
        mine == null -> theirs
        theirs == null -> mine
        else -> minOf(mine, theirs)
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = "Disappearing messages",
                style = MaterialTheme.typography.titleMedium,
                color = scheme.onSurface,
            )
            Text(
                text = "In " + (if (isDirect) "@$title" else "#$title"),
                style = MaterialTheme.typography.bodyMedium,
                color = scheme.onSurfaceVariant,
            )

            if (server != null) {
                Spacer(Modifier.height(10.dp))
                Text(
                    text = "THIS SERVER",
                    style = MaterialTheme.typography.labelSmallEmphasized,
                    color = scheme.onSurfaceVariant,
                )
                Text(
                    text = "Deletes for everybody, along with any files. It outranks the " +
                        "setting below, because a row that is gone cannot be un-hidden.",
                    style = MaterialTheme.typography.bodySmall,
                    color = scheme.onSurfaceVariant,
                )
                DisappearingRow(
                    value = theirs,
                    enabled = canManage && !busy,
                ) { seconds ->
                    busy = true
                    error = null
                    scope.launch {
                        val failure = runCatching {
                            Workspace.setServerMessageWindow(server.id, seconds)
                        }.exceptionOrNull()
                        busy = false
                        if (failure != null) error = Session.messageOf(failure)
                    }
                }
                if (!canManage) {
                    Text(
                        text = "Only someone who can manage this server may change it.",
                        style = MaterialTheme.typography.bodySmall,
                        color = scheme.onSurfaceVariant,
                    )
                }
            }

            Spacer(Modifier.height(10.dp))
            Text(
                text = "JUST FOR ME",
                style = MaterialTheme.typography.labelSmallEmphasized,
                color = scheme.onSurfaceVariant,
            )
            Text(
                text = "Stops showing you messages older than this, in every conversation, on " +
                    "every device you are signed in on. Nobody else loses anything.",
                style = MaterialTheme.typography.bodySmall,
                color = scheme.onSurfaceVariant,
            )
            DisappearingRow(value = mine, enabled = !busy) { seconds ->
                busy = true
                error = null
                scope.launch {
                    val failure = runCatching {
                        Session.updateUser(BetweenUsApi.setMessageWindow(seconds))
                        // Applied here as well as saved. The server leaves what
                        // is now too old out of the next history page, but this
                        // screen is already holding decrypted messages nothing
                        // will re-ask for - so without the prune the setting
                        // appears to do nothing until something reloads.
                        Conversation.pruneExpired()
                    }.exceptionOrNull()
                    busy = false
                    if (failure != null) error = Session.messageOf(failure)
                }
            }

            Spacer(Modifier.height(12.dp))
            // The answer to the question that brought anybody here.
            Text(
                text = if (effective == null) {
                    "Messages here stay until somebody deletes them."
                } else {
                    "You will see messages here for " +
                        DisappearingWindows.label(effective).lowercase() + "."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = scheme.onSurface,
            )

            error?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = scheme.error,
                )
            }
        }
    }
}

/**
 * The windows, as a row of choices.
 *
 * A row of chips rather than a dropdown: there are five, they are all short,
 * and the one that matters most is "Off" - which a dropdown hides behind a tap.
 * Seeing the current setting without opening anything is the point of it.
 */
@Composable
private fun DisappearingRow(value: Int?, enabled: Boolean, onPick: (Int?) -> Unit) {
    val scheme = MaterialTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for (seconds in DisappearingWindows.OPTIONS) {
            val on = seconds == value
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (on) scheme.primary.copy(alpha = 0.16f) else scheme.surfaceContainerHigh)
                    .border(
                        width = 1.dp,
                        color = if (on) scheme.primary else scheme.outlineVariant,
                        shape = RoundedCornerShape(10.dp),
                    )
                    .clickable(enabled = enabled) { onPick(seconds) }
                    .padding(horizontal = 14.dp, vertical = 9.dp),
            ) {
                Text(
                    text = DisappearingWindows.label(seconds),
                    style = MaterialTheme.typography.bodyMedium,
                    color = when {
                        !enabled -> scheme.onSurfaceVariant.copy(alpha = 0.5f)
                        on -> scheme.onSurface
                        else -> scheme.onSurfaceVariant
                    },
                )
            }
        }
    }
}

/**
 * The windows anything may be set to, mirroring `DISAPPEARING_WINDOWS` in
 * `packages/shared-types`.
 *
 * A fixed list rather than a free number, and both ends check against it. A
 * free number is a footgun in both directions: three seconds is a conversation
 * nobody can read, and ten years is a retention policy wearing a privacy
 * feature's clothes.
 */
object DisappearingWindows {
    /** Off first, then shortest to longest, which is the order to draw them in. */
    val OPTIONS: List<Int?> = listOf(null, 3600, 28800, 86400, 604800)

    /** One spelling per window, so three clients cannot disagree about "8h". */
    fun label(seconds: Int?): String = when (seconds) {
        null -> "Off"
        3600 -> "1 hour"
        28800 -> "8 hours"
        86400 -> "24 hours"
        604800 -> "7 days"
        else -> "${seconds}s"
    }
}
