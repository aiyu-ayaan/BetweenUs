package com.aatech.betweenus.feature.voice

import android.graphics.Matrix
import android.opengl.GLES11Ext
import android.opengl.GLES20
import org.webrtc.GlShader
import org.webrtc.GlTextureFrameBuffer
import org.webrtc.GlUtil
import org.webrtc.RendererCommon
import org.webrtc.SurfaceTextureHelper
import org.webrtc.TextureBufferImpl
import org.webrtc.VideoFrame
import org.webrtc.VideoFrameDrawer
import org.webrtc.VideoProcessor
import org.webrtc.VideoSink
import org.webrtc.YuvConverter
import java.nio.FloatBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The camera's picture, changed on its way to the sender.
 *
 * The phone's half of the seam `camera-effects.ts` is on the desktop, and it
 * sits in the same place in the pipeline: between what the camera captured and
 * what every peer receives. That position is the whole reason for the caution
 * below - a fault here is not a worse picture, it is a black tile for everyone
 * in the call - so **every failure path forwards the original frame** rather
 * than dropping it or emitting a broken one.
 *
 * ## Why this is written by hand
 *
 * The obvious base class is `GlGenericDrawer`, which already turns a shader
 * body into the three variants a `VideoFrame` can arrive in. It is
 * package-private in the bundled WebRTC, so it cannot be extended from here and
 * [LookDrawer] below is that idea rewritten: one fragment shader body, compiled
 * three times against a different sampler.
 *
 * `VideoFrameDrawer` *is* public, and is doing the genuinely fiddly work -
 * choosing OES, RGB or YUV, uploading planes for an I420 buffer, and composing
 * the texture matrix with the frame's rotation. Reimplementing that would have
 * been the actual risk; this only has to say what colour comes out.
 *
 * ## What the shader does
 *
 * One pass: sample the frame and multiply by the filter's colour matrix.
 *
 * ## Not verified on hardware
 *
 * ponytail: this compiles and its failure paths are safe, but no frame of it
 * has been through a real camera. GL that is wrong is wrong in ways a compiler
 * cannot see - so the first run on a device is the real review. It is off by
 * default (filter "none"), so a call that never turns it on cannot be affected either way.
 */
class CameraEffects(private val helper: SurfaceTextureHelper) : VideoProcessor {

    private var sink: VideoSink? = null

    @Volatile
    private var filter: CameraLook.Filter = CameraLook.filterFor(null)

    /** Set once something in here has failed; from then on it is a pass-through. */
    private val broken = AtomicBoolean(false)

    private val drawer = LookDrawer()
    private val frameDrawer = VideoFrameDrawer()
    /**
     * The surface every processed frame is drawn into.
     *
     * ponytail: one framebuffer, reused. The published buffer points at this
     * texture rather than owning a copy, so a sink that holds a frame past the
     * next capture would see the next picture in it. WebRTC's own source
     * converts promptly, which is why this is a single texture and not a pool -
     * if tearing or a one-frame flicker ever shows up under load, a small ring
     * of framebuffers indexed per frame is the fix, not a copy per frame.
     */
    private val target = GlTextureFrameBuffer(GLES20.GL_RGBA)
    private val yuvConverter = YuvConverter()

    fun setLook(filterName: String?) {
        filter = CameraLook.filterFor(filterName)
    }

    private fun passThrough(): Boolean =
        broken.get() || filter.name == "none"

    override fun setSink(sink: VideoSink?) {
        this.sink = sink
    }

    override fun onCapturerStarted(success: Boolean) = Unit

    override fun onCapturerStopped() = Unit

    override fun onFrameCaptured(frame: VideoFrame) {
        val out = sink ?: return
        if (passThrough()) {
            out.onFrame(frame)
            return
        }

        val rendered = runCatching { render(frame) }.getOrElse { error ->
            // Once, and then never again: a GL context that cannot compile a
            // shader will not compile it on the next frame either, and thirty
            // failures a second is how a broken effect becomes a dead call.
            broken.set(true)
            android.util.Log.w("CameraEffects", "the camera effect stopped", error)
            null
        }

        // Null covers both the failure above and a frame the renderer chose not
        // to touch. Either way the original goes on, unmodified - an unfiltered
        // frame is cosmetic, and a missing one is a stall everybody sees.
        out.onFrame(rendered ?: frame)
        if (rendered != null) rendered.release()
    }

    /**
     * The frame, redrawn into a texture of our own.
     *
     * Runs on the capture thread, which is the `SurfaceTextureHelper`'s handler
     * thread and therefore the one holding the EGL context the incoming texture
     * belongs to. Rendering anywhere else is a black frame at best.
     */
    private fun render(frame: VideoFrame): VideoFrame? {
        val width = frame.rotatedWidth
        val height = frame.rotatedHeight
        if (width <= 0 || height <= 0) return null

        target.setSize(width, height)
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, target.frameBufferId)

        drawer.filter = filter.matrix

        frameDrawer.drawFrame(frame, drawer, null, 0, 0, width, height)
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
        GlUtil.checkNoGLES2Error("CameraEffects.render")

        // The texture is handed on with an identity matrix: whatever rotation
        // and crop the frame carried has already been baked in by drawing it,
        // and applying it a second time downstream would rotate it twice.
        val buffer = TextureBufferImpl(
            width,
            height,
            VideoFrame.TextureBuffer.Type.RGB,
            target.textureId,
            Matrix(),
            helper.handler,
            yuvConverter,
            null,
        )
        return VideoFrame(buffer, 0, frame.timestampNs)
    }

    /**
     * Frees the GL objects, on the thread that owns them.
     *
     * Blocking, and bounded. The capturer is torn down straight after this and
     * the EGL context goes with it, so releasing afterwards would be releasing
     * against a context that no longer exists; waiting for ever on a render
     * thread that has already died would be worse than leaking a texture.
     */
    fun release() {
        val done = CountDownLatch(1)
        helper.handler.post {
            runCatching {
                drawer.release()
                frameDrawer.release()
                target.release()
                yuvConverter.release()
            }
            done.countDown()
        }
        runCatching { done.await(500, TimeUnit.MILLISECONDS) }
    }
}

/**
 * `GlGenericDrawer` rewritten, because that class is package-private.
 *
 * One fragment shader body, compiled once per input type. The only difference
 * between the three is how a texel is fetched - an external texture, an ordinary
 * one, or three planes converted from YUV - so `sampleFrame()` is defined per variant
 * and everything after it is shared.
 */
private class LookDrawer : RendererCommon.GlDrawer {

    var filter: FloatArray = CameraLook.IDENTITY

    private enum class Kind { OES, RGB, YUV }

    private val shaders = HashMap<Kind, GlShader>()
    private var current: Kind? = null

    override fun drawOes(
        oesTextureId: Int,
        texMatrix: FloatArray,
        frameWidth: Int,
        frameHeight: Int,
        viewportX: Int,
        viewportY: Int,
        viewportWidth: Int,
        viewportHeight: Int,
    ) {
        prepare(Kind.OES, texMatrix)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTextureId)
        draw(viewportX, viewportY, viewportWidth, viewportHeight)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, 0)
    }

    override fun drawRgb(
        textureId: Int,
        texMatrix: FloatArray,
        frameWidth: Int,
        frameHeight: Int,
        viewportX: Int,
        viewportY: Int,
        viewportWidth: Int,
        viewportHeight: Int,
    ) {
        prepare(Kind.RGB, texMatrix)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
        draw(viewportX, viewportY, viewportWidth, viewportHeight)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0)
    }

    override fun drawYuv(
        yuvTextures: IntArray,
        texMatrix: FloatArray,
        frameWidth: Int,
        frameHeight: Int,
        viewportX: Int,
        viewportY: Int,
        viewportWidth: Int,
        viewportHeight: Int,
    ) {
        prepare(Kind.YUV, texMatrix)
        for (i in 0 until 3) {
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0 + i)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, yuvTextures[i])
        }
        draw(viewportX, viewportY, viewportWidth, viewportHeight)
        for (i in 0 until 3) {
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0 + i)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0)
        }
    }

    private fun prepare(kind: Kind, texMatrix: FloatArray) {
        val shader = shaders.getOrPut(kind) {
            GlShader(VERTEX, fragmentFor(kind)).also { fresh ->
                fresh.useProgram()
                when (kind) {
                    Kind.YUV -> {
                        GLES20.glUniform1i(fresh.getUniformLocation("y_tex"), 0)
                        GLES20.glUniform1i(fresh.getUniformLocation("u_tex"), 1)
                        GLES20.glUniform1i(fresh.getUniformLocation("v_tex"), 2)
                    }
                    else -> GLES20.glUniform1i(fresh.getUniformLocation("tex"), 0)
                }
                fresh.setVertexAttribArray("in_pos", 2, FULL_QUAD)
                fresh.setVertexAttribArray("in_tc", 2, FULL_TEXTURE)
            }
        }
        if (current != kind) {
            shader.useProgram()
            current = kind
        }

        GLES20.glUniformMatrix4fv(shader.getUniformLocation("tex_mat"), 1, false, texMatrix, 0)
        GLES20.glUniformMatrix4fv(shader.getUniformLocation("colour_mat"), 1, false, filter, 0)
    }

    private fun draw(x: Int, y: Int, width: Int, height: Int) {
        GLES20.glViewport(x, y, width, height)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    }

    override fun release() {
        for (shader in shaders.values) shader.release()
        shaders.clear()
        current = null
    }

    private companion object {
        val FULL_QUAD: FloatBuffer = GlUtil.createFloatBuffer(
            floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f),
        )
        val FULL_TEXTURE: FloatBuffer = GlUtil.createFloatBuffer(
            floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f, 1f, 1f),
        )

        const val VERTEX = """
            varying vec2 tc;
            attribute vec4 in_pos;
            attribute vec4 in_tc;
            uniform mat4 tex_mat;
            void main() {
              gl_Position = in_pos;
              tc = (tex_mat * in_tc).xy;
            }
        """

        /**
         * The shared half of every variant.
         *
         * `sampleFrame()` is what differs and is prepended per kind.
         * The filter colour matrix is applied directly to the sample.
         */
        const val BODY = """
            precision mediump float;
            varying vec2 tc;
            uniform mat4 colour_mat;

            void main() {
              vec4 sharp = sampleFrame(tc);
              gl_FragColor = colour_mat * vec4(sharp.rgb, 1.0);
            }
        """

        fun fragmentFor(kind: Kind): String = when (kind) {
            Kind.OES ->
                "#extension GL_OES_EGL_image_external : require\n" +
                    "precision mediump float;\n" +
                    "uniform samplerExternalOES tex;\n" +
                    "vec4 sampleFrame(vec2 p) { return texture2D(tex, p); }\n" + BODY
            Kind.RGB ->
                "precision mediump float;\n" +
                    "uniform sampler2D tex;\n" +
                    "vec4 sampleFrame(vec2 p) { return texture2D(tex, p); }\n" + BODY
            Kind.YUV ->
                "precision mediump float;\n" +
                    "uniform sampler2D y_tex;\n" +
                    "uniform sampler2D u_tex;\n" +
                    "uniform sampler2D v_tex;\n" +
                    "vec4 sampleFrame(vec2 p) {\n" +
                    "  float y = texture2D(y_tex, p).r;\n" +
                    "  float u = texture2D(u_tex, p).r - 0.5;\n" +
                    "  float v = texture2D(v_tex, p).r - 0.5;\n" +
                    "  return vec4(y + 1.403 * v, y - 0.344 * u - 0.714 * v, y + 1.77 * u, 1.0);\n" +
                    "}\n" + BODY
        }
    }
}
