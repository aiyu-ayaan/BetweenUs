package com.aktech.nexora.feature.voice

import android.content.Context
import android.content.Intent
import com.aktech.nexora.core.crypto.Crypto
import com.aktech.nexora.core.crypto.E2ee
import com.aktech.nexora.core.data.CallPeer
import com.aktech.nexora.core.data.CallSocket
import com.aktech.nexora.core.data.IceServer
import com.aktech.nexora.core.data.NexoraApi
import com.aktech.nexora.core.data.PresenceSocket
import com.aktech.nexora.core.data.Session
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import org.webrtc.AudioTrack
import org.webrtc.Camera1Enumerator
import org.webrtc.Camera2Enumerator
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpParameters
import org.webrtc.RtpTransceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoTrack
import org.webrtc.audio.JavaAudioDeviceModule
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap

/**
 * A voice or video call: one `PeerConnection` per other participant, media
 * directly between the two devices, and `call-service` as a switchboard that
 * never sees a frame.
 *
 * The port of `apps/desktop/src/services/mesh.ts`, and it has to be a faithful
 * one - the two clients are talking to each other, so anything this file does
 * differently is a call that connects and carries nothing.
 *
 * ## Fixed transceiver slots
 *
 * Every connection is built with exactly four transceivers, always in the same
 * order: microphone, camera, screen, screen audio. They are created empty and
 * stay for the life of the connection, and turning a device on is
 * `sender.setTrack` on a sender that already exists - which never renegotiates.
 *
 * Only the impolite side creates them; the polite side adopts the four the
 * offer brought (see `adopt`). This is the part that was missing: Android used
 * to `addTrack` whatever it happened to be capturing, so a phone offered one
 * audio m-line to a desktop expecting four, the desktop's `adopt` refused to
 * run, and it never put a single track on the wire. Two tiles, both connected,
 * no media in either direction.
 *
 * ## Perfect negotiation
 *
 * Either side may need to offer, and if both do at once the connection breaks.
 * Politeness is decided by comparing peer ids, which both ends can do without
 * agreeing anything, and the impolite peer's offer wins.
 *
 * ## The fingerprint signature
 *
 * Each peer sends `HMAC-SHA256(channel key, its own DTLS fingerprint)` beside
 * the SDP and the receiver recomputes it. The relay has never held the channel
 * key, so it cannot put its own fingerprint in each direction and sit in the
 * middle of a connection both ends believe is direct.
 *
 * ## What is really arriving
 *
 * A video receiver on an empty slot is not honest - it unmutes on the padding
 * sent to probe for bandwidth - so a camera nobody turned on would be a black
 * rectangle where an avatar belongs. Frames decoded per second do not lie, so
 * that is what decides whether a slot is showing (see `poll`).
 *
 * ponytail: no simulcast and no bandwidth ladder. The mesh ceiling is the
 * desktop's - comfortable to five, video degrades past six - and a phone hits
 * it sooner. Adaptive layers are the upgrade if calls get bigger, and an SFU is
 * the answer if they get much bigger, which is a deliberate future decision
 * rather than something to smuggle in here.
 */
class VoiceEngine(private val context: Context) {

    /**
     * What a transceiver carries. The declaration order is the m-line order and
     * is load-bearing: it is how both ends agree what arrived without a
     * side-channel to race against.
     */
    enum class Slot(val media: MediaStreamTrack.MediaType, val wire: String) {
        MIC(MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO, "mic"),
        CAMERA(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO, "camera"),
        SCREEN(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO, "screen"),

        /**
         * Never sent from a phone: Android's playback capture needs its own
         * consent flow and is not wired up. The slot still exists, because
         * dropping it would shift every m-line after it and the desktop counts
         * on the order.
         */
        SCREEN_AUDIO(MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO, "screenAudio"),
    }

    data class Participant(
        val peer: CallPeer,
        val camera: VideoTrack? = null,
        val screen: VideoTrack? = null,
        /** What they say their microphone is doing, over the data channel. */
        val micEnabled: Boolean = true,
        val speaking: Boolean = false,
        val connected: Boolean = false,
    ) {
        /** What a tile shows. A share wins over a camera; a phone has one tile. */
        val video: VideoTrack? get() = screen ?: camera
    }

    sealed interface CallState {
        data object Idle : CallState
        data class Connecting(val channelId: String) : CallState
        data class Live(val channelId: String) : CallState
        data class Failed(val reason: String) : CallState
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    val eglBase: EglBase = EglBase.create()

    private val factory: PeerConnectionFactory by lazy {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .createInitializationOptions(),
        )
        PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .setAudioDeviceModule(
                JavaAudioDeviceModule.builder(context)
                    .setUseHardwareAcousticEchoCanceler(true)
                    .setUseHardwareNoiseSuppressor(true)
                    .createAudioDeviceModule(),
            )
            .createPeerConnectionFactory()
    }

    private val connections = ConcurrentHashMap<String, PeerLink>()

    private val _state = MutableStateFlow<CallState>(CallState.Idle)
    val state: StateFlow<CallState> = _state.asStateFlow()

    private val _participants = MutableStateFlow<List<Participant>>(emptyList())
    val participants: StateFlow<List<Participant>> = _participants.asStateFlow()

    private val _muted = MutableStateFlow(false)
    val muted: StateFlow<Boolean> = _muted.asStateFlow()

    private val _cameraOn = MutableStateFlow(false)
    val cameraOn: StateFlow<Boolean> = _cameraOn.asStateFlow()

    private val _sharing = MutableStateFlow(false)
    val sharing: StateFlow<Boolean> = _sharing.asStateFlow()

    private val _localVideo = MutableStateFlow<VideoTrack?>(null)
    val localVideo: StateFlow<VideoTrack?> = _localVideo.asStateFlow()

    /**
     * One peer in trouble is one tile, not the call, so this is said out loud
     * rather than ending anything. A failure nobody can see is a failure nobody
     * can report - which is exactly how the missing slots went unnoticed.
     */
    private val _problem = MutableStateFlow<String?>(null)
    val problem: StateFlow<String?> = _problem.asStateFlow()

    private var selfPeerId: String? = null
    private var channelId: String? = null
    private var channelKey: String = ""
    private var iceServers: List<PeerConnection.IceServer> = emptyList()
    private var detach: (() -> Unit)? = null
    private var pollJob: Job? = null
    private var joinTimeout: Job? = null

    private var audioTrack: AudioTrack? = null
    private var videoCapturer: VideoCapturer? = null
    private var cameraTrack: VideoTrack? = null
    private var screenTrack: VideoTrack? = null

    /** What the screen is actually being captured at, which sets its ceiling. */
    private var shareSize = ShareQuality.Size(1920, 1080)
    private var surfaceHelper: SurfaceTextureHelper? = null

    // --- lifecycle ---

    /**
     * Joins, or tries again after a failure.
     *
     * A failed join has to be retryable. The first attempt can lose to a
     * service that happened to be restarting, and treating `Failed` as
     * terminal left the screen showing an error with no way back to the button
     * that caused it.
     */
    fun join(channelId: String) {
        if (_state.value is CallState.Connecting || _state.value is CallState.Live) return
        this.channelId = channelId
        _state.value = CallState.Connecting(channelId)
        _problem.value = null

        scope.launch {
            try {
                // The channel key is what signs our DTLS fingerprint. Without
                // it there is nothing to prove the far side is talking to us and
                // not to the relay, so the call does not start.
                channelKey = E2ee.callKeyForChannel(channelId)
                iceServers = NexoraApi.callIce(channelId).map { it.toWebRtc() }

                startMicrophone()

                detach = CallSocket.on { event -> scope.launch { onSignal(event) } }
                Session.accessToken?.let { CallSocket.connect(it) }
                CallSocket.join(channelId)

                // Being in a call and being *seen* to be in one are two
                // different subscriptions. The roster under a voice channel in
                // everybody else's sidebar is presence, not the call service,
                // so a client that skips this is in the call and on nobody's
                // list - which is exactly how the phone looked from the web.
                PresenceSocket.joinVoice(channelId)

                startJoinTimeout(channelId)

                // From here the call has to survive the screen going off, and
                // the earpiece is not where a call this app starts belongs.
                CallService.attach(
                    onHangUp = { scope.launch { leave() } },
                    onToggleMute = { scope.launch { toggleMute() } },
                )
                CallService.start(context, "In a Nexora call", foregroundTypes(), _muted.value)
                CallAudio.start(context)

                startPolling()
            } catch (error: Exception) {
                fail(error.message ?: "The call could not start")
            }
        }
    }

    fun leave() {
        CallSocket.leave()
        channelId?.let { PresenceSocket.leaveVoice(it) }
        teardown()
        _state.value = CallState.Idle
        channelId = null
    }

    /**
     * A join that is never answered has to end somewhere.
     *
     * The call service answers every join with `joined` or an error, so silence
     * means the message never arrived - a socket that was still opening when
     * the app was killed, a reconnect that lost the join, a service that was
     * restarting. Without this the screen said "Connecting…" for as long as the
     * process lived, and since the engine outlives the screen there was no way
     * back: every later attempt found a call already "connecting" and returned.
     */
    private fun startJoinTimeout(channelId: String) {
        joinTimeout?.cancel()
        joinTimeout = scope.launch {
            delay(JOIN_TIMEOUT_MS)
            if (_state.value == CallState.Connecting(channelId)) {
                fail("The call server did not answer. Try again.")
            }
        }
    }

    /**
     * A failure has to leave as little behind as a clean exit does. Without
     * this a half-started call kept its microphone track and its socket
     * listener, and every retry added another listener to the pile.
     */
    private fun fail(reason: String) {
        teardown()
        _state.value = CallState.Failed(reason)
    }

    private fun teardown() {
        pollJob?.cancel()
        pollJob = null
        joinTimeout?.cancel()
        joinTimeout = null
        CallAudio.stop(context)
        CallService.stop(context)
        CallService.detach()
        detach?.invoke()
        detach = null
        connections.values.forEach { it.close() }
        connections.clear()
        stopVideo()
        audioTrack?.dispose()
        audioTrack = null
        _participants.value = emptyList()
        _localVideo.value = null
        _sharing.value = false
    }

    /**
     * Ends the call and gives the graphics context back. Only signing out gets
     * to do this: a screen going away is not the end of a call.
     */
    fun dispose() {
        leave()
        eglBase.release()
        synchronized(VoiceEngine) { if (instance === this) instance = null }
    }

    // --- local media ---

    private fun startMicrophone() {
        if (audioTrack != null) return
        val source = factory.createAudioSource(MediaConstraints())
        audioTrack = factory.createAudioTrack("nexora-audio", source).apply {
            setEnabled(!_muted.value)
        }
    }

    /**
     * Muting is the track going quiet, not the sender going away: a slot that
     * empties would tell the far end the microphone was never there. The far
     * end learns about it from the media state on the data channel, which is
     * the only thing that can distinguish "muted" from "silent room".
     */
    fun toggleMute() {
        _muted.update { !it }
        audioTrack?.setEnabled(!_muted.value)
        publishMediaState()
        CallService.start(context, "In a Nexora call", foregroundTypes(), _muted.value)
    }

    /** The camera. [startScreenShare] instead turns the capture into a share. */
    fun startCamera(front: Boolean = true) {
        if (videoCapturer != null) stopVideo()
        val enumerator = if (Camera2Enumerator.isSupported(context)) {
            Camera2Enumerator(context)
        } else {
            Camera1Enumerator(true)
        }
        val name = enumerator.deviceNames.firstOrNull {
            if (front) enumerator.isFrontFacing(it) else enumerator.isBackFacing(it)
        } ?: enumerator.deviceNames.firstOrNull() ?: return

        // 1080p30 asked for; the enumerator picks the nearest format the camera
        // actually has, which on most phones is 1080p or 720p.
        val track = beginCapture(
            enumerator.createCapturer(name, null),
            1920,
            1080,
            ShareQuality.CAMERA_FRAME_RATE,
        ) ?: return
        cameraTrack = track
        _cameraOn.value = true
        publish(Slot.CAMERA, track)
        afterMediaChange()
    }

    /**
     * Screen share. The intent is what `MediaProjectionManager` handed back
     * after the system asked - Android will not let an app capture the screen
     * on any other terms, and that consent is the right place for it.
     *
     * The foreground service has to be carrying the `mediaProjection` type
     * before the capturer starts, or Android 14 and later kill the process for
     * capturing under a service that never said it would.
     */
    fun startScreenShare(permission: Intent) {
        if (videoCapturer != null) stopVideo()
        CallService.start(
            context,
            "Sharing your screen",
            foregroundTypes(screen = true),
            _muted.value,
        )

        // The display's own shape and size, not a fixed 720p box: capturing
        // small and stretching on the far end is what "very low quality" looks
        // like, and it saves nothing, because the scaling happens after the
        // pixels have already been read.
        val size = ShareQuality.captureSize(context)
        shareSize = size

        val track = beginCapture(
            ScreenCapturerAndroid(
                permission,
                object : android.media.projection.MediaProjection.Callback() {
                    override fun onStop() {
                        scope.launch { stopVideo() }
                    }
                },
            ),
            size.width,
            size.height,
            ShareQuality.SCREEN_FRAME_RATE,
        ) ?: return
        screenTrack = track
        _sharing.value = true
        publish(Slot.SCREEN, track)
        afterMediaChange()
    }

    private fun beginCapture(capturer: VideoCapturer, width: Int, height: Int, fps: Int): VideoTrack? {
        val helper = SurfaceTextureHelper.create("nexora-capture", eglBase.eglBaseContext)
        val source = factory.createVideoSource(capturer.isScreencast)
        capturer.initialize(helper, context, source.capturerObserver)
        capturer.startCapture(width, height, fps)

        surfaceHelper = helper
        videoCapturer = capturer
        val track = factory.createVideoTrack("nexora-video", source)
        _localVideo.value = track
        return track
    }

    /** Stops whichever of the camera and the share is running. */
    fun stopVideo() {
        runCatching { videoCapturer?.stopCapture() }
        videoCapturer?.dispose()
        videoCapturer = null
        surfaceHelper?.dispose()
        surfaceHelper = null

        publish(Slot.CAMERA, null)
        publish(Slot.SCREEN, null)
        cameraTrack?.dispose()
        cameraTrack = null
        screenTrack?.dispose()
        screenTrack = null

        _localVideo.value = null
        _cameraOn.value = false
        _sharing.value = false
        afterMediaChange()
    }

    private fun afterMediaChange() {
        publishMediaState()
        if (_state.value is CallState.Live || _state.value is CallState.Connecting) {
            CallService.start(context, callLabel(), foregroundTypes(), _muted.value)
        }
    }

    private fun callLabel(): String = if (_sharing.value) "Sharing your screen" else "In a Nexora call"

    /**
     * The foreground types the service may legally declare right now. Android
     * 14 requires each one to be genuinely in use, so a camera that is off is a
     * type that cannot be claimed.
     */
    private fun foregroundTypes(screen: Boolean = _sharing.value): Int {
        var types = CallService.TYPE_MICROPHONE
        if (_cameraOn.value) types = types or CallService.TYPE_CAMERA
        if (screen) types = types or CallService.TYPE_PROJECTION
        return types
    }

    /** Puts a local track on one slot of every connection. */
    private fun publish(slot: Slot, track: MediaStreamTrack?) {
        connections.values.forEach { it.setTrack(slot, track) }
    }

    private fun publishMediaState() {
        val media = JSONObject()
            .put(Slot.MIC.wire, !_muted.value)
            .put(Slot.CAMERA.wire, _cameraOn.value)
            .put(Slot.SCREEN.wire, _sharing.value)
            .put(Slot.SCREEN_AUDIO.wire, false)
        val envelope = JSONObject().put("topic", VOICE_STATE_TOPIC).put("media", media)
        connections.values.forEach { it.sendData(envelope) }
    }

    // --- signalling ---

    private suspend fun onSignal(event: JSONObject) {
        when (event.optString("type")) {
            "ready" -> selfPeerId = event.optString("peerId")

            "joined" -> {
                joinTimeout?.cancel()
                joinTimeout = null
                _state.value = CallState.Live(channelId.orEmpty())
                val peers = event.optJSONArray("peers")
                for (index in 0 until (peers?.length() ?: 0)) {
                    addPeer(CallPeer.from(peers!!.getJSONObject(index)))
                }
            }

            "peer.joined" -> event.optJSONObject("peer")?.let { addPeer(CallPeer.from(it)) }

            "peer.left" -> {
                val peerId = event.optString("peerId")
                connections.remove(peerId)?.close()
                _participants.update { list -> list.filterNot { it.peer.peerId == peerId } }
            }

            "signal" -> {
                val from = event.optString("from")
                val data = event.optJSONObject("data") ?: return
                connections[from]?.onSignal(data)
            }

            // This account joined a call from somewhere else, so this
            // connection is no longer the one carrying it. One call per
            // account across every device.
            "superseded" -> fail("This call moved to another device")

            "error" -> fail(event.optString("message").ifEmpty { "The call service refused this" })
        }
    }

    private fun addPeer(peer: CallPeer) {
        if (connections.containsKey(peer.peerId)) return
        val self = selfPeerId ?: return
        // Whoever has the larger peer id yields. Both sides compute this from
        // the same two strings, so they always disagree - which is the point.
        val link = PeerLink(peer, polite = self > peer.peerId)
        connections[peer.peerId] = link
        _participants.update { it + Participant(peer) }
        link.start()
    }

    private fun send(to: String, data: JSONObject) {
        CallSocket.send(JSONObject().put("type", "signal").put("to", to).put("data", data))
    }

    private fun update(peerId: String, change: (Participant) -> Participant) {
        _participants.update { list ->
            list.map { if (it.peer.peerId == peerId) change(it) else it }
        }
    }

    /**
     * One `getStats` per peer per second, which is what decides whether a video
     * slot is really carrying anything and who is speaking. Both are statistics
     * rather than events, because WebRTC offers no event for either that can be
     * trusted.
     */
    private fun startPolling() {
        pollJob?.cancel()
        pollJob = scope.launch {
            while (isActive) {
                delay(POLL_MS)
                connections.values.forEach { it.poll() }
            }
        }
    }

    // --- one connection to one other participant ---

    private inner class PeerLink(val peer: CallPeer, val polite: Boolean) {

        private val transceivers = LinkedHashMap<Slot, RtpTransceiver>()

        /**
         * What this client wants to be sending, held for the answering side: it
         * has no senders until the offer arrives, and a camera turned on before
         * that would otherwise never reach anybody.
         */
        private val wanted = HashMap<Slot, MediaStreamTrack?>()

        /**
         * Candidates that arrived before there was a remote description to
         * attach them to. This is the normal path, not an edge case:
         * `addIceCandidate` is rejected until `setRemoteDescription` has run,
         * and a candidate dropped there is dropped for good - which is a call
         * that negotiates cleanly and then never carries a packet.
         */
        private val pendingCandidates = mutableListOf<IceCandidate>()

        private var makingOffer = false
        private var closed = false
        private val frames = HashMap<Slot, Long>()

        /** Consecutive polls a video slot has gone without a new frame. */
        private val stalled = HashMap<Slot, Int>()

        private val pc: PeerConnection = factory.createPeerConnection(
            PeerConnection.RTCConfiguration(iceServers).apply {
                sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
                // Both match the desktop. A different bundle policy is a
                // different set of m-lines, and the slot order is the contract.
                bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
                continualGatheringPolicy =
                    PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
            },
            object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: IceCandidate) {
                    send(
                        peer.peerId,
                        JSONObject()
                            .put("kind", "ice")
                            .put(
                                "candidate",
                                JSONObject()
                                    .put("candidate", candidate.sdp)
                                    .put("sdpMid", candidate.sdpMid)
                                    .put("sdpMLineIndex", candidate.sdpMLineIndex),
                            ),
                    )
                }

                override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
                    val up = state == PeerConnection.PeerConnectionState.CONNECTED
                    scope.launch { update(peer.peerId) { it.copy(connected = up) } }
                }

                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                    // One restart, then leave it. A mesh with one dead link is a
                    // call with one silent tile, not a call that ends.
                    if (state == PeerConnection.IceConnectionState.FAILED) pc.restartIce()
                }

                // Tracks are read off the slots after negotiation instead: the
                // transceiver handed to this callback is a fresh wrapper, so it
                // cannot be matched against the ones held here by identity.
                override fun onTrack(transceiver: RtpTransceiver) = Unit
                override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
                override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
                override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
                override fun onAddStream(stream: org.webrtc.MediaStream) = Unit
                override fun onRemoveStream(stream: org.webrtc.MediaStream) = Unit
                override fun onDataChannel(channel: DataChannel) = Unit
                override fun onRenegotiationNeeded() = Unit
            },
        ) ?: error("This device could not open a peer connection")

        /**
         * Negotiated on both sides with a fixed id, so neither has to wait for
         * the other's `onDataChannel` and there is no race about who opens it.
         * It carries the media state - which is the only way a mute is told
         * apart from a quiet room.
         */
        private val data: DataChannel = pc.createDataChannel(
            "nexora.share",
            DataChannel.Init().apply {
                negotiated = true
                id = 0
            },
        )

        init {
            // The four slots, in order, created by the offering side only.
            // Creating them on both sides is two sets of m-lines that no offer
            // can pair up, and every arriving track lands on a transceiver the
            // receiving side has never heard of.
            if (!polite) {
                for (slot in Slot.entries) {
                    transceivers[slot] = pc.addTransceiver(
                        slot.media,
                        RtpTransceiver.RtpTransceiverInit(
                            RtpTransceiver.RtpTransceiverDirection.SEND_RECV,
                        ),
                    )
                }
                preferScreenCodec()
            }

            data.registerObserver(object : DataChannel.Observer {
                override fun onStateChange() {
                    if (data.state() == DataChannel.State.OPEN) {
                        scope.launch { publishMediaState() }
                    }
                }

                override fun onMessage(buffer: DataChannel.Buffer) {
                    val bytes = ByteArray(buffer.data.remaining())
                    buffer.data.get(bytes)
                    val payload = runCatching {
                        JSONObject(String(bytes, StandardCharsets.UTF_8))
                    }.getOrNull() ?: return
                    scope.launch { onData(payload) }
                }

                override fun onBufferedAmountChange(previous: Long) = Unit
            })
        }

        fun start() {
            for (slot in Slot.entries) {
                val track = when (slot) {
                    Slot.MIC -> audioTrack
                    Slot.CAMERA -> cameraTrack
                    Slot.SCREEN -> screenTrack
                    Slot.SCREEN_AUDIO -> null
                }
                setTrack(slot, track)
            }
            // Only the impolite side offers first. Both offering at once is the
            // glare the polite rule exists to settle.
            if (!polite) scope.launch { offer() }
        }

        fun setTrack(slot: Slot, track: MediaStreamTrack?) {
            wanted[slot] = track
            // No transceiver yet means this side is still waiting for the offer
            // that makes one. `adopt` plays this back.
            val transceiver = transceivers[slot] ?: return
            transceiver.sender.setTrack(track, false)
            if (track != null) tune(slot)
        }

        /**
         * The bitrate ceiling and frame rate on one sender.
         *
         * Set on the live sender rather than in the offer, because encoding
         * parameters are not part of the SDP and changing them costs no
         * renegotiation. Without this a share was whatever WebRTC's default
         * decided - about 3 Mbps - regardless of what was captured.
         */
        private fun tune(slot: Slot) {
            val sender = transceivers[slot]?.sender ?: return
            if (slot != Slot.SCREEN && slot != Slot.CAMERA) return

            runCatching {
                val parameters = sender.parameters ?: return
                // A sender that has not negotiated yet has nothing to change.
                val encodings = parameters.encodings ?: return
                if (encodings.isEmpty()) return

                val screen = slot == Slot.SCREEN
                for (encoding in encodings) {
                    encoding.maxBitrateBps =
                        if (screen) ShareQuality.screenBitrate(shareSize) else ShareQuality.cameraBitrate()
                    encoding.maxFramerate =
                        if (screen) ShareQuality.SCREEN_FRAME_RATE else ShareQuality.CAMERA_FRAME_RATE
                    // Send what was captured. Congestion control still shrinks
                    // it when the link says so; this only stops it starting
                    // small for no reason.
                    encoding.scaleResolutionDownBy = 1.0
                    // A share is the call's primary visual media, not
                    // background video.
                    if (screen) encoding.networkPriority = 3
                }

                // Text stays readable and frames are what gets sacrificed - the
                // opposite trade to a camera, where a dropped frame is invisible
                // and a soft face is not.
                parameters.degradationPreference = if (screen) {
                    RtpParameters.DegradationPreference.MAINTAIN_RESOLUTION
                } else {
                    RtpParameters.DegradationPreference.BALANCED
                }

                sender.parameters = parameters
            }
        }

        /**
         * Asks for H.264 on the screen, which is the one codec with a hardware
         * encoder on essentially every phone - and hardware is what makes a
         * high frame rate possible without the battery paying for it. Ignored
         * where it is unavailable; the call works either way.
         */
        private fun preferScreenCodec() {
            val transceiver = transceivers[Slot.SCREEN] ?: return
            runCatching {
                val codecs = factory.getRtpSenderCapabilities(
                    MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,
                ).codecs
                val sorted = codecs.sortedByDescending { it.name.equals("H264", ignoreCase = true) }
                transceiver.setCodecPreferences(sorted)
            }
        }

        fun sendData(payload: JSONObject) {
            if (data.state() != DataChannel.State.OPEN) return
            val bytes = payload.toString().toByteArray(StandardCharsets.UTF_8)
            runCatching { data.send(DataChannel.Buffer(java.nio.ByteBuffer.wrap(bytes), false)) }
        }

        private fun onData(payload: JSONObject) {
            if (payload.optString("topic") != VOICE_STATE_TOPIC) return
            val media = payload.optJSONObject("media") ?: return
            if (!media.has(Slot.MIC.wire)) return
            update(peer.peerId) { it.copy(micEnabled = media.optBoolean(Slot.MIC.wire, true)) }
        }

        /**
         * The answering side takes ownership of the transceivers the offer
         * created. They arrive `recvonly`, which is the direction that would
         * make this end permanently silent, so they are flipped before the
         * answer is written - and whatever is already being captured goes on
         * immediately, because it was asked for while there was no sender.
         */
        private fun adopt() {
            if (transceivers.isNotEmpty()) return

            val found = pc.transceivers
            if (found.size < Slot.entries.size) {
                problem("${peer.username}: their offer carried ${found.size} media slots, not ${Slot.entries.size}")
                return
            }
            for ((index, slot) in Slot.entries.withIndex()) {
                if (found[index].mediaType != slot.media) {
                    problem("${peer.username}: their offer put ${found[index].mediaType} where ${slot.wire} belongs")
                    return
                }
            }

            for ((index, slot) in Slot.entries.withIndex()) {
                val transceiver = found[index]
                transceiver.direction = RtpTransceiver.RtpTransceiverDirection.SEND_RECV
                transceivers[slot] = transceiver
            }
            preferScreenCodec()
            for ((slot, track) in wanted) {
                transceivers[slot]?.sender?.setTrack(track, false)
                if (track != null) tune(slot)
            }
        }

        private suspend fun offer() {
            if (closed) return
            makingOffer = true
            try {
                val description = create(offer = true) ?: return
                if (!setLocal(description)) return
                sendDescription("offer", description)
            } finally {
                makingOffer = false
            }
        }

        fun onSignal(data: JSONObject) {
            when (data.optString("kind")) {
                "offer", "answer" -> scope.launch { onDescription(data) }
                "ice" -> data.optJSONObject("candidate")?.let { payload ->
                    val candidate = IceCandidate(
                        payload.optString("sdpMid"),
                        payload.optInt("sdpMLineIndex"),
                        payload.optString("candidate"),
                    )
                    if (pc.remoteDescription == null) {
                        pendingCandidates += candidate
                    } else {
                        pc.addIceCandidate(candidate)
                    }
                }
            }
        }

        private suspend fun onDescription(payload: JSONObject) {
            if (closed) return
            val sdp = payload.optString("sdp")
            val proof = payload.optString("fingerprintProof")

            // The relay has never held a channel key, so it cannot sign a
            // fingerprint of its own. A signature that does not check out means
            // somebody in the middle, and the connection is never made.
            if (!verifyFingerprint(sdp, proof)) {
                problem(
                    "${peer.username}: refused - their media key does not match this channel's",
                )
                return
            }

            val kind = payload.optString("kind")

            // Perfect negotiation: on a collision the impolite side ignores the
            // offer and its own wins. The polite side applies it.
            val collision = kind == "offer" &&
                (makingOffer || pc.signalingState() != PeerConnection.SignalingState.STABLE)
            if (collision && !polite) return

            val type = if (kind == "offer") {
                SessionDescription.Type.OFFER
            } else {
                SessionDescription.Type.ANSWER
            }
            if (!setRemote(SessionDescription(type, sdp))) return

            for (candidate in pendingCandidates) pc.addIceCandidate(candidate)
            pendingCandidates.clear()

            if (kind != "offer") {
                // An answer settles the senders, and encodings only exist once
                // they are settled - so this is the first moment the ceilings
                // can be put on at all.
                tune(Slot.SCREEN)
                tune(Slot.CAMERA)
                return
            }

            // Before the answer is written: the directions it carries are the
            // ones decided here.
            adopt()
            val answer = create(offer = false) ?: return
            if (!setLocal(answer)) return
            sendDescription("answer", answer)
            tune(Slot.SCREEN)
            tune(Slot.CAMERA)
        }

        private fun sendDescription(kind: String, description: SessionDescription) {
            val fingerprint = fingerprintOf(description.description)
            if (fingerprint == null) {
                // An SDP with no fingerprint cannot be verified by the far
                // side, and sending it unsigned would be the hole this closes.
                _state.value = CallState.Failed("No DTLS fingerprint to sign, so nothing was sent")
                return
            }
            send(
                peer.peerId,
                JSONObject()
                    .put("kind", kind)
                    .put("sdp", description.description)
                    .put("fingerprintProof", Crypto.signFingerprint(channelKey, fingerprint)),
            )
        }

        private fun verifyFingerprint(sdp: String, proof: String): Boolean {
            val fingerprint = fingerprintOf(sdp) ?: return false
            return Crypto.signFingerprint(channelKey, fingerprint) == proof
        }

        private suspend fun create(offer: Boolean): SessionDescription? =
            suspendCancellableCoroutine { continuation ->
                val observer = object : SdpObserver {
                    override fun onCreateSuccess(description: SessionDescription) {
                        if (continuation.isActive) continuation.resumeWith(Result.success(description))
                    }

                    override fun onCreateFailure(error: String?) {
                        problem("${peer.username}: could not ${if (offer) "offer" else "answer"} - $error")
                        if (continuation.isActive) continuation.resumeWith(Result.success(null))
                    }

                    override fun onSetSuccess() = Unit
                    override fun onSetFailure(error: String?) = Unit
                }
                val constraints = MediaConstraints()
                if (offer) pc.createOffer(observer, constraints) else pc.createAnswer(observer, constraints)
            }

        /**
         * Setting a description is awaited rather than fired and forgotten.
         * `adopt` and `createAnswer` both depend on the remote description
         * having actually landed, and the old code ran them against whatever
         * state happened to be there.
         */
        private suspend fun setLocal(description: SessionDescription): Boolean =
            applyDescription { observer -> pc.setLocalDescription(observer, description) }

        private suspend fun setRemote(description: SessionDescription): Boolean =
            applyDescription { observer -> pc.setRemoteDescription(observer, description) }

        private suspend fun applyDescription(apply: (SdpObserver) -> Unit): Boolean =
            suspendCancellableCoroutine { continuation ->
                apply(
                    object : SdpObserver {
                        override fun onSetSuccess() {
                            if (continuation.isActive) continuation.resumeWith(Result.success(true))
                        }

                        override fun onSetFailure(error: String?) {
                            problem("${peer.username}: $error")
                            if (continuation.isActive) continuation.resumeWith(Result.success(false))
                        }

                        override fun onCreateSuccess(description: SessionDescription?) = Unit
                        override fun onCreateFailure(error: String?) = Unit
                    },
                )
            }

        /**
         * Whether a camera and a share are really arriving, by counting frames,
         * and who is speaking, by reading audio levels.
         *
         * Nothing a video receiver says is trustworthy: it unmutes on the
         * padding sent to probe for bandwidth and stays unmuted after the far
         * end stops, so both a share that never started and one that has ended
         * look live. Frames decoded since the last look do not lie.
         */
        fun poll() {
            if (closed) return
            pc.getStats { report ->
                val decoded = HashMap<String, Long>()
                val levels = HashMap<String, Double>()
                for (stats in report.statsMap.values) {
                    if (stats.type != "inbound-rtp") continue
                    val mid = stats.members["mid"] as? String ?: continue
                    when (stats.members["kind"] as? String) {
                        "video" -> decoded[mid] = (stats.members["framesDecoded"] as? Number)?.toLong() ?: 0L
                        "audio" -> levels[mid] = (stats.members["audioLevel"] as? Number)?.toDouble() ?: 0.0
                    }
                }

                val camera = liveVideo(Slot.CAMERA, decoded)
                val screen = liveVideo(Slot.SCREEN, decoded)
                val speaking = (levels[transceivers[Slot.MIC]?.mid] ?: 0.0) >= SPEAKING_LEVEL

                scope.launch {
                    update(peer.peerId) {
                        it.copy(camera = camera, screen = screen, speaking = speaking)
                    }
                }
            }
        }

        /**
         * The track on a video slot, while frames are still arriving - with
         * enough patience to survive a share that is simply not changing.
         *
         * Frames decoded is the only honest signal that something is arriving,
         * because a receiver unmutes on the padding sent to probe for
         * bandwidth. But a screen share of a document nobody is typing in sends
         * almost nothing, so "no new frames this second" is not "the share
         * ended" - and treating it as one made the share stage open, close,
         * open and close again, taking the requested orientation down with it
         * every time.
         *
         * So a slot goes live on the first frame and stays live until several
         * seconds have passed with none.
         */
        private fun liveVideo(slot: Slot, decoded: Map<String, Long>): VideoTrack? {
            val transceiver = transceivers[slot] ?: return null
            val track = transceiver.receiver.track() as? VideoTrack ?: return null
            val mid = transceiver.mid ?: return null

            val now = decoded[mid] ?: 0L
            val moving = now > (frames[slot] ?: 0L)
            frames[slot] = now

            val misses = if (moving) 0 else (stalled[slot] ?: 0) + 1
            stalled[slot] = misses

            // Nothing has ever arrived on this slot: not live, no patience owed.
            if (now == 0L) return null
            return if (misses <= STALL_TOLERANCE) track else null
        }

        private fun problem(message: String) {
            scope.launch { _problem.value = message }
        }

        fun close() {
            closed = true
            runCatching { data.unregisterObserver() }
            runCatching { data.close() }
            runCatching { pc.close() }
            runCatching { pc.dispose() }
        }
    }

    companion object {
        /**
         * The one call this process can be in.
         *
         * A call cannot belong to a composable. The screen it is shown on is
         * destroyed by a rotation, by navigating to a channel, and by the
         * activity being recreated - and when the engine was remembered there,
         * every one of those hung the call up. It belongs to the process, like
         * the session and the workspace do, and only leaving ends it.
         */
        @Volatile
        private var instance: VoiceEngine? = null

        fun of(context: Context): VoiceEngine =
            instance ?: synchronized(this) {
                instance ?: VoiceEngine(context.applicationContext).also { instance = it }
            }

        /**
         * Ends whatever call is running, if there is one. Signing out is the
         * one thing that has to reach across and stop a call it did not start.
         */
        fun release() {
            synchronized(this) { instance }?.dispose()
        }

        /** The topic the desktop stamps its media state with. Must match. */
        private const val VOICE_STATE_TOPIC = "nexora.voice-state"

        private const val POLL_MS = 1_000L

        /** The desktop waits the same fifteen seconds before giving up on a join. */
        private const val JOIN_TIMEOUT_MS = 15_000L

        /**
         * Polls without a new frame before a video slot counts as finished.
         * Five seconds: longer than any still moment in a screen share, short
         * enough that a camera switched off does not linger.
         */
        private const val STALL_TOLERANCE = 5

        /**
         * Audio level above which somebody counts as speaking. About -40 dBFS:
         * below a voice, above the residue a suppressor leaves.
         */
        private const val SPEAKING_LEVEL = 0.01
    }
}

/**
 * The DTLS fingerprint out of an SDP blob.
 *
 * Requiring it to exist is deliberate: an SDP with no fingerprint cannot be
 * verified, and accepting one unverified would be the hole the signature closes.
 */
fun fingerprintOf(sdp: String): String? {
    val match = Regex("^a=fingerprint:(\\S+)\\s+(\\S+)", RegexOption.MULTILINE).find(sdp)
    return match?.let { "${it.groupValues[1]} ${it.groupValues[2]}" }
}

private fun IceServer.toWebRtc(): PeerConnection.IceServer =
    PeerConnection.IceServer.builder(urls)
        .setUsername(username.orEmpty())
        .setPassword(credential.orEmpty())
        .createIceServer()
