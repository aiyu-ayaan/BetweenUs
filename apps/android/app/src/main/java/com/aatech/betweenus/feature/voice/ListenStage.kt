package com.aatech.betweenus.feature.voice

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aatech.betweenus.core.data.ServerClock
import com.aatech.betweenus.core.store.Listen
import com.aatech.betweenus.core.store.ListenSession
import com.aatech.betweenus.core.store.ListenTrack
import com.aatech.betweenus.core.store.ListenSync
import com.aatech.betweenus.core.store.listenPositionAt
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.IconAction
import android.webkit.WebView
import kotlinx.coroutines.delay

/**
 * What the call is listening to, on the phone, playing it.
 *
 * The queue, who added what, the transport - and a [YouTubeFrame] kept in step
 * with everybody else by [ListenSync]. The phone is a full participant in the
 * session now rather than a remote control for one.
 *
 * ## Every client streams for itself
 *
 * No audio crosses the call. The gateway holds a queue and a position; each
 * client fetches the video from YouTube itself and seeks to where the call
 * says it should be. That is why this can exist at all with no media server,
 * and why the sync is arithmetic over a shared clock rather than a stream.
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
        if (current != null) {
            ListenPlayer(
                session = session,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(16f / 9f)
                    .clip(MaterialTheme.shapes.medium),
            )
        }

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

/**
 * The embed, and the loop that keeps it in step.
 *
 * Three jobs, and they are separated because they run on different clocks.
 * **Loading** happens when the track changes. **Reconciling** happens every
 * [ListenSync.DRIFT_CHECK_MS] and is the only thing that seeks. **Ducking**
 * follows whoever is talking and touches nothing else.
 *
 * The player is asked for its own position rather than told what it should be:
 * a correction computed from what this client last sent would be a client
 * correcting itself towards its own opinion.
 */
@Composable
private fun ListenPlayer(session: ListenSession, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val engine = VoiceEngine.live.collectAsStateWithLifecycle().value
    val participants = engine?.participants?.collectAsStateWithLifecycle()?.value.orEmpty()

    /** The last thing the embed said about itself. Null until it has loaded. */
    var reported by remember { mutableStateOf<YouTubeFrame.PlayerState?>(null) }
    /** Tracks this client has already described, so it says so once. */
    val described = remember { mutableSetOf<String>() }
    /** Tracks this client has already reported the end of. */
    val finished = remember { mutableSetOf<String>() }

    val web = remember { WebView(context) }
    val frame = remember { YouTubeFrame(web) { reported = it } }

    DisposableEffect(frame) {
        frame.attach()
        onDispose { frame.release() }
    }

    val current = session.current

    // A track change is a fresh page. The frame decides whether it is really a
    // change; asking twice for the same video does nothing.
    LaunchedEffect(current?.ref) {
        current?.ref?.let { frame.load(it) }
    }

    // --- the reconcile loop --------------------------------------------------
    LaunchedEffect(session, current?.id) {
        val track = current ?: return@LaunchedEffect
        while (true) {
            frame.poll()
            val state = reported
            if (state != null) {
                // Play and pause first: a paused session whose player is still
                // running would be corrected towards a moving target for ever.
                if (session.paused && state.playing) frame.pause()
                if (!session.paused && !state.playing && !state.ended) frame.play()

                ListenSync.correction(session, ServerClock.nowMs(), state.positionMs)
                    ?.let { frame.seek(it) }

                // The title and length, once, for everybody without a player.
                if (described.add(track.id) && (state.title.isNotBlank() || state.durationMs > 0)) {
                    if (track.title.isBlank() || track.durationMs == 0L) {
                        Listen.reportMeta(track.id, state.title, state.durationMs)
                    }
                }

                // The end of a track advances the queue, and the gateway
                // ignores a second report for one that is no longer current -
                // which is what makes several clients finishing at once safe.
                if (state.ended && finished.add(track.id)) Listen.reportEnded(track.id)
            }
            delay(ListenSync.DRIFT_CHECK_MS)
        }
    }

    // --- ducking -------------------------------------------------------------
    //
    // The embed's own volume, not the phone's: turning the media stream down
    // would duck every other sound on the device, and the call is on the voice
    // stream and must not move at all.
    val talking = participants.any { it.speaking }
    LaunchedEffect(talking) {
        frame.volume(if (talking) DUCKED_VOLUME else FULL_VOLUME)
    }

    AndroidView(factory = { web }, modifier = modifier)
}

/** A quarter, matching the desktop's `DUCK`: audible under a voice, not gone. */
private const val DUCKED_VOLUME = 25

private const val FULL_VOLUME = 100
