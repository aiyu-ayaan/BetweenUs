package com.aktech.nexora.feature.voice

import android.content.Context
import android.content.SharedPreferences
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import kotlin.concurrent.thread
import kotlin.math.PI
import kotlin.math.min
import kotlin.math.sin

/**
 * The two notes that say somebody arrived, and the two that say they left.
 *
 * The port of `apps/desktop/src/services/call-tones.ts`, down to the two
 * frequencies - a call with a phone in it and a laptop in it should not have
 * two different vocabularies for the same event. Rising means somebody is here,
 * falling means somebody is gone, and the direction is the entire message:
 * nobody has to learn what the sound means to know which way it went.
 *
 * Synthesised rather than shipped, for the same reason as on the desktop: two
 * sine notes with a soft envelope is what the asset would have contained, and
 * this way there is no file in the APK and nothing to fail to decode. The
 * envelope is the part that matters - a sine that starts abruptly is a click,
 * which is a broadband transient and a worse sound than the tone itself.
 *
 * `ToneGenerator` is the obvious shortcut and is the wrong one here: its tones
 * are a fixed DTMF-and-supervisory set, so it can say "beep" but not "these two
 * notes, in this order", which is the whole of what this communicates.
 */
object CallTones {
    private const val PREFS = "nexora.call-tones"
    private const val KEY = "enabled"

    private const val SAMPLE_RATE = 44_100
    /** Seconds per note. Long enough to have a pitch, short enough not to be a ringtone. */
    private const val NOTE_SECONDS = 0.09
    /** The fade at each end of a note, which is what stops it clicking. */
    private const val FADE_SECONDS = 0.012
    /** Quiet on purpose: this plays over a conversation, not instead of one. */
    private const val PEAK = 0.14

    /** A perfect fourth, up or down. Byte for byte the desktop's two notes. */
    private const val LOW = 523.25
    private const val HIGH = 698.46

    enum class Tone(val first: Double, val second: Double) {
        JOIN(LOW, HIGH),
        LEAVE(HIGH, LOW),
    }

    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    /**
     * On by default. A voice channel is the one screen nobody is looking at, so
     * who is in it has to be audible or it is not knowable at all.
     */
    var enabled: Boolean
        get() = prefs?.getBoolean(KEY, true) ?: true
        set(value) {
            prefs?.edit()?.putBoolean(KEY, value)?.apply()
        }

    /**
     * Plays one of the two tones, off the caller's thread.
     *
     * Never throws: a call is not worth failing over a sound, and a device that
     * refuses to open a track is a silent arrival rather than a dropped call.
     */
    fun play(tone: Tone) {
        if (!enabled) return
        thread(isDaemon = true, name = "nexora-call-tone") {
            runCatching { emit(tone) }
        }
    }

    private fun emit(tone: Tone) {
        val samples = render(tone)
        val bytes = samples.size * 2

        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    // The same usage the call itself has, so the tone follows
                    // the call's route: an arrival announced into the earpiece
                    // while the call is on a headset would be the wrong ear.
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            )
            // Static: the whole tone is known before it starts, so there is
            // nothing to stream and no underrun to guard against.
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(bytes)
            .build()

        try {
            track.write(samples, 0, samples.size)
            track.play()
            // The write is not the playback: releasing straight away cuts the
            // tone off before it is heard.
            Thread.sleep(((samples.size * 1000L) / SAMPLE_RATE) + 60)
        } finally {
            runCatching { track.stop() }
            track.release()
        }
    }

    /** Both notes, back to back, as 16-bit mono PCM. */
    private fun render(tone: Tone): ShortArray {
        val perNote = (SAMPLE_RATE * NOTE_SECONDS).toInt()
        val out = ShortArray(perNote * 2)
        note(out, 0, perNote, tone.first)
        note(out, perNote, perNote, tone.second)
        return out
    }

    private fun note(out: ShortArray, offset: Int, length: Int, frequency: Double) {
        val fade = (SAMPLE_RATE * FADE_SECONDS).toInt().coerceAtLeast(1)

        for (i in 0 until length) {
            // Linear in and out, which is all a click needs; anything smoother
            // is inaudible at twelve milliseconds.
            val envelope = min(1.0, min(i, length - i).toDouble() / fade)
            val value = sin(2.0 * PI * frequency * i / SAMPLE_RATE) * envelope * PEAK
            out[offset + i] = (value * Short.MAX_VALUE).toInt().toShort()
        }
    }
}
