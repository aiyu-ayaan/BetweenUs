package com.aatech.betweenus.feature.voice

import android.content.Context
import android.content.SharedPreferences

/**
 * How this phone's microphone is set up, and where the call comes out.
 *
 * The phone's half of `apps/desktop/src/services/voice-quality.ts`. A machine
 * setting rather than an account one, for the same reason it is on the desktop:
 * the processing that suits a headset in a quiet room is the processing that
 * ruins a call held at arm's length on a train, and which of those you are in
 * is a property of where you are sitting.
 *
 * Every one of the desktop's controls is here now, input sensitivity included.
 * That one was written down as blocked for a long time and the reasoning is
 * worth keeping: the two hooks anybody finds first - a samples-ready callback
 * that hands over a copy after the fact, and a microphone mute that zeroes the
 * buffer before that copy is taken - cannot make a gate between them. See
 * [MicGate] for what the third hook is and why it can.
 */
object AudioPrefs {
    private const val PREFS = "betweenus.audio"

    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    /**
     * What the microphone is for. Not a quality slider - the two want opposite
     * processing, and neither is "better". Byte for byte the desktop's
     * `VoiceMode`.
     */
    enum class Mode { CLEAR, HIFI }

    /**
     * Where a call plays. `AUTO` is what the app did before any of this
     * existed: the speaker, which is right for a phone held in front of you and
     * wrong for every other way of holding one.
     */
    enum class Route { AUTO, EARPIECE, SPEAKER, WIRED, BLUETOOTH }

    /**
     * Which microphone the call is heard through.
     *
     * `PHONE` is the built-in one; a headset is the only thing that adds a
     * second. Android routes a call as one device for both directions, so
     * naming an input names the output too - see `CallAudio.wantedRoute`.
     */
    enum class Input { AUTO, PHONE, WIRED, BLUETOOTH }

    var mode: Mode
        get() = runCatching { Mode.valueOf(prefs.getString("mode", null) ?: "CLEAR") }
            .getOrDefault(Mode.CLEAR)
        set(value) = prefs.edit().putString("mode", value.name).apply()

    var route: Route
        get() = runCatching { Route.valueOf(prefs.getString("route", null) ?: "AUTO") }
            .getOrDefault(Route.AUTO)
        set(value) = prefs.edit().putString("route", value.name).apply()

    var input: Input
        get() = runCatching { Input.valueOf(prefs.getString("input", null) ?: "AUTO") }
            .getOrDefault(Input.AUTO)
        set(value) = prefs.edit().putString("input", value.name).apply()

    /**
     * Input sensitivity, in dBFS: below this the microphone is closed.
     *
     * Null is an open microphone, which is what the phone did before the gate
     * existed and is still the right answer for a headset in a quiet room. The
     * value is the same scale the desktop uses, so a threshold that means
     * "ignore the fan" on a laptop means it here too.
     */
    var sensitivityDb: Int?
        get() = if (prefs.contains("gate")) prefs.getInt("gate", -50) else null
        set(value) = prefs.edit().apply {
            if (value == null) remove("gate") else putInt("gate", value)
        }.apply()

    var echoCancellation: Boolean
        get() = prefs.getBoolean("aec", true)
        set(value) = prefs.edit().putBoolean("aec", value).apply()

    var noiseSuppression: Boolean
        get() = prefs.getBoolean("ns", true)
        set(value) = prefs.edit().putBoolean("ns", value).apply()

    var autoGainControl: Boolean
        get() = prefs.getBoolean("agc", true)
        set(value) = prefs.edit().putBoolean("agc", value).apply()

    /**
     * The processing switches as WebRTC's audio source wants them.
     *
     * High-fidelity mode is not a preference: every one of these is destructive
     * to music - gain control pumps, suppression eats reverb tails, echo
     * cancellation chews holes in anything that correlates with what the
     * speaker is already playing - and a mode that says "this is an instrument"
     * has already answered the question.
     *
     * The `goog` prefix is what the Android stack still answers to; the names
     * without it are the browser's spelling of the same three switches.
     */
    fun captureConstraints(): List<Pair<String, Boolean>> {
        val hifi = mode == Mode.HIFI
        return listOf(
            "googEchoCancellation" to (!hifi && echoCancellation),
            "googNoiseSuppression" to (!hifi && noiseSuppression),
            "googAutoGainControl" to (!hifi && autoGainControl),
            // A high-pass filter removes rumble and removes the bottom of a
            // recording; it goes with the other three.
            "googHighpassFilter" to !hifi,
        )
    }

    /** How the microphone is encoded on the wire. The desktop's `micEncoding`. */
    fun micEncoding(): MicEncoding {
        val hifi = mode == Mode.HIFI
        return MicEncoding(
            // Discord's voice channel is 64 kbps mono and transparent for
            // speech; 128 stereo is what an instrument wants.
            maxBitrate = if (hifi) 128_000 else 64_000,
            stereo = hifi,
            // DTX stops sending during silence, which is most of a call and
            // none of a recording - a held piano note is what it deletes.
            dtx = !hifi,
        )
    }
}

/** What the Opus answer in an SDP has to say. */
data class MicEncoding(val maxBitrate: Int, val stereo: Boolean, val dtx: Boolean)
