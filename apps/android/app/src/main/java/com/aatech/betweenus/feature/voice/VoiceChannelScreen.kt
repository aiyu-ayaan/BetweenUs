package com.aatech.betweenus.feature.voice

import android.app.Activity
import android.content.Context
import android.media.projection.MediaProjectionManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.compose.ui.unit.sp
import com.aatech.betweenus.core.data.PublicUser
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.feature.settings.BetweenUsPermissions
import com.aatech.betweenus.feature.settings.rememberPermission
import com.aatech.betweenus.feature.settings.rememberPermissions
import com.aatech.betweenus.ui.components.Avatar
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.EmptyState
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.theme.Accent
import com.aatech.betweenus.ui.theme.Amber200
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Edge
import com.aatech.betweenus.ui.theme.Ground
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate300
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate50
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.StatusOnline
import com.aatech.betweenus.ui.theme.Surface800
import com.aatech.betweenus.ui.theme.Surface900
import com.aatech.betweenus.ui.theme.Surface950
import org.webrtc.RendererCommon
import org.webrtc.VideoTrack
import kotlin.math.roundToInt

/**
 * A WhatsApp/modern-style voice & video call screen.
 *
 * Designed with adaptive layouts (no vertical scrolling in calls):
 * - 1-on-1: Remote peer fills the screen with local self-view in a floating PiP card.
 * - 3-person (2 remote): 2 vertical tiles on top half, balanced layout on bottom half.
 * - 4-person (3-4 remote): 2x2 equal grid filling the viewport cleanly.
 * - 5+ person: Active speaker hero view with horizontal thumbnail strip.
 * - Floating glassmorphic control dock with camera flip, mute, video, share, speaker, and end call.
 */
@Composable
fun VoiceChannelScreen(
    channelId: String?,
    self: PublicUser,
    joinOnArrival: Boolean = false,
    onJoined: () -> Unit = {},
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val engine = remember { VoiceEngine.of(context) }

    val state by engine.state.collectAsState()
    val participants by engine.participants.collectAsState()
    val muted by engine.muted.collectAsState()
    val cameraOn by engine.cameraOn.collectAsState()
    val isFrontCamera by engine.isFrontCamera.collectAsState()
    val sharing by engine.sharing.collectAsState()
    val screenHolder by engine.screenHolder.collectAsState()
    val localVideo by engine.localVideo.collectAsState()
    // Your own microphone, so the green ring is not something that only ever
    // happens to other people.
    val selfSpeaking by engine.selfSpeaking.collectAsState()
    val linkStats by engine.stats.collectAsState()
    val signalling by engine.signalling.collectAsState()
    val problem by engine.problem.collectAsState()

    val channel = channelId?.let { Workspace.channel(it) }

    // A call is the whole screen. The status and navigation bars are hidden
    // for as long as one is running and put back when it ends or the screen
    // goes away - a swipe from an edge still brings them back transiently,
    // which is the only way out of a full-screen app Android guarantees.
    val inCallNow = state is VoiceEngine.CallState.Live ||
        state is VoiceEngine.CallState.Connecting
    val view = LocalView.current
    DisposableEffect(inCallNow, view) {
        val window = (view.context as? Activity)?.window
        val bars = window?.let { WindowCompat.getInsetsController(it, view) }
        if (inCallNow && bars != null) {
            bars.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            bars.hide(WindowInsetsCompat.Type.systemBars())
        }
        onDispose { bars?.show(WindowInsetsCompat.Type.systemBars()) }
    }

    // Back during a call shrinks it rather than ending it. Only if the system
    // refuses does back mean what it usually means.
    val inPip = rememberInPictureInPicture()
    val leaveScreen = { if (!(inCallNow && CallPip.enter(context))) onBack() }
    BackHandler(enabled = inCallNow && !inPip) { leaveScreen() }

    val watching = participants.firstOrNull { it.visibleScreen != null }
    var dismissed by remember { mutableStateOf<String?>(null) }
    var pickingDevices by remember { mutableStateOf(false) }
    var showingConnection by remember { mutableStateOf(false) }

    // Worked out once here rather than twice: it tints the button that opens
    // the sheet as well as heading the sheet itself, so a bad link is visible
    // without opening anything.
    val linkHealth = CallStats.healthWarning(linkStats)

    LaunchedEffect(watching?.peer?.peerId) {
        if (watching == null) dismissed = null
    }

    val microphone = rememberPermissions(
        permissions = listOfNotNull(
            BetweenUsPermissions.MICROPHONE,
            BetweenUsPermissions.NOTIFICATIONS,
            BetweenUsPermissions.BLUETOOTH,
        ),
        required = BetweenUsPermissions.MICROPHONE,
    ) {
        channelId?.let { engine.join(it) }
    }
    val camera = rememberPermission(BetweenUsPermissions.CAMERA) { engine.startCamera() }

    LaunchedEffect(joinOnArrival, channelId) {
        if (joinOnArrival && channelId != null && state is VoiceEngine.CallState.Idle) {
            onJoined()
            microphone.request()
        }
    }

    val projection = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            engine.startScreenShare(result.data!!)
        }
    }

    if (watching != null && watching.peer.peerId != dismissed) {
        ShareStage(
            label = watching.peer.username,
            track = watching.visibleScreen!!,
            participants = participants.filterNot { it.peer.peerId == watching.peer.peerId },
            self = self.label,
            selfId = self.id,
            eglContext = engine.eglBase.eglBaseContext,
            muted = muted,
            selfSpeaking = selfSpeaking,
            cameraOn = cameraOn,
            sharing = sharing,
            onToggleMute = engine::toggleMute,
            onToggleCamera = { if (cameraOn) engine.stopVideo() else camera.request() },
            onToggleShare = {
                if (sharing) {
                    engine.stopVideo()
                } else {
                    val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE)
                        as MediaProjectionManager
                    projection.launch(manager.createScreenCaptureIntent())
                }
            },
            onAudioDevices = { pickingDevices = true },
            onLeave = { engine.leave(); onBack() },
            onClose = { dismissed = watching.peer.peerId },
        )
        if (pickingDevices) CallDeviceSheet(onDismiss = { pickingDevices = false })
    if (showingConnection) ConnectionSheet(linkStats) { showingConnection = false }
        return
    }

    val isInCall = inCallNow

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Ground)
            .systemBarsPadding(),
    ) {
        // --- STAGE CONTENT ---
        when {
            channelId == null -> {
                EmptyState(
                    icon = BetweenUsIcons.Speaker,
                    title = "No channel",
                    detail = "Pick a voice channel from the drawer first.",
                    modifier = Modifier.align(Alignment.Center),
                )
            }

            !isInCall -> {
                // Not in call screen (Idle / Failed / Permission refused)
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Box(
                        modifier = Modifier
                            .size(96.dp)
                            .clip(CircleShape)
                            .background(Surface900)
                            .border(2.dp, Edge, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        BetweenUsIcon(BetweenUsIcons.Speaker, size = 44.dp, tint = Accent)
                    }

                    Spacer(Modifier.height(24.dp))
                    Text(
                        text = channel?.name ?: "Voice Channel",
                        style = MaterialTheme.typography.titleLarge,
                        color = Slate50,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = "Encrypted direct peer-to-peer voice and video. Media never touches the server.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Slate400,
                        textAlign = TextAlign.Center,
                    )

                    Spacer(Modifier.height(24.dp))
                    (state as? VoiceEngine.CallState.Failed)?.let {
                        Notice(it.reason, Danger)
                        Spacer(Modifier.height(16.dp))
                    }

                    if (microphone.refused) {
                        Notice(
                            "BetweenUs cannot use the microphone. Android will not ask again from here.",
                            Danger,
                        )
                        Spacer(Modifier.height(16.dp))
                        BetweenUsButton("Open app settings", onClick = { microphone.openSettings() })
                    } else {
                        BetweenUsButton(
                            text = if (state is VoiceEngine.CallState.Failed) "Try again" else "Join Voice",
                            onClick = { microphone.request() },
                        )
                    }
                }
            }

            else -> {
                // ACTIVE CALL - Adaptive WhatsApp / Modern Video Stage
                Box(modifier = Modifier.fillMaxSize()) {
                    when {
                        // 0 remote participants (Waiting for others)
                        participants.isEmpty() -> {
                            Box(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(horizontal = 12.dp, vertical = 72.dp)
                                    .clip(RoundedCornerShape(24.dp))
                                    .background(Surface950)
                                    .border(1.dp, Edge, RoundedCornerShape(24.dp)),
                                contentAlignment = Alignment.Center,
                            ) {
                                CallTile(
                                    label = "${self.label} (you)",
                                    id = self.id,
                                    track = localVideo,
                                    speaking = selfSpeaking,
                                    eglContext = engine.eglBase.eglBaseContext,
                                    muted = muted,
                                    isLocal = true,
                                    fit = RendererCommon.ScalingType.SCALE_ASPECT_FILL,
                                    modifier = Modifier.fillMaxSize(),
                                )
                                Box(
                                    modifier = Modifier
                                        .align(Alignment.Center)
                                        .background(Color.Black.copy(alpha = 0.65f), RoundedCornerShape(16.dp))
                                        .padding(horizontal = 16.dp, vertical = 10.dp),
                                ) {
                                    Text(
                                        text = "Waiting for others to join…",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = Slate300,
                                    )
                                }
                            }
                        }

                        // 1-on-1 Call: Remote fills screen, Local in floating PiP
                        participants.size == 1 -> {
                            val remote = participants.first()
                            CallTile(
                                label = remote.peer.username,
                                id = remote.peer.userId,
                                track = remote.video,
                                eglContext = engine.eglBase.eglBaseContext,
                                muted = !remote.micEnabled,
                                speaking = remote.speaking,
                                connected = remote.connected,
                                status = statusOf(remote),
                                fit = RendererCommon.ScalingType.SCALE_ASPECT_FILL,
                                // Clear of the floating dock, which is drawn
                                // over the bottom of this tile.
                                labelBottomPadding = 92.dp,
                                modifier = Modifier.fillMaxSize(),
                            )

                            // Floating PiP for self (top-right)
                            FloatingPipTile(
                                label = "${self.label} (you)",
                                id = self.id,
                                track = localVideo,
                                speaking = selfSpeaking,
                                eglContext = engine.eglBase.eglBaseContext,
                                muted = muted,
                                onFlipCamera = {
                                    if (cameraOn) engine.switchCamera()
                                },
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .padding(top = 68.dp, end = 14.dp),
                            )
                        }

                        // 2 Remote Participants (3 total): Top half split in 2 vertical tiles, bottom half local PiP
                        participants.size == 2 -> {
                            Column(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(top = 64.dp, bottom = 96.dp, start = 8.dp, end = 8.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .weight(1f),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    CallTile(
                                        label = participants[0].peer.username,
                                        id = participants[0].peer.userId,
                                        track = participants[0].video,
                                        eglContext = engine.eglBase.eglBaseContext,
                                        muted = !participants[0].micEnabled,
                                        speaking = participants[0].speaking,
                                        connected = participants[0].connected,
                                        status = statusOf(participants[0]),
                                        fit = RendererCommon.ScalingType.SCALE_ASPECT_FILL,
                                        modifier = Modifier
                                            .weight(1f)
                                            .fillMaxHeight(),
                                    )
                                    CallTile(
                                        label = participants[1].peer.username,
                                        id = participants[1].peer.userId,
                                        track = participants[1].video,
                                        eglContext = engine.eglBase.eglBaseContext,
                                        muted = !participants[1].micEnabled,
                                        speaking = participants[1].speaking,
                                        connected = participants[1].connected,
                                        status = statusOf(participants[1]),
                                        fit = RendererCommon.ScalingType.SCALE_ASPECT_FILL,
                                        modifier = Modifier
                                            .weight(1f)
                                            .fillMaxHeight(),
                                    )
                                }
                            }

                            // Self in Floating PiP
                            FloatingPipTile(
                                label = "${self.label} (you)",
                                id = self.id,
                                track = localVideo,
                                speaking = selfSpeaking,
                                eglContext = engine.eglBase.eglBaseContext,
                                muted = muted,
                                onFlipCamera = {
                                    if (cameraOn) engine.switchCamera()
                                },
                                modifier = Modifier
                                    .align(Alignment.BottomEnd)
                                    .padding(bottom = 110.dp, end = 14.dp),
                            )
                        }

                        // 3 or 4 Remote Participants (4-5 total): 2x2 Balanced Grid (no scroll)
                        participants.size in 3..4 -> {
                            Column(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(top = 64.dp, bottom = 96.dp, start = 8.dp, end = 8.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .weight(1f),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    CallTile(
                                        label = participants[0].peer.username,
                                        id = participants[0].peer.userId,
                                        track = participants[0].video,
                                        eglContext = engine.eglBase.eglBaseContext,
                                        muted = !participants[0].micEnabled,
                                        speaking = participants[0].speaking,
                                        connected = participants[0].connected,
                                        status = statusOf(participants[0]),
                                        fit = RendererCommon.ScalingType.SCALE_ASPECT_FILL,
                                        modifier = Modifier
                                            .weight(1f)
                                            .fillMaxHeight(),
                                    )
                                    CallTile(
                                        label = participants[1].peer.username,
                                        id = participants[1].peer.userId,
                                        track = participants[1].video,
                                        eglContext = engine.eglBase.eglBaseContext,
                                        muted = !participants[1].micEnabled,
                                        speaking = participants[1].speaking,
                                        connected = participants[1].connected,
                                        status = statusOf(participants[1]),
                                        fit = RendererCommon.ScalingType.SCALE_ASPECT_FILL,
                                        modifier = Modifier
                                            .weight(1f)
                                            .fillMaxHeight(),
                                    )
                                }
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .weight(1f),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    CallTile(
                                        label = participants[2].peer.username,
                                        id = participants[2].peer.userId,
                                        track = participants[2].video,
                                        eglContext = engine.eglBase.eglBaseContext,
                                        muted = !participants[2].micEnabled,
                                        speaking = participants[2].speaking,
                                        connected = participants[2].connected,
                                        status = statusOf(participants[2]),
                                        fit = RendererCommon.ScalingType.SCALE_ASPECT_FILL,
                                        modifier = Modifier
                                            .weight(1f)
                                            .fillMaxHeight(),
                                    )
                                    if (participants.size == 4) {
                                        CallTile(
                                            label = participants[3].peer.username,
                                            id = participants[3].peer.userId,
                                            track = participants[3].video,
                                            eglContext = engine.eglBase.eglBaseContext,
                                            muted = !participants[3].micEnabled,
                                            speaking = participants[3].speaking,
                                            connected = participants[3].connected,
                                            status = statusOf(participants[3]),
                                            fit = RendererCommon.ScalingType.SCALE_ASPECT_FILL,
                                            modifier = Modifier
                                                .weight(1f)
                                                .fillMaxHeight(),
                                        )
                                    } else {
                                        // 4th spot is self preview
                                        CallTile(
                                            label = "${self.label} (you)",
                                            id = self.id,
                                            track = localVideo,
                                            speaking = selfSpeaking,
                                            eglContext = engine.eglBase.eglBaseContext,
                                            muted = muted,
                                            isLocal = true,
                                            fit = RendererCommon.ScalingType.SCALE_ASPECT_FILL,
                                            modifier = Modifier
                                                .weight(1f)
                                                .fillMaxHeight(),
                                        )
                                    }
                                }
                            }

                            if (participants.size == 4) {
                                FloatingPipTile(
                                    label = "${self.label} (you)",
                                    id = self.id,
                                    track = localVideo,
                                    speaking = selfSpeaking,
                                    eglContext = engine.eglBase.eglBaseContext,
                                    muted = muted,
                                    onFlipCamera = {
                                        if (cameraOn) engine.switchCamera()
                                    },
                                    modifier = Modifier
                                        .align(Alignment.BottomEnd)
                                        .padding(bottom = 110.dp, end = 14.dp),
                                )
                            }
                        }

                        // 5+ Participants: Hero active speaker stage with bottom participant strip
                        else -> {
                            val activeSpeaker = participants.firstOrNull { it.speaking }
                                ?: participants.first()
                            val others = participants.filterNot { it.peer.peerId == activeSpeaker.peer.peerId }

                            Box(modifier = Modifier.fillMaxSize()) {
                                // Large Active Speaker Card
                                CallTile(
                                    label = activeSpeaker.peer.username,
                                    id = activeSpeaker.peer.userId,
                                    track = activeSpeaker.video,
                                    eglContext = engine.eglBase.eglBaseContext,
                                    muted = !activeSpeaker.micEnabled,
                                    speaking = activeSpeaker.speaking,
                                    connected = activeSpeaker.connected,
                                    status = statusOf(activeSpeaker),
                                    fit = RendererCommon.ScalingType.SCALE_ASPECT_FILL,
                                    modifier = Modifier.fillMaxSize(),
                                )

                                // Filmstrip of other participants at bottom
                                LazyRow(
                                    modifier = Modifier
                                        .align(Alignment.BottomCenter)
                                        .fillMaxWidth()
                                        .padding(bottom = 104.dp),
                                    contentPadding = PaddingValues(horizontal = 12.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    items(others, key = { it.peer.peerId }) { participant ->
                                        Box(
                                            modifier = Modifier
                                                .width(85.dp)
                                                .height(115.dp)
                                                .shadow(6.dp, RoundedCornerShape(12.dp)),
                                        ) {
                                            CallTile(
                                                label = participant.peer.username,
                                                id = participant.peer.userId,
                                                track = participant.video,
                                                eglContext = engine.eglBase.eglBaseContext,
                                                muted = !participant.micEnabled,
                                                speaking = participant.speaking,
                                                connected = participant.connected,
                                                status = statusOf(participant),
                                                isCompact = true,
                                                fit = RendererCommon.ScalingType.SCALE_ASPECT_FILL,
                                                modifier = Modifier.fillMaxSize(),
                                            )
                                        }
                                    }
                                }

                                // Local self in PiP
                                FloatingPipTile(
                                    label = "${self.label} (you)",
                                    id = self.id,
                                    track = localVideo,
                                    speaking = selfSpeaking,
                                    eglContext = engine.eglBase.eglBaseContext,
                                    muted = muted,
                                    onFlipCamera = {
                                        if (cameraOn) engine.switchCamera()
                                    },
                                    modifier = Modifier
                                        .align(Alignment.TopEnd)
                                        .padding(top = 68.dp, end = 14.dp),
                                )
                            }
                        }
                    }
                }
            }
        }

        // --- TOP TRANSLUCENT HEADER BAR ---
        // Nothing but the picture fits in a PiP window.
        if (!inPip) Row(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .background(
                    Brush.verticalGradient(
                        colors = listOf(Color.Black.copy(alpha = 0.85f), Color.Transparent),
                    ),
                )
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(38.dp)
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.45f))
                    .border(1.dp, Color.White.copy(alpha = 0.15f), CircleShape)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = leaveScreen,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                BetweenUsIcon(BetweenUsIcons.ChevronLeft, tint = Slate100, size = 20.dp)
            }

            Spacer(Modifier.width(12.dp))

            Column(Modifier.weight(1f)) {
                Text(
                    text = channel?.name ?: "Voice Call",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = Slate50,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = when (val current = state) {
                        VoiceEngine.CallState.Idle -> "Not connected"
                        is VoiceEngine.CallState.Connecting -> "Connecting…"
                        is VoiceEngine.CallState.Live -> when {
                            // Said before the head count, because it is the
                            // thing that explains everything else on screen.
                            !signalling -> "Reconnecting to the call server…"
                            participants.any { it.reconnecting } -> "Reconnecting…"
                            else -> "${participants.size + 1} in call · E2EE"
                        }
                        is VoiceEngine.CallState.Failed -> current.reason
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = when {
                        state is VoiceEngine.CallState.Failed -> Danger
                        state is VoiceEngine.CallState.Live && !signalling -> Amber200
                        else -> Slate400
                    },
                )
            }

            if (isInCall) {
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(Color.Black.copy(alpha = 0.45f))
                        .border(1.dp, Color.White.copy(alpha = 0.15f), CircleShape)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = { pickingDevices = true },
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    BetweenUsIcon(BetweenUsIcons.Speaker, tint = Slate100, size = 18.dp)
                }
            }
        }

        // Problem alert banner
        if (!inPip) problem?.let {
            Notice(
                it,
                Danger,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 64.dp, start = 12.dp, end = 12.dp),
            )
        }

        // --- FLOATING BOTTOM ACTION BAR (WhatsApp style) ---
        if (isInCall && !inPip) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 20.dp),
            ) {
                Row(
                    modifier = Modifier
                        .shadow(16.dp, RoundedCornerShape(36.dp))
                        .clip(RoundedCornerShape(36.dp))
                        .background(Color(0xFF131824).copy(alpha = 0.92f))
                        .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(36.dp))
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // 1. Flip Camera (visible when camera is on)
                    AnimatedVisibility(visible = cameraOn, enter = fadeIn(), exit = fadeOut()) {
                        CallCircleButton(
                            icon = BetweenUsIcons.RotateRight,
                            contentDescription = "Flip camera (${if (isFrontCamera) "Front" else "Back"})",
                            active = false,
                            tint = Slate100,
                            size = 46.dp,
                            onClick = { engine.switchCamera() },
                        )
                    }

                    // 2. Camera Toggle
                    CallCircleButton(
                        icon = if (cameraOn) BetweenUsIcons.Video else BetweenUsIcons.VideoOff,
                        contentDescription = if (cameraOn) "Turn camera off" else "Turn camera on",
                        active = cameraOn,
                        activeColor = Accent,
                        tint = if (cameraOn) Color.White else Slate400,
                        size = 48.dp,
                        onClick = { if (cameraOn) engine.stopVideo() else camera.request() },
                    )

                    // 3. Microphone Toggle
                    CallCircleButton(
                        icon = if (muted) BetweenUsIcons.MicOff else BetweenUsIcons.Mic,
                        contentDescription = if (muted) "Unmute" else "Mute",
                        active = muted,
                        activeColor = Danger.copy(alpha = 0.25f),
                        tint = if (muted) Danger else Color.White,
                        size = 52.dp,
                        onClick = engine::toggleMute,
                    )

                    // 4. Screen Share Toggle
                    CallCircleButton(
                        icon = BetweenUsIcons.ScreenShare,
                        contentDescription = when {
                            sharing -> "Stop sharing"
                            screenHolder != null -> "Take over screen"
                            else -> "Share screen"
                        },
                        active = sharing,
                        activeColor = Accent,
                        tint = if (sharing) Color.White else Slate400,
                        size = 48.dp,
                        onClick = {
                            if (sharing) {
                                engine.stopVideo()
                            } else {
                                val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE)
                                    as MediaProjectionManager
                                projection.launch(manager.createScreenCaptureIntent())
                            }
                        },
                    )

                    // 5. Connection - what the link is doing, in numbers. The
                    // one thing a phone in a bad call has no other way to find
                    // out, since there is no webrtc-internals to open.
                    CallCircleButton(
                        icon = BetweenUsIcons.Activity,
                        contentDescription = "Connection",
                        active = showingConnection,
                        activeColor = Accent,
                        tint = if (linkHealth != null) Danger else Slate400,
                        size = 48.dp,
                        onClick = { showingConnection = true },
                    )

                    // 6. Leave Call (Prominent Red Button)
                    Box(
                        modifier = Modifier
                            .size(54.dp)
                            .clip(CircleShape)
                            .background(Danger)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                                onClick = { engine.leave(); onBack() },
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        BetweenUsIcon(
                            BetweenUsIcons.Phone,
                            tint = Color.White,
                            size = 22.dp,
                            contentDescription = "Leave call",
                        )
                    }
                }
            }
        }
    }

    if (pickingDevices) CallDeviceSheet(onDismiss = { pickingDevices = false })
}

/**
 * Circular action button for the modern bottom floating call bar.
 */
@Composable
private fun CallCircleButton(
    icon: Int,
    contentDescription: String,
    active: Boolean = false,
    activeColor: Color = Surface800,
    tint: Color = Slate100,
    size: androidx.compose.ui.unit.Dp = 48.dp,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .background(if (active) activeColor else Surface800.copy(alpha = 0.7f))
            .border(1.dp, Color.White.copy(alpha = 0.1f), CircleShape)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        BetweenUsIcon(icon, tint = tint, size = 20.dp, contentDescription = contentDescription)
    }
}

private val PIP_WIDTH = 108.dp
private val PIP_HEIGHT = 154.dp

/**
 * Floating Picture-in-Picture (PiP) card showing the user's camera/avatar.
 */
@Composable
private fun FloatingPipTile(
    label: String,
    id: String,
    track: VideoTrack?,
    eglContext: org.webrtc.EglBase.Context,
    muted: Boolean,
    onFlipCamera: () -> Unit,
    modifier: Modifier = Modifier,
    speaking: Boolean = false,
) {
    // Dragged anywhere on the stage, the way every other phone does it. The
    // tile is laid out at the top-right, so the offset runs left and down from
    // there and is clamped to what is left of the screen.
    // ponytail: free drag, no snap-to-corner. Add one if it feels loose.
    val metrics = LocalConfiguration.current
    var drag by remember { mutableStateOf(Offset.Zero) }
    val slackX = with(LocalDensity.current) { (metrics.screenWidthDp.dp - PIP_WIDTH - 28.dp).toPx() }
    val slackY = with(LocalDensity.current) { (metrics.screenHeightDp.dp - PIP_HEIGHT - 160.dp).toPx() }

    Box(
        modifier = modifier
            .offset { IntOffset(drag.x.roundToInt(), drag.y.roundToInt()) }
            .pointerInput(Unit) {
                detectDragGestures { change, moved ->
                    change.consume()
                    drag = Offset(
                        (drag.x + moved.x).coerceIn(-slackX.coerceAtLeast(0f), 0f),
                        (drag.y + moved.y).coerceIn(0f, slackY.coerceAtLeast(0f)),
                    )
                }
            }
            .width(PIP_WIDTH)
            .height(PIP_HEIGHT)
            .shadow(14.dp, RoundedCornerShape(18.dp))
            .clip(RoundedCornerShape(18.dp))
            .background(Surface900)
            // The same green every other tile uses, so "that one is talking"
            // reads the same whoever it is.
            .border(
                if (speaking) 2.5.dp else 1.5.dp,
                if (speaking) StatusOnline else Color.White.copy(alpha = 0.22f),
                RoundedCornerShape(18.dp),
            ),
    ) {
        if (track != null) {
            VideoSurface(
                track = track,
                eglContext = eglContext,
                overlay = true,
                mirror = true,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Avatar(id = id, label = label, url = null, size = 48.dp)
            }
        }

        // Bottom label pill
        Row(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(6.dp)
                .background(Color.Black.copy(alpha = 0.65f), RoundedCornerShape(8.dp))
                .padding(horizontal = 6.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = "You",
                style = MaterialTheme.typography.labelSmall,
                color = Slate100,
                fontSize = 10.sp,
                fontWeight = FontWeight.Medium,
            )
            if (muted) {
                BetweenUsIcon(BetweenUsIcons.MicOff, tint = Danger, size = 10.dp)
            }
        }

        // Quick flip button if video is active
        if (track != null) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(6.dp)
                    .size(24.dp)
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.55f))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = onFlipCamera,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                BetweenUsIcon(BetweenUsIcons.RotateRight, tint = Slate100, size = 12.dp)
            }
        }
    }
}

/**
 * What a tile says about a link that is not carrying anything.
 *
 * Null while everything is fine, which is almost always - a tile with a
 * permanent status line is a tile nobody reads.
 */
private fun statusOf(participant: VoiceEngine.Participant): String? = when {
    participant.lost -> "No connection"
    participant.reconnecting -> "Reconnecting…"
    else -> null
}

/**
 * Standard call participant tile with smooth video rendering, speaking ring,
 * frosted glass user badge, and muted indicators.
 */
@Composable
private fun CallTile(
    label: String,
    id: String,
    track: VideoTrack?,
    eglContext: org.webrtc.EglBase.Context,
    modifier: Modifier = Modifier,
    muted: Boolean = false,
    speaking: Boolean = false,
    connected: Boolean = true,
    /**
     * "Reconnecting…" or "No connection", when there is something to say.
     *
     * A greyed name was the only sign a link had died, which reads as somebody
     * being quiet rather than as somebody being gone.
     */
    status: String? = null,
    isLocal: Boolean = false,
    isCompact: Boolean = false,
    fit: RendererCommon.ScalingType = RendererCommon.ScalingType.SCALE_ASPECT_FILL,
    labelBottomPadding: Dp = 0.dp,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(if (isCompact) 12.dp else 18.dp))
            .background(Surface900)
            .then(
                if (speaking) {
                    Modifier.border(
                        2.5.dp,
                        StatusOnline,
                        RoundedCornerShape(if (isCompact) 12.dp else 18.dp),
                    )
                } else {
                    Modifier.border(
                        1.dp,
                        Edge,
                        RoundedCornerShape(if (isCompact) 12.dp else 18.dp),
                    )
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (track != null) {
            VideoSurface(
                track = track,
                eglContext = eglContext,
                fit = fit,
                overlay = isLocal,
                mirror = isLocal,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Avatar(
                id = id,
                label = label,
                url = null,
                size = if (isCompact) 36.dp else 72.dp,
            )
        }

        // Overlay participant name & status pill
        Row(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(if (isCompact) 4.dp else 10.dp)
                .padding(bottom = labelBottomPadding)
                .background(
                    Color.Black.copy(alpha = 0.65f),
                    RoundedCornerShape(if (isCompact) 6.dp else 8.dp),
                )
                .padding(
                    horizontal = if (isCompact) 5.dp else 8.dp,
                    vertical = if (isCompact) 2.dp else 4.dp,
                ),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = if (status != null) "$label · $status" else label,
                style = if (isCompact) MaterialTheme.typography.labelSmall else MaterialTheme.typography.bodySmall,
                color = if (connected) Slate100 else Slate500,
                fontSize = if (isCompact) 10.sp else 12.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (muted) {
                BetweenUsIcon(
                    icon = BetweenUsIcons.MicOff,
                    tint = Danger,
                    size = if (isCompact) 10.dp else 13.dp,
                )
            }
            if (!connected) {
                Text(
                    text = "connecting…",
                    style = MaterialTheme.typography.labelSmall,
                    color = Slate500,
                    fontSize = if (isCompact) 9.sp else 11.sp,
                )
            }
        }

        // Online status dot
        if (connected && track == null) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(if (isCompact) 4.dp else 8.dp)
                    .background(StatusOnline, CircleShape)
                    .size(if (isCompact) 6.dp else 8.dp),
            )
        }
    }
}
