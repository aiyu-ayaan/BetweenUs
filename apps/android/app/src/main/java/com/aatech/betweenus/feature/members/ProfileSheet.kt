package com.aatech.betweenus.feature.members

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.PresenceStatus
import com.aatech.betweenus.core.data.UserSummary
import com.aatech.betweenus.core.store.LastSeen
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.ui.components.AvatarWithStatus
import com.aatech.betweenus.ui.theme.Slate200
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate500

/**
 * Who somebody is: their picture, whether they are here, when they were last
 * here, and their about line.
 *
 * The same card the desktop opens when the pointer rests on a name, reached by
 * the gesture a phone has instead of hovering - a double tap on the message, on
 * the face beside it or on the header. A sheet rather than a floating card
 * because a phone has no room beside anything, and the gesture that opens it is
 * one nothing else on the row had claimed: a single tap does nothing, a long
 * press opens the message's own actions, and a swipe replies.
 *
 * It reads presence live rather than taking a snapshot, so somebody who comes
 * online while the sheet is open stops reading as away without it being closed
 * and opened again.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileSheet(
    person: UserSummary,
    onDismiss: () -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val statuses by Presence.statuses.collectAsState()
    val lastSeen by Presence.lastSeen.collectAsState()

    // A `presence.sync` carries only the people who are here, so the one case
    // the line exists for is the one the socket has said nothing about. Asked
    // once, when the sheet opens: a timestamp a few minutes stale reads
    // identically, and somebody coming back arrives as an event of its own.
    LaunchedEffect(person.id) { Presence.askLastSeen(listOf(person.id)) }

    val status = statuses[person.id] ?: PresenceStatus.OFFLINE
    // `profile` and not `sentence`: a sheet always says something. Offline with
    // no timestamp - a new account, or one whose last seen is hidden from you -
    // used to draw nothing at all here, which read as a sheet that had failed
    // to load rather than as somebody nobody has seen.
    val line = LastSeen.profile(status, lastSeen[person.id])

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                AvatarWithStatus(
                    id = person.id,
                    label = person.label,
                    url = person.avatarUrl?.let { Endpoint.absolute(it) },
                    status = status.wire,
                    size = 56.dp,
                )
                Column(Modifier.weight(1f)) {
                    Text(
                        text = person.label,
                        style = MaterialTheme.typography.titleMediumEmphasized,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                    )
                    person.handle?.let {
                        Text(text = it, style = MaterialTheme.typography.bodySmall, color = Slate500)
                    }
                    Text(
                        text = line,
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate400,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
            }

            // Drawn only when there is one. A heading over an empty space is a
            // section that looks like it failed to load.
            if (person.about.isNotBlank()) {
                Spacer(Modifier.height(18.dp))
                HorizontalDivider()
                Spacer(Modifier.height(14.dp))
                Text(
                    text = "ABOUT",
                    style = MaterialTheme.typography.labelSmall,
                    color = Slate500,
                )
                Text(
                    text = person.about,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Slate200,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
    }
}
