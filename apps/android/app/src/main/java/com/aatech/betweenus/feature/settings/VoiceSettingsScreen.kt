package com.aatech.betweenus.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.feature.voice.AudioPrefs
import com.aatech.betweenus.feature.voice.CallAudio
import com.aatech.betweenus.feature.voice.CallTones
import com.aatech.betweenus.feature.voice.CameraLook
import com.aatech.betweenus.feature.voice.MicGate
import com.aatech.betweenus.feature.voice.ShareQuality
import com.aatech.betweenus.feature.voice.VoiceEngine
import com.aatech.betweenus.feature.voice.inputLabel
import com.aatech.betweenus.feature.voice.rememberCallDevices
import com.aatech.betweenus.feature.voice.routeLabel
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.theme.StatusOnline
import kotlinx.coroutines.flow.MutableStateFlow
import org.webrtc.Camera1Enumerator
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraEnumerator

/**
 * Dedicated Voice & Calls Settings Sub-Page.
 *
 * Provides device routing (headset/speaker/earpiece), input selection, high-fidelity
 * microphone mode, three-level noise suppression, echo cancellation, automatic gain control,
 * live dBFS pre-gate input sensitivity meter with threshold slider, and join/leave call tones.
 */
@Composable
fun VoiceSettingsScreen(
    onBack: () -> Unit,
    onCallUsage: () -> Unit,
) {
    val context = LocalContext.current

    var callTones by remember { mutableStateOf(CallTones.enabled) }
    var mode by remember { mutableStateOf(AudioPrefs.mode) }
    var route by remember { mutableStateOf(AudioPrefs.route) }
    var input by remember { mutableStateOf(AudioPrefs.input) }
    var echoCancellation by remember { mutableStateOf(AudioPrefs.echoCancellation) }
    var pushToTalk by remember { mutableStateOf(AudioPrefs.pushToTalk) }
    var noiseSuppression by remember { mutableStateOf(AudioPrefs.noiseSuppression) }
    var autoGainControl by remember { mutableStateOf(AudioPrefs.autoGainControl) }
    var sensitivity by remember { mutableStateOf(AudioPrefs.sensitivityDb) }
    val devices by rememberCallDevices()

    var cameraQuality by remember { mutableStateOf(AudioPrefs.cameraQuality) }
    var cameraFilter by remember { mutableStateOf(AudioPrefs.cameraFilter) }
    var cameraPortrait by remember { mutableStateOf(AudioPrefs.cameraPortrait) }
    var cameraDevice by remember { mutableStateOf(AudioPrefs.cameraDeviceName) }
    val enumerator = remember {
        if (Camera2Enumerator.isSupported(context)) Camera2Enumerator(context) else Camera1Enumerator(true)
    }
    val cameraNames = remember(enumerator) { enumerator.deviceNames.toList() }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .navigationBarsPadding(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .statusBarsPadding()
                .padding(start = 4.dp, end = 12.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(BetweenUsIcons.ChevronLeft, "Back", onBack)
            Text(
                text = "Voice & Audio",
                style = MaterialTheme.typography.titleLargeEmphasized,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
        }

        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 40.dp)) {
            // --- Audio Devices ---
            SectionLabel("Audio Devices")

            ListRow(
                title = "Audio Output",
                subtitle = routeLabel(route),
                leading = { BetweenUsIcon(BetweenUsIcons.Speaker) },
                trailing = {
                    Chip(
                        text = "Change",
                        onClick = {
                            val list = devices.routes
                            val next = list[(list.indexOf(route) + 1).mod(list.size)]
                            route = next
                            AudioPrefs.route = next
                            CallAudio.apply(context)
                        },
                    )
                },
            )

            ListRow(
                title = "Audio Input",
                subtitle = inputLabel(input),
                leading = { BetweenUsIcon(BetweenUsIcons.Mic) },
                trailing = {
                    Chip(
                        text = "Change",
                        onClick = {
                            val list = devices.inputs
                            val next = list[(list.indexOf(input) + 1).mod(list.size)]
                            input = next
                            AudioPrefs.input = next
                            CallAudio.apply(context)
                        },
                    )
                },
            )

            // --- Voice Quality & Processing ---
            SectionLabel("Voice Processing")

            ListRow(
                title = "High fidelity microphone",
                subtitle = if (mode == AudioPrefs.Mode.HIFI) {
                    "Stereo at twice the bitrate with speech processing off"
                } else {
                    "Speech: mono, denoised, and silent between sentences"
                },
                leading = { BetweenUsIcon(BetweenUsIcons.Mic) },
                trailing = {
                    Switch(
                        checked = mode == AudioPrefs.Mode.HIFI,
                        onCheckedChange = { on ->
                            mode = if (on) AudioPrefs.Mode.HIFI else AudioPrefs.Mode.CLEAR
                            AudioPrefs.mode = mode
                        },
                        colors = SwitchDefaults.colors(),
                    )
                },
            )

            if (mode == AudioPrefs.Mode.CLEAR) {
                // Three levels rather than a switch, because the middle one and
                // the loud one are genuinely different jobs and the desktop
                // draws the same three. The row carries the explanation and the
                // buttons sit under it: a segmented control is too wide to be a
                // trailing element on a 56dp row, and squeezing it there is how
                // the labels turn into "Sta...".
                ListRow(
                    title = "Noise suppression",
                    subtitle = when (noiseSuppression) {
                        AudioPrefs.NoiseSuppression.OFF ->
                            "Your microphone is sent as the room sounds"
                        AudioPrefs.NoiseSuppression.STANDARD ->
                            "Filters fans, keyboard clatter, and ambient noise"
                        AudioPrefs.NoiseSuppression.HIGH ->
                            "Uses more battery. Best in a noisy room or on speakerphone"
                    },
                    leading = { BetweenUsIcon(BetweenUsIcons.Settings) },
                )

                SingleChoiceSegmentedButtonRow(
                    // 22dp is the ListRow's own inset (10 outside, 12 in), so
                    // the buttons line up under the text they belong to.
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 22.dp, vertical = 4.dp),
                ) {
                    val levels = AudioPrefs.NoiseSuppression.entries
                    levels.forEachIndexed { index, level ->
                        SegmentedButton(
                            selected = noiseSuppression == level,
                            onClick = {
                                noiseSuppression = level
                                AudioPrefs.noiseSuppression = level
                            },
                            shape = SegmentedButtonDefaults.itemShape(index, levels.size),
                        ) {
                            Text(
                                when (level) {
                                    AudioPrefs.NoiseSuppression.OFF -> "Off"
                                    AudioPrefs.NoiseSuppression.STANDARD -> "Standard"
                                    AudioPrefs.NoiseSuppression.HIGH -> "High"
                                },
                            )
                        }
                    }
                }

                ListRow(
                    title = "Push to talk",
                    subtitle = "The microphone stays closed until you hold the talk button " +
                        "on the call screen. For a room the gate cannot help with",
                    leading = { BetweenUsIcon(BetweenUsIcons.Mic) },
                    trailing = {
                        Switch(
                            checked = pushToTalk,
                            onCheckedChange = {
                                pushToTalk = it
                                AudioPrefs.pushToTalk = it
                                // A call that is already running has to be told:
                                // turning the mode on must close the microphone
                                // now rather than whenever something next
                                // happens to re-decide, and turning it off must
                                // reopen it - nothing else would.
                                VoiceEngine.live.value?.refreshTalkMode()
                            },
                            colors = SwitchDefaults.colors(),
                        )
                    },
                )

                ListRow(
                    title = "Echo cancellation",
                    subtitle = "Stops what the call plays being picked up and sent back. " +
                        "On speakerphone the app cancels it itself rather than trusting the phone",
                    leading = { BetweenUsIcon(BetweenUsIcons.Settings) },
                    trailing = {
                        Switch(
                            checked = echoCancellation,
                            onCheckedChange = {
                                echoCancellation = it
                                AudioPrefs.echoCancellation = it
                            },
                            colors = SwitchDefaults.colors(),
                        )
                    },
                )

                ListRow(
                    title = "Automatic gain control",
                    subtitle = "Automatically balances loud and quiet speaking levels",
                    leading = { BetweenUsIcon(BetweenUsIcons.Settings) },
                    trailing = {
                        Switch(
                            checked = autoGainControl,
                            onCheckedChange = {
                                autoGainControl = it
                                AudioPrefs.autoGainControl = it
                            },
                            colors = SwitchDefaults.colors(),
                        )
                    },
                )

                // Said rather than quietly not done. Whether the phone's own
                // canceller runs is fixed when the audio engine is built, and
                // rebuilding it mid-call would drop every peer - so a change
                // made while a call is up waits for the next one. See
                // VoiceEngine.refreshAudioStack.
                Text(
                    text = "Echo and noise settings apply from your next call.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 22.dp, end = 22.dp, top = 4.dp, bottom = 8.dp),
                )
            }

            // --- Input Sensitivity ---
            SectionLabel("Input Sensitivity & Gate")
            VoiceInputSensitivity(
                threshold = sensitivity,
                onChange = {
                    sensitivity = it
                    AudioPrefs.sensitivityDb = it
                },
            )

            // --- Camera & Video ---
            SectionLabel("Camera & Video")

            if (cameraNames.isNotEmpty()) {
                ListRow(
                    title = "Camera",
                    subtitle = cameraLabel(cameraDevice, cameraNames, enumerator),
                    leading = { BetweenUsIcon(BetweenUsIcons.Video) },
                    trailing = {
                        Chip(
                            text = "Change",
                            onClick = {
                                val activeTarget = cameraDevice
                                    ?: cameraNames.firstOrNull { runCatching { enumerator.isFrontFacing(it) }.getOrDefault(false) }
                                    ?: cameraNames.firstOrNull()
                                val currentIndex = cameraNames.indexOf(activeTarget)
                                val nextIndex = (currentIndex + 1).mod(cameraNames.size)
                                val next = cameraNames[nextIndex]
                                cameraDevice = next
                                AudioPrefs.cameraDeviceName = next
                            },
                        )
                    },
                )
            }

            ListRow(
                title = "Resolution",
                subtitle = cameraQualityLabel(cameraQuality),
                leading = { BetweenUsIcon(BetweenUsIcons.Video) },
                trailing = {
                    Chip(
                        text = "Change",
                        onClick = {
                            val qualities = ShareQuality.CameraQuality.entries
                            val nextIndex = (qualities.indexOf(cameraQuality) + 1).mod(qualities.size)
                            val next = qualities[nextIndex]
                            cameraQuality = next
                            AudioPrefs.cameraQuality = next
                        },
                    )
                },
            )

            ListRow(
                title = "Filter",
                subtitle = CameraLook.filterFor(cameraFilter).label,
                leading = { BetweenUsIcon(BetweenUsIcons.Sparkles) },
                trailing = {
                    Chip(
                        text = "Change",
                        onClick = {
                            val filters = CameraLook.FILTERS
                            val currentIndex = filters.indexOfFirst { it.name == cameraFilter }
                            val nextIndex = (currentIndex + 1).mod(filters.size)
                            val next = filters[nextIndex]
                            cameraFilter = next.name
                            AudioPrefs.cameraFilter = next.name
                            VoiceEngine.live.value?.setCameraLook(next.name, cameraPortrait)
                        },
                    )
                },
            )

            ListRow(
                title = "Background Blur",
                subtitle = CameraLook.portraitFor(cameraPortrait).label,
                leading = { BetweenUsIcon(BetweenUsIcons.Sparkles) },
                trailing = {
                    Chip(
                        text = "Change",
                        onClick = {
                            val portraits = CameraLook.Portrait.entries
                            val currentIndex = portraits.indexOfFirst { it.level == cameraPortrait }
                            val nextIndex = (currentIndex + 1).mod(portraits.size)
                            val next = portraits[nextIndex]
                            cameraPortrait = next.level
                            AudioPrefs.cameraPortrait = next.level
                            VoiceEngine.live.value?.setCameraLook(cameraFilter, next.level)
                        },
                    )
                },
            )

            // --- Call Sounds & Analytics ---
            SectionLabel("Call Sounds & Data")

            ListRow(
                title = "Join and leave tones",
                subtitle = "Subtle acoustic cues when someone connects or disconnects",
                leading = { BetweenUsIcon(BetweenUsIcons.Speaker) },
                trailing = {
                    Switch(
                        checked = callTones,
                        onCheckedChange = { on ->
                            callTones = on
                            CallTones.enabled = on
                            if (on) CallTones.play(CallTones.Tone.JOIN)
                        },
                        colors = SwitchDefaults.colors(),
                    )
                },
            )

            ListRow(
                title = "Calls & data usage",
                subtitle = "Review bandwidth, duration, and connection topology for past calls",
                leading = { BetweenUsIcon(BetweenUsIcons.Phone) },
                trailing = { BetweenUsIcon(BetweenUsIcons.ChevronRight, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
                onClick = onCallUsage,
            )
        }
    }
}

@Composable
private fun VoiceInputSensitivity(threshold: Int?, onChange: (Int?) -> Unit) {
    val engine = VoiceEngine.current()
    val level by (engine?.micLevelDb ?: remember { MutableStateFlow(-100.0) }).collectAsState()
    val open by (engine?.gateOpen ?: remember { MutableStateFlow(true) }).collectAsState()
    val call by (engine?.state ?: remember {
        MutableStateFlow<VoiceEngine.CallState>(VoiceEngine.CallState.Idle)
    }).collectAsState()
    val live = call is VoiceEngine.CallState.Live

    ListRow(
        title = "Input sensitivity gate",
        subtitle = when {
            threshold == null -> "Automatic: everything the microphone hears is transmitted"
            live -> "Below $threshold dB the microphone remains silent"
            else -> "Below $threshold dB the microphone is closed. Join a call to see live meter."
        },
        leading = { BetweenUsIcon(BetweenUsIcons.Mic) },
        trailing = {
            Switch(
                checked = threshold != null,
                onCheckedChange = { on -> onChange(if (on) -50 else null) },
                colors = SwitchDefaults.colors(),
            )
        },
    )

    if (threshold == null) return

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        VoiceMicMeter(levelDb = level, thresholdDb = threshold, open = open, live = live)
        Slider(
            value = threshold.toFloat(),
            onValueChange = { onChange(it.toInt()) },
            valueRange = MicGate.MIN_THRESHOLD_DB.toFloat()..MicGate.MAX_THRESHOLD_DB.toFloat(),
        )
    }
}

@Composable
private fun VoiceMicMeter(levelDb: Double, thresholdDb: Int, open: Boolean, live: Boolean) {
    fun position(db: Double): Float = ((db + 80.0) / 80.0).coerceIn(0.0, 1.0).toFloat()
    val filled = if (live) position(levelDb) else 0f

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(10.dp)
            .clip(RoundedCornerShape(5.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHighest),
    ) {
        if (filled > 0f) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(filled)
                    .fillMaxHeight()
                    .background(
                        if (open) StatusOnline else MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
            )
        }
        Box(
            modifier = Modifier
                .fillMaxWidth(position(thresholdDb.toDouble()))
                .fillMaxHeight(),
            contentAlignment = Alignment.CenterEnd,
        ) {
            Box(
                modifier = Modifier
                    .width(2.dp)
                    .fillMaxHeight()
                    .background(MaterialTheme.colorScheme.onSurface),
            )
        }
    }
}

private fun cameraQualityLabel(quality: ShareQuality.CameraQuality): String = when (quality) {
    ShareQuality.CameraQuality.AUTO -> "Auto"
    ShareQuality.CameraQuality.P360 -> "360p"
    ShareQuality.CameraQuality.P720 -> "720p"
    ShareQuality.CameraQuality.P1080 -> "1080p"
}

private fun cameraLabel(name: String?, cameraNames: List<String>, enumerator: CameraEnumerator): String {
    val target = name
        ?: cameraNames.firstOrNull { runCatching { enumerator.isFrontFacing(it) }.getOrDefault(false) }
        ?: cameraNames.firstOrNull()
        ?: return "None"
    val frontCount = cameraNames.count { runCatching { enumerator.isFrontFacing(it) }.getOrDefault(false) }
    val backCount = cameraNames.count { runCatching { enumerator.isBackFacing(it) }.getOrDefault(false) }
    val isFront = runCatching { enumerator.isFrontFacing(target) }.getOrDefault(false)
    val isBack = runCatching { enumerator.isBackFacing(target) }.getOrDefault(false)
    return when {
        isFront && frontCount > 1 -> "Front camera ($target)"
        isFront -> "Front camera"
        isBack && backCount > 1 -> "Back camera ($target)"
        isBack -> "Back camera"
        else -> "Camera $target"
    }
}
