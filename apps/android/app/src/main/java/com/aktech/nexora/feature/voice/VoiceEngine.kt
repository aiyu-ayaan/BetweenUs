package com.aktech.nexora.feature.voice

import android.content.Context
import android.content.Intent
import com.aktech.nexora.core.crypto.Crypto
import com.aktech.nexora.core.crypto.E2ee
import com.aktech.nexora.core.data.CallPeer
import com.aktech.nexora.core.data.CallSocket
import com.aktech.nexora.core.data.IceServer
import com.aktech.nexora.core.data.NexoraApi
import com.aktech.nexora.core.data.Session
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlinx.coroutines.suspendCancellableCoroutine
import org.webrtc.AudioTrack
import org.webrtc.Camera1Enumerator
import org.webrtc.Camera2Enumerator
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpTransceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoTrack
import org.webrtc.audio.JavaAudioDeviceModule
import java.util.concurrent.ConcurrentHashMap

/**
 * A voice or video call: one `PeerConnection` per other participant, media
 * directly between the two devices, and `call-service` as a switchboard that
 * never sees a frame.
 *
 * The port of `apps/desktop/src/services/mesh.ts`. The two rules it exists to
 * keep are section 28 of CLAUDE.md - never proxy media, never run a media
 * server - and the fingerprint signature that stops the relay sitting in the
 * middle of a connection both ends believe is direct.
 *
 * ponytail: no simulcast and no bandwidth ladder. The mesh ceiling is the
 * desktop's - comfortable to five, video degrades past six - and a phone hits
 * it sooner. Adaptive layers are the upgrade if calls get bigger, and an SFU is
 * the answer if they get much bigger, which is a deliberate future decision
 * rather than something to smuggle in here.
 */
class VoiceEngine(private val context: Context) {

    data class Participant(
        val peer: CallPeer,
        val track: VideoTrack? = null,
        val speaking: Boolean = false,
        val connected: Boolean = false,
    )

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
            .setAudioDeviceModule(JavaAudioDeviceModule.builder(context).createAudioDeviceModule())
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

    private var selfPeerId: String? = null
    private var channelId: String? = null
    private var channelKey: String = ""
    private var iceServers: List<PeerConnection.IceServer> = emptyList()
    private var detach: (() -> Unit)? = null

    private var audioTrack: AudioTrack? = null
    private var videoCapturer: VideoCapturer? = null
    private var videoTrack: VideoTrack? = null
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
                CallSocket.send(JSONObject().put("type", "join").put("channelId", channelId))
                // From here the call has to survive the screen going off.
                CallService.start(context, "In a Nexora call")
            } catch (error: Exception) {
                fail(error.message ?: "The call could not start")
            }
        }
    }

    fun leave() {
        CallSocket.send(JSONObject().put("type", "leave"))
        teardown()
        _state.value = CallState.Idle
        channelId = null
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
        CallService.stop(context)
        detach?.invoke()
        detach = null
        connections.values.forEach { it.close() }
        connections.clear()
        stopCamera()
        audioTrack?.dispose()
        audioTrack = null
        _participants.value = emptyList()
        _localVideo.value = null
        _sharing.value = false
    }

    fun dispose() {
        leave()
        eglBase.release()
    }

    // --- local media ---

    private fun startMicrophone() {
        if (audioTrack != null) return
        val source = factory.createAudioSource(MediaConstraints())
        audioTrack = factory.createAudioTrack("nexora-audio", source).apply {
            setEnabled(!_muted.value)
        }
    }

    fun toggleMute() {
        _muted.update { !it }
        audioTrack?.setEnabled(!_muted.value)
    }

    /** The camera. [screenIntent] instead turns the capture into a screen share. */
    fun startCamera(front: Boolean = true) {
        if (videoCapturer != null) stopCamera()
        val enumerator = if (Camera2Enumerator.isSupported(context)) {
            Camera2Enumerator(context)
        } else {
            Camera1Enumerator(true)
        }
        val name = enumerator.deviceNames.firstOrNull {
            if (front) enumerator.isFrontFacing(it) else enumerator.isBackFacing(it)
        } ?: enumerator.deviceNames.firstOrNull() ?: return

        beginCapture(enumerator.createCapturer(name, null), 960, 540, 24)
        _cameraOn.value = true
    }

    /**
     * Screen share. The intent is what `MediaProjectionManager` handed back
     * after the system asked - Android will not let an app capture the screen
     * on any other terms, and that consent is the right place for it.
     */
    fun startScreenShare(permission: Intent) {
        if (videoCapturer != null) stopCamera()
        beginCapture(
            ScreenCapturerAndroid(permission, object : android.media.projection.MediaProjection.Callback() {
                override fun onStop() {
                    scope.launch { stopCamera() }
                }
            }),
            1280,
            720,
            15,
        )
        _sharing.value = true
    }

    private fun beginCapture(capturer: VideoCapturer, width: Int, height: Int, fps: Int) {
        val helper = SurfaceTextureHelper.create("nexora-capture", eglBase.eglBaseContext)
        val source = factory.createVideoSource(capturer.isScreencast)
        capturer.initialize(helper, context, source.capturerObserver)
        capturer.startCapture(width, height, fps)

        surfaceHelper = helper
        videoCapturer = capturer
        videoTrack = factory.createVideoTrack("nexora-video", source)
        _localVideo.value = videoTrack

        // Every existing connection has to be told there is video now.
        connections.values.forEach { it.attachVideo(videoTrack) }
    }

    fun stopCamera() {
        runCatching { videoCapturer?.stopCapture() }
        videoCapturer?.dispose()
        videoCapturer = null
        surfaceHelper?.dispose()
        surfaceHelper = null
        videoTrack?.dispose()
        videoTrack = null
        _localVideo.value = null
        _cameraOn.value = false
        _sharing.value = false
        connections.values.forEach { it.attachVideo(null) }
    }

    // --- signalling ---

    private suspend fun onSignal(event: JSONObject) {
        when (event.optString("type")) {
            "ready" -> selfPeerId = event.optString("peerId")

            "joined" -> {
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
        val link = PeerLink(peer, polite = self > peer.peerId)
        connections[peer.peerId] = link
        _participants.update { it + Participant(peer) }
        link.start()
    }

    private fun send(to: String, data: JSONObject) {
        CallSocket.send(JSONObject().put("type", "signal").put("to", to).put("data", data))
    }

    // --- one connection to one other participant ---

    private inner class PeerLink(val peer: CallPeer, val polite: Boolean) {
        private val pc: PeerConnection = factory.createPeerConnection(
            PeerConnection.RTCConfiguration(iceServers).apply {
                sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
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

                override fun onTrack(transceiver: RtpTransceiver) {
                    val track = transceiver.receiver.track()
                    if (track is VideoTrack) {
                        _participants.update { list ->
                            list.map {
                                if (it.peer.peerId == peer.peerId) it.copy(track = track) else it
                            }
                        }
                    }
                }

                override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
                    val up = state == PeerConnection.PeerConnectionState.CONNECTED
                    _participants.update { list ->
                        list.map {
                            if (it.peer.peerId == peer.peerId) it.copy(connected = up) else it
                        }
                    }
                }

                override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) = Unit
                override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
                override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
                override fun onAddStream(stream: org.webrtc.MediaStream) = Unit
                override fun onRemoveStream(stream: org.webrtc.MediaStream) = Unit
                override fun onDataChannel(channel: org.webrtc.DataChannel) = Unit
                override fun onRenegotiationNeeded() = Unit
            },
        ) ?: error("This device could not open a peer connection")

        private var videoSender: org.webrtc.RtpSender? = null

        fun start() {
            audioTrack?.let { pc.addTrack(it, listOf("nexora")) }
            videoTrack?.let { videoSender = pc.addTrack(it, listOf("nexora")) }
            // Only the impolite side offers. Both offering at once is the
            // glare the polite/impolite rule exists to settle.
            if (!polite) scope.launch { offer() }
        }

        fun attachVideo(track: VideoTrack?) {
            when {
                track == null -> videoSender?.let { pc.removeTrack(it); videoSender = null }
                videoSender == null -> videoSender = pc.addTrack(track, listOf("nexora"))
                else -> videoSender?.setTrack(track, false)
            }
            if (!polite) scope.launch { offer() }
        }

        private suspend fun offer() {
            val description = create(offer = true) ?: return
            pc.setLocalDescription(NoopSdpObserver, description)
            sendDescription("offer", description)
        }

        fun onSignal(data: JSONObject) {
            when (data.optString("kind")) {
                "offer", "answer" -> scope.launch { onDescription(data) }
                "ice" -> data.optJSONObject("candidate")?.let {
                    pc.addIceCandidate(
                        IceCandidate(
                            it.optString("sdpMid"),
                            it.optInt("sdpMLineIndex"),
                            it.optString("candidate"),
                        ),
                    )
                }
            }
        }

        private suspend fun onDescription(data: JSONObject) {
            val sdp = data.optString("sdp")
            val proof = data.optString("fingerprintProof")

            // The relay has never held a channel key, so it cannot sign a
            // fingerprint of its own. A signature that does not check out means
            // somebody in the middle, and the connection is never made.
            if (!verifyFingerprint(sdp, proof)) {
                _state.value = CallState.Failed(
                    "Refused ${peer.username}: their connection fingerprint is not signed with this channel's key",
                )
                return
            }

            val kind = data.optString("kind")
            val type = if (kind == "offer") {
                SessionDescription.Type.OFFER
            } else {
                SessionDescription.Type.ANSWER
            }
            pc.setRemoteDescription(NoopSdpObserver, SessionDescription(type, sdp))

            if (kind == "offer") {
                val answer = create(offer = false) ?: return
                pc.setLocalDescription(NoopSdpObserver, answer)
                sendDescription("answer", answer)
            }
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
                        if (continuation.isActive) continuation.resumeWith(Result.success(null))
                    }

                    override fun onSetSuccess() = Unit
                    override fun onSetFailure(error: String?) = Unit
                }
                val constraints = MediaConstraints()
                if (offer) pc.createOffer(observer, constraints) else pc.createAnswer(observer, constraints)
            }

        fun close() {
            runCatching { pc.close() }
            runCatching { pc.dispose() }
        }
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

private object NoopSdpObserver : SdpObserver {
    override fun onCreateSuccess(description: SessionDescription?) = Unit
    override fun onSetSuccess() = Unit
    override fun onCreateFailure(error: String?) = Unit
    override fun onSetFailure(error: String?) = Unit
}
