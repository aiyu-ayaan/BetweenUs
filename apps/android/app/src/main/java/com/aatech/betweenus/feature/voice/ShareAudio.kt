package com.aatech.betweenus.feature.voice

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Process
import androidx.annotation.RequiresApi
import java.nio.ByteBuffer
import kotlin.math.min

/**
 * The sound coming out of the phone, going out with the shared screen.
 *
 * A share used to be silent. Somebody putting a video, a game or a call on the
 * stage sent every frame of it and none of the sound, and the far end had no
 * way to tell that from a video with no soundtrack.
 *
 * ## Why it rides on the microphone
 *
 * The wire has a `screenAudio` slot and this does not use it, which looks wrong
 * and is not. A track in libwebrtc's Android build can only come from the audio
 * device module, there is exactly one of those per factory, and it reads the
 * microphone: there is no public way to hand arbitrary PCM to a second audio
 * track. So the choice is between no screen sound at all and mixing it into the
 * one capture that does exist, and the far end plays what arrives on the
 * microphone slot either way.
 *
 * Two consequences, both deliberate:
 *
 * - Muting cannot mean "stop the track", because the track is now carrying two
 *   things. [VoiceEngine.applyMute] closes the microphone at the device module
 *   instead, which is where mute has always genuinely happened - the buffer
 *   arrives already zeroed and this adds the screen's sound to the silence.
 * - The mixed signal goes through the call's echo canceller and noise
 *   suppressor, which were tuned for a voice in a room. Music through them is
 *   thinner than music through a path built for it.
 *
 * ponytail: an SFU or a second peer connection would carry this on its own
 * m-line at full quality. Both are much larger than the feature, and this is
 * the version that works today on the library the app already has.
 *
 * ## What is captured
 *
 * `AudioPlaybackCaptureConfiguration` is API 29 and later, and it needs a live
 * `MediaProjection` - the same consent the screen capture is already running
 * under, taken off the capturer rather than asked for again, because the
 * system hands out one projection per consent and asking twice fails.
 *
 * This app's own UID is excluded, and that is not a nicety: without it the
 * capture picks up the call this share is part of and sends the other people
 * in it back to themselves, one buffer late, for ever.
 */
class ShareAudio {

    private var record: AudioRecord? = null

    /** Scratch for one buffer's worth of playback, sized on the first mix. */
    private var scratch = ByteArray(0)

    val running: Boolean get() = record != null

    /**
     * Starts capturing, at the shape the microphone is already being read in.
     *
     * The rate and the channel count are the ones the device module reports on
     * its own capture buffer, so the two streams can be added sample for sample
     * with no resampling and no downmix - which is the only reason this is
     * cheap enough to do on the audio thread.
     *
     * Returns false and leaves nothing running when the platform is too old or
     * the record cannot be built. A share with no sound is the old behaviour;
     * a call that dies because a soundtrack could not start is not.
     */
    fun start(projection: MediaProjection, sampleRate: Int, channelCount: Int): Boolean {
        // minSdk is 24 and playback capture is 29. The whole of the API lives
        // in [open], so a phone below that never loads a class it has no
        // implementation of.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
        if (record != null) return true
        return open(projection, sampleRate, channelCount)
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    @SuppressLint("MissingPermission")
    private fun open(projection: MediaProjection, sampleRate: Int, channelCount: Int): Boolean {
        return runCatching {
            val configuration = AudioPlaybackCaptureConfiguration.Builder(projection)
                // What a person means by "share the sound": media, games, and
                // the unmarked stream every app that never set a usage plays
                // through. Notifications and ringtones are deliberately absent -
                // sharing a screen must not put somebody's message alerts on
                // the call.
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                // Ourselves, or the call feeds itself; see the class comment.
                .excludeUid(Process.myUid())
                .build()

            val mask = if (channelCount >= 2) {
                AudioFormat.CHANNEL_IN_STEREO
            } else {
                AudioFormat.CHANNEL_IN_MONO
            }
            val format = AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(sampleRate)
                .setChannelMask(mask)
                .build()

            // Room for several of the device module's 10ms buffers. The minimum
            // is a figure the platform will accept rather than one that
            // survives a scheduling hiccup, and an underrun here is an audible
            // gap in the shared sound.
            val minimum = AudioRecord.getMinBufferSize(sampleRate, mask, AudioFormat.ENCODING_PCM_16BIT)
            val size = if (minimum > 0) minimum * 2 else sampleRate * channelCount * 2 / 5

            AudioRecord.Builder()
                .setAudioPlaybackCaptureConfig(configuration)
                .setAudioFormat(format)
                .setBufferSizeInBytes(size)
                .build()
                .also { it.startRecording() }
        }.onSuccess { record = it }.isSuccess
    }

    /**
     * Adds whatever the phone has played since the last buffer, in place.
     *
     * On the audio thread, several hundred times a second: an integer pass over
     * the buffer and nothing else. The read is non-blocking on purpose - this
     * thread belongs to the microphone, and waiting here for the playback
     * stream to catch up would stall the call itself rather than the share.
     *
     * ponytail: a shortfall is padded with silence rather than held in a ring
     * buffer, so two clocks drifting apart cost the occasional short gap
     * instead of a growing delay. A jitter buffer is the upgrade if it turns
     * out to be audible.
     */
    fun mix(buffer: ByteBuffer, bytes: Int) {
        val source = record ?: return
        val usable = min(bytes, buffer.capacity())
        if (usable <= 0) return

        if (scratch.size < usable) scratch = ByteArray(usable)
        val read = runCatching {
            source.read(scratch, 0, usable, AudioRecord.READ_NON_BLOCKING)
        }.getOrDefault(0)
        if (read <= 1) return

        var index = 0
        val end = read - 1
        while (index < end) {
            val mic = ((buffer.get(index + 1).toInt() shl 8) or
                (buffer.get(index).toInt() and 0xFF)).toShort()
            val screen = ((scratch[index + 1].toInt() shl 8) or
                (scratch[index].toInt() and 0xFF)).toShort()
            // Added and clipped rather than averaged: halving both would make a
            // person's voice quiet for the whole of every share, which is the
            // wrong trade against the rare moment two loud things coincide.
            val sum = (mic + screen).coerceIn(-32768, 32767)
            buffer.put(index, (sum and 0xFF).toByte())
            buffer.put(index + 1, ((sum shr 8) and 0xFF).toByte())
            index += 2
        }
    }

    /** Stops and releases. Safe to call when nothing was ever started. */
    fun stop() {
        val source = record ?: return
        record = null
        runCatching { source.stop() }
        runCatching { source.release() }
    }
}
