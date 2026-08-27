package com.aatech.betweenus.feature.remote

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.aatech.betweenus.core.data.AuthPhase
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.data.RemoteMachine
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.EmptyState
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Edge
import com.aatech.betweenus.ui.theme.Ground
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate50
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.StatusOffline
import com.aatech.betweenus.ui.theme.StatusOnline
import com.aatech.betweenus.ui.theme.Surface950
import org.webrtc.RendererCommon
import kotlinx.coroutines.launch
import org.webrtc.SurfaceViewRenderer

/** Machines this account owns, plus the ones it holds a live grant on. */
@Composable
fun RemoteMachinesScreen(onBack: () -> Unit, onOpenSession: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var machines by remember { mutableStateOf<List<RemoteMachine>?>(null) }
    var note by remember { mutableStateOf<String?>(null) }
    /** The machine whose access and audit trail are being looked at. */
    var managing by remember { mutableStateOf<RemoteMachine?>(null) }

    val phase by Session.state.collectAsState()
    val selfId = (phase as? AuthPhase.SignedIn)?.user?.id

    suspend fun reload() {
        runCatching { BetweenUsApi.machines() }
            .onSuccess { machines = it }
            .onFailure { note = it.message; machines = emptyList() }
    }

    LaunchedEffect(Unit) { reload() }

    Column(Modifier.fillMaxSize().background(Ground).navigationBarsPadding()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Surface950)
                .statusBarsPadding()
                .padding(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(BetweenUsIcons.ChevronLeft, "Back", onBack)
            Text(
                text = "Remote machines",
                style = MaterialTheme.typography.titleMedium,
                color = Slate50,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
        }
        HorizontalDivider(color = Edge)

        note?.let { Notice(it, Danger, Modifier.padding(12.dp)) }

        val list = machines
        when {
            list == null -> Text(
                text = "Loading…",
                style = MaterialTheme.typography.bodyMedium,
                color = Slate500,
                modifier = Modifier.padding(16.dp),
            )

            list.isEmpty() -> EmptyState(
                icon = BetweenUsIcons.Monitor,
                title = "No machines",
                detail = "A machine appears here once its agent has enrolled, or once " +
                    "somebody grants you access to theirs.",
            )

            else -> LazyColumn {
                item { SectionLabel("${list.size} machines") }
                items(list, key = { it.id }) { machine ->
                    ListRow(
                        title = machine.name,
                        subtitle = "${machine.platform} · ${machine.ownerUsername}",
                        leading = {
                            BetweenUsIcon(
                                BetweenUsIcons.Monitor,
                                tint = if (machine.online) StatusOnline else StatusOffline,
                            )
                        },
                        trailing = {
                            if (!machine.may("REMOTE_VIEW")) {
                                Chip("no access", tone = Slate500)
                            } else if (!machine.online) {
                                Chip("offline", tone = Slate500)
                            } else {
                                Chip("connect")
                            }
                            // Only the owner is offered this. The gateway
                            // refuses everybody else anyway; a button that
                            // exists to fail is not a button.
                            if (machine.ownerId == selfId) {
                                IconAction(
                                    icon = BetweenUsIcons.Settings,
                                    contentDescription = "Manage this machine",
                                    onClick = { managing = machine },
                                )
                            }
                        },
                        onClick = {
                            if (machine.online && machine.may("REMOTE_VIEW")) onOpenSession(machine.id)
                        },
                    )
                }
            }
        }
    }

    managing?.let { machine ->
        MachineSheet(
            machine = machine,
            onDismiss = { managing = null },
            onChanged = { scope.launch { reload() } },
        )
    }
}

/**
 * The screen of another machine, and - when the session was granted control -
 * a touch surface that drives its mouse.
 *
 * A tap is a click at that fraction of the display; a drag is a move. The agent
 * is the only side that knows what the display measures, so nothing here sends
 * pixels, only fractions.
 */
@Composable
fun RemoteSessionScreen(machineId: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val engine = remember { RemoteEngine(context) }

    val state by engine.state.collectAsState()
    val track by engine.screen.collectAsState()
    val screens by engine.screens.collectAsState()
    val activeId by engine.activeScreenId.collectAsState()
    val controlling by engine.controlGranted.collectAsState()
    val permissions by engine.permissions.collectAsState()
    val remoteClipboard by engine.remoteClipboard.collectAsState()
    val clipboard = LocalClipboardManager.current

    var surface by remember { mutableStateOf(IntSize.Zero) }
    var clipboardNote by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(machineId) { engine.start(machineId) }
    DisposableEffect(engine) { onDispose { engine.dispose() } }

    Column(Modifier.fillMaxSize().background(Ground).navigationBarsPadding()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Surface950)
                .statusBarsPadding()
                .padding(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(BetweenUsIcons.ChevronLeft, "Back", { engine.end(); onBack() })
            Column(Modifier.weight(1f).padding(start = 8.dp)) {
                Text(
                    text = (state as? RemoteEngine.State.Live)?.machineName ?: "Remote session",
                    style = MaterialTheme.typography.titleMedium,
                    color = Slate50,
                )
                Text(
                    text = when (val current = state) {
                        RemoteEngine.State.Idle -> "Not connected"
                        RemoteEngine.State.Starting -> "Asking the machine…"
                        is RemoteEngine.State.Live ->
                            if (controlling) "Viewing and controlling" else "Viewing only"
                        is RemoteEngine.State.Ended -> current.reason
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = if (state is RemoteEngine.State.Ended) Danger else Slate500,
                )
            }
            // Offered only with REMOTE_CLIPBOARD, which is the gateway's rule
            // and not this screen's: it refuses a `clipboard.set` from a
            // session without it either way.
            if (permissions.contains("REMOTE_CLIPBOARD")) {
                IconAction(
                    icon = BetweenUsIcons.Copy,
                    contentDescription = "Send this phone's clipboard to the machine",
                    onClick = {
                        val text = clipboard.getText()?.text.orEmpty()
                        clipboardNote = if (text.isBlank()) {
                            "Nothing on this phone's clipboard to send"
                        } else {
                            engine.sendClipboard(text)
                            "Sent to the machine"
                        }
                    },
                )
            }
            IconAction(
                icon = if (controlling) BetweenUsIcons.Lock else BetweenUsIcons.Eye,
                contentDescription = if (controlling) "Hand control back" else "Ask for control",
                onClick = { if (controlling) engine.releaseControl() else engine.requestControl() },
            )
        }
        HorizontalDivider(color = Edge)

        clipboardNote?.let { note ->
            Text(
                text = note,
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }

        // What the machine has copied. Deliberately not written onto this
        // phone's clipboard as it arrives - a machine that could overwrite the
        // clipboard of the phone watching it whenever it liked could put a URL
        // under somebody's next paste. Taking it is a tap.
        remoteClipboard?.let { text ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "On the machine's clipboard: ${text.take(80)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate500,
                    modifier = Modifier.weight(1f),
                )
                IconAction(
                    icon = BetweenUsIcons.Copy,
                    contentDescription = "Copy it to this phone",
                    onClick = {
                        clipboard.setText(AnnotatedString(text))
                        clipboardNote = "Copied to this phone"
                    },
                )
            }
        }

        if (screens.size > 1) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                screens.forEach { screen ->
                    Chip(
                        text = screen.label,
                        selected = screen.id == activeId,
                        onClick = { engine.selectScreen(screen.id) },
                    )
                }
            }
        }

        Box(Modifier.weight(1f).background(Surface950)) {
            val live = track
            if (live == null) {
                EmptyState(
                    icon = BetweenUsIcons.Monitor,
                    title = "Waiting for the screen",
                    detail = "The picture comes straight from the machine, not through the gateway.",
                    modifier = Modifier.align(Alignment.Center),
                )
            } else {
                AndroidView(
                    factory = { ctx ->
                        SurfaceViewRenderer(ctx).apply {
                            init(engine.eglBase.eglBaseContext, null)
                            setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
                            setEnableHardwareScaler(true)
                            live.addSink(this)
                        }
                    },
                    onRelease = { renderer ->
                        live.removeSink(renderer)
                        renderer.release()
                    },
                    modifier = Modifier
                        .fillMaxSize()
                        .onSizeChanged { surface = it }
                        .pointerInput(controlling, surface) {
                            if (!controlling || surface == IntSize.Zero) return@pointerInput
                            detectTapGestures { offset ->
                                val x = offset.x / surface.width
                                val y = offset.y / surface.height
                                engine.mouse("move", x, y)
                                engine.mouse("down", x, y, button = "left")
                                engine.mouse("up", x, y, button = "left")
                            }
                        }
                        .pointerInput(controlling, surface) {
                            if (!controlling || surface == IntSize.Zero) return@pointerInput
                            detectDragGestures { change, _ ->
                                engine.mouse(
                                    "move",
                                    change.position.x / surface.width,
                                    change.position.y / surface.height,
                                )
                            }
                        },
                )
            }
        }

        if (!controlling && state is RemoteEngine.State.Live) {
            Text(
                text = "Viewing only. Ask for control with the button above; whoever is at the " +
                    "machine decides.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate400,
                modifier = Modifier.padding(12.dp),
            )
        }
    }
}
