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

    /**
     * How hard the phone works to remove the room, in three steps rather than
     * two. The desktop's `NoiseSuppression`, and the two platforms have to mean
     * the same thing by each name or the setting is per-device folklore.
     *
     * `STANDARD` is the behaviour a switch turned on used to give: the OEM's
     * own noise suppressor where the phone has one, WebRTC's otherwise. `HIGH`
     * refuses the hardware path outright and runs WebRTC's software chain,
     * which is more aggressive, costs battery, and - the reason it exists -
     * behaves the same on every phone. `OFF` is no suppression at all.
     */
    enum class NoiseSuppression { OFF, STANDARD, HIGH }

    /**
     * The level, migrating anybody who set the old switch.
     *
     * The boolean lived under `"ns"` and the level lives under `"ns.level"`,
     * because the two cannot share a key: reading a string out of a slot
     * holding a boolean throws, and writing a string into it would leave an
     * older build of the app unable to read its own setting back. The old key
     * is therefore read and never written - see [suppressionOf] for the
     * decision itself, which is pure so it can be tested without a phone.
     */
    var noiseSuppression: NoiseSuppression
        get() = suppressionOf(
            prefs.getString("ns.level", null),
            if (prefs.contains("ns")) prefs.getBoolean("ns", true) else null,
        )
        set(value) = prefs.edit().putString("ns.level", value.name).apply()

    /**
     * Which level a stored pair of keys means.
     *
     * Order matters: the new key wins whenever it is there, so a person who
     * has since chosen a level is not dragged back to whatever the old switch
     * happened to say. Only when it is absent does the old switch speak, and
     * an unreadable new value falls through to the same migration rather than
     * to the default - somebody who had turned suppression off should not have
     * it turned on again by a value this build did not recognise.
     */
    internal fun suppressionOf(level: String?, legacy: Boolean?): NoiseSuppression {
        if (level != null) {
            runCatching { return NoiseSuppression.valueOf(level) }
        }
        return when (legacy) {
            false -> NoiseSuppression.OFF
            else -> NoiseSuppression.STANDARD
        }
    }

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
            "googNoiseSuppression" to (!hifi && noiseSuppression != NoiseSuppression.OFF),
            "googAutoGainControl" to (!hifi && autoGainControl),
            // A high-pass filter removes rumble and removes the bottom of a
            // recording; it goes with the other three.
            "googHighpassFilter" to !hifi,
        )
    }

    /**
     * Which of the two cancellers the phone's own silicon is asked to run.
     *
     * These are not the same switches as [captureConstraints], and that
     * distinction is the whole of the echo bug. A constraint says *whether*
     * the microphone is processed; these say *who does it*. Handing the job to
     * the OEM canceller (`setUseHardwareAcousticEchoCanceler(true)`) makes
     * WebRTC stand its own AEC3 down and trust the phone - which is free, and
     * on most handsets is fine against the earpiece and poor against the
     * loudspeaker, because a loudspeaker couples into the microphone far
     * harder than an earpiece ever does. That is the echo people report, and
     * it is not a bug in a canceller so much as a bad choice of one.
     *
     * So the software path is preferred in exactly the two cases where it
     * earns its battery: the call is coming out of the loudspeaker, or the
     * person has asked for [NoiseSuppression.HIGH], which is what that setting
     * means.
     */
    data class HardwareProcessing(
        /** Let the OEM cancel echo, instead of WebRTC's AEC3. */
        val echoCanceller: Boolean,
        /** Let the OEM suppress noise, instead of WebRTC's NS. */
        val noiseSuppressor: Boolean,
    )

    /** [HardwareProcessing] for this phone as it is set up right now. */
    fun hardwareProcessing(context: Context): HardwareProcessing = hardwareProcessingFor(
        mode = mode,
        echo = echoCancellation,
        suppression = noiseSuppression,
        loudspeaker = CallAudio.onLoudspeaker(context),
    )

    /**
     * The decision on its own, with nothing to read it from - pure, so the two
     * cases nobody can reproduce on a desk (a phone with no hardware canceller,
     * a call on the loudspeaker) are unit-tested rather than guessed at.
     *
     * High-fidelity mode turns both off for the same reason it turns the
     * constraints off: it has already answered the question.
     */
    internal fun hardwareProcessingFor(
        mode: Mode,
        echo: Boolean,
        suppression: NoiseSuppression,
        loudspeaker: Boolean,
    ): HardwareProcessing {
        if (mode == Mode.HIFI) return HardwareProcessing(echoCanceller = false, noiseSuppressor = false)
        val preferSoftware = loudspeaker || suppression == NoiseSuppression.HIGH
        return HardwareProcessing(
            echoCanceller = echo && !preferSoftware,
            noiseSuppressor = suppression == NoiseSuppression.STANDARD,
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
