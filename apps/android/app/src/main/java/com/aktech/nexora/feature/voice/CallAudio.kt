package com.aktech.nexora.feature.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build

/**
 * Where a call's sound goes, and who else has to stop making it.
 *
 * WebRTC plays remote audio on the voice-call stream, which on a phone is the
 * earpiece and is governed by the in-call volume - and neither of those is
 * where the system puts them until something asks. Left alone, a call arrives
 * as silence: the packets are decoded and played to a route nobody is holding
 * the phone against, at a volume the volume keys were not adjusting.
 *
 * So three things are asked for together, and all three are undone on the way
 * out: communication mode, audio focus, and the speaker.
 *
 * Where it comes out is a choice now - see [AudioPrefs.Route]. `AUTO` is what
 * this did before there was one: the speaker, which is right for a phone held
 * in front of you and wrong for every other way of holding one. Anything else
 * goes through `setCommunicationDevice`, which is the API that can actually
 * name a headset; below API 31 there is only the speakerphone flag, so those
 * devices get the earpiece-or-speaker half of the choice and the system's own
 * routing for the rest.
 */
object CallAudio {

    private var previousMode: Int = AudioManager.MODE_NORMAL
    private var previousSpeaker: Boolean = false
    private var focus: AudioFocusRequest? = null
    private var held = false

    fun start(context: Context) {
        if (held) return
        val manager = context.getSystemService(AudioManager::class.java) ?: return

        previousMode = manager.mode
        @Suppress("DEPRECATION")
        previousSpeaker = manager.isSpeakerphoneOn

        // Communication mode is what turns on the echo canceller and hands the
        // volume keys to the call.
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

        applyRoute(manager, AudioPrefs.route)

        held = true
    }

    /**
     * Sends the call to the chosen device, now, on a call that is already up.
     *
     * Changing this mid-call is the whole point: the moment somebody reaches
     * for it is the moment they have put a headset on, or picked the phone up
     * off the table and wants it against their ear.
     */
    fun applyRoute(context: Context, route: AudioPrefs.Route) {
        val manager = context.getSystemService(AudioManager::class.java) ?: return
        if (held) applyRoute(manager, route)
    }

    /** What the system says is available, in the order a picker should list it. */
    fun availableRoutes(context: Context): List<AudioPrefs.Route> {
        val fixed = listOf(AudioPrefs.Route.AUTO, AudioPrefs.Route.SPEAKER, AudioPrefs.Route.EARPIECE)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return fixed

        val manager = context.getSystemService(AudioManager::class.java) ?: return fixed
        val present = manager.availableCommunicationDevices
            .mapNotNull { routeOf(it.type) }
            .toSet()
        // Wired and Bluetooth are only offered when one is plugged in or
        // paired: a menu entry that cannot be chosen is worse than no entry.
        return fixed + listOf(AudioPrefs.Route.WIRED, AudioPrefs.Route.BLUETOOTH).filter {
            it in present
        }
    }

    private fun applyRoute(manager: AudioManager, route: AudioPrefs.Route) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && route != AudioPrefs.Route.AUTO) {
            val device = manager.availableCommunicationDevices.firstOrNull {
                routeOf(it.type) == route
            }
            if (device != null && manager.setCommunicationDevice(device)) return
            // Asked for a headset that has since been unplugged: fall through
            // to the speaker rather than leaving the call somewhere silent.
        }

        // Deprecated since API 31 in favour of setCommunicationDevice, which
        // needs a device to pick from. It still works everywhere, and it is the
        // only thing that does below 31.
        @Suppress("DEPRECATION")
        manager.isSpeakerphoneOn = route != AudioPrefs.Route.EARPIECE
    }

    private fun routeOf(type: Int): AudioPrefs.Route? = when (type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> AudioPrefs.Route.SPEAKER
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> AudioPrefs.Route.EARPIECE
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_USB_HEADSET,
        -> AudioPrefs.Route.WIRED
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_BLE_HEADSET,
        -> AudioPrefs.Route.BLUETOOTH
        else -> null
    }

    fun stop(context: Context) {
        if (!held) return
        val manager = context.getSystemService(AudioManager::class.java) ?: return

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
