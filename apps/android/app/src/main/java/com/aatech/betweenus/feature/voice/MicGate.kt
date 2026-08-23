package com.aatech.betweenus.feature.voice

import java.nio.ByteBuffer
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Input sensitivity: the noise gate, on the phone.
 *
 * Noise suppression cleans up a signal. It does not decide that nobody is
 * talking, so a suppressed fan is a quieter fan, still in the call. What makes
 * a call silent between sentences is a gate: below a threshold the microphone
 * is simply closed. It is the single control that most changes what other
 * people hear, and it is the last of the desktop's audio controls the phone
 * did not have.
 *
 * ## Why this was written down as impossible, and what changed
 *
 * The note in `AudioPrefs` said Android's WebRTC had no insertion point on the
 * capture path short of a custom audio device module, and that a gate here
 * would be a level meter driving a mute toggle - a different thing wearing the
 * same name. That was right about the two hooks it knew about:
 *
 * - `setSamplesReadyCallback` hands over a **copy**, after the buffer has
 *   already gone to the encoder. Good for a meter, useless for a gate.
 * - `setMicrophoneMute` zeroes the buffer, but it zeroes it *before* that
 *   callback too - so a gate driven from the meter would read silence the
 *   moment it closed and could never decide to open again. It latches shut.
 *   That is the trap, and it is why the honest answer at the time was no.
 *
 * `setAudioBufferCallback` is the third hook, and it is the real one: it is
 * handed the live capture buffer, in place, **before** the buffer reaches the
 * encoder. So this is a gate in the same sense the desktop's worklet is one -
 * it attenuates the samples that are about to be sent, and it measures them
 * before it does, so it always knows when to open again.
 *
 * ## What it has to be
 *
 * This runs on the audio thread, once per 10 ms buffer, for the length of every
 * call. It allocates nothing, it does one pass to measure and one to apply, and
 * every constant in it is the same number the desktop uses - a threshold set on
 * a laptop and a threshold set on a phone should mean the same thing.
 */
object MicGate {

    /** Hold and hysteresis, byte for byte the desktop's `stepGate`. */
    private const val HOLD_MS = 300L
    private const val HYSTERESIS_DB = 6.0

    /**
     * Five milliseconds to open, a hundred and fifty to close.
     *
     * Opening any slower eats the start of a word - the consonant that tells
     * "bat" from "cat" is shorter than 20 ms. Closing any faster is an audible
     * click, because a waveform cut mid-cycle is a step edge and a step edge is
     * a broadband snap.
     */
    private const val ATTACK_MS = 5.0
    private const val RELEASE_MS = 150.0

    /** Where a gate is open and closed, as the two ends of the settings slider. */
    const val MIN_THRESHOLD_DB = -80
    const val MAX_THRESHOLD_DB = -20

    /**
     * Whether the gate is passing audio, and until when it stays that way.
     *
     * Immutable so the decision can be tested without a buffer, an audio thread
     * or a clock - which is the half of this with a bug in it.
     */
    data class State(val open: Boolean, val heldUntilMs: Long)

    val CLOSED = State(open = false, heldUntilMs = 0L)

    /**
     * One decision, given how loud the last buffer was.
     *
     * Two things stop it chattering, and both matter more than they look:
     *
     * - **A hold.** Speech is mostly gaps at this timescale - every stop
     *   consonant is one - so a gate that closed the instant the level dropped
     *   would slam shut inside every word.
     * - **Hysteresis.** Once open it stays open 6 dB lower than it took to
     *   open. Without it, a voice sitting exactly on the threshold flutters the
     *   gate open and shut, which is far more distracting than either state.
     */
    fun step(state: State, levelDb: Double, thresholdDb: Double, nowMs: Long): State {
        val loud = levelDb >= thresholdDb
        val open = loud ||
            nowMs < state.heldUntilMs ||
            (state.open && levelDb >= thresholdDb - HYSTERESIS_DB)
        return State(open, if (loud) nowMs + HOLD_MS else state.heldUntilMs)
    }

    /**
     * RMS amplitude (0..1) as dBFS, floored at -100 so silence is a number
     * rather than negative infinity.
     */
    fun amplitudeToDb(rms: Double): Double = if (rms > 0.00001) 20 * log10(rms) else -100.0

    /**
     * The RMS of 16-bit little-endian PCM sitting in a buffer, without copying
     * it out.
     *
     * The same arithmetic as `VoiceEngine.rootMeanSquare`, over a `ByteBuffer`
     * rather than a `ByteArray`, because the capture hook hands over the live
     * buffer and copying it every 10 ms to reuse one function would be a
     * kilobyte of garbage per buffer for the length of a call.
     */
    fun rootMeanSquare(buffer: ByteBuffer, bytes: Int): Double {
        val usable = min(bytes, buffer.capacity())
        val count = usable / 2
        if (count == 0) return 0.0
        var sum = 0L
        var index = 0
        while (index + 1 < usable) {
            val sample = ((buffer.get(index + 1).toInt() shl 8) or
                (buffer.get(index).toInt() and 0xFF)).toShort()
            sum += sample.toLong() * sample.toLong()
            index += 2
        }
        return sqrt(sum.toDouble() / count) / Short.MAX_VALUE
    }

    /**
     * The gain this buffer should end at, given where it started and whether
     * the gate is open.
     *
     * Separated from the writing so the ramp can be checked without a buffer:
     * a ramp that reaches its target in one buffer is a click, and one that
     * never reaches it is a microphone that fades out mid-sentence. Both are
     * arithmetic, and both are wrong in a way nobody hears until it ships.
     */
    fun rampTo(fromGain: Double, open: Boolean, samples: Int, sampleRate: Int): Double {
        if (samples <= 0 || sampleRate <= 0) return fromGain
        val target = if (open) 1.0 else 0.0
        val milliseconds = samples * 1000.0 / sampleRate
        val travelled = milliseconds / (if (open) ATTACK_MS else RELEASE_MS)
        return if (open) min(target, fromGain + travelled) else max(target, fromGain - travelled)
    }

    /**
     * Applies a gain ramp across one buffer of 16-bit little-endian PCM, in
     * place, and answers with the gain it ended on.
     *
     * Per sample rather than per buffer: a buffer-wide gain step is a 10 ms
     * staircase, and a staircase in the amplitude envelope is audible as
     * zipper noise. Clamped on write because the ramp only ever attenuates -
     * the gain never exceeds one - but a sample at full scale multiplied by
     * exactly one still has to survive the round trip through a Double.
     */
    fun applyRamp(
        buffer: ByteBuffer,
        bytes: Int,
        fromGain: Double,
        toGain: Double,
    ): Double {
        val usable = min(bytes, buffer.capacity())
        val count = usable / 2
        if (count == 0) return toGain

        // Both ends of the ramp already at unity: there is nothing to do, and
        // an open gate is the common case for the whole of a call.
        if (fromGain >= 1.0 && toGain >= 1.0) return 1.0

        val step = (toGain - fromGain) / count
        var gain = fromGain
        var index = 0
        while (index + 1 < usable) {
            val sample = ((buffer.get(index + 1).toInt() shl 8) or
                (buffer.get(index).toInt() and 0xFF)).toShort()
            val scaled = (sample * gain).toInt().coerceIn(-32768, 32767)
            buffer.put(index, (scaled and 0xFF).toByte())
            buffer.put(index + 1, ((scaled shr 8) and 0xFF).toByte())
            gain += step
            index += 2
        }
        return toGain
    }
}
