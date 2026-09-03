package com.aatech.betweenus.feature.members

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.PresenceStatus
import com.aatech.betweenus.core.data.ServerRole
import com.aatech.betweenus.core.data.UserSummary
import com.aatech.betweenus.core.store.LastSeen
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.ui.components.AvatarWithStatus
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ProfileCover
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.theme.Slate200
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate500

/**
 * Everything about one person, on a screen of its own.
 *
 * [ProfileSheet] answers the questions that are not worth leaving a
 * conversation for - are they here, what does their line say. This answers the
 * ones that are: the whole about line rather than the two lines a sheet has
 * room for, the cover picture at a size worth having uploaded, and their rung
 * in this server. A sheet that grew to hold all of that would be a sheet
 * covering the conversation it was opened from.
 *
 * A full-screen [Dialog] rather than a navigation destination, and deliberately
 * so: this opens from a message, a face, a header and a member row, three of
 * which live under different back stacks. A route would need a way in from each
 * of them and a way back to each of them; a dialog is one object anything can
 * call, which is the pattern [com.aatech.betweenus.ui.components.ProfileViewer]
 * already established in this app for exactly the same reason.
 */
object FullProfile {
    var shown: UserSummary? by mutableStateOf(null)
        private set

    fun open(person: UserSummary) {
        shown = person
    }

    fun close() {
        shown = null
    }
}

/** Mounted once, at the root, beside `ProfileDialogHost`. */
@Composable
fun FullProfileHost() {
    val person = FullProfile.shown ?: return
    Dialog(
        onDismissRequest = { FullProfile.close() },
        // Full width and height: this is a screen wearing a dialog's clothes,
        // and the default platform dialog insets would leave it a card.
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        FullProfileScreen(person = person, onClose = { FullProfile.close() })
    }
}

@Composable
private fun FullProfileScreen(person: UserSummary, onClose: () -> Unit) {
    val statuses by Presence.statuses.collectAsState()
    val lastSeen by Presence.lastSeen.collectAsState()
    val members by Workspace.members.collectAsState()

    // The same one-shot the sheet does, for the same reason: a `presence.sync`
    // carries only the people who are here, so the one case the line exists for
    // is the one the socket has said nothing about.
    LaunchedEffect(person.id) { Presence.askLastSeen(listOf(person.id)) }

    // The member row, where there is one, carries the rung and a cover that a
    // message author does not. Absent is fine - every line below is optional.
    val member = members.values.asSequence()
        .flatten()
        .firstOrNull { it.userId == person.id }

    val status = statuses[person.id] ?: PresenceStatus.OFFLINE
    val cover = (person.coverUrl ?: member?.coverUrl)?.let { Endpoint.absolute(it) }
    val about = person.about.ifBlank { member?.about ?: "" }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding(),
    ) {
        ProfileCover(coverUrl = cover, height = 180.dp) {
            Box(Modifier.statusBarsPadding().padding(4.dp)) {
                IconAction(BetweenUsIcons.ChevronLeft, "Close profile", onClose)
            }
        }

        // Pulled up over the band, the way every profile since Twitter has done
        // it - it is what ties the round picture to the wide one.
        Box(Modifier.padding(start = 20.dp).offset(y = (-36).dp)) {
            AvatarWithStatus(
                id = person.id,
                label = person.label,
                url = person.avatarUrl?.let { Endpoint.absolute(it) },
                status = status.wire,
                size = 88.dp,
                ring = MaterialTheme.colorScheme.background,
            )
        }

        Column(Modifier.padding(horizontal = 20.dp).offset(y = (-24).dp)) {
            Text(
                text = person.label,
                style = MaterialTheme.typography.headlineSmallEmphasized,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            person.handle?.let {
                Text(text = it, style = MaterialTheme.typography.bodyMedium, color = Slate500)
            }
            Text(
                text = LastSeen.profile(status, lastSeen[person.id]),
                style = MaterialTheme.typography.bodySmall,
                color = Slate400,
                modifier = Modifier.padding(top = 6.dp),
            )
        }

        // Unclamped, unlike the sheet. This screen exists so the whole line can
        // be read; clamping it here would make it the sheet again, only slower
        // to reach.
        if (about.isNotBlank()) {
            SectionLabel("About")
            Card {
                Text(
                    text = about,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Slate200,
                )
            }
        }

        // The base rung, not the custom roles. Those are fetched per server and
        // sit in no store this screen can read; a request per profile opened is
        // not worth a row of chips a member list already implies.
        if (member != null) {
            SectionLabel("Role in this server")
            Card {
                Text(
                    text = member.role.label(),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Slate200,
                )
            }
        }

        Spacer(Modifier.height(40.dp))
    }
}

/** The rounded slab every section on this screen sits in. */
@Composable
private fun Card(content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .background(
                MaterialTheme.colorScheme.surfaceContainer,
                RoundedCornerShape(16.dp),
            )
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        content()
    }
}

/** "Owner", not "OWNER" - a screen reads a rung, it does not shout an enum. */
private fun ServerRole.label(): String =
    name.take(1) + name.drop(1).lowercase()
