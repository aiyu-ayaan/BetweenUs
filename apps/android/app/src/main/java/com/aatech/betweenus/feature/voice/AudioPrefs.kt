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
 * One of the desktop's controls is deliberately not here:
 *
 * - **Input sensitivity.** The desktop gates the captured track in a Web Audio
 *   worklet before it reaches the encoder. Android's WebRTC has no insertion
 *   point on the capture path short of a custom audio device module, so a gate
 *   here would be a mute toggle driven by a level meter - which is a different
 *   thing wearing the same name. It stays open until the ADM work is done.
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
