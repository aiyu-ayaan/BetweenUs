package com.aatech.betweenus.feature.voice

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/**
 * The one place a [VideoTrack] becomes pixels.
 *
 * Every tile in a call renders through here, because two things about a
 * `SurfaceViewRenderer` are easy to get wrong in the same way four times over:
 *
 * - A new capture is a *new* `VideoTrack`. Turning the camera off and on, or
 *   flipping it, disposes the old track and makes another - and `AndroidView`
 *   will not rebuild its view for that on its own, so the renderer stays sunk
 *   to a disposed track and the tile goes empty. [key] on the track is what
 *   makes a new track a new renderer.
 * - A `SurfaceView` drawn over another `SurfaceView` is behind it unless it
 *   says otherwise. The self-view floating over a full-screen peer, and the
 *   filmstrip over a share, are both that case, and both show as a blank box
 *   without [overlay].
 * - **A `SurfaceView` is not clipped by its parent.** It is its own surface,
 *   composited underneath the window, so `Modifier.clip` above it does nothing
 *   at all: every rounded tile in the call had square video corners inside a
 *   rounded shadow and a rounded border. [corner] is the fix, and it is a mask
 *   rather than a clip - the four corner slivers painted in [cornerColor] by
 *   the window, which does draw over the surface. That is the same reason the
 *   name pill and the flip button are visible on top of the video.
 */
@Composable
internal fun VideoSurface(
    track: VideoTrack,
    eglContext: EglBase.Context,
    modifier: Modifier = Modifier,
    fit: RendererCommon.ScalingType = RendererCommon.ScalingType.SCALE_ASPECT_FILL,
    hardwareScaler: Boolean = true,
    overlay: Boolean = false,
    mirror: Boolean = false,
    events: RendererCommon.RendererEvents? = null,
    /** Radius of the rounded rectangle the picture should appear to sit in. */
    corner: Dp = 0.dp,
    /** What the masked corners are painted with - the tile's own background. */
    cornerColor: Color = Color.Transparent,
) {
    Box(modifier) {
        key(track) {
            AndroidView(
                factory = { context ->
                    SurfaceViewRenderer(context).apply {
                        init(eglContext, events)
                        setScalingType(fit)
                        setEnableHardwareScaler(hardwareScaler)
                        setMirror(mirror)
                        if (overlay) setZOrderMediaOverlay(true)
                        track.addSink(this)
                    }
                },
                onRelease = { renderer ->
                    track.removeSink(renderer)
                    renderer.release()
                },
                modifier = Modifier.fillMaxSize(),
            )
        }

        if (corner > 0.dp && cornerColor != Color.Transparent) {
            Canvas(Modifier.fillMaxSize()) {
                val radius = corner.toPx()
                // Outer rectangle minus the rounded one, filled: what is left
                // is the four corners and nothing else.
                val mask = Path().apply {
                    fillType = PathFillType.EvenOdd
                    addRect(Rect(Offset.Zero, size))
                    addRoundRect(RoundRect(Rect(Offset.Zero, size), CornerRadius(radius)))
                }
                drawPath(mask, cornerColor)
            }
        }
    }
}
