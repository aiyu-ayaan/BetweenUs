package com.aatech.betweenus.feature.voice

import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
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
) {
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
            modifier = modifier,
        )
    }
}
