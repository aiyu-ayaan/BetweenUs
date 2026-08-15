package com.aktech.nexora.feature.voice

import android.content.Context
import android.media.AudioAttributes
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
 * ponytail: no Bluetooth or wired-headset routing, and no route picker. The
 * speaker is the right default for a phone held in front of you, and
 * `setCommunicationDevice` is the upgrade path when somebody wants to choose.
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

        // Deprecated since API 31 in favour of setCommunicationDevice, which
        // needs a device to pick from. This still works everywhere and is one
        // line; the picker is the upgrade, not the fix.
        @Suppress("DEPRECATION")
        manager.isSpeakerphoneOn = true

        held = true
    }

    fun stop(context: Context) {
        if (!held) return
        val manager = context.getSystemService(AudioManager::class.java) ?: return

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
