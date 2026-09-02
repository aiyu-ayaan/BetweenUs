package com.aatech.betweenus.feature.voice

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aatech.betweenus.core.data.ServerClock
import com.aatech.betweenus.core.store.Listen
import com.aatech.betweenus.core.store.ListenSession
import com.aatech.betweenus.core.store.ListenTrack
import com.aatech.betweenus.core.store.listenPositionAt
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.IconAction
import kotlinx.coroutines.delay

/**
 * What the call is listening to, on the phone.
 *
 * A seat at the table rather than a second sound system: the phone shows the
 * queue, says who added what and who last changed it, and can pause, skip and
 * drop a track. The audio is still coming out of the desktops in the call.
 *
 * **It does not play anything, and it says so.** A stage that looked like a
 * player and produced no sound would be read as broken; one that states what it
 * is is read as what it is. The player is the next item - a WebView, the IFrame
 * API and a sync loop - and half of it would be audio that drifts silently,
 * which is the one failure a listening session cannot survive.
 */

/** `4:07`, and `1:02:03` once an hour is involved. */
fun listenClock(ms: Long): String {
    val total = maxOf(0L, ms) / 1000
    val seconds = total % 60
    val minutes = (total / 60) % 60
    val hours = total / 3600
    return if (hours > 0) {
        "%d:%02d:%02d".format(hours, minutes, seconds)
    } else {
        "%d:%02d".format(minutes, seconds)
    }
}

/**
 * What to call a track that nothing has named yet.
 *
 * `title` is filled in by the first client whose player learns it, so a session
 * of nothing but phones has none at all - and a blank row reads as a broken
 * queue rather than as a video nobody has opened. The provider's own id is at
 * least a handle somebody can recognise.
 */
fun listenLabel(track: ListenTrack): String =
    track.title.ifBlank { track.ref }

@Composable
fun ListenStage(modifier: Modifier = Modifier) {
    val session by Listen.session.collectAsStateWithLifecycle()
    val live = session ?: return

    ListenStageContent(live, modifier)
}

@Composable
private fun ListenStageContent(session: ListenSession, modifier: Modifier = Modifier) {
    val scheme = MaterialTheme.colorScheme
    val current = session.current

    /**
     * The needle, ticked here rather than carried in the state.
     *
     * The gateway sends where the track *was*; advancing it is every client's
     * own arithmetic off a shared clock, which is what stops a progress bar
     * needing a message a second to move.
     */
    var positionMs by remember(session) { mutableLongStateOf(0L) }
    LaunchedEffect(session) {
        while (true) {
            positionMs = listenPositionAt(session, ServerClock.nowMs())
            delay(500)
        }
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.large)
            .background(scheme.surfaceContainerHigh)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = current?.let { listenLabel(it) } ?: "Nothing queued",
                    style = MaterialTheme.typography.titleSmall,
                    color = scheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = current?.let { "Added by ${it.addedByUsername}" }
                        ?: "Anybody in the call can add a track from a desktop",
                    style = MaterialTheme.typography.bodySmall,
                    color = scheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            if (current != null) {
                IconAction(
                    icon = BetweenUsIcons.ChevronLeft,
                    contentDescription = "Previous track",
                    onClick = { Listen.skip(-1) },
                )
                IconAction(
                    icon = if (session.paused) BetweenUsIcons.Play else BetweenUsIcons.Pause,
                    contentDescription = if (session.paused) "Resume for everybody" else "Pause for everybody",
                    onClick = { if (session.paused) Listen.resume() else Listen.pause() },
                    prominent = true,
                )
                IconAction(
                    icon = BetweenUsIcons.ChevronRight,
                    contentDescription = "Skip for everybody",
                    onClick = { Listen.skip(1) },
                )
            }
        }

        if (current != null) {
            // A known duration gives a bar; an unknown one gives the elapsed
            // time alone, because a progress bar with no end is a bar that
            // lies about how far through the track is.
            if (current.durationMs > 0) {
                LinearProgressIndicator(
                    progress = { (positionMs.toFloat() / current.durationMs).coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Text(
                text = if (current.durationMs > 0) {
                    "${listenClock(positionMs)} / ${listenClock(current.durationMs)}"
                } else {
                    listenClock(positionMs)
                },
                style = MaterialTheme.typography.labelSmall,
                color = scheme.onSurfaceVariant,
            )
        }

        // Said plainly rather than left to be discovered. Somebody looking at a
        // queue on a phone and hearing nothing needs to know which of the two
        // things is happening.
        Text(
            text = "Playing on the desktops in this call. This phone shows the queue and can " +
                "change it; it does not play the track.",
            style = MaterialTheme.typography.bodySmall,
            color = scheme.onSurfaceVariant,
        )

        if (session.queue.size > 1) {
            LazyColumn(
                modifier = Modifier.heightIn(max = 180.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                items(session.queue, key = { it.id }) { track ->
                    val playing = track.id == current?.id
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        BetweenUsIcon(
                            icon = if (playing) BetweenUsIcons.Speaker else BetweenUsIcons.Message,
                            size = 16.dp,
                            tint = if (playing) scheme.primary else scheme.onSurfaceVariant,
                            contentDescription = null,
                        )
                        Text(
                            text = listenLabel(track),
                            style = MaterialTheme.typography.bodySmall,
                            color = if (playing) scheme.onSurface else scheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        if (!playing) {
                            IconAction(
                                icon = BetweenUsIcons.X,
                                contentDescription = "Remove ${listenLabel(track)} from the queue",
                                onClick = { Listen.remove(track.id) },
                            )
                        }
                    }
                }
            }
        }
    }
}
