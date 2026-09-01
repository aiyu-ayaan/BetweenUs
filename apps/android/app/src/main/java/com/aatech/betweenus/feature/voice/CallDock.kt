package com.aatech.betweenus.feature.voice

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.theme.BetweenUsMotion
import kotlinx.coroutines.delay
import org.webrtc.RendererCommon
import org.webrtc.VideoTrack

/**
 * The call, while somebody is looking at something else.
 *
 * Backing out of a call screen used to shrink the whole activity into system
 * picture-in-picture, which answered "I want to leave this screen" with "then
 * leave the app". It is the wrong shape for the thing people actually do
 * mid-call, which is read the conversation the call is about, and it took the
 * channel list with it: there is no drawer inside a hundred-point window.
 *
 * So back is back now - the call screen is left, the call is not - and this is
 * what stands in for it:
 *
 *  - [CallBar], always. A strip under the status bar with who you are talking
 *    to, how long it has been, mute, and hang up. Tapping it goes back to the
 *    call. On an audio call this is the whole of it, which is the point: a
 *    floating black rectangle showing nothing is not a useful thing to put on
 *    top of somebody's conversation.
 *  - [FloatingCall], only when there is a picture worth floating. A small
 *    draggable window over whatever is on screen, tap to go back.
 *
 * Both read the engine directly rather than being handed state, because the one
 * thing they must not do is disappear when the screen underneath them changes.
 */
data class CallDockState(
    val channelId: String,
    /** Still joining. There is no duration yet and nothing to float. */
    val connecting: Boolean,
    /** Elapsed-realtime stamp the call became live at, or null while connecting. */
    val liveSince: Long?,
    val muted: Boolean,
    /**
     * What the floating window would show, or null when this call has no
     * picture in it - which is what makes an audio call a bar and nothing else.
     */
    val video: VideoTrack?,
) {
    val label: String
        get() = Workspace.channel(channelId)?.name
            ?: Workspace.directChannels.value
                .firstOrNull { it.channelId == channelId }
                ?.participant
                ?.label
            ?: "In a call"
}

/**
 * The dock's state, or null when there is nothing to dock.
 *
 * Null on the call screen itself as well as out of a call: the dock exists to
 * stand in for the screen, and standing in for a screen that is in front of you
 * is a second copy of it.
 */
@Composable
fun rememberCallDock(onCallScreen: Boolean): CallDockState? {
    // Watched rather than asked once: this is composed for the life of the
    // shell, and `remember { current() }` would cache the null from before the
    // first call and never notice the engine that arrived afterwards.
    val engine = VoiceEngine.live.collectAsState().value ?: return null

    val state by engine.state.collectAsState()
    val liveSince by engine.liveSince.collectAsState()
    val muted by engine.muted.collectAsState()
    val participants by engine.participants.collectAsState()
    val localVideo by engine.localVideo.collectAsState()
    val cameraOn by engine.cameraOn.collectAsState()
    val sharing by engine.sharing.collectAsState()

    if (onCallScreen) return null
    val channelId = when (val now = state) {
        is VoiceEngine.CallState.Live -> now.channelId
        is VoiceEngine.CallState.Connecting -> now.channelId
        else -> return null
    }

    // Somebody else's picture first, and your own only when there is no other:
    // your own camera is the one face in the call you are not there to watch,
    // and a share you started is worth keeping an eye on.
    //
    // ponytail: first with a picture rather than the sticky last-speaker rule
    // the full stage uses. This is a thumbnail somebody glances at on the way
    // past, and a second copy of that bookkeeping to run it is not worth the
    // one call in ten that has two cameras on.
    val video = participants.firstOrNull { it.video != null }?.video
        ?: localVideo?.takeIf { cameraOn || sharing }

    return CallDockState(
        channelId = channelId,
        connecting = state is VoiceEngine.CallState.Connecting,
        liveSince = liveSince,
        muted = muted,
        video = video,
    )
}

/**
 * The strip that says a call is still running.
 *
 * Under the status bar and above everything else, beside the connection and
 * clock banners, because it is the same kind of thing: a fact about the app
 * that outlives whatever screen is showing. It pushes the screen down rather
 * than covering it - a call somebody has walked away from must not be sitting
 * on top of the first line of their conversation.
 */
@Composable
fun CallBar(
    dock: CallDockState?,
    onReturn: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scheme = MaterialTheme.colorScheme
    val context = LocalContext.current

    // Held through the exit animation. `dock` is null by the time the bar is
    // sliding away, and a bar that empties itself before it leaves reads as a
    // glitch rather than as a dismissal. Written before it is read, so the
    // first frame of the arrival is already the real call.
    val shown = remember { mutableStateOf<CallDockState?>(null) }
    if (dock != null) shown.value = dock

    AnimatedVisibility(
        visible = dock != null,
        enter = fadeIn(BetweenUsMotion.effect()) + slideInVertically(BetweenUsMotion.spatial()) { -it },
        exit = fadeOut(BetweenUsMotion.effect()) + slideOutVertically(BetweenUsMotion.spatial()) { -it },
        modifier = modifier,
    ) {
        val entry = shown.value ?: return@AnimatedVisibility

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(scheme.primaryContainer)
                .clickable(onClick = onReturn)
                .statusBarsPadding()
                .padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(if (entry.connecting) scheme.outline else scheme.primary),
            )
            Text(
                text = entry.label,
                style = MaterialTheme.typography.labelLarge,
                color = scheme.onPrimaryContainer,
                modifier = Modifier.weight(1f, fill = false),
            )
            Text(
                text = if (entry.connecting) "Connecting…" else rememberElapsed(entry.liveSince),
                style = MaterialTheme.typography.labelLarge,
                color = scheme.onPrimaryContainer.copy(alpha = 0.75f),
                modifier = Modifier.weight(1f),
            )

            // The two things worth doing without going back to the call. Mute
            // is the one people reach for in a hurry - somebody walked into the
            // room - and it is the reason this bar has buttons at all rather
            // than being a line of text.
            IconAction(
                icon = if (entry.muted) BetweenUsIcons.MicOff else BetweenUsIcons.Mic,
                contentDescription = if (entry.muted) "Unmute" else "Mute",
                onClick = { VoiceEngine.of(context).toggleMute() },
            )
            // The phone glyph in the error colour: there is no separate
            // hung-up phone in the set, and a red one already reads as the end
            // of a call everywhere else in this app.
            IconAction(
                icon = BetweenUsIcons.Phone,
                contentDescription = "Leave the call",
                onClick = { VoiceEngine.of(context).leave() },
                tint = scheme.error,
            )
        }
    }
}

/**
 * The picture, floating over whatever is on screen.
 *
 * Only when the call has one. An audio call gets [CallBar] and nothing else -
 * a black rectangle with a name in it is not worth the corner of the screen it
 * would take from somebody's conversation.
 *
 * Draggable, and it stays where it is put: the one thing a floating window has
 * to do is get out of the way of what it is floating over, and the only thing
 * that knows where that is is the person reading it.
 */
@Composable
fun FloatingCall(
    dock: CallDockState?,
    eglContext: org.webrtc.EglBase.Context,
    onReturn: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val track = dock?.video ?: return
    val scheme = MaterialTheme.colorScheme
    val density = LocalDensity.current

    BoxWithConstraints(modifier.fillMaxSize()) {
        val width = 112.dp
        val height = 168.dp
        val margin = 12.dp
        val maxX = with(density) { (maxWidth - width - margin).toPx() }
        val maxY = with(density) { (maxHeight - height - margin).toPx() }
        val edge = with(density) { margin.toPx() }

        // Top-right to start with, which is the corner a phone's own call
        // window uses and the one furthest from a thumb on either side.
        var offset by remember { mutableStateOf<androidx.compose.ui.geometry.Offset?>(null) }
        val placed = offset ?: Offset(maxX, edge)

        Box(
            modifier = Modifier
                .offset {
                    IntOffset(
                        placed.x.coerceIn(edge, maxX.coerceAtLeast(edge)).toInt(),
                        placed.y.coerceIn(edge, maxY.coerceAtLeast(edge)).toInt(),
                    )
                }
                .width(width)
                .height(height)
                .clip(RoundedCornerShape(14.dp))
                .background(Color.Black)
                .border(1.dp, scheme.outlineVariant, RoundedCornerShape(14.dp))
                .pointerInput(maxX, maxY) {
                    detectDragGestures { change, drag ->
                        change.consume()
                        val from = offset ?: Offset(maxX, edge)
                        offset = Offset(
                            (from.x + drag.x).coerceIn(edge, maxX.coerceAtLeast(edge)),
                            (from.y + drag.y).coerceIn(edge, maxY.coerceAtLeast(edge)),
                        )
                    }
                }
                .clickable(onClick = onReturn),
        ) {
            VideoSurface(
                track = track,
                eglContext = eglContext,
                modifier = Modifier.fillMaxSize(),
                fit = RendererCommon.ScalingType.SCALE_ASPECT_FILL,
                // Over the app rather than under it. A SurfaceView drawn on top
                // of the window is behind everything unless it says otherwise,
                // and this one is by definition on top of something.
                overlay = true,
                corner = 14.dp,
                cornerColor = Color.Black,
            )
        }
    }
}

/**
 * How long the call has been running, as `4:07` or `1:04:07`, ticking.
 *
 * A second at a time and nothing finer: a counter that redraws thirty times a
 * second to show a number that changes once is a frame budget spent on nothing.
 */
@Composable
private fun rememberElapsed(liveSince: Long?): String {
    var now by remember(liveSince) { mutableStateOf(android.os.SystemClock.elapsedRealtime()) }
    LaunchedEffect(liveSince) {
        if (liveSince == null) return@LaunchedEffect
        while (true) {
            now = android.os.SystemClock.elapsedRealtime()
            delay(1000)
        }
    }
    if (liveSince == null) return ""
    return formatElapsed(((now - liveSince) / 1000).coerceAtLeast(0))
}

/**
 * Seconds as a call timer reads them.
 *
 * Minutes are not padded and seconds always are, which is how every phone on
 * the planet draws this: `4:07`, not `04:07`. The hour only appears once there
 * has been one.
 */
fun formatElapsed(seconds: Long): String {
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    val rest = seconds % 60
    return if (hours > 0) {
        "$hours:${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}"
    } else {
        "$minutes:${rest.toString().padStart(2, '0')}"
    }
}
