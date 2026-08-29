package com.aatech.betweenus.feature.chat

import android.content.Context
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import androidx.core.net.toUri
import java.io.File
import java.util.Locale

/**
 * Recording a voice message.
 *
 * A voice message is not a new kind of message. It is a recording, sealed and
 * uploaded exactly like a file picked with the paperclip, and it arrives as an
 * audio attachment the message list already knows how to play. Everything
 * downstream of "here is a file" already existed, which is why this is short.
 *
 * What it does own is the awkward half: holding a microphone open, stopping it
 * without losing the last of the recording, and giving the microphone back on
 * every path out - including the ones nobody plans for, like leaving the
 * screen mid-recording. A recording indicator left on is the one bug in this
 * area nobody forgives.
 */
object VoiceNote {

    /**
     * Longer than this and the recorder stops itself.
     *
     * What it really guards is somebody starting a recording and walking away:
     * without a ceiling that is an open microphone and a growing file until
     * the process is killed.
     */
    const val MAX_SECONDS: Int = 5 * 60

    /**
     * A recording shorter than this is a slip of the finger, not a message.
     *
     * Every messenger has this threshold because every messenger has the same
     * gesture: a tap meant as a hold produces a quarter-second of room tone,
     * and sending it is never what anybody meant.
     */
    const val MIN_SECONDS: Int = 1

    /**
     * A recording in progress.
     *
     * Two ways out, and they are not the same. [stop] returns the file; [cancel]
     * throws it away. Both release the microphone.
     */
    class Recording internal constructor(
        private val recorder: MediaRecorder,
        private val file: File,
        private val startedAt: Long,
        private val contentType: String,
    ) {
        private var finished = false

        /** Seconds recorded so far, for the counter on screen. */
        fun elapsed(): Float = (System.currentTimeMillis() - startedAt) / 1000f

        /**
         * Finishes and returns what was recorded, or null when it was too
         * short to be a message - or when the recorder failed on the way out.
         *
         * `MediaRecorder.stop` throws when it is stopped before it has
         * captured anything, which is exactly the too-short case, so the two
         * failures answer the same way rather than one of them crashing.
         */
        fun stop(): PickedPreview? {
            if (finished) return null
            finished = true

            val seconds = elapsed()
            val captured = runCatching {
                recorder.stop()
            }.isSuccess
            release()

            if (!captured || seconds < MIN_SECONDS || file.length() == 0L) {
                file.delete()
                return null
            }
            return PickedPreview(file.toUri(), file.name, contentType)
        }

        /** Abandons it: the microphone goes back, and so does the disk. */
        fun cancel() {
            if (finished) return
            finished = true
            runCatching { recorder.stop() }
            release()
            file.delete()
        }

        private fun release() {
            runCatching { recorder.reset() }
            runCatching { recorder.release() }
        }
    }

    /**
     * Opens the microphone and starts recording.
     *
     * Returns null when the microphone cannot be opened - refused permission,
     * or another app already holding it. The caller puts that on screen: it is
     * the one failure here somebody can do something about.
     */
    fun start(context: Context): Recording? {
        val app = context.applicationContext

        // Opus where the platform has it, AAC before that. Opus is what the
        // call path and the other two clients already use and is markedly
        // smaller for speech; AAC in an MP4 is what every Android since this
        // app's minimum can write, and every client can play.
        val opus = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
        val extension = if (opus) "ogg" else "m4a"
        val contentType = if (opus) "audio/ogg" else "audio/mp4"

        // The app's own cache directory: this file is plaintext until it is
        // sealed for upload, so it goes somewhere no other app can read and
        // somewhere the system may reclaim.
        val file = File(app.cacheDir, "${name()}.$extension")

        @Suppress("DEPRECATION")
        val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(app)
        } else {
            MediaRecorder()
        }

        return runCatching {
            recorder.apply {
                setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
                if (opus) {
                    setOutputFormat(MediaRecorder.OutputFormat.OGG)
                    setAudioEncoder(MediaRecorder.AudioEncoder.OPUS)
                    // What Opus is tuned for, and what a spoken message needs.
                    setAudioSamplingRate(48_000)
                    setAudioEncodingBitRate(24_000)
                } else {
                    setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                    setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                    setAudioSamplingRate(44_100)
                    setAudioEncodingBitRate(64_000)
                }
                setAudioChannels(1)
                // The ceiling, enforced by the recorder rather than by a timer
                // somewhere else: a recording walked away from is precisely the
                // one nobody is watching a timer for.
                setMaxDuration(MAX_SECONDS * 1000)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }
            Recording(recorder, file, System.currentTimeMillis(), contentType)
        }.getOrElse {
            runCatching { recorder.release() }
            file.delete()
            null
        }
    }

    /**
     * What a recording is called.
     *
     * Named for when it was, so a channel of them reads as a list rather than
     * as six files called "audio". Local time, because it is a label for
     * whoever is looking at it and not a timestamp anything parses.
     */
    private fun name(at: Long = System.currentTimeMillis()): String {
        val stamp = java.text.SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US)
            .format(java.util.Date(at))
        return "voice_$stamp"
    }

    /** `m:ss`, which is how long a voice message is ever worth spelling out. */
    fun formatDuration(seconds: Float): String {
        val whole = seconds.toInt().coerceAtLeast(0)
        return "${whole / 60}:${(whole % 60).toString().padStart(2, '0')}"
    }

    /** Whether a picked file is one of these, for the row that draws it. */
    fun isVoice(uri: Uri): Boolean = uri.lastPathSegment?.startsWith("voice_") == true
}
