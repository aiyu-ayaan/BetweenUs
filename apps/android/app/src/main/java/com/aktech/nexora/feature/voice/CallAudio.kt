package com.aktech.nexora.feature.voice

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
 *   working" - it is not in the list. See `NexoraPermissions.BLUETOOTH`.
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
    private var held = false
    private var scoStarted = false

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
                .build()
            manager.requestAudioFocus(request)
            focus = request
        } else {
            @Suppress("DEPRECATION")
            manager.requestAudioFocus(
                null,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT,
            )
        }

        held = true
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
            manager.abandonAudioFocus(null)
        }
        focus = null
        held = false
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
