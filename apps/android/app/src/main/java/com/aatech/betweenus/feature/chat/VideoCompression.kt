package com.aatech.betweenus.feature.chat

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume
import kotlin.math.max
import kotlin.math.min

/**
 * Shrinking a video before it is sent.
 *
 * A phone records at whatever its camera can do - 4K at 50 Mbps is ordinary -
 * and none of that survives being watched in a message list. Sending it as it
 * was recorded was the difference between a clip arriving in seconds and a clip
 * arriving in ten minutes, on a phone uplink, with the app pinned open the
 * whole time. Every chat app compresses; this is that.
 *
 * The rules, in the order they are applied:
 *
 * - the short side is brought down to [SHORT_SIDE] and never raised;
 * - the video is re-encoded as H.264 at a bitrate set by the result's size;
 * - audio is left as it is, because audio is a rounding error next to video
 *   and re-encoding it only costs quality;
 * - a file that is already small enough is not touched at all, because a
 *   re-encode of an already-small clip is slower *and* worse.
 *
 * The output is a file in the cache. Everything the caller does after this -
 * seal, upload, send - is the same as for any other file.
 */
private const val SHORT_SIDE = 720

/** Below this a clip is not worth a re-encode: it is already message-sized. */
private const val LEAVE_ALONE_UNDER_BYTES = 6L * 1024 * 1024

/**
 * About what 720p needs to look like the recording it came from, and roughly
 * what every other chat app settles on. Not a guess at quality: it is the
 * number that decides whether the upload is seconds or minutes.
 */
private const val TARGET_BITRATE = 2_500_000

/** Above this, a re-encode would cost more time than the upload it saves. */
private const val MAX_DURATION_MS = 20L * 60 * 1000

/** What came back: a file to send, and whether it is a new one to delete after. */
data class PreparedVideo(val uri: Uri, val temporary: Boolean)

/**
 * Re-encodes [source] smaller, or gives it back untouched.
 *
 * Never throws for a video it cannot handle. A codec that refuses, a container
 * nothing can read, a device with no encoder to spare - all of them mean "send
 * what was picked", which is slower and works, rather than an error about a
 * file the person can see is fine.
 */
@androidx.annotation.OptIn(UnstableApi::class)
suspend fun compressVideo(
    context: Context,
    source: Uri,
    sizeBytes: Long,
    onProgress: (Float) -> Unit = {},
): PreparedVideo = withContext(Dispatchers.Main) {
    if (sizeBytes in 1..LEAVE_ALONE_UNDER_BYTES) return@withContext PreparedVideo(source, false)

    val facts = videoFacts(context, source)
    if (facts != null && facts.durationMs > MAX_DURATION_MS) {
        return@withContext PreparedVideo(source, false)
    }
    // Already at or below the target on both counts: re-encoding would spend
    // minutes to make it very slightly worse.
    if (facts != null && facts.shortSide <= SHORT_SIDE && facts.bitrate in 1..TARGET_BITRATE) {
        return@withContext PreparedVideo(source, false)
    }

    val directory = File(context.cacheDir, "outgoing").apply { mkdirs() }
    val target = File(directory, "video-${System.currentTimeMillis()}.mp4")

    val transformer = Transformer.Builder(context)
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        // The bitrate is the whole point. Left to the default, Transformer
        // picks one from the source's own - so a 50 Mbps recording comes out
        // large, correctly encoded, and just as slow to send as it was.
        .setEncoderFactory(
            DefaultEncoderFactory.Builder(context)
                .setRequestedVideoEncoderSettings(
                    VideoEncoderSettings.Builder().setBitrate(TARGET_BITRATE).build(),
                )
                // A device with no hardware encoder for these settings falls
                // back to a software one rather than refusing: slow beats "your
                // video could not be sent".
                .setEnableFallback(true)
                .build(),
        )
        .build()

    val item = EditedMediaItem.Builder(MediaItem.fromUri(source))
        .setEffects(
            Effects(
                // Audio untouched: it is a rounding error next to the video
                // track, and re-encoding it only costs quality.
                emptyList(),
                listOf(Presentation.createForShortSide(SHORT_SIDE)),
            ),
        )
        .build()

    val done = suspendCancellableCoroutine { continuation ->
        val listener = object : Transformer.Listener {
            override fun onCompleted(composition: Composition, result: ExportResult) {
                if (continuation.isActive) continuation.resume(true)
            }

            override fun onError(
                composition: Composition,
                result: ExportResult,
                exception: ExportException,
            ) {
                if (continuation.isActive) continuation.resume(false)
            }
        }
        transformer.addListener(listener)
        continuation.invokeOnCancellation { transformer.cancel() }

        runCatching { transformer.start(item, target.absolutePath) }
            .onFailure { if (continuation.isActive) continuation.resume(false) }

        // Transformer reports progress by being asked, not by calling back.
        // One second apart: fine enough for a bar and cheap enough to ignore.
        pollProgress(transformer, onProgress, continuation)
    }

    if (!done || !target.exists() || target.length() == 0L) {
        target.delete()
        return@withContext PreparedVideo(source, false)
    }
    // A "compressed" file bigger than what went in is a re-encode that lost.
    if (sizeBytes > 0 && target.length() >= sizeBytes) {
        target.delete()
        return@withContext PreparedVideo(source, false)
    }

    PreparedVideo(
        androidx.core.content.FileProvider.getUriForFile(
            context,
            "${context.packageName}.files",
            target,
        ),
        temporary = true,
    )
}

@androidx.annotation.OptIn(UnstableApi::class)
private fun pollProgress(
    transformer: Transformer,
    onProgress: (Float) -> Unit,
    continuation: kotlinx.coroutines.CancellableContinuation<Boolean>,
) {
    val handler = android.os.Handler(android.os.Looper.getMainLooper())
    val holder = androidx.media3.transformer.ProgressHolder()
    val tick = object : Runnable {
        override fun run() {
            if (!continuation.isActive) return
            val state = transformer.getProgress(holder)
            if (state == Transformer.PROGRESS_STATE_AVAILABLE) {
                onProgress(holder.progress / 100f)
            }
            handler.postDelayed(this, 1000)
        }
    }
    handler.postDelayed(tick, 1000)
    continuation.invokeOnCancellation { handler.removeCallbacks(tick) }
}

private class VideoFacts(val shortSide: Int, val bitrate: Int, val durationMs: Long)

/** Size, bitrate and length, read from the container's own index. */
private fun videoFacts(context: Context, uri: Uri): VideoFacts? = runCatching {
    MediaMetadataRetriever().use { reader ->
        reader.setDataSource(context, uri)
        fun number(key: Int): Long = reader.extractMetadata(key)?.toLongOrNull() ?: 0L

        val width = number(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH).toInt()
        val height = number(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT).toInt()
        val rotation = number(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION).toInt()
        // A portrait recording is a landscape frame plus a rotation flag, and
        // the short side is the short side of what is actually shown.
        val shown = if (rotation == 90 || rotation == 270) height to width else width to height

        VideoFacts(
            shortSide = min(shown.first, shown.second).let { if (it > 0) it else max(width, height) },
            bitrate = number(MediaMetadataRetriever.METADATA_KEY_BITRATE).toInt(),
            durationMs = number(MediaMetadataRetriever.METADATA_KEY_DURATION),
        )
    }
}.getOrNull()

/** `MediaMetadataRetriever` is only `AutoCloseable` from API 29. */
private inline fun <T> MediaMetadataRetriever.use(block: (MediaMetadataRetriever) -> T): T = try {
    block(this)
} finally {
    runCatching { release() }
}
