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
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current

    var muted by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    var friend by remember { mutableStateOf(true) }

    LaunchedEffect(member.userId) {
        val preferences = PushGate.preferences()
        muted = preferences?.mutedUserIds?.contains(member.userId) == true
        friend = Workspace.friends.value.any { it.user.id == member.userId }
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
                    title = "Add friend",
                    leading = { BetweenUsIcon(BetweenUsIcons.UserPlus, tint = Slate400) },
                    onClick = {
                        scope.launch {
                            note = runCatching {
                                BetweenUsApi.addFriend(member.username)
                                Workspace.loadFriends()
                                friend = true
                                "Request sent"
                            }.getOrElse { it.message ?: "That did not work" }
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
