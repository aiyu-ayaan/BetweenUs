package com.aatech.betweenus.feature.voice

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.PresenceStatus
import com.aatech.betweenus.core.data.ServerMember
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.ui.components.AvatarWithStatus
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.theme.Accent
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate50
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.StatusOnline
import com.aatech.betweenus.ui.theme.Surface800
import kotlinx.coroutines.launch

/**
 * "Come into this call": the phone's half of the ring the desktop has had.
 *
 * The roster announcement already tells a channel that a call is happening, and
 * it deliberately rings nobody - a phone that buzzes every time anybody joins
 * any voice channel is a phone with notifications turned off. This is the other
 * half, aimed at one person, which is why it may ring them wherever they are
 * signed in.
 *
 * Reachable from inside the call rather than from the member list, because
 * "who else should be here" is a thought somebody has while looking at a call
 * with two people in it. On the desktop it lives in the member list, which a
 * phone in a call is not showing.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InviteToCallSheet(
    channelId: String,
    channelName: String,
    serverId: String?,
    selfId: String,
    inCall: Set<String>,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val membersByServer by Workspace.members.collectAsState()
    val statuses by Presence.statuses.collectAsState()

    /** Per person: null untouched, "ringing", "rang", or why it failed. */
    val rung = remember { mutableStateMapOf<String, String>() }
    var loading by remember { mutableStateOf(serverId != null) }

    LaunchedEffect(serverId) {
        serverId?.let { Workspace.loadMembers(it) }
        loading = false
    }

    // Everybody in the server except this account and whoever is already here.
    // Somebody already in the call is left out rather than shown greyed: the
    // list is what a thumb reaches into, and a row that cannot be tapped is
    // just a row in the way.
    val candidates = serverId
        ?.let { membersByServer[it] }
        .orEmpty()
        .filter { it.userId != selfId && it.userId !in inCall }
        .sortedBy { it.label.lowercase() }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 20.dp)
                .padding(bottom = 20.dp)
                .heightIn(max = 520.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text(
                text = "Add to the call",
                style = MaterialTheme.typography.titleMedium,
                color = Slate50,
            )
            Text(
                text = "Rings them into #$channelName wherever they are signed in. They can be " +
                    "rung again in a moment if they miss it.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate400,
            )
            Spacer(Modifier.height(12.dp))

            when {
                serverId == null -> Notice(
                    "This is a direct conversation - the other person is already the whole call.",
                    Slate500,
                )

                loading && candidates.isEmpty() -> Box(
                    Modifier.fillMaxWidth().padding(24.dp),
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator(color = Accent) }

                candidates.isEmpty() -> Notice("Everybody here is already in the call.", Slate500)

                else -> for (member in candidates) {
                    InviteRow(
                        member = member,
                        status = statuses[member.userId] ?: PresenceStatus.OFFLINE,
                        state = rung[member.userId],
                        onRing = {
                            rung[member.userId] = "ringing"
                            scope.launch {
                                runCatching { BetweenUsApi.callRing(channelId, member.userId) }
                                    .onSuccess { rung[member.userId] = "rang" }
                                    .onFailure {
                                        rung[member.userId] = it.message ?: "could not ring them"
                                    }
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun InviteRow(
    member: ServerMember,
    status: PresenceStatus,
    state: String?,
    onRing: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Surface800)
            // A row already rung is not tappable again: the service holds a
            // cooldown per pair, so a second tap earns a 403 rather than a
            // second ring, and a button that answers with an error is worse
            // than one that says what it already did.
            .let { if (state == null) it.clickable(onClick = onRing) else it }
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AvatarWithStatus(
            id = member.userId,
            label = member.label,
            url = member.avatarUrl,
            status = status.name.lowercase(),
            size = 36.dp,
        )
        Column(Modifier.weight(1f)) {
            Text(member.label, style = MaterialTheme.typography.bodyMedium, color = Slate100)
            Text(
                text = "@${member.username}",
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
            )
        }
        Text(
            text = when (state) {
                null -> "Ring"
                "ringing" -> "Ringing…"
                "rang" -> "Rung"
                else -> state
            },
            style = MaterialTheme.typography.bodySmall,
            color = when (state) {
                null -> Accent
                "ringing" -> Slate400
                "rang" -> StatusOnline
                else -> Danger
            },
        )
    }
}
