package com.aatech.betweenus.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.AuthPhase
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.FriendshipStatus
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.data.StatusPrivacy
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.ui.components.Avatar
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.EmptyState
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.theme.StatusOnline
import kotlinx.coroutines.launch

/**
 * The two things somebody does about other people rather than about the app:
 * refusing one of them, and taking their own history off every screen.
 *
 * The port of the Privacy & Safety page in
 * `apps/desktop/src/features/settings/UserSettings.tsx`. They share a screen
 * because they share a shape - both are one-sided, both are about this
 * account's own view, and neither reaches across and changes what anybody else
 * sees.
 */
/**
 * Who a moment is shared with when it is posted.
 *
 * Saved on every press rather than behind a Save button, the same as the
 * last-seen switch and for the same reason: a privacy setting that waits for
 * one is a setting people believe they have changed and have not. Both halves
 * go together because half of "only these three" saved is a different audience
 * from the one that was chosen.
 *
 * It applies from the next post onwards, and the screen says so. A moment
 * already up was sealed for the audience it had, and nothing here can reach a
 * key that is already on somebody's device.
 */
@Composable
private fun MomentsAudience(enabled: Boolean, onFail: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val user = (Session.state.collectAsState().value as? AuthPhase.SignedIn)?.user
    val friends by Workspace.friends.collectAsState()
    var saving by remember { mutableStateOf(false) }

    if (user == null) return
    val chosen = user.statusPrivacy
    val named = user.statusPrivacyList

    fun save(privacy: StatusPrivacy, list: List<String>) {
        saving = true
        scope.launch {
            runCatching { Session.updateUser(BetweenUsApi.setStatusPrivacy(privacy, list)) }
                .onFailure { onFail(Session.messageOf(it)) }
            saving = false
        }
    }

    SectionLabel("Moments")
    Text(
        text = "Who a moment is shared with when you post it. Your friend list is the widest " +
            "this can be - a moment is never shown to anybody else, whichever of these is " +
            "chosen. It applies to what you post from now on.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 12.dp),
    )
    Spacer(Modifier.height(8.dp))

    Row(
        modifier = Modifier
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        StatusPrivacy.entries.forEach { option ->
            FilterChip(
                selected = option == chosen,
                enabled = enabled && !saving,
                onClick = { if (option != chosen) save(option, named) },
                label = { Text(option.label) },
            )
        }
    }
    Spacer(Modifier.height(6.dp))
    Text(
        text = chosen.note,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 16.dp),
    )

    // The list exists only for the two choices that name people, and it is the
    // same list either way - what changes is what being on it means, which is
    // what the line above says.
    if (chosen != StatusPrivacy.FRIENDS) {
        Spacer(Modifier.height(8.dp))
        val accepted = friends.filter { it.status == FriendshipStatus.ACCEPTED }
        if (accepted.isEmpty()) {
            Text(
                text = "You have no friends to choose from yet.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        } else {
            accepted.forEach { friend ->
                val ticked = friend.user.id in named
                ListRow(
                    title = friend.user.label,
                    subtitle = friend.user.handle,
                    leading = {
                        Avatar(
                            id = friend.user.id,
                            label = friend.user.label,
                            url = friend.user.avatarUrl?.let { Endpoint.absolute(it) },
                            viewable = false,
                        )
                    },
                    trailing = {
                        Checkbox(
                            checked = ticked,
                            enabled = enabled && !saving,
                            onCheckedChange = {
                                save(
                                    chosen,
                                    if (ticked) named - friend.user.id else named + friend.user.id,
                                )
                            },
                        )
                    },
                    onClick = {
                        if (!saving) {
                            save(
                                chosen,
                                if (ticked) named - friend.user.id else named + friend.user.id,
                            )
                        }
                    },
                )
            }
        }
        if (chosen == StatusPrivacy.ONLY_SHARE_WITH && named.isEmpty()) {
            Notice(
                message = "Nobody is ticked, so nobody but you will see what you post.",
                tone = MaterialTheme.colorScheme.tertiary,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
    }
}

@Composable
fun PrivacyScreen(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val blocked by Workspace.blocked.collectAsState()

    var note by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var confirmingClear by remember { mutableStateOf(false) }

    // Settings can be opened without ever having been to the friends screen,
    // which is the only other thing that loads this.
    LaunchedEffect(Unit) { Workspace.loadBlocked() }

    fun act(block: suspend () -> Unit) {
        scope.launch {
            busy = true
            error = runCatching { block() }.exceptionOrNull()?.let { Session.messageOf(it) }
            busy = false
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .navigationBarsPadding(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .statusBarsPadding()
                .padding(start = 4.dp, end = 12.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(BetweenUsIcons.ChevronLeft, "Back", onBack)
            Text(
                text = "Privacy & Safety",
                style = MaterialTheme.typography.titleLargeEmphasized,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier
                    .weight(1f)
                    .padding(start = 8.dp),
            )
        }

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 32.dp),
        ) {
            SectionLabel("Blocked people")
            Text(
                text = "A blocked person cannot message you or send you a request, and your " +
                    "conversation disappears for both of you. Nothing is deleted - unblocking " +
                    "brings it back.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 12.dp),
            )
            Spacer(Modifier.height(8.dp))

            if (blocked.isEmpty()) {
                EmptyState(
                    icon = BetweenUsIcons.Block,
                    title = "Nobody is blocked",
                    detail = "You can block someone from their row on the friends screen.",
                )
            } else {
                for (entry in blocked) {
                    ListRow(
                        title = entry.user.label,
                        subtitle = entry.user.handle,
                        leading = {
                            Avatar(
                                id = entry.user.id,
                                label = entry.user.label,
                                url = entry.user.avatarUrl?.let { Endpoint.absolute(it) },
                                size = 36.dp,
                            )
                        },
                        trailing = {
                            TextButton(
                                onClick = { act { Workspace.unblock(entry.user.id) } },
                                enabled = !busy,
                            ) {
                                Text(
                                    text = "Unblock",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                        },
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            MomentsAudience(enabled = !busy, onFail = { error = it })

            Spacer(Modifier.height(16.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            SectionLabel("Your messages")
            Text(
                text = "Hides everything you can currently see, in every conversation, on every " +
                    "device you are signed in on. The people you were talking to keep their own " +
                    "copies - a conversation has two ends, and this only reaches one of them.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 12.dp),
            )
            Spacer(Modifier.height(8.dp))

            ListRow(
                title = "Clear all my messages",
                subtitle = "Cannot be undone from inside the app",
                leading = { BetweenUsIcon(BetweenUsIcons.Trash, tint = MaterialTheme.colorScheme.error) },
                onClick = { if (!busy) confirmingClear = true },
            )

            note?.let {
                Notice(it, StatusOnline, Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
            }
            error?.let {
                Notice(
                    it,
                    MaterialTheme.colorScheme.error,
                    Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
        }
    }

    // A dialog rather than a row that acts on the first tap. It is not
    // reversible from inside the app, and the sentence about the other person
    // keeping their copy is the part somebody actually needs to read.
    if (confirmingClear) {
        AlertDialog(
            onDismissRequest = { confirmingClear = false },
            title = { Text("Clear all your messages?") },
            text = {
                Text(
                    "This hides every message you can currently see, in every conversation, " +
                        "on every device you are signed in on.\n\n" +
                        "Nobody else loses anything. The other side of each conversation still " +
                        "has their copy, and new messages still arrive.",
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmingClear = false
                        note = null
                        act {
                            BetweenUsApi.clearChats()
                            // The server publishes the cut to this account's own
                            // sockets, and Conversation drops the caches when it
                            // lands - including this phone's. Nothing to do here
                            // but say so.
                            note = "Cleared. Your other devices are catching up."
                        }
                    },
                ) {
                    Text("Clear everything", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmingClear = false }) { Text("Keep them") }
            },
        )
    }
}
