package com.aatech.betweenus.feature.members

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.FriendshipStatus
import com.aatech.betweenus.core.data.ServerMember
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.feature.notifications.PushGate
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate500
import kotlinx.coroutines.launch

/**
 * What a member's row offers besides opening a conversation.
 *
 * The port of the desktop's member menu - message, add friend, mute, copy id -
 * as a sheet, because a phone has no right-click and no hover. Nothing here
 * applies to yourself, so the row that opens it is not drawn for you.
 *
 * Muting is per person and follows the account rather than the device: it is a
 * notification preference the server holds, which is what makes a person muted
 * on a phone also muted on a laptop. It silences them wherever they write,
 * mentions included - a mute any mention could bypass is a mute the loud
 * person controls.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MemberMenuSheet(
    member: ServerMember,
    onDismiss: () -> Unit,
    onOpenDirect: () -> Unit,
    /** Whether this account may change [member]'s role. An owner's is fixed. */
    mayEditRole: Boolean = false,
    onEditRole: () -> Unit = {},
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current

    var muted by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    // Three states, not two: a friendship that is only asked for opens no
    // conversation and takes no second request.
    var friend by remember { mutableStateOf(true) }
    var asked by remember { mutableStateOf(false) }

    LaunchedEffect(member.userId) {
        val preferences = PushGate.preferences()
        muted = preferences?.mutedUserIds?.contains(member.userId) == true
        val friendship = Workspace.friends.value.firstOrNull { it.user.id == member.userId }
        friend = friendship?.status == FriendshipStatus.ACCEPTED
        asked = friendship != null && !friend
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp)) {
            Text(
                text = "@${member.username}",
                style = MaterialTheme.typography.labelMedium,
                color = Slate500,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )

            ListRow(
                title = "Message",
                // Said before it is tried rather than after it is refused: a
                // direct message needs an accepted friendship, and the row
                // below is how one is asked for.
                subtitle = if (friend) null else "Only after they accept your friend request",
                leading = { BetweenUsIcon(BetweenUsIcons.Message, tint = Slate400) },
                onClick = {
                    onOpenDirect()
                    onDismiss()
                },
            )

            // A direct message needs a friendship, which is why this is offered
            // right beside it. Somebody already asked is told so rather than
            // offered a button that does nothing.
            if (!friend) {
                ListRow(
                    title = if (asked) "Friend request pending" else "Add friend",
                    subtitle = if (asked) "Waiting on one of you to accept" else null,
                    leading = { BetweenUsIcon(BetweenUsIcons.UserPlus, tint = Slate400) },
                    onClick = if (asked) {
                        null
                    } else {
                        {
                            scope.launch {
                                note = runCatching {
                                    BetweenUsApi.addFriend(member.username)
                                    Workspace.loadFriends()
                                    asked = true
                                    "Request sent"
                                }.getOrElse { it.message ?: "That did not work" }
                            }
                        }
                    },
                )
            }

            ListRow(
                title = if (muted) "Unmute notifications" else "Mute notifications",
                subtitle = if (muted) null else "Silences them wherever they write, mentions included",
                leading = {
                    BetweenUsIcon(
                        if (muted) BetweenUsIcons.Bell else BetweenUsIcons.BellOff,
                        tint = Slate400,
                    )
                },
                onClick = {
                    scope.launch {
                        val wanted = !muted
                        note = runCatching {
                            val current = PushGate.preferences()?.mutedUserIds.orEmpty()
                            val next =
                                if (wanted) (current + member.userId).distinct()
                                else current - member.userId
                            BetweenUsApi.updateNotificationPreferences(mutedUserIds = next)
                            // The cached copy is what every push is judged
                            // against; leaving it stale mutes nobody until it
                            // happens to expire.
                            PushGate.forgetPreferences()
                            muted = wanted
                            if (wanted) "Muted" else "Unmuted"
                        }.getOrElse { it.message ?: "That did not work" }
                    }
                },
            )

            if (mayEditRole) {
                ListRow(
                    title = "Role and permissions",
                    leading = { BetweenUsIcon(BetweenUsIcons.Shield, tint = Slate400) },
                    onClick = {
                        onDismiss()
                        onEditRole()
                    },
                )
            }

            ListRow(
                title = "Copy user ID",
                leading = { BetweenUsIcon(BetweenUsIcons.Copy, tint = Slate400) },
                onClick = {
                    clipboard.setText(AnnotatedString(member.userId))
                    onDismiss()
                },
            )

            note?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate100,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
        }
    }
}
