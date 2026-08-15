package com.aktech.nexora.feature.voice

import android.app.Activity
import android.content.pm.ActivityInfo
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.systemBarsPadding
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.aktech.nexora.ui.components.IconAction
import com.aktech.nexora.ui.components.NexoraIcons
import com.aktech.nexora.ui.theme.Accent
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Slate100
import com.aktech.nexora.ui.theme.Slate400
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack
import kotlin.math.max
import kotlin.math.min

/**
 * Somebody else's screen, full bleed.
 *
 * A share is not another tile. It is usually text - an editor, a terminal, a
 * document - and text in a quarter of a phone screen is not readable, which
 * makes a grid the wrong shape for it however tidy the grid is. So a share
 * takes the whole screen, the call controls come along on an overlay, and the
 * grid is one tap away.
 *
 * Two things exist because a phone is not a monitor:
 *
 * - **Zoom and pan.** A 1280x720 desktop on a 6" screen is unreadable at fit
 *   scale no matter what. Pinch to get in, drag to move, double-tap to reset.
 * - **Orientation.** A landscape share in a portrait phone wastes two thirds of
 *   the glass. Rotating is the fix, and the phone's own rotation lock is
 *   usually on, so this asks for the orientation directly rather than hoping.
 *
 * The requested orientation is given back on the way out - leaving an activity
 * pinned to landscape after a share ends is a bug that outlives the call.
 */
@Composable
fun ShareStage(
    label: String,
    track: VideoTrack,
    eglContext: EglBase.Context,
    muted: Boolean,
    onToggleMute: () -> Unit,
    onLeave: () -> Unit,
    onClose: () -> Unit,
) {
    val activity = LocalContext.current as? Activity
    var orientation by rememberSaveable { mutableStateOf(StageOrientation.FOLLOW_PHONE) }
    var chrome by remember { mutableStateOf(true) }

    var scale by remember { mutableFloatStateOf(1f) }
    var offsetX by remember { mutableFloatStateOf(0f) }
    var offsetY by remember { mutableFloatStateOf(0f) }

    LaunchedEffect(orientation) {
        activity?.requestedOrientation = orientation.request
    }
    DisposableEffect(activity) {
        onDispose { activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }
    }

    val transform = rememberTransformableState { zoom, pan, _ ->
        scale = min(max(scale * zoom, 1f), MAX_ZOOM)
        // Panning below fit scale would slide the picture off its own screen.
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
                    // Fit, not fill: a share cropped to the phone's shape is a
                    // share with its edges - which is where the toolbars are -
                    // cut off.
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

        // Above the renderer, so a tap anywhere brings the controls back.
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
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.TopCenter),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.Black.copy(alpha = 0.55f))
                    .systemBarsPadding()
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconAction(NexoraIcons.ChevronLeft, "Back to the call", onClose)
                Column(Modifier.weight(1f).padding(start = 8.dp)) {
                    Text(
                        text = "$label is sharing",
                        style = MaterialTheme.typography.titleSmall,
                        color = Slate100,
                    )
                    Text(
                        text = orientation.label,
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate400,
                    )
                }
                // Maximize rather than a rotate mark: the icon set is generated
                // from the desktop's, and inventing one here would be a fourth
                // set that nearly agrees. The line underneath says which mode
                // it is in, which is the part that has to be unambiguous.
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
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.Black.copy(alpha = 0.55f))
                    .systemBarsPadding()
                    .padding(8.dp),
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
                    icon = NexoraIcons.Phone,
                    contentDescription = "Leave the call",
                    tint = Danger,
                    onClick = onLeave,
                )
            }
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
