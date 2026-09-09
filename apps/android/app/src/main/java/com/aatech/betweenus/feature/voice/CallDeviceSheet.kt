package com.aatech.betweenus.feature.voice

import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.theme.Accent
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate500
import org.webrtc.Camera1Enumerator
import org.webrtc.Camera2Enumerator

/**
 * Which device the call is heard on and spoken into, from inside the call.
 *
 * Settings has the same two choices, and settings is the wrong place for them:
 * the moment somebody wants to change where a call is coming out is the moment
 * they are in one, with a headset in their hand. So the control row has a
 * button, and this is what it opens.
 *
 * The list is live - see [rememberCallDevices]. A headset put on while the
 * sheet is open appears in it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CallDeviceSheet(
    onDismiss: () -> Unit,
    onCameraChanged: (name: String) -> Unit = {},
    /**
     * Reopen the camera, because a size is a property of the capture and only
     * a new one can change it. A callback rather than the engine itself: this
     * sheet otherwise knows nothing about calls, and the caller already holds
     * both the engine and whether a camera is running.
     */
    onCameraQualityChanged: () -> Unit = {},
    onCameraLookChanged: (filter: String) -> Unit = {},
) {
    val context = LocalContext.current
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val devices by rememberCallDevices()

    var route by remember { mutableStateOf(AudioPrefs.route) }
    var input by remember { mutableStateOf(AudioPrefs.input) }
    var quality by remember { mutableStateOf(AudioPrefs.cameraQuality) }
    var selectedCamera by remember { mutableStateOf(AudioPrefs.cameraDeviceName) }
    var filter by remember { mutableStateOf(AudioPrefs.cameraFilter) }

    val enumerator = remember {
        if (Camera2Enumerator.isSupported(context)) Camera2Enumerator(context) else Camera1Enumerator(true)
    }
    val cameraNames = remember(enumerator) { enumerator.deviceNames.toList() }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(bottom = 12.dp)
        ) {
            SectionLabel("Play through")
            devices.routes.forEach { option ->
                ListRow(
                    title = routeLabel(option),
                    subtitle = routeDetail(option),
                    selected = option == route,
                    leading = {
                        BetweenUsIcon(
                            icon = BetweenUsIcons.Speaker,
                            tint = if (option == route) Accent else Slate400,
                        )
                    },
                    onClick = {
                        route = option
                        AudioPrefs.route = option
                        CallAudio.apply(context)
                    },
                )
            }

            SectionLabel("Speak into")
            devices.inputs.forEach { option ->
                ListRow(
                    title = inputLabel(option),
                    subtitle = inputDetail(option),
                    selected = option == input,
                    leading = {
                        BetweenUsIcon(
                            icon = BetweenUsIcons.Mic,
                            tint = if (option == input) Accent else Slate400,
                        )
                    },
                    onClick = {
                        input = option
                        AudioPrefs.input = option
                        CallAudio.apply(context)
                    },
                )
            }

            if (cameraNames.isNotEmpty()) {
                SectionLabel("Camera")
                val frontCount = cameraNames.count { enumerator.isFrontFacing(it) }
                val backCount = cameraNames.count { enumerator.isBackFacing(it) }
                val defaultCamera = cameraNames.firstOrNull { enumerator.isFrontFacing(it) }
                    ?: cameraNames.firstOrNull()

                cameraNames.forEach { name ->
                    val isFront = enumerator.isFrontFacing(name)
                    val isBack = enumerator.isBackFacing(name)
                    val title = when {
                        isFront && frontCount > 1 -> "Front camera ($name)"
                        isFront -> "Front camera"
                        isBack && backCount > 1 -> "Back camera ($name)"
                        isBack -> "Back camera"
                        else -> "Camera $name"
                    }
                    val subtitle = when {
                        isFront -> "Front facing lens"
                        isBack -> "Back facing lens"
                        else -> "Lens $name"
                    }
                    val isSelected = name == selectedCamera || (selectedCamera == null && name == defaultCamera)

                    ListRow(
                        title = title,
                        subtitle = subtitle,
                        selected = isSelected,
                        leading = {
                            BetweenUsIcon(
                                icon = BetweenUsIcons.Video,
                                tint = if (isSelected) Accent else Slate400,
                            )
                        },
                        onClick = {
                            selectedCamera = name
                            AudioPrefs.cameraDeviceName = name
                            onCameraChanged(name)
                        },
                    )
                }
            }

            SectionLabel("Camera quality")
            ShareQuality.CameraQuality.entries.forEach { option ->
                ListRow(
                    title = cameraQualityLabel(option),
                    subtitle = cameraQualityDetail(option),
                    selected = option == quality,
                    leading = {
                        BetweenUsIcon(
                            icon = BetweenUsIcons.Video,
                            tint = if (option == quality) Accent else Slate400,
                        )
                    },
                    onClick = {
                        quality = option
                        AudioPrefs.cameraQuality = option
                        onCameraQualityChanged()
                    },
                )
            }

            SectionLabel("Camera filter")
            CameraLook.FILTERS.forEach { f ->
                val isSelected = f.name == filter
                ListRow(
                    title = f.label,
                    subtitle = cameraFilterDetail(f.name),
                    selected = isSelected,
                    leading = {
                        BetweenUsIcon(
                            icon = BetweenUsIcons.Sparkles,
                            tint = if (isSelected) Accent else Slate400,
                        )
                    },
                    onClick = {
                        filter = f.name
                        AudioPrefs.cameraFilter = f.name
                        onCameraLookChanged(f.name)
                    },
                )
            }

            Text(
                text = "Android routes a call as one device, so choosing a headset's microphone " +
                    "puts the call in that headset as well.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
        }
    }
}

private fun cameraQualityLabel(quality: ShareQuality.CameraQuality): String = when (quality) {
    ShareQuality.CameraQuality.AUTO -> "Automatic"
    ShareQuality.CameraQuality.P360 -> "360p"
    ShareQuality.CameraQuality.P720 -> "720p"
    ShareQuality.CameraQuality.P1080 -> "1080p"
}

private fun cameraQualityDetail(quality: ShareQuality.CameraQuality): String = when (quality) {
    ShareQuality.CameraQuality.AUTO -> "720p, which is what a phone's sensor is actually good at"
    ShareQuality.CameraQuality.P360 -> "For a metered or a struggling connection"
    ShareQuality.CameraQuality.P720 -> "The usual choice"
    ShareQuality.CameraQuality.P1080 -> "Worth it on a phone whose camera resolves it"
}

private fun cameraFilterDetail(name: String): String = when (name) {
    "none" -> "Natural sensor colors"
    "warm" -> "Warmer skin tones"
    "cool" -> "Cooler crisp tones"
    "vivid" -> "Higher saturation and contrast"
    "mono" -> "Greyscale black and white"
    "soft" -> "Soft lifted tones"
    else -> "Camera filter"
}


fun routeLabel(route: AudioPrefs.Route): String = when (route) {
    AudioPrefs.Route.AUTO -> "Automatic"
    AudioPrefs.Route.SPEAKER -> "Speaker"
    AudioPrefs.Route.EARPIECE -> "Earpiece"
    AudioPrefs.Route.WIRED -> "Wired headset"
    AudioPrefs.Route.BLUETOOTH -> "Bluetooth"
}

private fun routeDetail(route: AudioPrefs.Route): String = when (route) {
    AudioPrefs.Route.AUTO -> "A headset when one is connected, the speaker otherwise"
    AudioPrefs.Route.SPEAKER -> "The phone held in front of you"
    AudioPrefs.Route.EARPIECE -> "The phone held against your ear"
    AudioPrefs.Route.WIRED -> "Plugged in"
    AudioPrefs.Route.BLUETOOTH -> "Paired headset or hearing aid"
}

fun inputLabel(input: AudioPrefs.Input): String = when (input) {
    AudioPrefs.Input.AUTO -> "Automatic"
    AudioPrefs.Input.PHONE -> "Phone microphone"
    AudioPrefs.Input.WIRED -> "Wired headset"
    AudioPrefs.Input.BLUETOOTH -> "Bluetooth"
}

private fun inputDetail(input: AudioPrefs.Input): String = when (input) {
    AudioPrefs.Input.AUTO -> "Follows wherever the call is playing"
    AudioPrefs.Input.PHONE -> "The built-in microphone, even with a headset connected"
    AudioPrefs.Input.WIRED -> "The microphone on the plugged-in headset"
    AudioPrefs.Input.BLUETOOTH -> "The microphone on the paired headset"
}
