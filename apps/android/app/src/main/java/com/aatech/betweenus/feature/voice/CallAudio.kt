package com.aatech.betweenus.feature.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/**
 * Where a call's sound goes, where its microphone comes from, and who else has
 * to stop making it.
 *
 * WebRTC plays remote audio on the voice-call stream, which on a phone is the
 * earpiece and is governed by the in-call volume - and neither of those is
 * where the system puts them until something asks. Left alone, a call arrives
 * as silence: the packets are decoded and played to a route nobody is holding
 * the phone against, at a volume the volume keys were not adjusting.
 *
 * So three things are asked for together, and all three are undone on the way
 * out: communication mode, audio focus, and the route.
 *
 * ## Finding a Bluetooth headset
 *
 * A paired headset is harder to see than it looks, and each of these was a way
 * of not seeing it:
 *
 * - **`BLUETOOTH_CONNECT` is a runtime permission from API 31.** Declaring it
 *   in the manifest is not holding it. Without the grant the platform reports
 *   no Bluetooth communication device at all, so the headset is not "not
 *   working" - it is not in the list. See `BetweenUsPermissions.BLUETOOTH`.
 * - **Outside a call a headset is an A2DP device, not an SCO one.** A picker
 *   drawn from `availableCommunicationDevices` in settings therefore sees
 *   nothing; the same headset appears as `TYPE_BLUETOOTH_SCO` only once the
 *   audio mode is `MODE_IN_COMMUNICATION`. [presentRoutes] reads the output
 *   device list as well, which lists it either way.
 * - **The old `AUTO` was not automatic.** It set the speakerphone flag, which
 *   is a decision - and the wrong one for somebody wearing a headset. It now
 *   picks the headset when there is one.
 * - **Below API 31 `setCommunicationDevice` does not exist**, and the
 *   speakerphone flag cannot name a headset. That is what `startBluetoothSco`
 *   is for, and it is still the fallback above 31 when the new API cannot see
 *   a device the old one can route to.
 */
object CallAudio {

    private var previousMode: Int = AudioManager.MODE_NORMAL
    private var previousSpeaker: Boolean = false
    private var focus: AudioFocusRequest? = null
    /**
     * The manager the live call is holding, so the focus can be asked for
     * again without a `Context` the caller has no reason to be holding.
     */
    private var manager: AudioManager? = null
    /**
     * A focus loss the system will never take back.
     *
     * A transient loss - the ordinary cellular call - ends in `AUDIOFOCUS_GAIN`
     * and the call resumes itself. A permanent one does not: nothing is coming,
     * and a call that waits for it stays on hold for the rest of the afternoon.
     * That is what [reclaimFocus] is for.
     */
    private var lostForGood = false

    /**
     * What the system says another app is doing to this call's audio.
     *
     * A cellular call, a voice assistant and a navigation prompt all arrive
     * here and nowhere else: an incoming phone call needs no telephony
     * permission to notice, because taking the audio *is* how the platform
     * announces it. Reading `READ_PHONE_STATE` to learn the same thing would
     * be asking for a permission to be told something already known.
     */
    private val onFocusChange = AudioManager.OnAudioFocusChangeListener { change ->
        VoiceEngine.current()?.setInterruption(
            when (change) {
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> VoiceEngine.Interruption.DUCK
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> VoiceEngine.Interruption.HOLD
                // A permanent loss is another app taking the audio for good -
                // a second VoIP call, usually. The call is not ended here,
                // because ending somebody's call on their behalf is worse than
                // holding it: they come back to it muted and can unmute.
                AudioManager.AUDIOFOCUS_LOSS -> {
                    lostForGood = true
                    VoiceEngine.Interruption.HOLD
                }
                AudioManager.AUDIOFOCUS_GAIN -> {
                    lostForGood = false
                    VoiceEngine.Interruption.NONE
                }
                else -> VoiceEngine.Interruption.NONE
            },
        )
    }
    private var held = false
    private var scoStarted = false

    /**
     * Registered for the length of the call, so plugging a headset in follows
     * the call wherever the user is looking.
     *
     * This used to live in `rememberCallDevices`, which only exists while the
     * device sheet is open - so the one gesture it was meant to serve, putting
     * a headset on mid-call, moved nothing unless the picker happened to be up
     * at that moment. Plugging in *is* the instruction; a call on `AUTO`
     * follows it, and a call pinned to a device that has just been unplugged
     * goes back to `AUTO` rather than to silence.
     */
    private var following: AudioDeviceCallback? = null

    fun start(context: Context) {
        if (held) return
        val manager = context.getSystemService(AudioManager::class.java) ?: return

        previousMode = manager.mode
        @Suppress("DEPRECATION")
        previousSpeaker = manager.isSpeakerphoneOn

        // Communication mode is what turns on the echo canceller, hands the
        // volume keys to the call, and - the part that matters here - makes a
        // paired headset appear as a communication device at all.
        manager.mode = AudioManager.MODE_IN_COMMUNICATION

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                .setOnAudioFocusChangeListener(onFocusChange)
                .build()
            manager.requestAudioFocus(request)
            focus = request
        } else {
            @Suppress("DEPRECATION")
            manager.requestAudioFocus(
                onFocusChange,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT,
            )
        }

        held = true
        this.manager = manager
        lostForGood = false
        applyTo(manager)
        follow(manager)
    }

    /**
     * Asks for the audio back, for a call that is on hold with nothing coming.
     *
     * The phone call that took the focus is over, but a permanent loss has no
     * "gain" to answer it - so the focus has to be requested again, and this is
     * the only thing that does it. Called when the call screen comes back to
     * the front, and by the Resume button on the hold banner.
     *
     * A no-op where the loss was transient: that case resumes itself, and
     * requesting focus underneath a live cellular call would take the audio off
     * the call somebody is actually on.
     */
    fun reclaimFocus(): Boolean {
        if (!held || !lostForGood) return false
        val manager = this.manager ?: return false

        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = focus ?: return false
            manager.requestAudioFocus(request)
        } else {
            @Suppress("DEPRECATION")
            manager.requestAudioFocus(
                onFocusChange,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT,
            )
        } == AudioManager.AUDIOFOCUS_REQUEST_GRANTED

        if (granted) {
            lostForGood = false
            VoiceEngine.current()?.setInterruption(VoiceEngine.Interruption.NONE)
        }
        return granted
    }

    /**
     * Re-routes the live call whenever the hardware changes.
     *
     * Both directions matter. A device arriving is the common one - a headset
     * put on, a car connecting - and a call on `AUTO` should move to it. A
     * device leaving is the one that used to end the call in silence: an
     * explicit choice of a headset that has just been unplugged can no longer
     * be honoured, and the honest answer is to go back to `AUTO` and re-resolve
     * rather than to keep asking for something that is not there.
     */
    private fun follow(manager: AudioManager) {
        if (following != null) return
        val callback = object : AudioDeviceCallback() {
            override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>?) = reroute(manager)
            override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>?) =
                reroute(manager)
        }
        following = callback
        manager.registerAudioDeviceCallback(callback, null)
    }

    private fun reroute(manager: AudioManager) {
        if (!held) return

        val routes = presentRoutes(manager)
        if (AudioPrefs.route != AudioPrefs.Route.AUTO && AudioPrefs.route !in routes) {
            AudioPrefs.route = AudioPrefs.Route.AUTO
        }

        val inputs = manager.getDevices(AudioManager.GET_DEVICES_INPUTS)
            .mapNotNull { inputOf(it.type) }
            .toSet()
        if (AudioPrefs.input != AudioPrefs.Input.AUTO && AudioPrefs.input !in inputs) {
            AudioPrefs.input = AudioPrefs.Input.AUTO
        }

        // SCO is torn down first: it is held against a device that may have
        // just gone, and starting it again on a stale handle is a call that
        // routes nowhere.
        stopSco(manager)
        applyTo(manager)
    }

    /**
     * Sends the call to the chosen devices, now, on a call that is already up.
     *
     * Changing this mid-call is the whole point: the moment somebody reaches
     * for it is the moment they have put a headset on, or picked the phone up
     * off the table and wants it against their ear.
     */
    fun apply(context: Context) {
        val manager = context.getSystemService(AudioManager::class.java) ?: return
        if (held) applyTo(manager)
    }

    /** What the system says is available, in the order a picker should list it. */
    fun availableRoutes(context: Context): List<AudioPrefs.Route> {
        val fixed = listOf(AudioPrefs.Route.AUTO, AudioPrefs.Route.SPEAKER, AudioPrefs.Route.EARPIECE)
        val manager = context.getSystemService(AudioManager::class.java) ?: return fixed
        val present = presentRoutes(manager)
        // Wired and Bluetooth are only offered when one is plugged in or
        // paired: a menu entry that cannot be chosen is worse than no entry.
        return fixed + listOf(AudioPrefs.Route.WIRED, AudioPrefs.Route.BLUETOOTH).filter {
            it in present
        }
    }

    /**
     * The microphones, same rule.
     *
     * A phone has one built-in microphone and the platform routes it; what a
     * headset adds is a second one, and that is the choice worth offering.
     */
    fun availableInputs(context: Context): List<AudioPrefs.Input> {
        val fixed = listOf(AudioPrefs.Input.AUTO, AudioPrefs.Input.PHONE)
        val manager = context.getSystemService(AudioManager::class.java) ?: return fixed
        val present = manager.getDevices(AudioManager.GET_DEVICES_INPUTS)
            .mapNotNull { inputOf(it.type) }
            .toSet()
        return fixed + listOf(AudioPrefs.Input.WIRED, AudioPrefs.Input.BLUETOOTH).filter {
            it in present
        }
    }

    /**
     * The route both directions end up on.
     *
     * Android routes a call as one communication device, not as a pair: asking
     * for the headset's microphone asks for its earpiece too. So a named input
     * wins over the output setting, and choosing the phone's own microphone
     * takes the call off a headset. That is the platform, not a shortcut - the
     * alternative is a custom audio device module, and it would still be one
     * device below API 31.
     */
    private fun wantedRoute(): AudioPrefs.Route = when (AudioPrefs.input) {
        AudioPrefs.Input.AUTO -> AudioPrefs.route
        AudioPrefs.Input.WIRED -> AudioPrefs.Route.WIRED
        AudioPrefs.Input.BLUETOOTH -> AudioPrefs.Route.BLUETOOTH
        AudioPrefs.Input.PHONE -> when (AudioPrefs.route) {
            AudioPrefs.Route.EARPIECE -> AudioPrefs.Route.EARPIECE
            else -> AudioPrefs.Route.SPEAKER
        }
    }

    /**
     * Whether the call is (or would be) coming out of the phone's own speaker.
     *
     * Asked before a call starts as well as during one, which is why it goes
     * through the same [wantedRoute] and [resolve] a live call does rather than
     * reading the stored preference: `AUTO` is the setting almost everybody is
     * on, and `AUTO` with no headset present *is* the loudspeaker. Reading the
     * preference alone would answer "not the speaker" for the exact
     * configuration that echoes worst.
     *
     * Used by [AudioPrefs.hardwareProcessing] to decide whether WebRTC's own
     * echo canceller should be preferred over the OEM's.
     */
    fun onLoudspeaker(context: Context): Boolean {
        val manager = context.getSystemService(AudioManager::class.java) ?: return true
        return resolve(manager, wantedRoute()) == AudioPrefs.Route.SPEAKER
    }

    private fun applyTo(manager: AudioManager) {
        val target = resolve(manager, wantedRoute())

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val device = manager.availableCommunicationDevices.firstOrNull {
                routeOf(it.type) == target
            }
            if (device != null &&
                runCatching { manager.setCommunicationDevice(device) }.getOrDefault(false)
            ) {
                // A device that is not the headset must not leave SCO running
                // underneath it.
                if (target != AudioPrefs.Route.BLUETOOTH) stopSco(manager)
                return
            }
            // Asked for something the new API cannot name - a headset that is
            // paired but not offered as a communication device is the usual
            // one. The old API can still route to it, so fall through rather
            // than leaving the call somewhere silent.
        }

        legacyRoute(manager, target)
    }

    /**
     * `AUTO` means "wherever a person would expect it", which is the headset
     * they are wearing before it is the speaker in their hand.
     */
    private fun resolve(manager: AudioManager, route: AudioPrefs.Route): AudioPrefs.Route {
        if (route != AudioPrefs.Route.AUTO) return route
        val present = presentRoutes(manager)
        return when {
            AudioPrefs.Route.BLUETOOTH in present -> AudioPrefs.Route.BLUETOOTH
            AudioPrefs.Route.WIRED in present -> AudioPrefs.Route.WIRED
            else -> AudioPrefs.Route.SPEAKER
        }
    }

    /**
     * Deprecated since API 31 in favour of `setCommunicationDevice`, which
     * needs a device to pick from. It still works everywhere, and it is the
     * only thing that does below 31.
     */
    private fun legacyRoute(manager: AudioManager, route: AudioPrefs.Route) {
        if (route == AudioPrefs.Route.BLUETOOTH) {
            startSco(manager)
            @Suppress("DEPRECATION")
            manager.isSpeakerphoneOn = false
            return
        }
        stopSco(manager)
        @Suppress("DEPRECATION")
        manager.isSpeakerphoneOn = route == AudioPrefs.Route.SPEAKER
    }

    private fun startSco(manager: AudioManager) {
        if (scoStarted) return
        @Suppress("DEPRECATION")
        runCatching {
            manager.isBluetoothScoOn = true
            manager.startBluetoothSco()
        }
        scoStarted = true
    }

    private fun stopSco(manager: AudioManager) {
        if (!scoStarted) return
        @Suppress("DEPRECATION")
        runCatching {
            manager.stopBluetoothSco()
            manager.isBluetoothScoOn = false
        }
        scoStarted = false
    }

    /**
     * Everything the platform can currently route a call to.
     *
     * Both lists, because neither is complete on its own: the communication
     * list is the one `setCommunicationDevice` accepts and only names a
     * headset in communication mode, while the output list names a paired
     * headset as A2DP at any time, including from the settings screen with no
     * call running.
     */
    private fun presentRoutes(manager: AudioManager): Set<AudioPrefs.Route> {
        val communication = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            manager.availableCommunicationDevices.mapNotNull { routeOf(it.type) }
        } else {
            emptyList()
        }
        val outputs = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            .mapNotNull { routeOf(it.type) }
        return (communication + outputs).toSet()
    }

    internal fun routeOf(type: Int): AudioPrefs.Route? = when (type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> AudioPrefs.Route.SPEAKER
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> AudioPrefs.Route.EARPIECE
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_USB_HEADSET,
        AudioDeviceInfo.TYPE_USB_DEVICE,
        -> AudioPrefs.Route.WIRED
        // A2DP is the same headset seen outside a call, and a hearing aid is
        // routed exactly like one. Leaving these out is why a paired headset
        // was never offered.
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
        AudioDeviceInfo.TYPE_BLE_HEADSET,
        AudioDeviceInfo.TYPE_BLE_SPEAKER,
        AudioDeviceInfo.TYPE_HEARING_AID,
        -> AudioPrefs.Route.BLUETOOTH
        else -> null
    }

    internal fun inputOf(type: Int): AudioPrefs.Input? = when (type) {
        AudioDeviceInfo.TYPE_BUILTIN_MIC -> AudioPrefs.Input.PHONE
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_USB_HEADSET,
        AudioDeviceInfo.TYPE_USB_DEVICE,
        -> AudioPrefs.Input.WIRED
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_BLE_HEADSET,
        AudioDeviceInfo.TYPE_HEARING_AID,
        -> AudioPrefs.Input.BLUETOOTH
        else -> null
    }

    fun stop(context: Context) {
        if (!held) return
        val manager = context.getSystemService(AudioManager::class.java) ?: return

        following?.let { manager.unregisterAudioDeviceCallback(it) }
        following = null

        stopSco(manager)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            runCatching { manager.clearCommunicationDevice() }
        }
        @Suppress("DEPRECATION")
        manager.isSpeakerphoneOn = previousSpeaker
        manager.mode = previousMode

        val request = focus
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && request != null) {
            manager.abandonAudioFocusRequest(request)
        } else {
            @Suppress("DEPRECATION")
            manager.abandonAudioFocus(onFocusChange)
        }
        focus = null
        held = false
        this.manager = null
        lostForGood = false
        // The call is over, so nothing is interrupting it any more. Leaving
        // this set would hold the microphone shut on the next call.
        VoiceEngine.current()?.setInterruption(VoiceEngine.Interruption.NONE)
    }
}

/** What a picker has to show: the devices, and what is chosen on each side. */
data class CallDevices(
    val routes: List<AudioPrefs.Route>,
    val inputs: List<AudioPrefs.Input>,
)

/**
 * The device lists, kept honest while the screen is open.
 *
 * A headset is put on *during* a call more often than before one, and a list
 * read once at composition is a list that still says there is no headset while
 * somebody is wearing it. `AudioDeviceCallback` is the platform saying so.
 *
 * A call on `AUTO` follows the change as well: plugging in is the instruction.
 */
@Composable
fun rememberCallDevices(): State<CallDevices> {
    val context = LocalContext.current
    val devices = remember {
        mutableStateOf(
            CallDevices(CallAudio.availableRoutes(context), CallAudio.availableInputs(context)),
        )
    }

    DisposableEffect(context) {
        val manager = context.getSystemService(AudioManager::class.java)
        val reread = {
            devices.value =
                CallDevices(CallAudio.availableRoutes(context), CallAudio.availableInputs(context))
            if (AudioPrefs.route == AudioPrefs.Route.AUTO) CallAudio.apply(context)
        }
        val callback = object : AudioDeviceCallback() {
            override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>?) = reread()
            override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>?) = reread()
        }
        manager?.registerAudioDeviceCallback(callback, null)
        onDispose { manager?.unregisterAudioDeviceCallback(callback) }
    }

    return devices
}
