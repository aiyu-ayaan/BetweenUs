package com.aatech.betweenus.feature.remote

import android.content.Context
import com.aatech.betweenus.core.data.IceServer
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.RemoteScreen
import com.aatech.betweenus.core.data.RemoteSocket
import com.aatech.betweenus.core.data.Session
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.VideoTrack

/**
 * The controller half of a remote-desktop session.
 *
 * `remote-gateway` relays the handshake, the offer, the answer, the ICE and
 * every mouse and key event, and enforces the permissions. It never carries the
 * screen: that arrives over WebRTC directly from the agent, exactly as call
 * media does, which is the only shape that survives a Cloudflare Tunnel without
 * opening a port.
 *
 * There is no agent here on purpose. A phone is a controller; controlling a
 * phone is a different product, and section 8 of the roadmap says so.
 */
class RemoteEngine(context: Context) {

    sealed interface State {
        data object Idle : State
        data object Starting : State
        data class Live(val sessionId: String, val machineName: String) : State
        data class Ended(val reason: String) : State
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    /**
     * RTC signals, applied strictly one at a time.
     *
     * Events are dispatched with a `launch` per event and nothing waits for
     * them, so two offers arriving close together - which switching the shared
     * screen produces, since it renegotiates - used to run concurrently and
     * interleave at every suspension point. The second then reached
     * `setLocalDescription` after the first had already driven the connection to
     * STABLE, which fails with "Called in wrong state: stable". The same shape
     * as `VoiceEngine.PeerLink.signals` and `mesh.ts`.
     */
    private val signals = Mutex()

    val eglBase: EglBase = EglBase.create()

    private val factory: PeerConnectionFactory by lazy {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .createInitializationOptions(),
        )
        PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()

    private val _screen = MutableStateFlow<VideoTrack?>(null)
    val screen: StateFlow<VideoTrack?> = _screen.asStateFlow()

    private val _screens = MutableStateFlow<List<RemoteScreen>>(emptyList())
    val screens: StateFlow<List<RemoteScreen>> = _screens.asStateFlow()

    private val _activeScreenId = MutableStateFlow<String?>(null)
    val activeScreenId: StateFlow<String?> = _activeScreenId.asStateFlow()

    /** What the gateway says this session may do *now*, not what was asked for. */
    private val _permissions = MutableStateFlow<List<String>>(emptyList())
    val permissions: StateFlow<List<String>> = _permissions.asStateFlow()

    private val _controlGranted = MutableStateFlow(false)
    val controlGranted: StateFlow<Boolean> = _controlGranted.asStateFlow()

    private var connection: PeerConnection? = null
    private var sessionId: String? = null
    private var detach: (() -> Unit)? = null

    fun start(machineId: String) {
        if (_state.value !is State.Idle) return
        _state.value = State.Starting

        scope.launch {
            try {
                val session = BetweenUsApi.startRemoteSession(machineId)
                sessionId = session.sessionId
                _permissions.value = session.permissions
                _controlGranted.value = session.permissions.contains("REMOTE_CONTROL")
                openConnection(session.iceServers)

                detach = RemoteSocket.on { event -> scope.launch { onEvent(event) } }
                Session.accessToken?.let { RemoteSocket.connect(it) }
                _state.value = State.Live(session.sessionId, session.machineName)
            } catch (error: Exception) {
                _state.value = State.Ended(error.message ?: "The session could not start")
            }
        }
    }

    fun end() {
        sessionId?.let { id ->
            RemoteSocket.send(JSONObject().put("type", "session.end"))
            scope.launch { runCatching { BetweenUsApi.endRemoteSession(id) } }
        }
        detach?.invoke()
        detach = null
        connection?.let { runCatching { it.close() }; runCatching { it.dispose() } }
        connection = null
        _screen.value = null
        _screens.value = emptyList()
        _state.value = State.Idle
        sessionId = null
    }

    fun dispose() {
        end()
        eglBase.release()
    }

    // --- input ---
    //
    // Coordinates are a fraction of the screen, because only the agent knows
    // what its display measures. The gateway refuses all of this unless the
    // session holds REMOTE_CONTROL; the checks here only keep the UI honest.

    fun mouse(action: String, x: Float, y: Float, button: String? = null, deltaY: Float? = null) {
        if (!_controlGranted.value) return
        RemoteSocket.send(
            JSONObject()
                .put("type", "input.mouse")
                .put("action", action)
                .put("x", x.toDouble())
                .put("y", y.toDouble())
                .apply {
                    button?.let { put("button", it) }
                    deltaY?.let { put("deltaY", it.toDouble()) }
                },
        )
    }

    fun key(action: String, key: String, code: String, modifiers: List<String> = emptyList()) {
        if (!_controlGranted.value) return
        RemoteSocket.send(
            JSONObject()
                .put("type", "input.key")
                .put("action", action)
                .put("key", key)
                .put("code", code)
                .put("modifiers", JSONArray().also { array -> modifiers.forEach { array.put(it) } }),
        )
    }

    /**
     * Asks the machine for the mouse and keyboard, the way RDP does. Answered
     * immediately when the grant already allows it; otherwise it goes to
     * whoever is sitting at the machine, who is the one authority higher than
     * a stored grant.
     */
    fun requestControl() = RemoteSocket.send(JSONObject().put("type", "control.request"))

    fun releaseControl() = RemoteSocket.send(JSONObject().put("type", "control.release"))

    fun selectScreen(screenId: String) =
        RemoteSocket.send(JSONObject().put("type", "screen.select").put("screenId", screenId))

    /**
     * This phone's clipboard, onto the machine's.
     *
     * The check here is a courtesy - the gateway refuses `clipboard.set` from
     * a session without `REMOTE_CLIPBOARD` and is the one enforcing it. What
     * this buys is a button that is not offered rather than one that silently
     * does nothing.
     */
    fun sendClipboard(text: String) {
        if (!mayClipboard()) return
        RemoteSocket.send(JSONObject().put("type", "clipboard.set").put("text", text))
    }

    fun mayClipboard(): Boolean = _permissions.value.contains("REMOTE_CLIPBOARD")

    /**
     * The machine's clipboard, as it last arrived.
     *
     * Not written to this phone's clipboard the moment it lands: a remote
     * machine that could overwrite the clipboard of the phone watching it
     * whenever it liked is a machine that can put a URL under somebody's next
     * paste. It is offered, and copying it is a tap - the same way the far
     * direction is a tap rather than a poll.
     */
    private val _remoteClipboard = MutableStateFlow<String?>(null)
    val remoteClipboard: StateFlow<String?> = _remoteClipboard.asStateFlow()

    // --- signalling ---

    private fun openConnection(iceServers: List<IceServer>) {
        connection = factory.createPeerConnection(
            PeerConnection.RTCConfiguration(iceServers.map { it.toWebRtc() }).apply {
                sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            },
            object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: IceCandidate) {
                    signal(
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
                    (transceiver.receiver.track() as? VideoTrack)?.let { _screen.value = it }
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
        )
    }

    private suspend fun onEvent(event: JSONObject) {
        when (event.optString("type")) {
            "session.ended" -> {
                _state.value = State.Ended(event.optString("reason").ifEmpty { "The session ended" })
                end()
            }

            "screens" -> {
                val screens = event.optJSONArray("screens")
                _screens.value = (0 until (screens?.length() ?: 0))
                    .map { RemoteScreen.from(screens!!.getJSONObject(it)) }
                _activeScreenId.value = event.optString("activeId")
            }

            "control.changed" -> {
                _permissions.value = (0 until (event.optJSONArray("permissions")?.length() ?: 0))
                    .map { event.getJSONArray("permissions").getString(it) }
                _controlGranted.value = event.optBoolean("granted")
            }

            // The machine's clipboard, which the gateway only relays to a
            // session holding REMOTE_CLIPBOARD.
            "clipboard.set" -> _remoteClipboard.value = event.optString("text").ifEmpty { null }

            "rtc.signal" -> event.optJSONObject("data")?.let { signals.withLock { onRtcSignal(it) } }
        }
    }

    /** Called only under [signals]; the whole body is a critical section over the connection. */
    private suspend fun onRtcSignal(data: JSONObject) {
        val pc = connection ?: return
        when (data.optString("kind")) {
            // The agent is the one with a screen to send, so it is the one that
            // offers. This end only ever answers.
            "offer" -> {
                pc.setRemoteDescription(
                    NoopSdp,
                    SessionDescription(SessionDescription.Type.OFFER, data.optString("sdp")),
                )
                val answer = suspendCancellableCoroutine<SessionDescription?> { continuation ->
                    pc.createAnswer(
                        object : SdpObserver {
                            override fun onCreateSuccess(description: SessionDescription) {
                                if (continuation.isActive) continuation.resumeWith(Result.success(description))
                            }

                            override fun onCreateFailure(error: String?) {
                                if (continuation.isActive) continuation.resumeWith(Result.success(null))
                            }

                            override fun onSetSuccess() = Unit
                            override fun onSetFailure(error: String?) = Unit
                        },
                        MediaConstraints(),
                    )
                } ?: return
                pc.setLocalDescription(NoopSdp, answer)
                signal(JSONObject().put("kind", "answer").put("sdp", answer.description))
            }

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

    private fun signal(data: JSONObject) =
        RemoteSocket.send(JSONObject().put("type", "rtc.signal").put("data", data))
}

private fun IceServer.toWebRtc(): PeerConnection.IceServer =
    PeerConnection.IceServer.builder(urls)
        .setUsername(username.orEmpty())
        .setPassword(credential.orEmpty())
        .createIceServer()

private object NoopSdp : SdpObserver {
    override fun onCreateSuccess(description: SessionDescription?) = Unit
    override fun onSetSuccess() = Unit
    override fun onCreateFailure(error: String?) = Unit
    override fun onSetFailure(error: String?) = Unit
}
