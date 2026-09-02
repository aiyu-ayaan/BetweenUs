package com.aatech.betweenus.feature.voice

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import com.aatech.betweenus.core.crypto.Crypto
import com.aatech.betweenus.core.crypto.E2ee
import com.aatech.betweenus.core.data.CallPeer
import com.aatech.betweenus.core.data.CallSocket
import com.aatech.betweenus.core.data.IceServer
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.PresenceSocket
import com.aatech.betweenus.core.data.Session
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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.math.sqrt
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
         * Never sent from a phone, and see [ShareAudio] for why that is not the
         * same as a phone sharing its screen in silence: libwebrtc's Android
         * build has one audio device module and no way to feed a second audio
         * track, so the sound of a shared screen is mixed into [MIC] instead.
         *
         * The slot still exists, because dropping it would shift every m-line
         * after it and the desktop counts on the order.
         */
        SCREEN_AUDIO(MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO, "screenAudio"),
    }

    data class Participant(
        val peer: CallPeer,
        val camera: VideoTrack? = null,
        val screen: VideoTrack? = null,
        /** What they say their microphone is doing, over the data channel. */
        val micEnabled: Boolean = true,
        /**
         * They are on a phone call, or something else took their audio.
         *
         * Different from muted on purpose: they did not choose it, and it ends
         * when the other call does. Sent over the same data channel; false for
         * a client too old to mention it.
         */
        val held: Boolean = false,
        /**
         * What they say their camera and their screen share are doing, on the
         * same data channel.
         *
         * These decide whether a picture is shown, and frames decided only
         * whether one has ever arrived. Frames stopping is not sharing
         * stopping: a share of a screen nobody is touching decodes nothing for
         * minutes, and reading that as the end closed the stage under whoever
         * was watching and offered them the share again.
         *
         * Null until their first media state lands, which is the one moment
         * the frames are all there is to go on.
         */
        val cameraDeclared: Boolean? = null,
        val screenDeclared: Boolean? = null,
        val speaking: Boolean = false,
        val connected: Boolean = false,
        /**
         * The link is down and being retried.
         *
         * Kept apart from `connected` rather than folded into it, because a
         * tile has three things to say and not two: connecting for the first
         * time, carrying media, and having carried it a moment ago. Only the
         * third is worth a spinner, and only the third is worth apologising
         * for.
         */
        val reconnecting: Boolean = false,
        /** Retried until [CallRecovery] ran out of patience. */
        val lost: Boolean = false,
    ) {
        /** What a tile shows. A share wins over a camera; a phone has one tile. */
        val video: VideoTrack? get() = visibleScreen ?: visibleCamera

        /** The share, unless they have said they stopped sharing. */
        val visibleScreen: VideoTrack? get() = if (screenDeclared == false) null else screen

        /** The camera, unless they have said they turned it off. */
        val visibleCamera: VideoTrack? get() = if (cameraDeclared == false) null else camera
    }

    sealed interface CallState {
        data object Idle : CallState
        data class Connecting(val channelId: String) : CallState
        data class Live(val channelId: String) : CallState
        data class Failed(val reason: String) : CallState
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    val eglBase: EglBase = EglBase.create()

    /**
     * Held, because muting has to reach the microphone itself and not only the
     * track carrying it. See [toggleMute].
     */
    private var audioDevice: JavaAudioDeviceModule? = null

    private var peerFactory: PeerConnectionFactory? = null

    /**
     * What the live device module was built to do, so [refreshAudioStack] can
     * tell a changed setting from an unchanged one.
     */
    private var audioSetup: AudioPrefs.HardwareProcessing? = null

    /**
     * The factory, building the audio stack underneath it if nothing has yet.
     *
     * This used to be a `by lazy`, and that was the echo bug rather than a
     * detail of it. Which canceller runs is chosen when the device module is
     * *constructed*, so a module built once per process is a pair of switches
     * in the settings screen that could only ever have described the state of
     * the app at its very first call.
     */
    private fun factory(): PeerConnectionFactory =
        peerFactory ?: buildAudioStack(AudioPrefs.hardwareProcessing(context))

    private fun buildAudioStack(setup: AudioPrefs.HardwareProcessing): PeerConnectionFactory {
        val module = JavaAudioDeviceModule.builder(context)
            // The two flags the settings screen is actually about. `true` means
            // "let the phone do it", which stands WebRTC's own AEC3 and NS down
            // in favour of the OEM's - see [AudioPrefs.hardwareProcessingFor]
            // for when that is the wrong trade, which on a loudspeaker it
            // usually is.
            .setUseHardwareAcousticEchoCanceler(setup.echoCanceller)
            .setUseHardwareNoiseSuppressor(setup.noiseSuppressor)
            // Where the green ring around your own tile comes from. Read off
            // the microphone itself rather than off a peer connection's
            // statistics, for one reason: the statistics only exist once
            // somebody else is in the call, and the first thing anybody does
            // in an empty channel is check whether they are being heard.
            .setSamplesReadyCallback(::onMicrophoneSamples)
            // Input sensitivity. This is the hook that is handed the live
            // capture buffer *before* it reaches the encoder, which is what
            // makes a real gate possible rather than a mute toggle driven by a
            // meter - see [MicGate], which explains why the other two hooks
            // cannot do it.
            .setAudioBufferCallback(::onCaptureBuffer)
            .createAudioDeviceModule()

        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .createInitializationOptions(),
        )
        val built = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .setAudioDeviceModule(module)
            .createPeerConnectionFactory()

        audioDevice = module
        peerFactory = built
        audioSetup = setup
        return built
    }

    /**
     * Rebuilds the audio stack when the processing settings no longer match it.
     *
     * **Between calls, and never during one.** A device module cannot be
     * swapped underneath a `PeerConnectionFactory` - the factory takes it at
     * construction - so honouring a changed setting means disposing the
     * factory, and the factory owns every live peer connection, the microphone
     * track and the video source. Doing that mid-call would drop every peer to
     * rebuild them a moment later, which is a worse thing to do to somebody's
     * call than letting the setting wait for the next one.
     *
     * So the point it happens is the start of [join], before anything has been
     * created from the factory and after the previous call's teardown has
     * disposed what it made. A setting changed during a call therefore applies
     * to the next call, and the settings screen says so rather than appearing
     * to do something it is not doing.
     *
     * Nothing happens at all when the settings are unchanged, which is the
     * ordinary case: the stack is built once and kept, exactly as before.
     */
    private fun refreshAudioStack() {
        val wanted = AudioPrefs.hardwareProcessing(context)
        if (peerFactory != null && audioSetup == wanted) return
        releaseAudioStack()
        buildAudioStack(wanted)
    }

    private fun releaseAudioStack() {
        // The factory first: it holds native objects that reference the module,
        // and releasing the module out from under it is a crash rather than a
        // leak.
        runCatching { peerFactory?.dispose() }
        runCatching { audioDevice?.release() }
        peerFactory = null
        audioDevice = null
        audioSetup = null
    }

    private val connections = ConcurrentHashMap<String, PeerLink>()

    private val _state = MutableStateFlow<CallState>(CallState.Idle)
    val state: StateFlow<CallState> = _state.asStateFlow()

    private val _liveSince = MutableStateFlow<Long?>(null)

    /**
     * When this call started carrying anything, as an elapsed-realtime stamp,
     * or null when there is no call.
     *
     * Elapsed realtime rather than wall clock, because a duration measured
     * against the wall clock jumps whenever the network hands the phone a
     * corrected time - and a call that has been running four minutes must not
     * suddenly read as an hour because a timezone or an NTP sync landed.
     *
     * Stamped at `joined` rather than at `join`: the seconds somebody spends
     * waiting for a connection are not seconds of a call, and a counter that
     * starts before anybody can hear you is a counter that lies about the one
     * thing it is for.
     */
    val liveSince: StateFlow<Long?> = _liveSince.asStateFlow()

    private val _participants = MutableStateFlow<List<Participant>>(emptyList())
    val participants: StateFlow<List<Participant>> = _participants.asStateFlow()

    private val _muted = MutableStateFlow(false)
    val muted: StateFlow<Boolean> = _muted.asStateFlow()

    /**
     * The push-to-talk control being held, which is not the same as unmuted.
     *
     * Only consulted when the mode is on - see [PushToTalk.shouldPassAudio],
     * which is where the four-way decision lives and is tested. False whenever
     * the call screen is not on top of a finger, because a microphone that
     * opens and is never told to close is the whole failure this feature has to
     * avoid.
     */
    private val _talking = MutableStateFlow(false)
    val talking: StateFlow<Boolean> = _talking.asStateFlow()

    /**
     * Whether this microphone is hearing a voice right now.
     *
     * The same fact [Participant.speaking] carries for everybody else, for the
     * one participant no peer connection reports on: yourself. Without it the
     * green ring was something that happened to other people, and the question
     * it answers - "is this thing picking me up?" - is the one you have about
     * your own microphone and never about theirs.
     */
    private val _selfSpeaking = MutableStateFlow(false)
    val selfSpeaking: StateFlow<Boolean> = _selfSpeaking.asStateFlow()

    /**
     * How loud the microphone is *before* the gate, in dBFS, and whether the
     * gate is letting it through.
     *
     * Before the gate on purpose: this is what the settings screen draws a
     * meter from, and a meter that showed the gated signal would sit at
     * silence exactly when somebody is trying to find the threshold that stops
     * it doing that.
     */
    private val _micLevelDb = MutableStateFlow(-100.0)
    val micLevelDb: StateFlow<Double> = _micLevelDb.asStateFlow()

    private val _gateOpen = MutableStateFlow(true)
    val gateOpen: StateFlow<Boolean> = _gateOpen.asStateFlow()

    /**
     * What each link is doing, in numbers, for the connection panel.
     *
     * Rebuilt from the same one-second poll that decides who is speaking - the
     * report is already being fetched and parsed, so this costs the parse and
     * nothing else. Empty until somebody else is in the call: media is peer to
     * peer, so with nobody to measure against there is nothing to measure.
     */
    private val _stats = MutableStateFlow<List<LinkStats>>(emptyList())
    val stats: StateFlow<List<LinkStats>> = _stats.asStateFlow()

    /**
     * Whether the switchboard is reachable, for the one line at the top of the
     * call screen.
     *
     * Not the same question as whether media is flowing: signalling can be down
     * for a minute while two peers carry on talking perfectly, because nothing
     * about an established connection goes through the server. It still has to
     * be said, because in that state nobody new can join and the roster
     * everybody else sees no longer has this device in it.
     */
    private val _signalling = MutableStateFlow(true)
    val signalling: StateFlow<Boolean> = _signalling.asStateFlow()

    /**
     * When the last frame loud enough to count arrived, so the ring does not
     * strobe on the gaps between words.
     *
     * Written and read on the audio thread only.
     */
    private var lastLoudAt = 0L

    /** The gate's state, touched only on the audio thread. */
    private var gateState = MicGate.CLOSED
    private var gateGain = 1.0
    /** Throttles the meter: the flow does not need three hundred writes a second. */
    private var levelReportedAt = 0L

    /**
     * What another app is doing to this call's audio.
     *
     * A phone call, a voice assistant or a navigation prompt all arrive the
     * same way - as audio focus being taken - and the two useful answers are
     * different. Something short and spoken over the top is a DUCK: the call
     * carries on quieter. A cellular call is a HOLD: the microphone closes and
     * playback stops, because the person is talking to somebody else and the
     * room must not be sent to this call while they do.
     */
    enum class Interruption { NONE, DUCK, HOLD }

    private val _interruption = MutableStateFlow(Interruption.NONE)
    val interruption: StateFlow<Interruption> = _interruption.asStateFlow()

    private val _cameraOn = MutableStateFlow(false)
    val cameraOn: StateFlow<Boolean> = _cameraOn.asStateFlow()

    private val _isFrontCamera = MutableStateFlow(true)
    val isFrontCamera: StateFlow<Boolean> = _isFrontCamera.asStateFlow()

    private val _sharing = MutableStateFlow(false)
    val sharing: StateFlow<Boolean> = _sharing.asStateFlow()

    /**
     * Who the call says is sharing their screen, or null for nobody.
     *
     * One share at a time, arbitrated by the gateway - see `screen.claim`. A
     * second share replaces the first rather than joining it, which is what
     * every other product does and the only shape a single stage can have.
     */
    private val _screenHolder = MutableStateFlow<String?>(null)
    val screenHolder: StateFlow<String?> = _screenHolder.asStateFlow()

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

    /**
     * The two ways a call ends without anybody pressing anything: its
     * switchboard became unreachable, or everybody else left and nobody came
     * back. See [startWatchdogs].
     */
    private var watchdog: Job? = null

    /** Stops listening to the signalling socket's ups and downs. */
    private var socketWatch: (() -> Unit)? = null

    /** When the signalling socket last went away, while in a call. */
    @Volatile
    private var signallingLostAt: Long? = null

    /** When this device was last the only one in the call. */
    private var aloneSince: Long? = null

    /**
     * Offers and candidates that arrived before the peer they belong to was on
     * the roster.
     *
     * The relay sends `joined` before anybody's signalling, but "before" on two
     * different sockets is not an ordering anyone can rely on, and the far side
     * offers the instant it sees us. A signal dropped here is dropped for good:
     * the impolite peer offers once, so losing that one offer is a tile that
     * says "connecting..." for the life of the call. Held instead, and replayed
     * the moment the link exists.
     */
    private val earlySignals = ConcurrentHashMap<String, MutableList<JSONObject>>()

    /**
     * Peers announced before the relay had told us our own id. Politeness is
     * decided by comparing the two ids, so there is nothing to decide yet -
     * and the old answer, dropping them, was a roster the call never recovered.
     */
    private val earlyPeers = mutableListOf<CallPeer>()

    private var audioTrack: AudioTrack? = null

    /**
     * The sound of a shared screen, mixed into the microphone capture. See
     * [ShareAudio] for why it rides there rather than on its own slot.
     */
    private val shareAudio = ShareAudio()

    /**
     * The live projection while a share is running, so the playback capture can
     * be started on the audio thread - at the first buffer, which is the first
     * moment the rate and channel count it has to match are known.
     */
    private var shareProjection: android.media.projection.MediaProjection? = null
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
                // Between calls is the only safe moment to honour a changed
                // echo or noise setting, and this is it - see
                // [refreshAudioStack]. It has to come before the first thing
                // built from the factory, which is the microphone below.
                refreshAudioStack()

                // The channel key is what signs our DTLS fingerprint. Without
                // it there is nothing to prove the far side is talking to us and
                // not to the relay, so the call does not start.
                // Fresh, not the epoch this phone happened to cache: held keys
                // survive a restart here, so a cached one can be days behind
                // what the channel has rotated to - and joining a call under a
                // dead epoch is the "their media key does not match" refusal
                // seen from the other side.
                channelKey = E2ee.callKeyForChannel(channelId, refresh = true)
                iceServers = BetweenUsApi.callIce(channelId).map { it.toWebRtc() }

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
                startWatchdogs()

                // From here the call has to survive the screen going off, and
                // the earpiece is not where a call this app starts belongs.
                CallService.attach(
                    onHangUp = { scope.launch { leave() } },
                    onToggleMute = { scope.launch { toggleMute() } },
                )
                CallService.start(context, "In a BetweenUs call", foregroundTypes(), _muted.value)
                CallAudio.start(context)

                startPolling()
            } catch (error: Exception) {
                fail(error.message ?: "The call could not start")
            }
        }
    }

    fun leave() {
        // Only for a call that was up: leaving one that never connected has
        // nothing to say goodbye to.
        if (_state.value is CallState.Live) CallTones.play(CallTones.Tone.LEAVE)
        // The report goes with the goodbye, which is the only way the server can
        // ever know it: it is not in the media path and has nothing to count.
        CallSocket.leave(CallUsage.leaveEvent(usageReport()))
        retiredLinks.clear()
        channelId?.let { PresenceSocket.leaveVoice(it) }
        // The state goes first, and it matters. See `teardown`.
        _state.value = CallState.Idle
        _liveSince.value = null
        channelId = null
        _screenHolder.value = null
        teardown()
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
     * The two ways a call ends with nobody pressing anything.
     *
     * **The switchboard went away.** The signalling socket reconnects itself
     * and rejoins, and a tunnel is a real thing that ends - so a drop is not an
     * ending. But past [CallRecovery.SIGNALLING_DEADLINE_MS] the roster has
     * long since dropped this device, nobody else can see it in the call, and
     * an open microphone with a foreground service is a lie told to its owner.
     *
     * **Everybody else left.** Being alone is normal - it is how every call
     * starts and how every meeting ends - so it is timed rather than acted on.
     * What is not normal is holding a microphone open for the rest of the
     * afternoon because a call was never left.
     *
     * One coroutine for both, ticking once a second, because two would be two
     * things to cancel and this is not expensive.
     */
    private fun startWatchdogs() {
        watchdog?.cancel()
        socketWatch?.invoke()

        signallingLostAt = if (CallSocket.connected) null else System.currentTimeMillis()
        aloneSince = null
        _signalling.value = CallSocket.connected

        socketWatch = CallSocket.onConnection { up ->
            signallingLostAt = if (up) null else System.currentTimeMillis()
            _signalling.value = up
        }

        watchdog = scope.launch {
            while (isActive) {
                delay(1_000)
                if (!inCall()) continue
                val now = System.currentTimeMillis()

                signallingLostAt?.let { lostAt ->
                    if (now - lostAt >= CallRecovery.SIGNALLING_DEADLINE_MS) {
                        _problem.value = "The call server could not be reached, so the call ended."
                        leave()
                        return@launch
                    }
                }

                // Only once the call is actually up. A `Connecting` call has
                // nobody in it yet by definition, and the join timeout is what
                // covers that.
                if (_state.value is CallState.Live && _participants.value.isEmpty()) {
                    val since = aloneSince ?: now.also { aloneSince = it }
                    if (now - since >= CallRecovery.ALONE_MS) {
                        _problem.value = "You were the only one here, so the call ended."
                        leave()
                        return@launch
                    }
                } else {
                    aloneSince = null
                }
            }
        }
    }

    private fun stopWatchdogs() {
        watchdog?.cancel()
        watchdog = null
        socketWatch?.invoke()
        socketWatch = null
        signallingLostAt = null
        aloneSince = null
        // Not a call any more, so not a call with a problem either.
        _signalling.value = true
    }

    /**
     * A link this device could not get back, said once.
     *
     * Once per call rather than once per peer: in a mesh a network bad enough
     * to lose one link usually loses all of them at the same moment, and four
     * banners saying the same thing is how a banner gets ignored.
     */
    private fun noteLostLink() {
        if (_problem.value != null) return
        _problem.value = "Lost the connection to somebody in this call."
    }

    /**
     * A failure has to leave as little behind as a clean exit does. Without
     * this a half-started call kept its microphone track and its socket
     * listener, and every retry added another listener to the pile.
     */
    private fun fail(reason: String) {
        _state.value = CallState.Failed(reason)
        teardown()
    }

    /**
     * Tears the call down. Both callers set the state *before* calling this,
     * and that is not a style choice.
     *
     * `stopVideo` ends with `afterMediaChange`, which restarts the foreground
     * service whenever `inCall()` is true - it has to, because giving up the
     * camera changes the types the service may legally claim. With the state
     * still saying `Live`, hanging up stopped the service and then started it
     * again three lines later, and the call notification came back with a fresh
     * chronometer for a call that had ended. Hanging up from the notification
     * did the same thing, so it could not be got rid of at all.
     */
    private fun teardown() {
        pollJob?.cancel()
        pollJob = null
        joinTimeout?.cancel()
        joinTimeout = null
        stopWatchdogs()
        CallAudio.stop(context)
        CallService.stop(context)
        CallService.detach()
        detach?.invoke()
        detach = null
        // The socket goes with the call, and that is the fix rather than
        // tidiness. `ready` is sent once per connection and the listener above
        // has just been removed, so a socket that stays up and reconnects on
        // its own between calls - which is what a phone does - is a socket
        // whose new peer id nobody heard. The next call then computed who
        // offers from an id the far side has never seen, and connected about
        // half the time. A call starts on a connection of its own, as the
        // desktop's does, so `ready` is always heard and `selfPeerId` is always
        // this call's.
        CallSocket.disconnect()
        selfPeerId = null
        connections.values.forEach { it.close() }
        connections.clear()
        earlySignals.clear()
        earlyPeers.clear()
        stopVideo()
        audioTrack?.dispose()
        audioTrack = null
        _participants.value = emptyList()
        _localVideo.value = null
        _sharing.value = false
        // The microphone has stopped being read, so no buffer is coming to
        // turn this off; a ring left lit on the way out of a call is the sort
        // of thing that survives into the next one.
        lastLoudAt = 0L
        _selfSpeaking.value = false
        _stats.value = emptyList()
    }

    /**
     * Ends the call and gives the graphics context back. Only signing out gets
     * to do this: a screen going away is not the end of a call.
     */
    fun dispose() {
        leave()
        releaseAudioStack()
        eglBase.release()
        synchronized(VoiceEngine) {
            if (instance === this) {
                instance = null
                _live.value = null
            }
        }
    }

    // --- local media ---

    private fun startMicrophone() {
        if (audioTrack != null) return
        // What the room needs, not what the stack guesses - see AudioPrefs. A
        // headset in a quiet flat and a phone held at arm's length on a train
        // want opposite processing, and only the person holding it knows which.
        val constraints = MediaConstraints().apply {
            AudioPrefs.captureConstraints().forEach { (key, on) ->
                mandatory.add(MediaConstraints.KeyValuePair(key, on.toString()))
            }
        }
        val source = factory().createAudioSource(constraints)
        audioTrack = factory().createAudioTrack("betweenus-audio", source)
        applyMute()
    }

    /**
     * Mute in both places it can be meant.
     *
     * Disabling the track stops the samples being packetised, which is what
     * mute usually means. It does not stop the microphone being read - and
     * with the speaker carrying the call, a microphone that is still open is
     * still hearing the room and whatever the phone is playing. Muting the
     * device module is the part that actually closes the ear.
     *
     * Doing only the first is why a muted phone sharing its screen still sent
     * audio.
     */
    /**
     * One 10ms buffer of microphone audio, on the audio thread.
     *
     * Root-mean-square across the buffer, normalised to the same 0..1 scale
     * WebRTC's own `audioLevel` uses, so it can be compared against the same
     * [SPEAKING_LEVEL] every remote tile is judged by - one threshold, one
     * meaning, whichever side of the call somebody is on.
     *
     * This runs several hundred times a second and must stay cheap: an integer
     * pass over the buffer, and a write to the flow only when the answer
     * actually changes.
     */
    private fun onMicrophoneSamples(samples: JavaAudioDeviceModule.AudioSamples) {
        // Muted is not quiet - it is muted. The device module zeroes the buffer
        // for us, but a ring that waits for the next buffer to catch up would
        // stay green for a moment after the button, which reads as the mute
        // having not worked.
        if (_muted.value || _interruption.value == Interruption.HOLD) {
            lastLoudAt = 0L
            _selfSpeaking.value = false
            return
        }

        val level = rootMeanSquare(samples.data)
        val now = System.currentTimeMillis()
        if (level >= SPEAKING_LEVEL) lastLoudAt = now

        // Held briefly after the last loud buffer. Speech is mostly gaps at
        // this timescale - every stop consonant is one - and a ring that
        // followed the buffers exactly would flicker through a sentence.
        val speaking = now - lastLoudAt < SPEAKING_HOLD_MS
        if (_selfSpeaking.value != speaking) _selfSpeaking.value = speaking
    }

    /**
     * One 10 ms buffer of microphone audio, in place, on the audio thread,
     * before it reaches the encoder.
     *
     * Measured first and attenuated second, which is the ordering the whole
     * feature depends on: the level has to be read from the signal as it
     * arrived, or a closed gate would read its own silence and never open
     * again. That is exactly the trap `setMicrophoneMute` falls into, and why
     * it is not what closes this gate.
     *
     * Returns 0 to keep the capture timestamp the device module worked out.
     * Anything else here would be this thread claiming to know better than the
     * audio stack about when the sound arrived.
     */
    private fun onCaptureBuffer(
        buffer: java.nio.ByteBuffer,
        @Suppress("UNUSED_PARAMETER") audioFormat: Int,
        channelCount: Int,
        sampleRate: Int,
        bytesRead: Int,
        @Suppress("UNUSED_PARAMETER") captureTimeNs: Long,
    ): Long {
        // The sound of a shared screen, added to this buffer before anything
        // else looks at it - so the gate, the meter and the encoder all see the
        // one signal that is actually going out. See [ShareAudio].
        //
        // Started here rather than where the share starts, because this is the
        // first moment anything knows the rate and channel count the capture is
        // running at, and the two streams have to match to be added at all.
        val projection = shareProjection
        if (projection != null && !shareAudio.running) {
            if (!shareAudio.start(projection, sampleRate, channelCount)) {
                // Too old a platform, or the record would not build. The share
                // goes on without sound, which is what it did before this
                // existed; retrying every 10ms for the length of it would not.
                shareProjection = null
            }
        }
        shareAudio.mix(buffer, bytesRead)

        val threshold = AudioPrefs.sensitivityDb

        val level = MicGate.amplitudeToDb(MicGate.rootMeanSquare(buffer, bytesRead))
        val now = System.currentTimeMillis()
        // Twenty a second is more than a meter can be read at and a twentieth
        // of the writes every buffer would make.
        if (now - levelReportedAt >= METER_INTERVAL_MS) {
            levelReportedAt = now
            _micLevelDb.value = level
        }

        if (threshold == null) {
            // No gate. The buffer is left exactly as it arrived rather than
            // multiplied by one, which would be a pass over it for nothing.
            if (gateGain < 1.0) gateGain = 1.0
            gateState = MicGate.CLOSED.copy(open = true)
            if (!_gateOpen.value) _gateOpen.value = true
            return 0L
        }

        gateState = MicGate.step(gateState, level, threshold.toDouble(), now)
        if (_gateOpen.value != gateState.open) _gateOpen.value = gateState.open

        val samples = bytesRead / 2
        val target = MicGate.rampTo(gateGain, gateState.open, samples, sampleRate)
        gateGain = MicGate.applyRamp(buffer, bytesRead, gateGain, target)
        return 0L
    }

    private fun applyMute() {
        // Held means muted whatever the button says, and the button is left
        // alone: coming back from a phone call must not unmute somebody who
        // was muted before it rang. Push to talk is the third input, and all
        // four are decided in one tested place rather than here.
        val muted = !PushToTalk.shouldPassAudio(
            muted = _muted.value,
            held = _interruption.value == Interruption.HOLD,
            pushToTalk = AudioPrefs.pushToTalk,
            talking = _talking.value,
        )

        // Disabling the track stops everything it carries, and while a screen
        // is being shared it is carrying two things - see [ShareAudio]. Muting
        // yourself must not also mute the video you are showing people, so the
        // track stays enabled and the microphone is closed at the device module
        // instead. That is where mute genuinely happens either way: the buffer
        // arrives already zeroed, and the screen's sound is added to silence.
        //
        // Keyed on the share rather than on whether the playback capture
        // actually came up, which is decided later and on another thread. When
        // it did not, this leaves an enabled track carrying a zeroed buffer -
        // which is silence, the same silence the disabled track would have
        // been.
        audioTrack?.setEnabled(!muted || _sharing.value)
        runCatching { audioDevice?.setMicrophoneMute(muted) }
    }

    /**
     * Another app took the audio, or gave it back.
     *
     * Called from [CallAudio]'s focus listener, which is the only place the
     * system says so. Ducking lowers what this call plays; holding closes the
     * microphone as well and tells the far end, so a tile goes to "muted"
     * rather than to a silence nobody can explain.
     */
    fun setInterruption(interruption: Interruption) {
        if (_interruption.value == interruption) return
        _interruption.value = interruption
        applyMute()
        applyPlayback()
        publishMediaState()
        if (inCall()) CallService.start(context, callLabel(), foregroundTypes(), _muted.value)
    }

    /** How loud this call plays, which is the ducking half of an interruption. */
    private fun playbackGain(): Double = when (_interruption.value) {
        Interruption.NONE -> 1.0
        // Quiet enough to hear the prompt over, loud enough that the call has
        // not gone away.
        Interruption.DUCK -> 0.2
        Interruption.HOLD -> 0.0
    }

    private fun applyPlayback() {
        val gain = playbackGain()
        connections.values.forEach { it.applyPlayback(gain) }
    }

    /**
     * Muting is the track going quiet, not the sender going away: a slot that
     * empties would tell the far end the microphone was never there. The far
     * end learns about it from the media state on the data channel, which is
     * the only thing that can distinguish "muted" from "silent room".
     */
    /**
     * The talk control went down or came up.
     *
     * Idempotent, because the gesture that drives it can report a release more
     * than once - and because the screen closes it on the way out whether or
     * not anything was held.
     */
    fun setTalking(talking: Boolean) {
        if (_talking.value == talking) return
        _talking.value = talking
        applyMute()
        publishMediaState()
    }

    /**
     * The push-to-talk preference changed while a call was running.
     *
     * Turning the mode on has to close the microphone at once - otherwise it
     * stays open until something else happens to re-decide, and somebody who
     * just switched to push to talk is live without knowing it. Turning it off
     * has the mirror duty: nothing else would reopen the microphone.
     */
    fun refreshTalkMode() {
        _talking.value = false
        applyMute()
        publishMediaState()
    }

    fun toggleMute() {
        _muted.update { !it }
        applyMute()
        publishMediaState()
        // Only while there is a call. Starting the service to relabel a
        // notification for a call that has ended is how the notification came
        // back after everything had been hung up.
        if (inCall()) {
            CallService.start(context, callLabel(), foregroundTypes(), _muted.value)
        }
    }

    /**
     * Whether this call has a picture in it: anybody's camera, or a screen.
     *
     * Asked rather than observed, because the two callers are both a moment
     * rather than a stream - the app being left, and the dock deciding whether
     * there is anything to float. A flow would be a subscription for a question
     * asked twice.
     */
    fun hasPicture(): Boolean =
        _participants.value.any { it.video != null } ||
            (_localVideo.value != null && (_cameraOn.value || _sharing.value))

    private fun inCall(): Boolean =
        _state.value is CallState.Live || _state.value is CallState.Connecting

    /** The camera. [startScreenShare] instead turns the capture into a share. */
    fun startCamera(front: Boolean = _isFrontCamera.value) {
        _isFrontCamera.value = front
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

    /** Flip between front and back facing cameras. */
    fun switchCamera() {
        val next = !_isFrontCamera.value
        _isFrontCamera.value = next
        if (_cameraOn.value) {
            startCamera(next)
        }
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

        // The capture cannot begin until the service is genuinely carrying the
        // media-projection type, and asking for it is not the same as having
        // it: startForegroundService returns before the service has run a line.
        // Capturing on the next statement threw a SecurityException straight
        // through onActivityResult and killed the process.
        CallService.startThen(
            context,
            "Sharing your screen",
            foregroundTypes(screen = true),
            _muted.value,
        ) {
            beginScreenCapture(permission)
        }
    }

    private fun beginScreenCapture(permission: Intent) {
        // The display's own shape and size, not a fixed 720p box: capturing
        // small and stretching on the far end is what "very low quality" looks
        // like, and it saves nothing, because the scaling happens after the
        // pixels have already been read.
        val size = ShareQuality.captureSize(context)
        shareSize = size

        // Claimed before the capture starts, so whoever is sharing stops while
        // this one is still starting - the alternative is a moment with two
        // live captures, which is the moment somebody's screen is on somebody
        // else's stage without either of them meaning it.
        CallSocket.claimScreen()

        val capturer = ScreenCapturerAndroid(
            permission,
            object : android.media.projection.MediaProjection.Callback() {
                override fun onStop() {
                    scope.launch { stopVideo() }
                }
            },
        )
        val track = beginCapture(
            capturer,
            size.width,
            size.height,
            ShareQuality.SCREEN_FRAME_RATE,
        ) ?: return
        screenTrack = track
        _sharing.value = true

        // The same projection the frames are coming from, not a second one:
        // the system hands out one per consent, and asking again with the token
        // already spent fails. It is only available after `startCapture`, which
        // is what `beginCapture` has just done.
        //
        // Left for the audio thread to pick up. The playback capture has to be
        // opened at whatever rate and channel count the device module is
        // reading the microphone in, and the first capture buffer is the first
        // thing that says what those are.
        shareProjection = runCatching { capturer.mediaProjection }.getOrNull()

        publish(Slot.SCREEN, track)
        afterMediaChange()
    }

    private fun beginCapture(capturer: VideoCapturer, width: Int, height: Int, fps: Int): VideoTrack? {
        val helper = SurfaceTextureHelper.create("betweenus-capture", eglBase.eglBaseContext)
        val source = factory().createVideoSource(capturer.isScreencast)
        capturer.initialize(helper, context, source.capturerObserver)

        // A capturer that will not start is a tile that stays empty, not a
        // process that dies. The platform throws here for reasons that are
        // nothing to do with the call - a revoked projection, a camera another
        // app has - and taking the whole call down with it is the wrong trade.
        val started = runCatching { capturer.startCapture(width, height, fps) }
        started.exceptionOrNull()?.let { error ->
            _problem.value = "The capture could not start: ${error.message}"
            runCatching { capturer.dispose() }
            helper.dispose()
            return null
        }

        surfaceHelper = helper
        videoCapturer = capturer
        val track = factory().createVideoTrack("betweenus-video", source)
        _localVideo.value = track
        return track
    }

    /**
     * Stops whichever of the camera and the share is running.
     *
     * [replaced] is set when somebody else took the screen rather than the user
     * stopping: releasing a claim that has already moved would take the screen
     * away from whoever just took it.
     */
    fun stopVideo(replaced: Boolean = false) {
        if (_sharing.value && !replaced) CallSocket.releaseScreen()
        // Before the capturer is disposed: the playback capture is holding the
        // projection that capturer owns, and reading from one that has been
        // torn down underneath it is the crash rather than the silence.
        shareProjection = null
        shareAudio.stop()
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
        // Starting or stopping a share changes what the microphone track is
        // carrying, and therefore what muting is allowed to do to it. See
        // [applyMute].
        applyMute()
        publishMediaState()
        if (inCall()) CallService.start(context, callLabel(), foregroundTypes(), _muted.value)
    }

    private fun callLabel(): String = if (_sharing.value) "Sharing your screen" else "In a BetweenUs call"

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
            // What the capture is actually doing, not what the button says: a
            // push-to-talk client between sentences is sending nothing, and a
            // tile drawn live is a tile somebody waits on.
            .put(
                Slot.MIC.wire,
                PushToTalk.shouldPassAudio(
                    muted = _muted.value,
                    held = _interruption.value == Interruption.HOLD,
                    pushToTalk = AudioPrefs.pushToTalk,
                    talking = _talking.value,
                ),
            )
            .put(Slot.CAMERA.wire, _cameraOn.value)
            .put(Slot.SCREEN.wire, _sharing.value)
            .put(Slot.SCREEN_AUDIO.wire, false)
            // Held is not muted, and a tile that says "muted" for somebody who
            // has been pulled into a phone call is the wrong answer twice: they
            // did not choose it, and it does not say when it ends. An older
            // client that has never heard of the key reads the microphone as
            // off, which is what it was before this.
            .put(HOLD_WIRE, _interruption.value == Interruption.HOLD)
        val envelope = JSONObject().put("topic", VOICE_STATE_TOPIC).put("media", media)
        connections.values.forEach { it.sendData(envelope) }
    }

    // --- signalling ---

    private suspend fun onSignal(event: JSONObject) {
        when (event.optString("type")) {
            "ready" -> {
                val announced = event.optString("peerId")

                // A peer id belongs to the socket, and this socket is not
                // necessarily the one the call was built on: a phone drops its
                // connection constantly, and `onConnected` rejoins on a new one
                // with a new id. Every link already open decided who offers by
                // comparing the *old* id against the far side's, and the far
                // side has since torn that link down and rebuilt it against the
                // new one - so the two ends now disagree about who yields, and
                // either nobody offers or both do. Both are a call that
                // connects and then carries nothing.
                //
                // The links go, and the roster that arrives with `joined` a
                // moment later builds them again against the identity everybody
                // else can actually see.
                if (CallIdentity.changed(selfPeerId, announced)) {
                    // Their counters are read before the links go: this is the
                    // same call from the log's point of view, and a rebuilt link
                    // starts counting from zero.
                    connections.values.forEach { link ->
                        link.usage()?.let(retiredLinks::add)
                        link.close()
                    }
                    connections.clear()
                    earlySignals.clear()
                    _participants.value = emptyList()
                }

                selfPeerId = announced
                val waiting = earlyPeers.toList()
                earlyPeers.clear()
                waiting.forEach { addPeer(it) }
            }

            "joined" -> {
                joinTimeout?.cancel()
                joinTimeout = null
                _state.value = CallState.Live(channelId.orEmpty())
                // Only the first time. A reconnection inside one call is not a
                // new call, and restarting the clock on one would tell somebody
                // their forty-minute conversation had just begun.
                if (_liveSince.value == null) _liveSince.value = SystemClock.elapsedRealtime()
                val peers = event.optJSONArray("peers")
                for (index in 0 until (peers?.length() ?: 0)) {
                    addPeer(CallPeer.from(peers!!.getJSONObject(index)))
                }
                // Once, for arriving - not once per person already in the
                // channel, which would be a fanfare rather than a confirmation.
                CallTones.play(CallTones.Tone.JOIN)
            }

            "peer.joined" -> event.optJSONObject("peer")?.let {
                // Before the link, because a link negotiates as soon as it
                // exists: whoever just arrived may have minted the epoch this
                // device is now behind. See `refreshChannelKey`.
                refreshChannelKey()
                addPeer(CallPeer.from(it))
                CallTones.play(CallTones.Tone.JOIN)
            }

            "screen.holder" -> {
                // `optString` turns a JSON null into "", and "" is not a peer.
                val holder = event.optString("peerId").takeIf { it.isNotEmpty() }
                _screenHolder.value = holder
                // Somebody else took it. The capture is torn down rather than
                // left running unpublished: a screen still being read is still
                // a privacy question, whatever is being done with the frames.
                if (_sharing.value && holder != null && holder != selfPeerId) {
                    _problem.value = "Somebody else started sharing, so your share stopped."
                    stopVideo(replaced = true)
                }
            }

            "peer.left" -> {
                val peerId = event.optString("peerId")
                earlySignals.remove(peerId)
                earlyPeers.removeAll { it.peerId == peerId }
                connections.remove(peerId)?.let { link ->
                    link.usage()?.let(retiredLinks::add)
                    link.close()
                }
                _participants.update { list -> list.filterNot { it.peer.peerId == peerId } }
                CallTones.play(CallTones.Tone.LEAVE)
            }

            "signal" -> {
                val from = event.optString("from")
                val data = event.optJSONObject("data") ?: return
                val link = connections[from]
                if (link != null) {
                    link.onSignal(data)
                } else {
                    earlySignals.getOrPut(from) { mutableListOf() }.add(data)
                }
            }

            // This account joined a call from somewhere else, so this
            // connection is no longer the one carrying it. One call per
            // account across every device.
            "superseded" -> fail("This call moved to another device")

            "error" -> fail(event.optString("message").ifEmpty { "The call service refused this" })
        }
    }

    /**
     * Re-reads the channel key, because somebody arriving may have minted it.
     *
     * A member who joins a channel holding none of its keys mints the next
     * epoch for itself - that is the only way it gets one at all. Everybody
     * already in the call is still signing fingerprints with the epoch they
     * read when *they* joined, one generation behind, so the newcomer refuses
     * every one of them with "their media key does not match this channel's" -
     * and since only the impolite side offers, whichever way the refusal falls
     * the connection is simply never made and the tile sits on "connecting".
     *
     * A failure is not fatal: the key we already hold is still the best guess,
     * and `verifyFingerprint` asks again if it turns out to be wrong.
     */
    private suspend fun refreshChannelKey() {
        val id = channelId ?: return
        runCatching { E2ee.callKeyForChannel(id, refresh = true) }
            .getOrNull()
            ?.let { channelKey = it }
    }

    private fun addPeer(peer: CallPeer) {
        if (connections.containsKey(peer.peerId)) return
        val self = selfPeerId ?: run {
            if (earlyPeers.none { it.peerId == peer.peerId }) earlyPeers += peer
            return
        }
        val link = PeerLink(peer, polite = CallIdentity.polite(self, peer.peerId))
        connections[peer.peerId] = link
        _participants.update { it + Participant(peer) }
        link.start()
        // Anything that arrived while there was nowhere to put it, in the order
        // it arrived: an offer before its candidates, which is the order that
        // matters.
        earlySignals.remove(peer.peerId)?.forEach { link.onSignal(it) }
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
     * One link's reading, folded into the list the panel shows.
     *
     * Ordered by the roster rather than by whichever connection answered
     * `getStats` first, so the rows do not swap places under a finger every
     * second. A peer that has left takes its row with it.
     */
    private fun publishStats(peerId: String, link: LinkStats) {
        val roster = _participants.value.map { it.peer.peerId }
        _stats.update { previous ->
            val merged = previous.filter { it.peerId != peerId } + link
            merged.filter { it.peerId in roster }.sortedBy { roster.indexOf(it.peerId) }
        }
    }

    /**
     * One `getStats` per peer per second, which is what decides whether a video
     * slot is really carrying anything and who is speaking. Both are statistics
     * rather than events, because WebRTC offers no event for either that can be
     * trusted.
     */
    /**
     * What the people who have already left moved.
     *
     * Kept because their counters go with their connection: once a peer link is
     * closed there is nothing left to read, so the reading has to be taken as
     * they go rather than asked for at the end.
     */
    private val retiredLinks = mutableListOf<LinkUsage>()

    /** Everything measured this call: the links still open, and the ones gone. */
    private fun usageReport(): List<LinkUsage> =
        retiredLinks + connections.values.mapNotNull { it.usage() }

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
         * Video slots that have decoded at least one frame. See [liveVideo].
         *
         * A latch, and the reason incoming video used to flicker: a stats
         * report that happens not to carry this slot's `inbound-rtp` entry -
         * one arrives empty after a renegotiation, and a mid can change under
         * one - read as nought frames decoded, which took the track away and
         * put it back a beat later. The desktop client has held the same latch
         * since the same bug was fixed there.
         */
        private val decodedOnce = HashSet<Slot>()

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

        /**
         * Signals from this peer, applied strictly one at a time.
         *
         * [onSignal] launches a coroutine per signal and nothing waits for it,
         * so two descriptions arriving close together used to run *concurrently*
         * and interleave at every suspension point inside. That breaks perfect
         * negotiation at the root: the state checks in [onDescription] read
         * `signalingState` before [verifyFingerprint], which can go to the
         * network for a fresh channel key, so by the time the second run acts on
         * its decision the first has already moved the connection on.
         *
         * An offer and a re-offer from [chase] landing together is the case that
         * shows: both pass the collision check while the state is still
         * HAVE_REMOTE_OFFER, the first drives the connection to STABLE with its
         * answer, and the second reaches [setLocal] a moment later and fails
         * with "Called in wrong state: stable" across a call that is otherwise
         * fine.
         *
         * It also makes [pendingCandidates] safe. That list was appended to from
         * the socket thread and drained inside [onDescription] at the same time.
         *
         * One lock per peer, not one for the call: separate links share no state
         * and queueing them behind each other would make the slowest peer's key
         * re-read everybody else's problem.
         */
        private val signals = Mutex()
        /** When the channel key was last re-read for this peer. See [verifyFingerprint]. */
        private var keyReadAt = 0L

        private val pc: PeerConnection = factory().createPeerConnection(
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

                /**
                 * The one callback that says whether media is flowing, and the
                 * only place recovery starts.
                 *
                 * `DISCONNECTED` and `FAILED` are different problems. The first
                 * is usually a handover and usually fixes itself, so it is
                 * given [CallRecovery.GRACE_MS] to do that. The second means
                 * ICE has exhausted every candidate it had and nothing will
                 * happen without a restart.
                 */
                override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
                    when (state) {
                        PeerConnection.PeerConnectionState.CONNECTED -> recovered()

                        PeerConnection.PeerConnectionState.DISCONNECTED ->
                            startRecovery(CallRecovery.GRACE_MS)

                        PeerConnection.PeerConnectionState.FAILED ->
                            startRecovery(0L)

                        // Closed is this side hanging up, and there is nothing
                        // to recover from a decision.
                        PeerConnection.PeerConnectionState.CLOSED ->
                            scope.launch {
                                update(peer.peerId) {
                                    it.copy(connected = false, reconnecting = false)
                                }
                            }

                        else -> Unit
                    }
                }

                // Everything this used to do now happens in onConnectionChange,
                // which is the state that includes DTLS rather than only ICE -
                // a connection can have ICE up and still be carrying nothing.
                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) = Unit

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
            "betweenus.share",
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
            if (!polite) scope.launch { offer(); chase() }
        }

        /**
         * Offers again when an offer was never answered.
         *
         * Nothing else does. `onConnectionChange` only reaches `FAILED` once ICE
         * has had a remote description to fail against, so an offer the far end
         * refused - a fingerprint signed with an epoch it had not caught up to,
         * most often - leaves this connection in `NEW` with no callback ever
         * fired and no recovery path to enter. That is the whole of a tile that
         * says "connecting…" until somebody leaves the call.
         *
         * Only from `NEW`: a connection with a remote description is
         * negotiating, and offering over the top of a slow network would break
         * the calls that were about to work. Re-reading the key first is not
         * incidental - it is the fix for the case this is most often chasing.
         */
        private suspend fun chase() {
            var attempts = 0
            while (!closed && attempts < CallRecovery.MAX_ATTEMPTS) {
                delay(CONNECT_DEADLINE_MS)
                if (closed) return
                if (pc.connectionState() != PeerConnection.PeerConnectionState.NEW) return

                attempts += 1
                refreshChannelKey()
                offer()
            }
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
         *
         * Which H.264 is the half this used to leave to the platform, and the
         * platform's answer is Constrained Baseline. [ShareQuality.codecRank]
         * has what that costs. Sorting is stable, so codecs of equal rank keep
         * the order the encoder factory put them in.
         */
        private fun preferScreenCodec() {
            val transceiver = transceivers[Slot.SCREEN] ?: return
            runCatching {
                val codecs = factory().getRtpSenderCapabilities(
                    MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,
                ).codecs
                val sorted = codecs.sortedByDescending {
                    ShareQuality.codecRank(it.name, it.parameters.orEmpty())
                }
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
            update(peer.peerId) {
                it.copy(
                    micEnabled = media.optBoolean(Slot.MIC.wire, true),
                    held = if (media.has(HOLD_WIRE)) media.optBoolean(HOLD_WIRE, false) else it.held,
                    // A slot the sender did not mention stays as it was: an
                    // older client that only ever spoke about its microphone
                    // must not be read as having turned its camera off.
                    cameraDeclared = if (media.has(Slot.CAMERA.wire)) {
                        media.optBoolean(Slot.CAMERA.wire, false)
                    } else {
                        it.cameraDeclared
                    },
                    screenDeclared = if (media.has(Slot.SCREEN.wire)) {
                        media.optBoolean(Slot.SCREEN.wire, false)
                    } else {
                        it.screenDeclared
                    },
                )
            }
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
            // A peer that arrives during an interruption starts at the volume
            // everybody else is at, rather than at full while a phone call is
            // in progress.
            applyPlayback(playbackGain())
        }

        /**
         * How loud this peer plays. Both audio slots, because a shared screen
         * carries its own sound and ducking one of the two is ducking neither.
         */
        fun applyPlayback(gain: Double) {
            for (slot in listOf(Slot.MIC, Slot.SCREEN_AUDIO)) {
                val track = transceivers[slot]?.receiver?.track() as? AudioTrack ?: continue
                runCatching { track.setVolume(gain) }
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
                "offer", "answer" -> scope.launch { signals.withLock { onDescription(data) } }
                // Through the same lock as a description, because it touches the
                // same two things one does: the connection, and the pending
                // list a description drains.
                "ice" -> data.optJSONObject("candidate")?.let { payload ->
                    val candidate = IceCandidate(
                        payload.optString("sdpMid"),
                        payload.optInt("sdpMLineIndex"),
                        payload.optString("candidate"),
                    )
                    scope.launch {
                        signals.withLock {
                            if (closed) return@withLock
                            if (pc.remoteDescription == null) {
                                pendingCandidates += candidate
                            } else {
                                pc.addIceCandidate(candidate)
                            }
                        }
                    }
                }
            }
        }

        /** Called only under [signals]; the whole body is a critical section over [pc]. */
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

            // An answer is the reply to one offer, and only the side with that
            // offer still outstanding can apply it. A second answer - which
            // `chase` produces whenever it re-offers a connection that never
            // came up, since each offer is answered - arrives when this side is
            // already STABLE, and applying it fails with "Failed to set remote
            // answer sdp: Called in wrong state: stable", in red, across a call
            // that is otherwise fine. Dropping it is right: the description that
            // settled the connection is already in place.
            if (kind == "answer" &&
                pc.signalingState() != PeerConnection.SignalingState.HAVE_LOCAL_OFFER
            ) {
                return
            }

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

        /**
         * Whether the far side signed this fingerprint with the channel's key,
         * re-reading the key when it has not just been read.
         *
         * The re-read is the point: two people joining at the same moment, or a
         * member removed mid-call, rotate the epoch under a connection that is
         * already open, and this device would otherwise refuse a peer for
         * holding the *newer* key.
         *
         * It used to be allowed once per peer and then never again, which is a
         * link that can survive exactly one epoch change. One is normal, and
         * burning it on the first description - the description most likely to
         * arrive mid-rotation - left every one after it refused against a key
         * known to be stale, with nothing left that would ever look again. That
         * is a tile on "Connecting…" for the life of the call.
         *
         * A cooldown keeps what the latch was for: a proof that is simply wrong
         * still cannot make this client hammer the key directory, because a
         * wrong proof arriving twice a second re-reads once.
         */
        private suspend fun verifyFingerprint(sdp: String, proof: String): Boolean {
            val fingerprint = fingerprintOf(sdp) ?: return false
            if (Crypto.signFingerprint(channelKey, fingerprint) == proof) return true

            val now = System.currentTimeMillis()
            if (now - keyReadAt < KEY_REREAD_COOLDOWN_MS) return false
            keyReadAt = now
            refreshChannelKey()
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
        /**
         * Sets the local description, with the receive-side quality asked for.
         *
         * The patch is a preference, not a requirement - a stack that refuses
         * the munged SDP still has a working call - so the patched one is tried
         * first and the untouched one is the fallback. Same shape as the
         * desktop's `setLocalDescription`.
         */
        private suspend fun setLocal(description: SessionDescription): Boolean {
            val patched = runCatching {
                // Video first, then the microphone: bitrate, stereo and DTX are
                // Opus payload parameters, so they are fixed when the
                // connection is negotiated and cannot be set on a live sender
                // the way a video bitrate can.
                SdpQuality.patchAudio(
                    SdpQuality.patch(description.description, ShareQuality.screenBitrate(shareSize)),
                    AudioPrefs.micEncoding(),
                )
            }.getOrNull()

            if (patched != null && patched != description.description) {
                val applied = applyDescription(quiet = true) { observer ->
                    pc.setLocalDescription(observer, SessionDescription(description.type, patched))
                }
                if (applied) return true
            }
            return applyDescription { observer -> pc.setLocalDescription(observer, description) }
        }

        private suspend fun setRemote(description: SessionDescription): Boolean =
            applyDescription { observer -> pc.setRemoteDescription(observer, description) }

        /**
         * [quiet] is for an attempt that has a fallback behind it: a refused
         * quality patch is not something to put in front of anybody, because
         * the call carries on either way.
         */
        private suspend fun applyDescription(
            quiet: Boolean = false,
            apply: (SdpObserver) -> Unit,
        ): Boolean =
            suspendCancellableCoroutine { continuation ->
                apply(
                    object : SdpObserver {
                        override fun onSetSuccess() {
                            if (continuation.isActive) continuation.resumeWith(Result.success(true))
                        }

                        override fun onSetFailure(error: String?) {
                            if (!quiet) problem("${peer.username}: $error")
                            if (continuation.isActive) continuation.resumeWith(Result.success(false))
                        }

                        override fun onCreateSuccess(description: SessionDescription?) = Unit
                        override fun onCreateFailure(error: String?) = Unit
                    },
                )
            }

        /** The last reading, so the next one can be a rate rather than a total. */
        private var lastSample: LinkSample? = null

        /**
         * What this link has moved, for the call log.
         *
         * The last poll rather than a fresh one: a closed peer connection
         * answers `getStats` with nothing, so a reading taken at the end of a
         * call is a reading of the links that happen to still be open - which
         * is how a call that lost four people one at a time reports the traffic
         * of only the last. Null before the first poll, which is a link that
         * never carried anything.
         */
        fun usage(): LinkUsage? = lastSample?.let { CallUsage.of(peer.userId, peer.username, it) }

        // --- recovery ---

        /** The retry loop, while one is running. */
        private var recovery: Job? = null

        /** When the media stopped, so the deadline is measured from the fault. */
        private var downSince: Long? = null

        private var attempts = 0

        /**
         * Media is flowing again - either it never really stopped, or a restart
         * worked.
         *
         * The counters reset, so a call that drops once an hour on a train gets
         * the full budget each time rather than spending its way to "lost" over
         * an afternoon.
         */
        fun recovered() {
            recovery?.cancel()
            recovery = null
            downSince = null
            attempts = 0
            scope.launch {
                update(peer.peerId) {
                    it.copy(connected = true, reconnecting = false, lost = false)
                }
            }
        }

        /**
         * Start trying, after [initialDelay].
         *
         * Idempotent: a connection flapping between DISCONNECTED and FAILED
         * calls this repeatedly, and each call must not start a second loop
         * racing the first.
         */
        fun startRecovery(initialDelay: Long) {
            if (closed) return
            if (recovery?.isActive == true) return
            if (downSince == null) downSince = System.currentTimeMillis()

            recovery = scope.launch {
                delay(initialDelay)
                // The grace period is exactly the case where nothing more is
                // needed: ICE climbed out on its own while we waited.
                if (closed || connectedNow()) return@launch

                scope.launch {
                    update(peer.peerId) { it.copy(connected = false, reconnecting = true) }
                }

                while (isActive && !closed && !connectedNow()) {
                    val downFor = System.currentTimeMillis() - (downSince ?: break)
                    if (CallRecovery.spent(attempts, downFor)) {
                        giveUp()
                        return@launch
                    }

                    attempts += 1
                    delay(CallRecovery.backoffMs(attempts))
                    if (closed || connectedNow()) return@launch

                    // Only the impolite side, and both halves are needed: the
                    // restart marks the connection as wanting fresh candidates
                    // and the offer is what actually asks for them. The old
                    // code called restartIce alone, and since nothing here acts
                    // on onRenegotiationNeeded, it did nothing at all.
                    if (CallRecovery.restarts(polite)) {
                        runCatching { pc.restartIce() }
                        offer()
                    }

                    // Long enough for a restart to have landed, short enough
                    // that four of them fit inside the deadline.
                    delay(CallRecovery.GRACE_MS)
                }
            }
        }

        private fun connectedNow(): Boolean =
            pc.connectionState() == PeerConnection.PeerConnectionState.CONNECTED

        /**
         * Out of attempts, or out of time.
         *
         * The connection is left open rather than closed. Who is in the call is
         * the roster's answer and never this side's guess: a peer whose phone
         * really has gone is removed by `call.roster` a moment later, and one
         * whose link is merely unrecoverable from *here* may still be perfectly
         * present to everybody else. Closing it would also throw away the only
         * thing that can still report a late recovery.
         */
        private fun giveUp() {
            recovery = null
            scope.launch {
                update(peer.peerId) {
                    it.copy(connected = false, reconnecting = false, lost = true)
                }
                noteLostLink()
            }
        }


        /**
         * Whether a camera and a share are really arriving, by counting frames,
         * who is speaking, by reading audio levels, and what the link is doing,
         * by reading byte counters.
         *
         * Nothing a video receiver says is trustworthy: it unmutes on the
         * padding sent to probe for bandwidth and stays unmuted after the far
         * end stops, so both a share that never started and one that has ended
         * look live. Frames decoded since the last look do not lie.
         *
         * One walk of the report answers all three. The report is the expensive
         * part and it was already being fetched.
         */
        fun poll() {
            if (closed) return
            pc.getStats { report ->
                val decoded = HashMap<String, Long>()
                val levels = HashMap<String, Double>()

                var inboundAudio = 0L
                var inboundVideo = 0L
                var outboundAudio = 0L
                var outboundVideo = 0L
                var packetsLost = 0L
                var packetsReceived = 0L
                var roundTrip: Double? = null
                var picture: Triple<Int?, Int?, Double?> = Triple(null, null, null)
                var pair: Map<String, Any>? = null
                val candidateTypes = HashMap<String, String>()

                for (stats in report.statsMap.values) {
                    val members = stats.members
                    val kind = members["kind"] as? String
                    when (stats.type) {
                        "inbound-rtp" -> {
                            val bytes = (members["bytesReceived"] as? Number)?.toLong() ?: 0L
                            if (kind == "audio") inboundAudio += bytes else inboundVideo += bytes
                            packetsLost += (members["packetsLost"] as? Number)?.toLong() ?: 0L
                            packetsReceived += (members["packetsReceived"] as? Number)?.toLong() ?: 0L

                            val mid = members["mid"] as? String
                            if (kind == "video") {
                                if (mid != null) {
                                    decoded[mid] = (members["framesDecoded"] as? Number)?.toLong() ?: 0L
                                }
                                picture = CallStats.larger(
                                    picture,
                                    (members["frameWidth"] as? Number)?.toInt() ?: 0,
                                    (members["frameHeight"] as? Number)?.toInt() ?: 0,
                                    (members["framesPerSecond"] as? Number)?.toDouble() ?: 0.0,
                                )
                            } else if (kind == "audio" && mid != null) {
                                levels[mid] = (members["audioLevel"] as? Number)?.toDouble() ?: 0.0
                            }
                        }

                        "outbound-rtp" -> {
                            val bytes = (members["bytesSent"] as? Number)?.toLong() ?: 0L
                            if (kind == "audio") outboundAudio += bytes else outboundVideo += bytes
                        }

                        // Only the pair actually carrying the call. The losers
                        // of the ICE race stay in the report and their round
                        // trip means nothing.
                        "candidate-pair" -> {
                            val nominated = members["nominated"] as? Boolean ?: false
                            val succeeded = (members["state"] as? String) == "succeeded"
                            if (nominated && succeeded) {
                                (members["currentRoundTripTime"] as? Number)?.toDouble()
                                    ?.let { roundTrip = it }
                                pair = members
                            }
                        }

                        // Kept by id whatever they are: the pair that names them
                        // is not guaranteed to have been walked yet.
                        "local-candidate", "remote-candidate" ->
                            candidateTypes[stats.id] = members["candidateType"] as? String ?: ""

                    }
                }

                val camera = liveVideo(Slot.CAMERA, decoded)
                val screen = liveVideo(Slot.SCREEN, decoded)
                val speaking = (levels[transceivers[Slot.MIC]?.mid] ?: 0.0) >= SPEAKING_LEVEL

                val sample = LinkSample(
                    at = System.currentTimeMillis(),
                    inboundAudioBytes = inboundAudio,
                    inboundVideoBytes = inboundVideo,
                    outboundAudioBytes = outboundAudio,
                    outboundVideoBytes = outboundVideo,
                    packetsLost = packetsLost,
                    packetsReceived = packetsReceived,
                    roundTripSeconds = roundTrip,
                    // Asked rather than inferred from the counters, because a
                    // link that is up and quiet and a link that never came up
                    // produce the same still counters, and only one of them is
                    // a microphone fault.
                    connected = connectedNow(),
                    frameWidth = picture.first,
                    frameHeight = picture.second,
                    framesPerSecond = picture.third,
                    transport = pair?.let { selected ->
                        CallUsage.transportOf(
                            candidateTypes[selected["localCandidateId"] as? String ?: ""],
                            candidateTypes[selected["remoteCandidateId"] as? String ?: ""],
                        )
                    },
                )
                val link = CallStats.toStats(peer.peerId, peer.username, sample, lastSample)
                lastSample = sample

                scope.launch {
                    update(peer.peerId) {
                        it.copy(camera = camera, screen = screen, speaking = speaking)
                    }
                    publishStats(peer.peerId, link)
                }
            }
        }

        /**
         * The track on a video slot, once a frame has actually been decoded on
         * it.
         *
         * Frames decoded is the only honest signal that something has arrived,
         * because a receiver unmutes on the padding sent to probe for
         * bandwidth - so a slot nobody is sending on looks live, and a camera
         * nobody turned on becomes a black rectangle.
         *
         * It says nothing about the other direction, and it used to be asked.
         * A screen share of a document nobody is typing in decodes nothing for
         * minutes; treating that as the end made the share stage open, close,
         * open and close again, taking the requested orientation down with it
         * every time. Whether a slot is still *on* is what its owner says on
         * the data channel - `screenDeclared` and `cameraDeclared`.
         *
         * Latched by [decodedOnce], so this only ever goes from nothing to a
         * track. `framesDecoded` only grows, but the *report* is not a promise:
         * a slot missing from one poll is not a slot that stopped, and reading
         * it as one is what made an arriving camera flicker.
         */
        private fun liveVideo(slot: Slot, decoded: Map<String, Long>): VideoTrack? {
            val transceiver = transceivers[slot] ?: return null
            val track = transceiver.receiver.track() as? VideoTrack ?: return null
            val mid = transceiver.mid

            if (mid != null && (decoded[mid] ?: 0L) > 0L) decodedOnce += slot
            return if (slot in decodedOnce) track else null
        }

        private fun problem(message: String) {
            scope.launch { _problem.value = message }
        }

        fun close() {
            closed = true
            recovery?.cancel()
            recovery = null
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

        private val _live = MutableStateFlow<VoiceEngine?>(null)

        /**
         * The engine as something a composable can watch for, rather than ask
         * about once.
         *
         * [current] answers "is there one now", which is the right question for
         * a listener firing on a process that may have no call in it. It is the
         * wrong one for a screen that outlives every call: `remember` would
         * cache the null from before the first call and never see the engine
         * that arrived afterwards, so the call dock would appear only for
         * people who had already been in a call when the shell was composed.
         *
         * The engine is not built to be watched for - the flow is empty until
         * something genuinely needs one - so watching costs nothing on a
         * process that never makes a call.
         */
        val live: StateFlow<VoiceEngine?> = _live.asStateFlow()

        fun of(context: Context): VoiceEngine =
            instance ?: synchronized(this) {
                instance ?: VoiceEngine(context.applicationContext).also {
                    instance = it
                    _live.value = it
                }
            }

        /**
         * The engine only if one exists, for the few callers that must not
         * build one just to ask a question - the audio focus listener fires
         * on a process with no call in it as readily as on one that has.
         */
        fun current(): VoiceEngine? = instance

        /**
         * Ends whatever call is running, if there is one. Signing out is the
         * one thing that has to reach across and stop a call it did not start.
         */
        fun release() {
            synchronized(this) { instance }?.dispose()
        }

        /** The topic the desktop stamps its media state with. Must match. */
        private const val VOICE_STATE_TOPIC = "betweenus.voice-state"

        /** The media-state key that says somebody has been pulled off the call. */
        private const val HOLD_WIRE = "hold"

        private const val POLL_MS = 1_000L

        /** The desktop waits the same fifteen seconds before giving up on a join. */
        private const val JOIN_TIMEOUT_MS = 15_000L

        /**
         * How long an offer may go unanswered before it is sent again. The
         * desktop uses the same number - see `chase` in both.
         *
         * Long enough that a slow answer is not chased: the far end has a key
         * read and an `adopt` to do first. Short enough that nobody sits
         * looking at "connecting…" wondering whether to leave.
         */
        private const val CONNECT_DEADLINE_MS = 8_000L

        /**
         * The shortest gap between two re-reads of the channel key for one
         * peer. See `verifyFingerprint`.
         */
        private const val KEY_REREAD_COOLDOWN_MS = 5_000L

        /**
         * Audio level above which somebody counts as speaking. About -40 dBFS:
         * below a voice, above the residue a suppressor leaves.
         */
        private const val SPEAKING_LEVEL = 0.01

        /**
         * How long the local ring stays lit after the last loud buffer.
         *
         * A remote tile gets this for free - its level is read once a second,
         * so a gap shorter than that is invisible. The microphone is read every
         * ten milliseconds and needs the smoothing done explicitly.
         */
        private const val SPEAKING_HOLD_MS = 250L

        /**
         * How often the microphone level reaches the settings screen.
         *
         * Twenty a second is faster than a meter can be read and a twentieth
         * of the writes a flow would take if every buffer published one.
         */
        private const val METER_INTERVAL_MS = 50L

        /**
         * 16-bit little-endian PCM to a 0..1 level, the scale WebRTC's own
         * `audioLevel` reports on.
         *
         * Squares are accumulated in a `Long` rather than a `Double`: a buffer
         * is a few hundred samples of at most 32768 squared, which fits, and
         * the audio thread should not be doing floating-point work it does not
         * have to.
         */
        internal fun rootMeanSquare(pcm: ByteArray): Double {
            val count = pcm.size / 2
            if (count == 0) return 0.0
            var sum = 0L
            var index = 0
            while (index + 1 < pcm.size) {
                // Little-endian: low byte unsigned, high byte signed.
                val sample = ((pcm[index + 1].toInt() shl 8) or (pcm[index].toInt() and 0xFF)).toShort()
                sum += sample.toLong() * sample.toLong()
                index += 2
            }
            return sqrt(sum.toDouble() / count) / Short.MAX_VALUE
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
