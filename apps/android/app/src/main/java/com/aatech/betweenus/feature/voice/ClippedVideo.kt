package com.aatech.betweenus.feature.voice

import android.content.Context
import android.graphics.SurfaceTexture
import android.view.TextureView
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import org.webrtc.EglBase
import org.webrtc.EglRenderer
import org.webrtc.GlRectDrawer
import org.webrtc.VideoFrame
import org.webrtc.VideoSink
import org.webrtc.VideoTrack
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Video that is genuinely inside its rounded rectangle.
 *
 * `SurfaceViewRenderer` is a `SurfaceView`, and a `SurfaceView` is a separate
 * surface composited by the system rather than pixels drawn into the window -
 * so nothing in the window clips it. `Modifier.clip` does nothing to it, and
 * neither does its parent's outline. That is the whole of "the camera output is
 * not curved properly": the floating self-view had a rounded shadow and a
 * rounded border around a picture with four square corners.
 *
 * [VideoSurface] works around it by painting the four corner slivers back in
 * over the surface, which is correct only when the tile sits on a known,
 * opaque background. The floating self-view does not - it floats over whoever
 * else is in the call - so the corners came out as four blocks of the tile's
 * background colour instead of the picture behind it.
 *
 * A `TextureView` has no such problem: it is drawn by the window like any other
 * view, so it clips, it composites with what is under it, and it stacks by
 * ordinary view order rather than by `setZOrderMediaOverlay`. It costs a copy
 * per frame, which is why the full-screen tiles and the share stage keep the
 * surface renderer and only the small floating one uses this.
 *
 * Aspect fill, always: [EglRenderer.setLayoutAspectRatio] is given the view's
 * own aspect, which is what tells the drawer to crop rather than letterbox.
 */
private class TextureVideoRenderer(context: Context) : TextureView(context), VideoSink {

    private val renderer = EglRenderer("betweenus-clipped")
    private var live = false

    init {
        // The rounded corners have to show what is behind them, which an
        // opaque TextureView would paint over.
        isOpaque = false

        surfaceTextureListener = object : SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(
                texture: SurfaceTexture,
                width: Int,
                height: Int,
            ) {
                renderer.createEglSurface(texture)
                renderer.setLayoutAspectRatio(aspect(width, height))
            }

            override fun onSurfaceTextureSizeChanged(
                texture: SurfaceTexture,
                width: Int,
                height: Int,
            ) {
                renderer.setLayoutAspectRatio(aspect(width, height))
            }

            override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean {
                // Returning true hands the SurfaceTexture back to the platform
                // to release, so the render thread must be finished with it
                // first. The wait is bounded: a renderer that has already been
                // released never runs the callback, and hanging the UI thread
                // on a teardown is worse than leaking one texture.
                val done = CountDownLatch(1)
                renderer.releaseEglSurface { done.countDown() }
                runCatching { done.await(500, TimeUnit.MILLISECONDS) }
                return true
            }

            override fun onSurfaceTextureUpdated(texture: SurfaceTexture) = Unit
        }
    }

    fun start(sharedContext: EglBase.Context, mirror: Boolean) {
        if (live) return
        renderer.init(sharedContext, EglBase.CONFIG_PLAIN, GlRectDrawer())
        renderer.setMirror(mirror)
        live = true
    }

    fun stop() {
        if (!live) return
        live = false
        renderer.release()
    }

    override fun onFrame(frame: VideoFrame) = renderer.onFrame(frame)

    private fun aspect(width: Int, height: Int): Float =
        if (height <= 0) 0f else width.toFloat() / height.toFloat()
}

/**
 * One [VideoTrack], cropped to fill and clipped by whatever shape the caller
 * put on [modifier].
 *
 * [key] on the track for the same reason [VideoSurface] does it: turning a
 * camera off and on, or flipping it, is a *new* track, and a renderer left sunk
 * to the old one is an empty tile.
 */
@Composable
internal fun ClippedVideo(
    track: VideoTrack,
    eglContext: EglBase.Context,
    modifier: Modifier = Modifier,
    mirror: Boolean = false,
) {
    key(track) {
        AndroidView(
            factory = { context ->
                TextureVideoRenderer(context).apply {
                    start(eglContext, mirror)
                    track.addSink(this)
                }
            },
            onRelease = { view ->
                track.removeSink(view)
                view.stop()
            },
            modifier = modifier.fillMaxSize(),
        )
    }
}
