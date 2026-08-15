package com.aktech.nexora.feature.voice

import android.app.Activity
import android.content.Context
import android.media.projection.MediaProjectionManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.aktech.nexora.core.data.PublicUser
import com.aktech.nexora.core.store.Workspace
import com.aktech.nexora.feature.settings.NexoraPermissions
import com.aktech.nexora.feature.settings.rememberPermission
import com.aktech.nexora.feature.settings.rememberPermissions
import com.aktech.nexora.ui.components.Avatar
import com.aktech.nexora.ui.components.EmptyState
import com.aktech.nexora.ui.components.IconAction
import com.aktech.nexora.ui.components.NexoraButton
import com.aktech.nexora.ui.components.Notice
import com.aktech.nexora.ui.theme.Accent
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Edge
import com.aktech.nexora.ui.theme.Ground
import com.aktech.nexora.ui.theme.Slate100
import com.aktech.nexora.ui.theme.Slate400
import com.aktech.nexora.ui.theme.Slate50
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.StatusOnline
import com.aktech.nexora.ui.components.NexoraIcons
import com.aktech.nexora.ui.theme.Surface900
import com.aktech.nexora.ui.theme.Surface950
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/**
 * A voice or video call.
 *
 * The microphone is asked for here and nowhere else: at the moment somebody
 * taps join, which is the only moment the request means anything. Refusing it
 * leaves the screen saying so rather than appearing to do nothing.
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
    // The call belongs to the process, not to this composable. A rotation, a
    // navigation, or the activity being rebuilt used to take the call with it.
    val engine = remember { VoiceEngine.of(context) }

    val state by engine.state.collectAsState()
    val participants by engine.participants.collectAsState()
    val muted by engine.muted.collectAsState()
    val cameraOn by engine.cameraOn.collectAsState()
    val sharing by engine.sharing.collectAsState()
    val localVideo by engine.localVideo.collectAsState()
    val problem by engine.problem.collectAsState()

    val channel = channelId?.let { Workspace.channel(it) }

    // Somebody else's screen takes the whole display: a share is usually text,
    // and text in a quarter of a phone is not text. Closing the stage goes back
    // to the grid and is remembered, so it does not reopen on the next poll -
    // only a share that stops and starts again does that.
    val watching = participants.firstOrNull { it.screen != null }
    var dismissed by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(watching?.peer?.peerId) {
        if (watching == null) dismissed = null
    }

    // The microphone is the one that decides whether the call happens.
    // Notifications are asked for in the same breath because a call runs as a
    // foreground service and the notification is how anyone gets back to it -
    // but refusing them is not a reason to refuse the call.
    val microphone = rememberPermissions(
        permissions = listOfNotNull(NexoraPermissions.MICROPHONE, NexoraPermissions.NOTIFICATIONS),
        required = NexoraPermissions.MICROPHONE,
    ) {
        channelId?.let { engine.join(it) }
    }
    val camera = rememberPermission(NexoraPermissions.CAMERA) { engine.startCamera() }

    // Tapping a voice channel is the decision to join it. Landing on a screen
    // with a button that asks the same question again is asking twice - the
    // permission prompt is the only thing that still has to be asked, and it
    // only appears the first time.
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
            track = watching.screen!!,
            participants = participants.filterNot { it.peer.peerId == watching.peer.peerId },
            self = self.label,
            selfId = self.id,
            eglContext = engine.eglBase.eglBaseContext,
            muted = muted,
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
            onLeave = { engine.leave(); onBack() },
            onClose = { dismissed = watching.peer.peerId },
        )
        return
    }

    Column(Modifier.fillMaxSize().background(Ground).systemBarsPadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().background(Surface950).padding(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(NexoraIcons.ChevronLeft, "Back", onBack)
            Column(Modifier.weight(1f).padding(start = 8.dp)) {
                Text(
                    text = channel?.name ?: "Call",
                    style = MaterialTheme.typography.titleMedium,
                    color = Slate50,
                )
                Text(
                    text = when (val current = state) {
                        VoiceEngine.CallState.Idle -> "Not connected"
                        is VoiceEngine.CallState.Connecting -> "Connecting…"
                        is VoiceEngine.CallState.Live ->
                            "${participants.size + 1} in the room · peer to peer"
                        is VoiceEngine.CallState.Failed -> current.reason
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = if (state is VoiceEngine.CallState.Failed) Danger else Slate500,
                )
            }
        }
        HorizontalDivider(color = Edge)

        // One peer failing is one tile, not the call - but a tile that silently
        // never carries anything is indistinguishable from a working one, which
        // is exactly how a mesh that negotiated nothing went unnoticed.
        problem?.let {
            Notice(it, Danger, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
        }

        Box(Modifier.weight(1f)) {
            when {
                channelId == null -> EmptyState(
                    icon = NexoraIcons.Speaker,
                    title = "No channel",
                    detail = "Pick a voice channel from the drawer first.",
                    modifier = Modifier.align(Alignment.Center),
                )

                state is VoiceEngine.CallState.Idle ||
                    state is VoiceEngine.CallState.Failed -> Column(
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        text = "Voice and video go directly between the people in the call. " +
                            "Nothing passes through the server.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Slate400,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(16.dp))
                    (state as? VoiceEngine.CallState.Failed)?.let {
                        Notice(it.reason, Danger)
                        Spacer(Modifier.height(12.dp))
                    }
                    if (microphone.refused) {
                        Notice(
                            "Nexora cannot use the microphone. Android will not ask again from here.",
                            Danger,
                        )
                        Spacer(Modifier.height(12.dp))
                        NexoraButton("Open app settings", onClick = { microphone.openSettings() })
                    } else {
                        NexoraButton(
                            text = if (state is VoiceEngine.CallState.Failed) "Try again" else "Join the call",
                            onClick = { microphone.request() },
                        )
                    }
                }

                else -> LazyVerticalGrid(
                    columns = GridCells.Fixed(if (participants.size > 1) 2 else 1),
                    modifier = Modifier.fillMaxSize().padding(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    item {
                        Tile(
                            label = "${self.label} (you)",
                            id = self.id,
                            track = localVideo,
                            eglContext = engine.eglBase.eglBaseContext,
                            muted = muted,
                        )
                    }
                    items(participants, key = { it.peer.peerId }) { participant ->
                        Tile(
                            label = participant.peer.username,
                            id = participant.peer.userId,
                            track = participant.video,
                            eglContext = engine.eglBase.eglBaseContext,
                            muted = !participant.micEnabled,
                            speaking = participant.speaking,
                            connected = participant.connected,
                        )
                    }
                }
            }
        }

        if (state is VoiceEngine.CallState.Connecting || state is VoiceEngine.CallState.Live) {
            HorizontalDivider(color = Edge)
            Row(
                modifier = Modifier.fillMaxWidth().background(Surface950).padding(8.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconAction(
                    icon = if (muted) NexoraIcons.MicOff else NexoraIcons.Mic,
                    contentDescription = if (muted) "Unmute" else "Mute",
                    tint = if (muted) Danger else Slate100,
                    onClick = engine::toggleMute,
                )
                IconAction(
                    icon = if (cameraOn) NexoraIcons.Video else NexoraIcons.VideoOff,
                    contentDescription = if (cameraOn) "Turn the camera off" else "Turn the camera on",
                    tint = if (cameraOn) Accent else Slate400,
                    onClick = { if (cameraOn) engine.stopVideo() else camera.request() },
                )
                IconAction(
                    icon = NexoraIcons.ScreenShare,
                    contentDescription = if (sharing) "Stop sharing" else "Share the screen",
                    tint = if (sharing) Accent else Slate400,
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
                IconAction(
                    icon = NexoraIcons.Phone,
                    contentDescription = "Leave the call",
                    tint = Danger,
                    onClick = { engine.leave(); onBack() },
                )
            }
        }
    }
}

/** One participant's tile: their video if they are sending any, else a face. */
@Composable
private fun Tile(
    label: String,
    id: String,
    track: VideoTrack?,
    eglContext: org.webrtc.EglBase.Context,
    muted: Boolean = false,
    speaking: Boolean = false,
    connected: Boolean = true,
) {
    Box(
        modifier = Modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(14.dp))
            .background(Surface900)
            .then(
                // The ring is the only thing that says who is talking when
                // nobody has a camera on, which is most calls from a phone.
                if (speaking) Modifier.border(2.dp, StatusOnline, RoundedCornerShape(14.dp))
                else Modifier,
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (track != null) {
            AndroidView(
                factory = { context ->
                    SurfaceViewRenderer(context).apply {
                        init(eglContext, null)
                        setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                        setEnableHardwareScaler(true)
                        track.addSink(this)
                    }
                },
                onRelease = { renderer ->
                    track.removeSink(renderer)
                    renderer.release()
                },
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Avatar(id = id, label = label, url = null, size = 64.dp)
        }

        Row(
            modifier = Modifier.align(Alignment.BottomStart).padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodySmall,
                color = if (connected) Slate100 else Slate500,
            )
            if (muted) {
                com.aktech.nexora.ui.components.NexoraIcon(
                    icon = NexoraIcons.MicOff,
                    tint = Danger,
                    size = 14.dp,
                )
            }
            if (!connected) {
                Text(
                    text = "connecting…",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate500,
                )
            }
        }

        if (connected && track == null) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp)
                    .background(StatusOnline, RoundedCornerShape(999.dp))
                    .padding(3.dp),
            )
        }
    }
}
