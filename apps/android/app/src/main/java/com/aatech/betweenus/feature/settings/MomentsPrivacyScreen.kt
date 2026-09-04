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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.SectionLabel
import kotlinx.coroutines.launch

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
fun MomentsPrivacyScreen(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val user = (Session.state.collectAsState().value as? AuthPhase.SignedIn)?.user
    val friends by Workspace.friends.collectAsState()
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun save(privacy: StatusPrivacy, list: List<String>) {
        saving = true
        error = null
        scope.launch {
            runCatching { Session.updateUser(BetweenUsApi.setStatusPrivacy(privacy, list)) }
                .onFailure { error = Session.messageOf(it) }
            saving = false
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
                text = "Moments Privacy",
                style = MaterialTheme.typography.titleLargeEmphasized,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier
                    .weight(1f)
                    .padding(start = 8.dp),
            )
        }

        if (user == null) return@Column
        val chosen = user.statusPrivacy
        val named = user.statusPrivacyList

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 32.dp),
        ) {
            SectionLabel("Audience")
            Text(
                text = "Who a moment is shared with when you post it. Your friend list is the widest " +
                    "this can be - a moment is never shown to anybody else, whichever of these is " +
                    "chosen. It applies to what you post from now on.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 12.dp),
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "A moment already up was sealed for the people it had then, and nothing here " +
                    "can reach a key that is already on somebody's device.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 12.dp),
            )
            Spacer(Modifier.height(12.dp))

            Row(
                modifier = Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                StatusPrivacy.entries.forEach { option ->
                    FilterChip(
                        selected = option == chosen,
                        enabled = !saving,
                        onClick = { if (option != chosen) save(option, named) },
                        label = { Text(option.label) },
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                text = chosen.note,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp),
            )

            if (chosen != StatusPrivacy.FRIENDS) {
                Spacer(Modifier.height(12.dp))
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
                                    enabled = !saving,
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

            error?.let {
                Notice(
                    it,
                    MaterialTheme.colorScheme.error,
                    Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
        }
    }
}
