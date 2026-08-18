package com.aatech.betweenus.feature.voice

import android.media.AudioDeviceInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The device-type mapping, which is where the headset went missing.
 *
 * A paired headset is `TYPE_BLUETOOTH_SCO` inside a call and
 * `TYPE_BLUETOOTH_A2DP` everywhere else. The mapping used to know only the
 * first, so the settings picker - which reads the list with no call running -
 * saw a phone with no Bluetooth on it.
 */
class CallAudioRoutingTest {

    @Test
    fun `a paired headset is bluetooth in both of its guises`() {
        assertEquals(AudioPrefs.Route.BLUETOOTH, CallAudio.routeOf(AudioDeviceInfo.TYPE_BLUETOOTH_SCO))
        assertEquals(AudioPrefs.Route.BLUETOOTH, CallAudio.routeOf(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP))
        assertEquals(AudioPrefs.Route.BLUETOOTH, CallAudio.routeOf(AudioDeviceInfo.TYPE_BLE_HEADSET))
        assertEquals(AudioPrefs.Route.BLUETOOTH, CallAudio.routeOf(AudioDeviceInfo.TYPE_HEARING_AID))
    }

    @Test
    fun `the phone's own outputs are the two it has`() {
        assertEquals(AudioPrefs.Route.SPEAKER, CallAudio.routeOf(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER))
        assertEquals(AudioPrefs.Route.EARPIECE, CallAudio.routeOf(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE))
        assertEquals(AudioPrefs.Route.WIRED, CallAudio.routeOf(AudioDeviceInfo.TYPE_WIRED_HEADSET))
        assertEquals(AudioPrefs.Route.WIRED, CallAudio.routeOf(AudioDeviceInfo.TYPE_USB_HEADSET))
    }

    @Test
    fun `an output that is not a route is not offered`() {
        // HDMI is a real output and not somewhere to hold a call.
        assertNull(CallAudio.routeOf(AudioDeviceInfo.TYPE_HDMI))
        assertNull(CallAudio.inputOf(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER))
    }

    @Test
    fun `the microphones are the built-in one and whatever a headset adds`() {
        assertEquals(AudioPrefs.Input.PHONE, CallAudio.inputOf(AudioDeviceInfo.TYPE_BUILTIN_MIC))
        assertEquals(AudioPrefs.Input.WIRED, CallAudio.inputOf(AudioDeviceInfo.TYPE_WIRED_HEADSET))
        assertEquals(AudioPrefs.Input.BLUETOOTH, CallAudio.inputOf(AudioDeviceInfo.TYPE_BLUETOOTH_SCO))
    }
}
