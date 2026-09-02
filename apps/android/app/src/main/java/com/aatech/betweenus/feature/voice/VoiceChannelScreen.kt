package com.aatech.betweenus.feature.voice

import android.app.Activity
import android.content.Context
import android.media.projection.MediaProjectionManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.systemBarsIgnoringVisibility
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilledIconToggleButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.FloatingToolbarDefaults
import androidx.compose.material3.HorizontalFloatingToolbar
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.layout.findRootCoordinates
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.toSize
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
import com.aatech.betweenus.ui.theme.BetweenUsMotion
import com.aatech.betweenus.ui.theme.Neutral99
import com.aatech.betweenus.ui.theme.Red60
import com.aatech.betweenus.ui.theme.StatusOnline
import com.aatech.betweenus.ui.theme.Surface800
import com.aatech.betweenus.ui.theme.Surface900
import com.aatech.betweenus.ui.theme.Surface950
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.webrtc.RendererCommon
import org.webrtc.VideoTrack
import kotlin.math.roundToInt

/**
 * How long the header and the control dock stay up with nothing happening.
 *
 * Long enough to find a button that has just appeared, short enough that a
 * call left alone is the picture and nothing else.
 */
private const val CHROME_IDLE_MS = 4_000L

/**
 * What the pin holds when the pinned tile is your own camera.
 *
 * The local tile has no peer id - it is not a peer - so it needs a name of its
 * own to be pinnable by the same one piece of state as everybody else.
 */
private const val SELF_PIN = "self"

/**
 * A WhatsApp/modern-style voice & video call screen.
 *
 * Designed with adaptive layouts (no vertical scrolling in calls):
 * - 1-on-1: Remote peer fills the screen with local self-view in a floating PiP card.
 * - 2-4 remote: a grid of the other people, self still floating over it.
 * - 5+ remote, or anybody pinned: one face on the stage with the rest in a
 *   thumbnail strip along the bottom.
 * - Floating glassmorphic control dock with camera flip, mute, video, share, speaker, and end call.
 *
 * Two rules run through all of it:
 *
 * - **The stage is the other people.** Your own camera is a small floating
 *   window, never a grid cell - you are not in the call to watch yourself.
 * - **Nothing moves on its own.** The unpinned stage follows the last speaker
 *   stickily rather than the current one, so a conversation does not throw the
 *   layout around between sentences. A pin fixes it outright.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun VoiceChannelScreen(
    channelId: String?,
    self: PublicUser,
    joinOnArrival: Boolean = false,
    onJoined: () -> Unit = {},
    onBack: () -> Unit,
    isTwoPane: Boolean = false,
    isFullscreen: Boolean = false,
    onToggleFullscreen: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    val engine = remember { VoiceEngine.of(context) }

    val state by engine.state.collectAsState()
    val participants by engine.participants.collectAsState()
    val muted by engine.muted.collectAsState()
    val cameraOn by engine.cameraOn.collectAsState()
    val sharing by engine.sharing.collectAsState()
    val screenHolder by engine.screenHolder.collectAsState()
    val localVideo by engine.localVideo.collectAsState()
    // Your own microphone, so the green ring is not something that only ever
    // happens to other people.
    val selfSpeaking by engine.selfSpeaking.collectAsState()
    val talking by engine.talking.collectAsState()
    /**
     * Read on composition rather than held: it is changed on the settings
     * screen, which this one is recomposed after returning from. Nothing about
     * the audio depends on this value - the engine reads the preference itself
     * every time it decides - so the worst this can be is a button that appears
     * a frame late.
     */
    val pushToTalk = AudioPrefs.pushToTalk
    val linkStats by engine.stats.collectAsState()
    val signalling by engine.signalling.collectAsState()
    val problem by engine.problem.collectAsState()
    val interruption by engine.interruption.collectAsState()

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

    // A talk control that is held while the screen goes away is a microphone
    // nobody can close: the release never arrives, because the thing that would
    // have reported it is gone. This is the phone's version of the desktop
    // closing it on window blur, and it is the failure that makes people stop
    // trusting push to talk.
    DisposableEffect(engine) {
        onDispose { engine.setTalking(false) }
    }

    // Coming back to the call after a phone call is the moment to ask for the
    // audio again. A transient loss resumes itself; a permanent one has no
    // "gain" coming, and without this the call stays silently on hold. The
    // reclaim is a no-op unless the loss was permanent, so this cannot take the
    // audio off a cellular call still in progress.
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) CallAudio.reclaimFocus()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }

    // Back is back. It leaves the call *screen* and not the call, which is what
    // the strip along the top and the floating window are for - see
    // `CallDock.kt`.
    //
    // It used to shrink the whole activity into system picture-in-picture,
    // which answered "I want to leave this screen" with "then leave the app".
    // That is the wrong shape for the thing people actually do in the middle of
    // a call, which is read the conversation the call is about: there is no
    // channel list inside a hundred-point window, and coming back out of one
    // landed on the drawer rather than on the call. Picture-in-picture is still
    // here, and it is now what *leaving the app* does - see
    // `MainActivity.onUserLeaveHint`.
    val inPip = rememberInPictureInPicture()
    val leaveScreen = onBack

    // Who the little window shows: whoever spoke last, and never yourself.
    //
    // A picture-in-picture window is one tile's worth of room, and the one tile
    // worth giving it is the person talking - your own camera is the one face
    // in the call you are not there to watch. Sticky, because a call is mostly
    // gaps: falling back to somebody else between two sentences would make the
    // window flick between faces for the whole conversation.
    var lastSpeaker by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(participants) {
        participants.firstOrNull { it.speaking }?.let { lastSpeaker = it.peer.peerId }
    }
    val pipTile = participants.firstOrNull { it.peer.peerId == lastSpeaker }
        ?: participants.firstOrNull { it.video != null }
        ?: participants.firstOrNull()

    // Pinned by hand: "keep showing me that one". One viewer's decision -
    // nobody else's stage moves - and it is dropped the moment they leave,
    // because a pin on somebody who hung up would hold an empty stage.
    var pinned by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(participants) {
        val stillHere = pinned == SELF_PIN || participants.any { it.peer.peerId == pinned }
        if (pinned != null && !stillHere) pinned = null
    }
    val pinnedPeer = participants.firstOrNull { it.peer.peerId == pinned }
    val selfPinned = pinned == SELF_PIN

    val watching = participants.firstOrNull { it.visibleScreen != null }
    var dismissed by remember { mutableStateOf<String?>(null) }
    var pickingDevices by remember { mutableStateOf(false) }
    var showingConnection by remember { mutableStateOf(false) }
    // "Who else should be here" is a thought somebody has while looking at a
    // call with two people in it, so the way to act on it is in the call.
    var inviting by remember { mutableStateOf(false) }

    // The header and the dock get out of the way on their own, and a tap
    // anywhere on the stage brings them back - the same gesture the share
    // stage already uses, and what every other call app does with a video
    // filling the screen.
    var chrome by remember { mutableStateOf(true) }
    // Bumped by a tap, so asking for the chrome back restarts the countdown
    // even though `chrome` was already true.
    var woken by remember { mutableStateOf(0) }

    // Worked out once here rather than twice: it tints the button that opens
    // the sheet as well as heading the sheet itself, so a bad link is visible
    // without opening anything.
    val linkHealth = CallStats.healthWarning(linkStats)

    LaunchedEffect(watching?.peer?.peerId) {
        if (watching == null) dismissed = null
    }

    // Anything the user might be reading or reaching for pins the chrome open:
    // a sheet on top of it, a problem to explain, or a control they have just
    // pressed - the toggles are keys here, so pressing one restarts the
    // countdown without every button having to say so.
    LaunchedEffect(
        chrome, woken, inCallNow, pickingDevices, showingConnection, inviting, problem,
        muted, cameraOn, sharing,
    ) {
        if (!inCallNow || pickingDevices || showingConnection || inviting || problem != null) {
            chrome = true
            return@LaunchedEffect
        }
        if (!chrome) return@LaunchedEffect
        delay(CHROME_IDLE_MS)
        chrome = false
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
            isTwoPane = isTwoPane,
            isFullscreen = isFullscreen,
            onToggleFullscreen = onToggleFullscreen,
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
        if (inviting && channelId != null) {
            InviteToCallSheet(
                channelId = channelId,
                channelName = channel?.name ?: "the call",
                serverId = channel?.serverId,
                selfId = self.id,
                inCall = participants.map { it.peer.userId }.toSet() + self.id,
                onDismiss = { inviting = false },
            )
        }
        return
    }

    val isInCall = inCallNow

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0B0D12))
            // `systemBarsIgnoringVisibility`, not `systemBarsPadding`. A call
            // hides the bars, which takes the insets to zero - so the padding
            // vanished and the header slid up under a status bar that is still
            // drawn over us the moment it comes back on a swipe, or never went
            // away at all on a device that refuses to hide it. The size the
            // bars have when they are visible is the size to keep clear.
            .windowInsetsPadding(WindowInsets.systemBarsIgnoringVisibility),
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
                //
                // The tap that brings the chrome back is on the stage rather
                // than on a layer over it: the tiles do not consume taps, and
                // the PiP tile and the dock do, so a drag or a button press is
                // still theirs.
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .pointerInput(Unit) {
                            detectTapGestures {
                                chrome = !chrome
                                woken++
                            }
                        },
                ) {
                    when {
                        // Picture-in-picture: one tile, and it is whoever is
                        // talking. No self-view, no filmstrip, no chrome -
                        // there is no room for any of it, and a thumbnail of
                        // your own face is the least useful thing to spend the
                        // window on. See `pipTile`.
                        inPip -> {
                            val shown = pipTile
                            if (shown != null) {
                                CallTile(
                                    label = shown.peer.username,
                                    id = shown.peer.userId,
                                    track = shown.video,
                                    eglContext = engine.eglBase.eglBaseContext,
                                    muted = !shown.micEnabled,
                                    speaking = shown.speaking,
                                    connected = shown.connected,
                                    status = statusOf(shown),
                                    fit = RendererCommon.ScalingType.SCALE_ASPECT_FILL,
                                    modifier = Modifier.fillMaxSize(),
                                )
                            } else {
                                // Alone in the call, so your own camera is the
                                // only thing there is to show.
                                CallTile(
                                    label = self.label,
                                    id = self.id,
                                    track = localVideo,
                                    speaking = selfSpeaking,
                                    eglContext = engine.eglBase.eglBaseContext,
                                    muted = muted,
                                    isLocal = true,
                                    fit = RendererCommon.ScalingType.SCALE_ASPECT_FILL,
                                    modifier = Modifier.fillMaxSize(),
                                )
                            }
                        }

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
                                    // Clear of the dock, which is drawn over
                                    // the bottom of this tile.
                                    labelBottomPadding = if (chrome) 92.dp else 12.dp,
                                    modifier = Modifier.fillMaxSize(),
                                )
                                // Below the tile's centre, not on it. Both were
                                // centred, so this pill was drawn across the
                                // face it was talking about.
                                Box(
                                    modifier = Modifier
                                        .align(Alignment.Center)
                                        .padding(top = 116.dp)
                                        .background(
                                            MaterialTheme.colorScheme.surfaceContainerHighest,
                                            MaterialTheme.shapes.extraLarge,
                                        )
                                        .padding(horizontal = 20.dp, vertical = 12.dp),
                                ) {
                                    Text(
                                        text = "Waiting for others to join…",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }

                        // 1-on-1 Call: Remote fills screen, Local in floating PiP
                        !selfPinned && pinnedPeer == null && participants.size == 1 -> {
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
                                onPin = { pinned = remote.peer.peerId },
                                // Clear of the floating dock, which is drawn
                                // over the bottom of this tile - but only while
                                // the dock is there. Held up against nothing,
                                // the name floated in the middle of somebody's
                                // chest instead of sitting where a caption
                                // sits.
                                labelBottomPadding = if (chrome) 92.dp else 12.dp,
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
                                chrome = chrome,
                                onFlipCamera = {
                                    if (cameraOn) engine.switchCamera()
                                },
                                onPin = { pinned = SELF_PIN },
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .padding(top = 68.dp, end = 14.dp),
                            )
                        }

                        // 2-4 Remote Participants: a grid that keeps each
                        // tile close to the shape of a person.
                        //
                        // The old layout gave every tile an equal share of the
                        // stage and let it stretch: two people side by side on
                        // a portrait phone came out as a pair of bookmarks,
                        // mostly empty, with a face stranded in the middle of
                        // each. `CallGrid` picks the column count from the
                        // stage shape and caps how tall a tile may go.
                        !selfPinned && pinnedPeer == null && participants.size in 2..4 -> {
                            // The grid is the other people, whatever the count.
                            // Your own camera used to fill the odd cell of a
                            // 2x2 when there were three of them, which spent a
                            // quarter of the stage on the one face in the call
                            // nobody is there to watch; it floats now, the same
                            // as every other count.
                            CallGrid(
                                count = participants.size,
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(top = 64.dp, bottom = 96.dp, start = 8.dp, end = 8.dp),
                            ) { index, tileModifier ->
                                val participant = participants[index]
                                CallTile(
                                    label = participant.peer.username,
                                    id = participant.peer.userId,
                                    track = participant.video,
                                    eglContext = engine.eglBase.eglBaseContext,
                                    muted = !participant.micEnabled,
                                    speaking = participant.speaking,
                                    connected = participant.connected,
                                    status = statusOf(participant),
                                    onPin = { pinned = participant.peer.peerId },
                                    modifier = tileModifier,
                                )
                            }

                            FloatingPipTile(
                                label = "${self.label} (you)",
                                id = self.id,
                                track = localVideo,
                                speaking = selfSpeaking,
                                eglContext = engine.eglBase.eglBaseContext,
                                muted = muted,
                                chrome = chrome,
                                onFlipCamera = {
                                    if (cameraOn) engine.switchCamera()
                                },
                                onPin = { pinned = SELF_PIN },
                                modifier = Modifier
                                    .align(Alignment.BottomEnd)
                                    .padding(bottom = if (chrome) 84.dp else 16.dp, end = 14.dp),
                            )
                        }

                        // Somebody pinned, or too many for a grid: one face
                        // on the stage and everybody else in a strip along the
                        // bottom.
                        //
                        // With nobody pinned the stage goes to whoever spoke
                        // last and *stays* there - the same sticky choice the
                        // picture-in-picture window makes, see `pipTile`.
                        // Handing it to whoever is speaking this instant threw
                        // the stage back and forth across every "mm-hm" in a
                        // conversation, which is what this screen was being
                        // told off for.
                        else -> {
                            val hero = if (selfPinned) null else pinnedPeer ?: pipTile
                            val others = participants.filterNot { it.peer.peerId == hero?.peer?.peerId }

                            Box(modifier = Modifier.fillMaxSize()) {
                                // The stage: the pinned face, the last speaker,
                                // or your own camera when you pinned yourself.
                                if (hero == null) {
                                    CallTile(
                                        label = "${self.label} (you)",
                                        id = self.id,
                                        track = localVideo,
                                        speaking = selfSpeaking,
                                        eglContext = engine.eglBase.eglBaseContext,
                                        muted = muted,
                                        isLocal = true,
                                        fit = RendererCommon.ScalingType.SCALE_ASPECT_FILL,
                                        labelBottomPadding = if (chrome) 92.dp else 12.dp,
                                        pinned = selfPinned,
                                        onPin = { pinned = if (selfPinned) null else SELF_PIN },
                                        modifier = Modifier.fillMaxSize(),
                                    )
                                } else {
                                    CallTile(
                                        label = hero.peer.username,
                                        id = hero.peer.userId,
                                        track = hero.video,
                                        eglContext = engine.eglBase.eglBaseContext,
                                        muted = !hero.micEnabled,
                                        speaking = hero.speaking,
                                        connected = hero.connected,
                                        status = statusOf(hero),
                                        labelBottomPadding = if (chrome) 92.dp else 12.dp,
                                        pinned = pinnedPeer != null,
                                        onPin = {
                                            pinned = if (pinnedPeer != null) null else hero.peer.peerId
                                        },
                                        modifier = Modifier.fillMaxSize(),
                                    )
                                }

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
                                                onPin = { pinned = participant.peer.peerId },
                                                modifier = Modifier.fillMaxSize(),
                                            )
                                        }
                                    }
                                }

                                // Local self in PiP - unless it is already on
                                // the stage, where a second copy of your own
                                // face is the last thing anybody needs.
                                if (!selfPinned) {
                                    FloatingPipTile(
                                        label = "${self.label} (you)",
                                        id = self.id,
                                        track = localVideo,
                                        speaking = selfSpeaking,
                                        eglContext = engine.eglBase.eglBaseContext,
                                        muted = muted,
                                        chrome = chrome,
                                        onFlipCamera = {
                                            if (cameraOn) engine.switchCamera()
                                        },
                                        onPin = { pinned = SELF_PIN },
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
        }

        // --- TOP TRANSLUCENT HEADER BAR ---
        // Nothing but the picture fits in a PiP window, and nothing at all
        // once the chrome has gone quiet.
        AnimatedVisibility(
            visible = !inPip && chrome,
            // The same spring as the dock, in the opposite direction, so the
            // two halves of the chrome leave together rather than at their own
            // speeds.
            enter = fadeIn(BetweenUsMotion.effect()) +
                slideInVertically(BetweenUsMotion.spatial()) { -it },
            exit = fadeOut(BetweenUsMotion.effect()) +
                slideOutVertically(BetweenUsMotion.spatial()) { -it },
            modifier = Modifier.align(Alignment.TopCenter),
        ) {
            Row(
                modifier = Modifier
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
                    BetweenUsIcon(BetweenUsIcons.ChevronLeft, tint = Color(0xFFF1F5F9), size = 20.dp)
                }

                Spacer(Modifier.width(12.dp))

                Column(Modifier.weight(1f)) {
                    Text(
                        text = channel?.name ?: "Voice Call",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = Color(0xFFF8FAFC),
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
                            else -> Color(0xFF94A3B8)
                        },
                    )
                }

                if (isTwoPane && onToggleFullscreen != null) {
                    Box(
                        modifier = Modifier
                            .size(38.dp)
                            .clip(CircleShape)
                            .background(Color.Black.copy(alpha = 0.45f))
                            .border(1.dp, Color.White.copy(alpha = 0.15f), CircleShape)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                                onClick = onToggleFullscreen,
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        BetweenUsIcon(
                            icon = if (isFullscreen) BetweenUsIcons.Minimize else BetweenUsIcons.Maximize,
                            tint = if (isFullscreen) Accent else Color(0xFFF1F5F9),
                            size = 18.dp,
                            contentDescription = if (isFullscreen) "Exit full screen" else "Full screen",
                        )
                    }
                    Spacer(Modifier.width(8.dp))
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
                        BetweenUsIcon(BetweenUsIcons.Speaker, tint = Color(0xFFF1F5F9), size = 18.dp)
                    }
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

        // On hold: something else has the audio - a phone call, almost always.
        // The far end is told over the data channel and shows it on this
        // person's tile; this is the half they see themselves, and the button
        // is for the case the system never hands the audio back, which is what
        // a permanent focus loss is.
        if (!inPip && interruption == VoiceEngine.Interruption.HOLD) {
            Row(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 64.dp, start = 12.dp, end = 12.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Amber200.copy(alpha = 0.16f))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    text = "On hold - another call has the audio",
                    style = MaterialTheme.typography.bodySmall,
                    color = Amber200,
                )
                Text(
                    text = "Resume",
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold,
                    color = Slate50,
                    modifier = Modifier.clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = { CallAudio.reclaimFocus() },
                    ),
                )
            }
        }

        // --- the controls ---
        //
        // A floating toolbar, which is the expressive component for exactly
        // this: a dock of actions over content, with the one destructive
        // action held apart from the rest as a button attached to its end.
        //
        // That separation is the point. Leaving a call and muting yourself were
        // six identical circles in a row, and the difference between them was a
        // colour. Now the five that change a setting are toggles inside the bar
        // - filled when on, quiet when off, each squaring off under a finger -
        // and the one that ends the call is a red FAB outside it.
        //
        // It also solves the old arithmetic problem honestly. Six fixed buttons
        // and fixed gaps came to about 400dp, wider than the phone, so the bar
        // ran off the right-hand edge and took the hang-up button with it; the
        // toolbar measures itself.
        AnimatedVisibility(
            visible = isInCall && !inPip && chrome,
            // Down and away, not squeezed in from the sides. The toolbar's
            // own transitions expand it horizontally, which is right for a bar
            // that appears beside something and wrong for a dock that lives at
            // the bottom of the screen: hiding the chrome made the controls
            // concertina into their own middle.
            enter = fadeIn(BetweenUsMotion.effect()) +
                slideInVertically(BetweenUsMotion.spatial()) { it / 2 },
            exit = fadeOut(BetweenUsMotion.effect()) +
                slideOutVertically(BetweenUsMotion.spatial()) { it / 2 },
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = FloatingToolbarDefaults.ScreenOffset),
        ) {
            HorizontalFloatingToolbar(
                expanded = true,
                // Standard, not vibrant. Vibrant paints the whole dock in the
                // primary container, which over a dark call stage is a large
                // purple slab with grey icons on it - the controls were the
                // least legible thing on a screen they are the only thing to
                // touch. A dark container with light icons is what a dock over
                // a picture wants, and it leaves "on" somewhere to go.
                colors = FloatingToolbarDefaults.standardFloatingToolbarColors(),
                floatingActionButton = {
                    FloatingActionButton(
                        onClick = { engine.leave(); onBack() },
                        // A circle, and the one fixed colour in this app.
                        //
                        // The scheme's `error` role is a *light* red in a dark
                        // theme, which is correct for text on a dark surface and
                        // wrong for the only button on the screen that ends the
                        // call: it came out pale pink. Hanging up is a colour
                        // people already know, so it is spelled out - a strong
                        // red with a white handset - and it is round, because
                        // every phone anyone has held has a round one.
                        shape = CircleShape,
                        containerColor = Red60,
                        contentColor = Neutral99,
                    ) {
                        BetweenUsIcon(
                            BetweenUsIcons.Phone,
                            size = 24.dp,
                            contentDescription = "Leave call",
                        )
                    }
                },
            ) {
                // Flipping the camera is not here: it is on the self tile,
                // which is the thing being flipped, and is the only place it
                // means anything at all while the camera is off. Seven buttons
                // in a row on a phone is how each of them ends up too small and
                // too close to the next.

                CallToggle(
                    icon = if (cameraOn) BetweenUsIcons.Video else BetweenUsIcons.VideoOff,
                    contentDescription = if (cameraOn) "Turn camera off" else "Turn camera on",
                    checked = cameraOn,
                    onCheckedChange = { if (cameraOn) engine.stopVideo() else camera.request() },
                )

                // Muted is the one toggle whose "on" is a problem rather than a
                // feature, so it is the one that turns red.
                CallToggle(
                    icon = if (muted) BetweenUsIcons.MicOff else BetweenUsIcons.Mic,
                    contentDescription = if (muted) "Unmute" else "Mute",
                    checked = muted,
                    onCheckedChange = { engine.toggleMute() },
                    alarming = true,
                )

                // Only in that mode, and beside the mute button rather than
                // instead of it: the two say different things. Mute is whether
                // this client is in the call at all, and it outranks a held
                // thumb - see [PushToTalk].
                if (pushToTalk) {
                    TalkButton(
                        talking = talking,
                        onTalking = engine::setTalking,
                    )
                }

                CallToggle(
                    icon = BetweenUsIcons.ScreenShare,
                    contentDescription = when {
                        sharing -> "Stop sharing"
                        screenHolder != null -> "Take over screen"
                        else -> "Share screen"
                    },
                    checked = sharing,
                    onCheckedChange = {
                        if (sharing) {
                            engine.stopVideo()
                        } else {
                            val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE)
                                as MediaProjectionManager
                            projection.launch(manager.createScreenCaptureIntent())
                        }
                    },
                )

                // Add somebody to the call. The roster announcement tells the
                // channel a call is happening and rings nobody; this is the
                // aimed half, and the only way to reach it from a phone that is
                // showing a call rather than a member list.
                CallToggle(
                    icon = BetweenUsIcons.UserPlus,
                    contentDescription = "Add someone to the call",
                    checked = inviting,
                    onCheckedChange = { inviting = true },
                )

                // What the link is doing, in numbers. The one thing a phone in
                // a bad call has no other way to find out, since there is no
                // webrtc-internals to open - so an unhappy link says so here,
                // in the error colour, before anybody thinks to look.
                CallToggle(
                    icon = BetweenUsIcons.Activity,
                    contentDescription = "Connection",
                    checked = showingConnection,
                    onCheckedChange = { showingConnection = true },
                    alarming = linkHealth != null,
                )
            }
        }
    }

    if (pickingDevices) CallDeviceSheet(onDismiss = { pickingDevices = false })
    if (showingConnection) ConnectionSheet(linkStats) { showingConnection = false }
    if (inviting && channelId != null) {
        InviteToCallSheet(
            channelId = channelId,
            channelName = channel?.name ?: "the call",
            serverId = channel?.serverId,
            selfId = self.id,
            inCall = participants.map { it.peer.userId }.toSet() + self.id,
            onDismiss = { inviting = false },
        )
    }
}

/**
 * One control in the call toolbar.
 *
 * A toggle rather than a button, because every one of these is a setting that
 * is either on or off, and a control that looks the same in both states is the
 * reason people mute themselves twice. Checked fills it; unchecked leaves it
 * quiet; the shape set squares it off under a finger and springs it back.
 *
 * [alarming] is for the two states that are bad news rather than good - muted,
 * and a link that is struggling - and swaps the fill for the error colour.
 */
@Composable
private fun CallToggle(
    icon: Int,
    contentDescription: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    alarming: Boolean = false,
) {
    val scheme = MaterialTheme.colorScheme
    FilledIconToggleButton(
        checked = checked,
        onCheckedChange = onCheckedChange,
        shapes = IconButtonDefaults.toggleableShapes(),
        colors = IconButtonDefaults.filledIconToggleButtonColors(
            containerColor = Color.Transparent,
            contentColor = if (alarming && checked) scheme.error else scheme.onSurfaceVariant,
            checkedContainerColor = if (alarming) scheme.errorContainer else scheme.primary,
            checkedContentColor = if (alarming) scheme.onErrorContainer else scheme.onPrimary,
        ),
    ) {
        BetweenUsIcon(icon, size = 22.dp, contentDescription = contentDescription)
    }
}

/**
 * Hold to be heard.
 *
 * A press-and-hold rather than a toggle, which is the whole difference between
 * push to talk and a mute button: releasing has to close it, and so does the
 * system cancelling the gesture. `tryAwaitRelease` answers for both - it
 * returns true on a real release and false on a cancel - and the microphone is
 * closed either way, because the branch where it stays open is the one nobody
 * notices until they have been overheard.
 */
@Composable
private fun TalkButton(talking: Boolean, onTalking: (Boolean) -> Unit) {
    val scheme = MaterialTheme.colorScheme
    Box(
        modifier = Modifier
            .size(48.dp)
            .clip(CircleShape)
            .background(if (talking) scheme.primary else scheme.surfaceContainerHighest)
            .pointerInput(Unit) {
                detectTapGestures(
                    onPress = {
                        onTalking(true)
                        tryAwaitRelease()
                        onTalking(false)
                    },
                )
            }
            // Announced as a button with a label, because a Box carrying a
            // pointer handler is announced as nothing at all.
            .semantics {
                contentDescription = "Hold to talk"
                role = Role.Button
            },
        contentAlignment = Alignment.Center,
    ) {
        BetweenUsIcon(
            icon = BetweenUsIcons.Mic,
            size = 22.dp,
            tint = if (talking) scheme.onPrimary else scheme.onSurfaceVariant,
            contentDescription = null,
        )
    }
}

private val PIP_WIDTH = 108.dp
private val PIP_HEIGHT = 154.dp
private val PIP_CORNER = 18.dp

/**
 * How close a corner the PiP tile may get to the edge of the stage.
 *
 * Not four equal margins: the top of the stage is under the header bar and the
 * bottom is under the control dock, and a tile that snapped to the true corner
 * would settle underneath one of them.
 */
private val PIP_INSET_SIDE = 14.dp
private val PIP_INSET_TOP = 68.dp
private val PIP_INSET_BOTTOM = 84.dp

/**
 * Where the top-left of the PiP tile is allowed to be, in stage pixels.
 *
 * A rectangle of positions rather than of pixels: `left`/`top` is the tile
 * resting in the top-left corner and `right`/`bottom` is it resting in the
 * bottom-right, so the four corners of the result *are* the four places it can
 * settle. A stage too small for the insets collapses to one position rather
 * than to a backwards range.
 */
internal fun pipBounds(stage: Size, tile: Size, side: Float, top: Float, bottom: Float): Rect {
    val right = (stage.width - tile.width - side).coerceAtLeast(side)
    val floor = (stage.height - tile.height - bottom).coerceAtLeast(top)
    return Rect(side, top, right, floor)
}

/**
 * The corner of [bounds] the tile settles into from [position], its current
 * top-left: whichever quadrant of the stage its own centre is in.
 */
internal fun pipNearestCorner(bounds: Rect, stage: Size, tile: Size, position: Offset): Offset {
    val centre = position + Offset(tile.width / 2f, tile.height / 2f)
    return Offset(
        if (centre.x < stage.width / 2f) bounds.left else bounds.right,
        if (centre.y < stage.height / 2f) bounds.top else bounds.bottom,
    )
}

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
    chrome: Boolean = true,
    /** Tapped to put your own camera on the stage. See `CallTile.onPin`. */
    onPin: (() -> Unit)? = null,
) {
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val drag = remember { Animatable(Offset.Zero, Offset.VectorConverter) }
    var anchor by remember { mutableStateOf(Offset.Zero) }
    var stage by remember { mutableStateOf(Size.Zero) }

    val tile = with(density) { Size(PIP_WIDTH.toPx(), PIP_HEIGHT.toPx()) }
    val bounds = with(density) {
        pipBounds(
            stage = stage,
            tile = tile,
            side = PIP_INSET_SIDE.toPx(),
            top = if (chrome) PIP_INSET_TOP.toPx() else 16.dp.toPx(),
            bottom = if (chrome) PIP_INSET_BOTTOM.toPx() else 16.dp.toPx(),
        )
    }
    val placed = stage.width > 0f && stage.height > 0f

    Box(
        modifier = modifier
            .onPlaced { coordinates ->
                val parent = coordinates.parentLayoutCoordinates
                if (parent != null) {
                    anchor = coordinates.positionInParent()
                    stage = parent.size.toSize()
                } else {
                    anchor = coordinates.localToRoot(Offset.Zero)
                    stage = coordinates.findRootCoordinates().size.toSize()
                }
            }
            .offset { IntOffset(drag.value.x.roundToInt(), drag.value.y.roundToInt()) }
            .pointerInput(placed, bounds) {
                if (!placed) return@pointerInput
                detectDragGestures(
                    onDrag = { change, moved ->
                        change.consume()
                        scope.launch {
                            drag.snapTo(
                                Offset(
                                    (drag.value.x + moved.x)
                                        .coerceIn(bounds.left - anchor.x, bounds.right - anchor.x),
                                    (drag.value.y + moved.y)
                                        .coerceIn(bounds.top - anchor.y, bounds.bottom - anchor.y),
                                ),
                            )
                        }
                    },
                    onDragEnd = {
                        val corner = pipNearestCorner(bounds, stage, tile, anchor + drag.value)
                        scope.launch {
                            drag.animateTo(corner - anchor, spring(stiffness = Spring.StiffnessMediumLow))
                        }
                    },
                )
            }
            .width(PIP_WIDTH)
            .height(PIP_HEIGHT)
            .shadow(14.dp, RoundedCornerShape(PIP_CORNER))
            .clip(RoundedCornerShape(PIP_CORNER))
            .background(Color(0xFF15181F))
            .border(
                if (speaking) 2.5.dp else 1.5.dp,
                if (speaking) StatusOnline else Color.White.copy(alpha = 0.22f),
                RoundedCornerShape(PIP_CORNER),
            ),
    ) {
        if (track != null) {
            ClippedVideo(
                track = track,
                eglContext = eglContext,
                mirror = true,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Avatar(id = id, label = label, url = null, size = 48.dp, viewable = false)
            }
        }

        // Bottom-left: name + muted mic pill — same style as CallTile.
        Row(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(6.dp)
                .background(Color.Black.copy(alpha = 0.75f), RoundedCornerShape(8.dp))
                .padding(horizontal = 6.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = "You",
                style = MaterialTheme.typography.labelSmall,
                color = Color(0xFFF1F5F9),
                fontSize = 10.sp,
                fontWeight = FontWeight.Medium,
            )
            if (muted) {
                BetweenUsIcon(BetweenUsIcons.MicOff, tint = Danger, size = 10.dp)
            }
        }

        // Bottom-right: pin circle button — mirrors CallTile's BottomEnd pin
        // so the two controls sit at the same height on opposite sides.
        if (onPin != null) {
            PinButton(
                pinned = false,
                compact = true,
                onClick = onPin,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(6.dp),
            )
        }

        // Top-right: flip camera button (only while video is active).
        if (track != null) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(6.dp)
                    .size(24.dp)
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.65f))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = onFlipCamera,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                BetweenUsIcon(BetweenUsIcons.RotateRight, tint = Color(0xFFF1F5F9), size = 12.dp)
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
    // Not "muted": they were pulled into a phone call and are coming back.
    participant.held -> "On hold"
    else -> null
}

/**
 * The tiles of a small call, laid out so nobody is drawn as a sliver.
 *
 * Two rules, and they are the whole thing:
 *
 * - Columns come from the shape of the stage, not from the head count. Two
 *   people side by side on a portrait phone is two narrow strips; stacked, it
 *   is two wide ones. Turn the phone and the same two go back to side by side.
 * - A tile may be as wide as its share of the stage, but never more than a
 *   third again as tall as it is wide. A stage taller than the grid wants is
 *   margin around a centred grid, which is the thing that stretching was
 *   avoiding and should not have been.
 */
@Composable
private fun CallGrid(
    count: Int,
    modifier: Modifier = Modifier,
    tile: @Composable (index: Int, modifier: Modifier) -> Unit,
) {
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val gap = 8.dp
        val columns = if (count <= 2 && maxHeight > maxWidth) 1 else 2
        val rows = (count + columns - 1) / columns
        val cellWidth = (maxWidth - gap * (columns - 1)) / columns
        val cellHeight = (maxHeight - gap * (rows - 1)) / rows
        val tileHeight = minOf(cellHeight, cellWidth * 4f / 3f)
        Column(verticalArrangement = Arrangement.spacedBy(gap)) {
            for (row in 0 until rows) {
                Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                    for (column in 0 until columns) {
                        val index = row * columns + column
                        if (index < count) {
                            tile(index, Modifier.width(cellWidth).height(tileHeight))
                        }
                    }
                }
            }
        }
    }
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
    /** Drawn as pinned, and the button says "unpin" rather than "pin". */
    pinned: Boolean = false,
    /**
     * Tapped to pin this tile to the stage, or to let it go again.
     *
     * Null on a tile there is nothing to pin - the one already filling a
     * picture-in-picture window, say.
     */
    onPin: (() -> Unit)? = null,
    /**
     * How a frame that is not the shape of its tile is dealt with.
     *
     * The whole frame by default. A laptop camera is landscape and a phone
     * screen is portrait, so filling one with the other throws away the sides
     * of the picture - which on a call is where the room, the second person and
     * whatever is being pointed at all are. Somebody on the web client and
     * somebody on a phone should be looking at the same picture.
     *
     * The tiles that stay `SCALE_ASPECT_FILL` are the ones too small to read a
     * whole frame in anyway: the Android picture-in-picture window, the
     * filmstrip thumbnails, and your own preview - a letterboxed self-view is
     * a tile mostly made of black bars.
     */
    fit: RendererCommon.ScalingType = RendererCommon.ScalingType.SCALE_ASPECT_FIT,
    labelBottomPadding: Dp = 0.dp,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(if (isCompact) 12.dp else 18.dp))
            .background(Color(0xFF15181F))
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
                        Color.White.copy(alpha = 0.15f),
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
                corner = if (isCompact) 12.dp else 18.dp,
                cornerColor = Color(0xFF15181F),
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Avatar(
                id = id,
                label = label,
                url = null,
                size = if (isCompact) 36.dp else 72.dp,
                viewable = false,
            )
        }

        // Overlay participant name & status pill
        Row(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(if (isCompact) 4.dp else 10.dp)
                .padding(bottom = labelBottomPadding)
                .background(
                    Color.Black.copy(alpha = 0.75f),
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
                color = if (connected) Color(0xFFF1F5F9) else Color(0xFF94A3B8),
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
            // Only when the status line has not already said it. The two
            // together read as "Reconnecting… connecting…", which is one thing
            // said twice and neither of them clearly.
            if (!connected && status == null) {
                Text(
                    text = "connecting…",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFF94A3B8),
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

        // Pinning is one viewer's decision - nobody else's stage moves - so it
        // is on the tile rather than in a menu somewhere else. There is no
        // hover on a phone, so the button is always there rather than always
        // hidden.
        //
        // Compact (filmstrip) tiles keep the pin at the top corner so it is
        // easy to hit on a small surface; the full-stage tile moves it to
        // the bottom-right so it sits at the same level as the name pill.
        if (onPin != null) {
            PinButton(
                pinned = pinned,
                compact = isCompact,
                onClick = onPin,
                modifier = if (isCompact) {
                    Modifier.align(Alignment.TopStart)
                } else {
                    Modifier
                        .align(Alignment.BottomEnd)
                        .padding(10.dp)
                        .padding(bottom = labelBottomPadding)
                },
            )
        }
    }
}

/**
 * The pin, on a tile or on the floating self view.
 *
 * Small, dark, and out of the way in a corner: it sits over somebody's face for
 * the whole call, so it has to be findable without being the thing you look at.
 */
@Composable
private fun PinButton(
    pinned: Boolean,
    compact: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val size = if (compact) 22.dp else 30.dp
    Box(
        modifier = modifier
            .padding(if (compact) 4.dp else 8.dp)
            .size(size)
            .clip(CircleShape)
            .background(if (pinned) Accent else Color.Black.copy(alpha = 0.65f))
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        BetweenUsIcon(
            icon = BetweenUsIcons.Pin,
            tint = if (pinned) Neutral99 else Color(0xFFF1F5F9),
            size = if (compact) 11.dp else 15.dp,
        )
    }
}
