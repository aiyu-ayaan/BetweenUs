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
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.PresenceStatus
import com.aatech.betweenus.core.data.UserSummary
import com.aatech.betweenus.core.store.LastSeen
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.ui.components.AvatarWithStatus
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.ProfileCover
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
    /**
     * Who to draw, as whoever opened the sheet knows them. It may be a message's
     * author, which carries no about line - see `person` below.
     */
    personArg: UserSummary,
    onDismiss: () -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val statuses by Presence.statuses.collectAsState()
    val lastSeen by Presence.lastSeen.collectAsState()
    val members by Workspace.members.collectAsState()
    val friends by Workspace.friends.collectAsState()
    val directs by Workspace.directChannels.collectAsState()

    /**
     * The fullest copy of this person the app is holding.
     *
     * A message carries who wrote it - an id, a name and a picture - and never
     * an about line: the same person writes fifty messages, and fifty copies of
     * one sentence in a channel's history is fifty copies to keep in step when
     * they edit it. So the sheet opened from a message was handed a summary with
     * an empty `about` and drew no About section at all, which looked like the
     * feature was missing rather than like the data was somewhere else.
     *
     * It is somewhere else: the member list, the friend list and the
     * conversation list all carry it, because those are fetched per person
     * rather than per message. Resolved here rather than at each call site so
     * that every way into this sheet - a message, a face, a header, a member
     * row - gets the same answer.
     *
     * Whatever was passed in stays the fallback, so somebody who has left the
     * server still gets a sheet with their name and their presence on it.
     */
    val person = remember(personArg, members, friends, directs) {
        // The first copy that actually carries a line, not the first copy that
        // exists: a member row whose about is blank must not shadow the friend
        // row that has one, which is the same person seen through two lists.
        val candidates = sequence {
            members.values.forEach { list ->
                list.forEach { if (it.userId == personArg.id) yield(it.summary) }
            }
            friends.forEach { if (it.user.id == personArg.id) yield(it.user) }
            directs.forEach { if (it.participant.id == personArg.id) yield(it.participant) }
        }.toList()
        // Merged rather than "the first copy that has an about line": the cover
        // and the about line are carried by different lists - a member row has
        // both, a friend row has neither - so picking one winning copy loses
        // whichever field that copy happens to be missing.
        (candidates.firstOrNull { it.about.isNotBlank() } ?: personArg).copy(
            coverUrl = candidates.firstNotNullOfOrNull { it.coverUrl } ?: personArg.coverUrl,
        )
    }

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
        // A short band rather than the full one the screen below draws: this is
        // a sheet, and a picture tall enough to be looked at properly is the
        // reason that screen exists.
        ProfileCover(coverUrl = person.coverUrl?.let { Endpoint.absolute(it) }, height = 72.dp)

        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 20.dp)
                .padding(top = 16.dp, bottom = 24.dp),
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
                    // Clamped here and nowhere else: a sheet that grows past a
                    // few lines starts covering the conversation it was opened
                    // from. The whole line is one tap away, below.
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }

            Spacer(Modifier.height(18.dp))
            BetweenUsButton(
                text = "View full profile",
                onClick = {
                    // Closed first: two things at this depth on screen at once
                    // leaves the sheet visible behind a full-screen dialog, and
                    // dismissing that one would reveal a sheet nobody asked to
                    // still be open.
                    onDismiss()
                    FullProfile.open(person)
                },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
