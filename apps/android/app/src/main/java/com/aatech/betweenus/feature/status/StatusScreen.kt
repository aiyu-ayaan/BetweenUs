package com.aatech.betweenus.feature.status

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.AuthPhase
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.store.Statuses
import com.aatech.betweenus.ui.components.Avatar
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.EmptyState
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.components.StatusComposerDoor
import com.aatech.betweenus.ui.components.StatusStory

/**
 * The status tray: your own run at the top, then everybody else's.
 *
 * Split into "Recent updates" and "Viewed updates" rather than one list sorted
 * by time, for the same reason the ring has two colours - the useful question
 * is not when somebody posted, it is whether there is anything left to watch.
 * One list buries the unwatched run under four that were finished an hour ago.
 *
 * Nothing here plays anything: a row opens [StatusStory], which the one player
 * in the app answers. The port of
 * `apps/desktop/src/features/status/StatusScreen.tsx`.
 */
@Composable
fun StatusScreen(onBack: () -> Unit) {
    val me = (Session.state.collectAsState().value as? AuthPhase.SignedIn)?.user
    val mine by Statuses.mine.collectAsState()
    val runs by Statuses.runs.collectAsState()
    val loaded by Statuses.loaded.collectAsState()
    val error by Statuses.error.collectAsState()

    // Read on arrival as well as on the socket's announcement: a phone that was
    // asleep while somebody posted has a stale tray and no event coming.
    LaunchedEffect(Unit) { Statuses.refresh() }

    val recent = runs.filter { it.unseen }
    val viewed = runs.filterNot { it.unseen }

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(
                icon = BetweenUsIcons.ChevronLeft,
                contentDescription = "Back",
                onClick = onBack,
            )
            Column(Modifier.weight(1f).padding(start = 8.dp)) {
                Text(
                    text = "Updates",
                    style = MaterialTheme.typography.titleLargeEmphasized,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = "Posts disappear after 24 hours",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconAction(
                icon = BetweenUsIcons.Plus,
                contentDescription = "Add an update",
                onClick = { StatusComposerDoor.show() },
                prominent = true,
            )
        }

        error?.let {
            Notice(
                message = it,
                tone = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }

        LazyColumn(Modifier.fillMaxSize().navigationBarsPadding()) {
            item {
                // Your own row is both the way in to the composer and the way
                // back to what you have already posted, which is why the plus
                // sits on the avatar rather than being a second row.
                ListRow(
                    title = "My updates",
                    subtitle = if (mine.isEmpty()) {
                        "Tap to add an update"
                    } else {
                        "${countLabel(mine.size)} · ${statusAge(mine.last().createdAt)}"
                    },
                    leading = {
                        Box {
                            Avatar(
                                id = me?.id.orEmpty(),
                                label = me?.label ?: "You",
                                url = me?.avatarUrl?.let { Endpoint.absolute(it) },
                                viewable = false,
                            )
                            if (mine.isEmpty()) {
                                Box(
                                    modifier = Modifier
                                        .align(Alignment.BottomEnd)
                                        .size(16.dp)
                                        .clip(CircleShape)
                                        .background(MaterialTheme.colorScheme.primary),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    BetweenUsIcon(
                                        BetweenUsIcons.Plus,
                                        size = 11.dp,
                                        tint = MaterialTheme.colorScheme.onPrimary,
                                    )
                                }
                            }
                        }
                    },
                    onClick = {
                        val id = me?.id
                        if (mine.isNotEmpty() && id != null) {
                            StatusStory.open(id)
                        } else {
                            StatusComposerDoor.show()
                        }
                    },
                )
            }

            if (loaded && runs.isEmpty()) {
                item {
                    EmptyState(
                        icon = BetweenUsIcons.UpdatesEmpty,
                        title = "No updates yet",
                        detail = "Updates from your friends appear here, and disappear a day later.",
                    )
                }
            }

            if (recent.isNotEmpty()) {
                item { SectionLabel("Recent updates") }
                items(recent, key = { it.author.id }) { run ->
                    ListRow(
                        title = run.author.label,
                        subtitle = "${countLabel(run.statuses.size)} · ${statusAge(run.latestAt)}",
                        // `viewable = false`: the row is already the way in to
                        // the statuses, so an avatar asking "profile or status"
                        // inside it would be the same question twice.
                        leading = {
                            Avatar(
                                id = run.author.id,
                                label = run.author.label,
                                url = run.author.avatarUrl?.let { Endpoint.absolute(it) },
                                viewable = false,
                            )
                        },
                        onClick = { StatusStory.open(run.author.id) },
                    )
                }
            }

            if (viewed.isNotEmpty()) {
                item { SectionLabel("Viewed updates") }
                items(viewed, key = { it.author.id }) { run ->
                    ListRow(
                        title = run.author.label,
                        subtitle = "${countLabel(run.statuses.size)} · ${statusAge(run.latestAt)}",
                        leading = {
                            Avatar(
                                id = run.author.id,
                                label = run.author.label,
                                url = run.author.avatarUrl?.let { Endpoint.absolute(it) },
                                viewable = false,
                            )
                        },
                        onClick = { StatusStory.open(run.author.id) },
                    )
                }
            }
        }
    }
}

private fun countLabel(count: Int): String = if (count == 1) "1 update" else "$count updates"
