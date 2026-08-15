package com.aktech.nexora.feature.voice

import android.app.Activity
import android.content.pm.ActivityInfo
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.aktech.nexora.ui.components.Avatar
import com.aktech.nexora.ui.components.IconAction
import com.aktech.nexora.ui.components.NexoraIcon
import com.aktech.nexora.ui.components.NexoraIcons
import com.aktech.nexora.ui.theme.Accent
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Slate100
import com.aktech.nexora.ui.theme.Slate400
import com.aktech.nexora.ui.theme.StatusOnline
import com.aktech.nexora.ui.theme.Surface900
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack
import kotlin.math.max
import kotlin.math.min

/**
 * Somebody else's screen, laid out the way a meeting client lays one out.
 *
 * A share is not another tile. It is usually text - an editor, a terminal, a
 * document - and text in a quarter of a phone screen is not readable, however
 * tidy the grid around it is. So the share is the screen: it takes the whole
 * canvas and fits itself to it, the people in the call become a filmstrip along
 * the bottom, and the call controls sit under that. Tapping anywhere clears all
 * of it away and leaves the share alone with the glass.
 *
 * Three things exist because a phone is not a monitor:
 *
 * - **Fit, always.** The renderer letterboxes rather than crops, because the
 *   edges of a desktop are where its toolbars are. Aspect ratio is the
 *   sender's, whatever shape this phone happens to be at the time.
 * - **Zoom and pan.** 1280x720 fitted to a 6" screen is small even done
 *   correctly. Pinch to get in, drag to move, double-tap back to fit.
 * - **Orientation.** A landscape share in a portrait phone wastes two thirds of
 *   the glass, and the phone's rotation lock is usually on, so this asks for an
 *   orientation rather than hoping for one.
 *
 * The orientation is only ever *given back* by this screen closing, never by it
 * being rebuilt. That distinction is the whole reason rotating used to loop:
 * asking for landscape recreated the activity, the recreate tore the stage down
 * and handed the orientation back, which recreated it again. The activity now
 * handles the configuration change itself (see the manifest), so a rotation
 * changes nothing here but the shape of the canvas.
 */
@Composable
fun ShareStage(
    label: String,
    track: VideoTrack,
    participants: List<VoiceEngine.Participant>,
    self: String,
    selfId: String,
    eglContext: EglBase.Context,
    muted: Boolean,
    cameraOn: Boolean,
    sharing: Boolean,
    onToggleMute: () -> Unit,
    onToggleCamera: () -> Unit,
    onToggleShare: () -> Unit,
    onLeave: () -> Unit,
    onClose: () -> Unit,
) {
    val activity = LocalContext.current as? Activity
    var orientation by rememberSaveable { mutableStateOf(StageOrientation.FOLLOW_PHONE) }
    var chrome by rememberSaveable { mutableStateOf(true) }

    var scale by remember { mutableFloatStateOf(1f) }
    var offsetX by remember { mutableFloatStateOf(0f) }
    var offsetY by remember { mutableFloatStateOf(0f) }

    LaunchedEffect(orientation) {
        activity?.requestedOrientation = orientation.request
    }
    DisposableEffect(Unit) {
        // Runs when the stage genuinely goes away, which - with the activity
        // handling its own configuration changes - is the only time it should.
        onDispose { activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }
    }

    val transform = rememberTransformableState { zoom, pan, _ ->
        scale = min(max(scale * zoom, 1f), MAX_ZOOM)
        // Panning at fit scale would slide the picture off its own screen.
        if (scale > 1f) {
            offsetX += pan.x
            offsetY += pan.y
        } else {
            offsetX = 0f
            offsetY = 0f
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(
            factory = { context ->
                SurfaceViewRenderer(context).apply {
                    init(eglContext, null)
                    // Fit, not fill: a share cropped to the phone's shape loses
                    // its edges, which is where the toolbars are.
                    setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
                    setEnableHardwareScaler(true)
                    track.addSink(this)
                }
            },
            onRelease = { renderer ->
                track.removeSink(renderer)
                renderer.release()
            },
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer(
                    scaleX = scale,
                    scaleY = scale,
                    translationX = offsetX,
                    translationY = offsetY,
                )
                .transformable(transform),
        )

        // Above the renderer, so a tap anywhere brings the chrome back.
        Box(
            Modifier.fillMaxSize().pointerInput(Unit) {
                detectTapGestures(
                    onTap = { chrome = !chrome },
                    onDoubleTap = {
                        scale = 1f
                        offsetX = 0f
                        offsetY = 0f
                    },
                )
            },
        )

        AnimatedVisibility(
            visible = chrome,
            enter = fadeIn() + slideInVertically { -it },
            exit = fadeOut() + slideOutVertically { -it },
            modifier = Modifier.align(Alignment.TopCenter),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.Black.copy(alpha = 0.6f))
                    .systemBarsPadding()
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconAction(NexoraIcons.ChevronLeft, "Back to the call", onClose)
                Column(Modifier.weight(1f).padding(start = 8.dp)) {
                    Text(
                        text = "$label is presenting",
                        style = MaterialTheme.typography.titleSmall,
                        color = Slate100,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = orientation.label,
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate400,
                    )
                }
                // Maximize rather than a rotate mark: the icon set is generated
                // from the desktop's, and inventing one here would be a fourth
                // set that nearly agrees. The line above says which mode it is
                // in, which is the part that has to be unambiguous.
                IconAction(
                    icon = NexoraIcons.Maximize,
                    contentDescription = "Change the orientation",
                    tint = if (orientation == StageOrientation.FOLLOW_PHONE) Slate400 else Accent,
                    onClick = { orientation = orientation.next() },
                )
            }
        }

        AnimatedVisibility(
            visible = chrome,
            enter = fadeIn() + slideInVertically { it },
            exit = fadeOut() + slideOutVertically { it },
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.Black.copy(alpha = 0.6f))
                    .systemBarsPadding(),
            ) {
                // The people, small, along the bottom: a share without the room
                // it is being shown to is a video, not a meeting.
                LazyRow(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    item {
                        FilmstripTile(
                            label = "$self (you)",
                            id = selfId,
                            eglContext = eglContext,
                            track = null,
                            muted = muted,
                            speaking = false,
                        )
                    }
                    items(participants, key = { it.peer.peerId }) { participant ->
                        FilmstripTile(
                            label = participant.peer.username,
                            id = participant.peer.userId,
                            eglContext = eglContext,
                            track = participant.camera,
                            muted = !participant.micEnabled,
                            speaking = participant.speaking,
                        )
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconAction(
                        icon = if (muted) NexoraIcons.MicOff else NexoraIcons.Mic,
                        contentDescription = if (muted) "Unmute" else "Mute",
                        tint = if (muted) Danger else Slate100,
                        onClick = onToggleMute,
                    )
                    IconAction(
                        icon = if (cameraOn) NexoraIcons.Video else NexoraIcons.VideoOff,
                        contentDescription = if (cameraOn) "Turn the camera off" else "Turn the camera on",
                        tint = if (cameraOn) Accent else Slate400,
                        onClick = onToggleCamera,
                    )
                    IconAction(
                        icon = NexoraIcons.ScreenShare,
                        contentDescription = if (sharing) "Stop sharing" else "Share the screen",
                        tint = if (sharing) Accent else Slate400,
                        onClick = onToggleShare,
                    )
                    IconAction(
                        icon = NexoraIcons.Phone,
                        contentDescription = "Leave the call",
                        tint = Danger,
                        onClick = onLeave,
                    )
                }
            }
        }
    }
}

/** One person in the strip under the share: their camera, or their face. */
@Composable
private fun FilmstripTile(
    label: String,
    id: String,
    eglContext: EglBase.Context,
    track: VideoTrack?,
    muted: Boolean,
    speaking: Boolean,
) {
    Box(
        modifier = Modifier
            .size(width = 96.dp, height = 64.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(Surface900)
            .then(
                if (speaking) Modifier.border(2.dp, StatusOnline, RoundedCornerShape(10.dp))
                else Modifier,
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (track != null) {
            AndroidView(
                factory = { context ->
                    SurfaceViewRenderer(context).apply {
                        init(eglContext, null)
                        // A thumbnail is cropped rather than letterboxed: at
                        // this size the black bars would be most of the tile.
                        setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                        setEnableHardwareScaler(true)
                        track.addSink(this)
                    }
                },
                onRelease = { renderer ->
                    track.removeSink(renderer)
                    renderer.release()
                },
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Avatar(id = id, label = label, url = null, size = 28.dp)
        }

        Row(
            modifier = Modifier.align(Alignment.BottomStart).padding(4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            if (muted) NexoraIcon(icon = NexoraIcons.MicOff, tint = Danger, size = 12.dp)
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = Slate100,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * What the stage asks the activity for.
 *
 * `SENSOR_LANDSCAPE` rather than `LANDSCAPE` so the phone can still be turned
 * either way round once it is on its side; the point is to override the
 * rotation lock, not to dictate which way up.
 */
enum class StageOrientation(val request: Int, val label: String) {
    FOLLOW_PHONE(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, "Following the phone"),
    LANDSCAPE(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE, "Landscape"),
    PORTRAIT(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, "Portrait");

    fun next(): StageOrientation = entries[(ordinal + 1) % entries.size]
}

/** Far enough in to read a terminal, not so far that it is all pixels. */
private const val MAX_ZOOM = 6f
