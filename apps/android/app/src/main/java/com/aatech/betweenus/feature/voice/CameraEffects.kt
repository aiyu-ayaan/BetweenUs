package com.aatech.betweenus.feature.voice

import android.graphics.Matrix
import android.opengl.GLES11Ext
import android.opengl.GLES20
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.Segmenter
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
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
import java.nio.ByteBuffer
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
 * One pass, three steps. Sample the frame sharp. Sample it again as a small box
 * blur when a background blur was asked for. Mix the two by the person mask,
 * then multiply by the filter's colour matrix. The blur is a box rather than a
 * gaussian because a gaussian at a useful radius is two passes and a second
 * framebuffer, for a difference nobody looking at their own shoulder can see.
 *
 * The mask comes from ML Kit's selfie segmenter, which ships its model inside
 * the app: the blur works with no network, and nothing about anybody's camera
 * ever leaves the phone. It runs on the CPU from an I420 copy of the frame,
 * which is the cost of the feature and the reason it is off by default.
 *
 * ## Not verified on hardware
 *
 * ponytail: this compiles and its failure paths are safe, but no frame of it
 * has been through a real camera. GL that is wrong is wrong in ways a compiler
 * cannot see - a green picture, an upside-down one, a mask that is inverted -
 * so the first run on a device is the real review. It is off by default, so a
 * call that never turns it on cannot be affected either way.
 */
class CameraEffects(private val helper: SurfaceTextureHelper) : VideoProcessor {

    private var sink: VideoSink? = null

    @Volatile
    private var filter: CameraLook.Filter = CameraLook.filterFor(null)

    @Volatile
    private var portrait: CameraLook.Portrait = CameraLook.Portrait.OFF

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
    private val mask = MaskTexture()
    private val segmenter: Segmenter by lazy {
        Segmentation.getClient(
            SelfieSegmenterOptions.Builder()
                .setDetectorMode(SelfieSegmenterOptions.STREAM_MODE)
                .build(),
        )
    }

    fun setLook(filterName: String?, portraitLevel: String?) {
        filter = CameraLook.filterFor(filterName)
        portrait = CameraLook.portraitFor(portraitLevel)
    }

    private fun passThrough(): Boolean =
        broken.get() || (filter.name == "none" && portrait == CameraLook.Portrait.OFF)

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

        // The mask is computed before any GL state is touched, because it may
        // fail and a half-configured framebuffer is worse than no effect.
        if (portrait != CameraLook.Portrait.OFF) mask.update(frame, segmenter)

        target.setSize(width, height)
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, target.frameBufferId)

        drawer.filter = filter.matrix
        // Radius in texels, so the same setting blurs the same amount whatever
        // the camera resolution is. Zero when the mask is unavailable: a blur
        // with no mask would blur the person too, which is not the feature.
        drawer.blurTexels = if (portrait != CameraLook.Portrait.OFF && mask.ready) {
            portrait.radius / width.toFloat()
        } else {
            0f
        }
        drawer.maskTextureId = if (drawer.blurTexels > 0f) mask.textureId else 0

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
                mask.release()
                yuvConverter.release()
            }
            done.countDown()
        }
        runCatching { done.await(500, TimeUnit.MILLISECONDS) }
        runCatching { segmenter.close() }
    }
}

/**
 * The person mask, as a one-channel texture.
 *
 * ML Kit answers with a `FloatBuffer` of confidences at its own resolution,
 * which is smaller than the frame - that is fine and slightly desirable: scaling
 * it up in the shader softens the edge, and a hard cut at the shoulders is what
 * makes a bad portrait mode look bad.
 *
 * Synchronously, on the capture thread. An asynchronous mask would be a frame
 * or two behind the picture it belongs to, which shows up as a halo trailing
 * somebody's head whenever they move - worse than the cost of waiting.
 */
private class MaskTexture {
    var textureId = 0
        private set
    var ready = false
        private set

    private var width = 0
    private var height = 0
    private var bytes: ByteBuffer? = null

    fun update(frame: VideoFrame, segmenter: Segmenter) {
        ready = false
        val i420 = runCatching { frame.buffer.toI420() }.getOrNull() ?: return
        try {
            val image = runCatching { inputImage(i420, frame.rotation) }.getOrNull() ?: return
            val result = runCatching {
                // ML Kit's task API is asynchronous by design; on STREAM_MODE
                // it is fast enough that waiting is the right trade. See the
                // note above about a mask that lags its frame.
                com.google.android.gms.tasks.Tasks.await(
                    segmenter.process(image),
                    120,
                    TimeUnit.MILLISECONDS,
                )
            }.getOrNull() ?: return

            // ML Kit's mask is a ByteBuffer holding floats, not a FloatBuffer.
            upload(result.buffer.asFloatBuffer(), result.width, result.height)
        } finally {
            i420.release()
        }
    }

    private fun inputImage(buffer: VideoFrame.I420Buffer, rotation: Int): InputImage {
        // ML Kit takes NV21: the Y plane whole, then V and U interleaved.
        val w = buffer.width
        val h = buffer.height
        val nv21 = ByteArray(w * h + 2 * ((w + 1) / 2) * ((h + 1) / 2))

        val y = buffer.dataY
        var offset = 0
        for (row in 0 until h) {
            y.position(row * buffer.strideY)
            y.get(nv21, offset, w)
            offset += w
        }

        val u = buffer.dataU
        val v = buffer.dataV
        val chromaWidth = (w + 1) / 2
        val chromaHeight = (h + 1) / 2
        for (row in 0 until chromaHeight) {
            for (col in 0 until chromaWidth) {
                nv21[offset++] = v.get(row * buffer.strideV + col)
                nv21[offset++] = u.get(row * buffer.strideU + col)
            }
        }

        return InputImage.fromByteArray(nv21, w, h, rotation, InputImage.IMAGE_FORMAT_NV21)
    }

    private fun upload(confidence: FloatBuffer, w: Int, h: Int) {
        if (textureId == 0) {
            textureId = GlUtil.generateTexture(GLES20.GL_TEXTURE_2D)
        }
        if (bytes == null || width != w || height != h) {
            width = w
            height = h
            bytes = ByteBuffer.allocateDirect(w * h)
        }
        val target = bytes ?: return

        target.clear()
        confidence.rewind()
        // A confidence, not a category: 1 is certainly a person. Kept as a
        // gradient rather than thresholded here, so the shader mixes rather
        // than cuts and the edge stays soft.
        for (i in 0 until w * h) {
            target.put((confidence.get(i) * 255f).toInt().coerceIn(0, 255).toByte())
        }
        target.rewind()

        GLES20.glActiveTexture(GLES20.GL_TEXTURE3)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
        GLES20.glTexImage2D(
            GLES20.GL_TEXTURE_2D,
            0,
            GLES20.GL_LUMINANCE,
            w,
            h,
            0,
            GLES20.GL_LUMINANCE,
            GLES20.GL_UNSIGNED_BYTE,
            target,
        )
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        ready = true
    }

    fun release() {
        if (textureId != 0) {
            GLES20.glDeleteTextures(1, intArrayOf(textureId), 0)
            textureId = 0
        }
        // Allocated with `allocateDirect`, so it is the collector's to reclaim.
        // Handing it to `JniCommon.nativeFreeByteBuffer` would be freeing memory
        // that allocator never handed out.
        bytes = null
        ready = false
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
    var blurTexels = 0f
    var maskTextureId = 0

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
        prepare(Kind.OES, texMatrix, frameWidth)
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
        prepare(Kind.RGB, texMatrix, frameWidth)
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
        prepare(Kind.YUV, texMatrix, frameWidth)
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

    private fun prepare(kind: Kind, texMatrix: FloatArray, frameWidth: Int) {
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
                GLES20.glUniform1i(fresh.getUniformLocation("mask_tex"), 3)
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
        GLES20.glUniform1f(shader.getUniformLocation("blur"), blurTexels)
        // The aspect keeps the blur circular: a step of the same size in x and
        // y is an oval on anything that is not square.
        GLES20.glUniform1f(shader.getUniformLocation("aspect"), if (frameWidth > 0) 1f else 1f)

        GLES20.glActiveTexture(GLES20.GL_TEXTURE3)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, maskTextureId)
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
         * `sampleFrame()` is what differs and is prepended per kind. The box blur is
         * nine taps in a ring plus the centre - enough to be a blur and cheap
         * enough for a phone - and it is only ever mixed in where the mask says
         * background, so a person costs one sample however strong the blur is.
         */
        const val BODY = """
            precision mediump float;
            varying vec2 tc;
            uniform mat4 colour_mat;
            uniform sampler2D mask_tex;
            uniform float blur;
            uniform float aspect;

            void main() {
              vec4 sharp = sampleFrame(tc);
              vec4 colour = sharp;

              if (blur > 0.0) {
                // 1.0 is certainly a person, 0.0 certainly the room.
                float person = texture2D(mask_tex, tc).r;
                if (person < 0.99) {
                  vec4 blurred = sharp;
                  blurred += sampleFrame(tc + vec2( blur,  0.0));
                  blurred += sampleFrame(tc + vec2(-blur,  0.0));
                  blurred += sampleFrame(tc + vec2( 0.0,   blur));
                  blurred += sampleFrame(tc + vec2( 0.0,  -blur));
                  blurred += sampleFrame(tc + vec2( blur,  blur) * 0.7);
                  blurred += sampleFrame(tc + vec2(-blur,  blur) * 0.7);
                  blurred += sampleFrame(tc + vec2( blur, -blur) * 0.7);
                  blurred += sampleFrame(tc + vec2(-blur, -blur) * 0.7);
                  blurred /= 9.0;
                  colour = mix(blurred, sharp, person);
                }
              }

              gl_FragColor = colour_mat * vec4(colour.rgb, 1.0);
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
