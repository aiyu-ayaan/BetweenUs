package com.aatech.betweenus.feature.voice

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aatech.betweenus.ui.components.BetweenUsButton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

/**
 * Asking for the mouse on somebody's shared screen, from a phone.
 *
 * The viewer half of `apps/desktop/src/stores/shareControl.ts`, and only that
 * half. A phone can ask to drive and then drive; it cannot be driven, because
 * being driven means injecting synthetic mouse and keyboard events into the
 * machine, and Android has no such thing outside an accessibility service - a
 * permission this app has no business asking for.
 *
 * That asymmetry is not silent. An `ask` arriving here is answered with a
 * `deny` and a reason, so somebody on a desktop who asks a phone to hand over
 * its screen is told why not, rather than waiting on a dialog that will never
 * appear.
 *
 * ## Why this needs no server at all
 *
 * The whole exchange rides the peers' own data channels. A data channel has
 * exactly two ends: a message on the connection to a peer came from that peer
 * and from nobody else, and that peer's identity came from the roster
 * `call-service` built out of authenticated sockets. The only authority is the
 * person sharing pressing yes - which is the right authority, because it is
 * their machine and they are sitting at it.
 */
object ShareControl {

    /** The topic the desktop stamps these with. Must match, byte for byte. */
    const val TOPIC = "betweenus.share"

    /** Mouse moves are sampled; the far end does not need five hundred a second. */
    private const val MOVE_INTERVAL_MS = 25L

    /** Pointers are cosmetic, so they go less often. */
    private const val POINTER_INTERVAL_MS = 60L

    /** Waiting on an answer from this peer, or null. */
    private val _asking = MutableStateFlow<String?>(null)
    val asking: StateFlow<String?> = _asking.asStateFlow()

    /** The peer whose screen this phone is driving, or null. */
    private val _driving = MutableStateFlow<String?>(null)
    val driving: StateFlow<String?> = _driving.asStateFlow()

    /** Why the last ask was turned down, for the line that says so. */
    private val _refusal = MutableStateFlow<String?>(null)
    val refusal: StateFlow<String?> = _refusal.asStateFlow()

    /**
     * Who this client asked.
     *
     * Kept so an unsolicited "yes" from somebody who was never asked is
     * ignored: a grant is only meaningful from the peer the request went to.
     */
    private var asked: String? = null

    private var lastMoveAt = 0L
    private var lastPointerAt = 0L

    /** Sends one envelope to one peer. Set by [VoiceEngine] while a call runs. */
    internal var send: ((peerId: String, JSONObject) -> Unit)? = null

    fun attach(sender: (peerId: String, JSONObject) -> Unit) {
        send = sender
    }

    /** The call ended. Nothing is being driven, and nothing is waiting. */
    fun detach() {
        send = null
        asked = null
        _asking.value = null
        _driving.value = null
        _refusal.value = null
    }

    /** May I have the mouse? */
    fun ask(peerId: String) {
        asked = peerId
        _asking.value = peerId
        _refusal.value = null
        publish(peerId, JSONObject().put("k", "ask"))
    }

    /**
     * Hand it back.
     *
     * The same message the sharer sends to take it away: one wire for both
     * directions, because "this arrangement is over" is one fact whichever end
     * decided it.
     */
    fun release() {
        val peer = _driving.value ?: _asking.value ?: return
        publish(peer, JSONObject().put("k", "revoke"))
        asked = null
        _asking.value = null
        _driving.value = null
    }

    /**
     * One message from a peer's data channel.
     *
     * [fromPeerId] is who it came from, decided by which connection carried it
     * rather than by anything inside the message - a peer cannot claim to be
     * somebody else, because there is no third party in the middle to be
     * fooled.
     */
    internal fun receive(fromPeerId: String, message: JSONObject) {
        when (message.optString("k")) {
            // Somebody wants to drive *this* device. It has no mouse to give.
            "ask" -> publish(
                fromPeerId,
                JSONObject()
                    .put("k", "deny")
                    .put("why", "They are on a phone, which cannot be driven"),
            )

            "grant" -> {
                if (asked != fromPeerId) return
                asked = null
                _driving.value = fromPeerId
                _asking.value = null
                _refusal.value = null
            }

            "deny" -> {
                if (asked != fromPeerId) return
                asked = null
                _asking.value = null
                _driving.value = null
                _refusal.value = message.optString("why").ifBlank { "They said no" }
            }

            // Either side ending it: the sharer taking it back, or an echo of
            // this client letting go.
            "revoke" -> {
                if (_driving.value == fromPeerId) _driving.value = null
                if (_asking.value == fromPeerId) {
                    asked = null
                    _asking.value = null
                }
            }

            // Input aimed at this device. There is nothing here to inject it
            // into, and dropping it is the whole of the correct behaviour.
            else -> Unit
        }
    }

    /**
     * A tap or a drag on the shared picture, in fractions of it.
     *
     * Fractions rather than pixels because only the machine at the far end
     * knows what its screen measures - the same reason the remote-desktop
     * viewer sends fractions. A phone showing a 4K desktop letterboxed into a
     * tile has no pixel of its own worth naming.
     *
     * Moves are throttled; presses and releases never are. A dropped move is a
     * slightly coarser path, and a dropped press is a click that did not
     * happen.
     */
    fun sendMouse(
        action: String,
        x: Float,
        y: Float,
        button: String? = null,
        deltaY: Float? = null,
    ) {
        val peer = _driving.value ?: return
        if (action == "move") {
            val now = System.currentTimeMillis()
            if (now - lastMoveAt < MOVE_INTERVAL_MS) return
            lastMoveAt = now
        }
        publish(
            peer,
            JSONObject()
                .put("k", "m")
                .put("a", action)
                .put("x", x.coerceIn(0f, 1f).toDouble())
                .put("y", y.coerceIn(0f, 1f).toDouble())
                .apply {
                    button?.let { put("b", it) }
                    deltaY?.let { put("d", it.toDouble()) }
                },
        )
    }

    /**
     * Where this person is pointing, for everybody watching.
     *
     * Only one person can drive; anybody can point. Sent to the sharer, who is
     * the one client that can place it on the picture everybody else is
     * watching a copy of.
     */
    fun sendPointer(sharerPeerId: String, x: Float, y: Float) {
        val now = System.currentTimeMillis()
        if (now - lastPointerAt < POINTER_INTERVAL_MS) return
        lastPointerAt = now
        publish(
            sharerPeerId,
            JSONObject()
                .put("k", "p")
                .put("x", x.coerceIn(0f, 1f).toDouble())
                .put("y", y.coerceIn(0f, 1f).toDouble()),
        )
    }

    fun clearPointer(sharerPeerId: String) =
        publish(sharerPeerId, JSONObject().put("k", "p.off"))

    private fun publish(peerId: String, message: JSONObject) {
        send?.invoke(peerId, JSONObject().put("topic", TOPIC).put("message", message))
    }
}

// --- the screen half ---------------------------------------------------------

/**
 * The bar that asks, waits, and says what came of it.
 *
 * Above the control dock beside the listening and playing stages, because it is
 * the same kind of thing: a line about the call that is usually not there.
 */
@Composable
fun ShareControlBar(
    sharerPeerId: String,
    sharerName: String,
    pinned: Boolean,
    onPin: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scheme = MaterialTheme.colorScheme
    val asking by ShareControl.asking.collectAsStateWithLifecycle()
    val driving by ShareControl.driving.collectAsStateWithLifecycle()
    val refusal by ShareControl.refusal.collectAsStateWithLifecycle()

    val amDriving = driving == sharerPeerId
    val amAsking = asking == sharerPeerId

    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.large)
            .background(scheme.surfaceContainerHigh)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = when {
                amDriving && !pinned -> "Pin the share to drive it"
                amDriving -> "You are driving $sharerName's screen"
                amAsking -> "Asked $sharerName for the mouse…"
                refusal != null -> refusal.orEmpty()
                else -> "$sharerName is sharing a screen"
            },
            style = MaterialTheme.typography.bodySmall,
            color = scheme.onSurfaceVariant,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )

        when {
            // The pin is the thing standing between them and a usable mouse, so
            // it is the button rather than an instruction to go and find one.
            amDriving && !pinned -> BetweenUsButton(text = "Pin", onClick = onPin)
            amDriving -> BetweenUsButton(text = "Stop", onClick = { ShareControl.release() })
            amAsking -> BetweenUsButton(text = "Cancel", onClick = { ShareControl.release() })
            else -> BetweenUsButton(
                text = "Ask to drive",
                onClick = { ShareControl.ask(sharerPeerId) },
            )
        }
    }
}

/**
 * The picture, while this phone is driving it.
 *
 * Touches become fractions of this box, which is exactly the pinned tile - see
 * why that is required at the call site. A drag is a press, a run of moves and
 * a release, which is what a mouse does and what the far end injects.
 *
 * Not a trackpad. A phone driving a desktop is somebody pointing at a thing on
 * a screen they can see, and an absolute surface is the one that matches what
 * they are looking at; a relative pad would need an on-screen cursor this app
 * would then have to draw and keep in step with the far end's own.
 */
@Composable
fun DriveSurface(sharerPeerId: String, modifier: Modifier = Modifier) {
    val driving by ShareControl.driving.collectAsStateWithLifecycle()
    if (driving != sharerPeerId) return

    Box(
        modifier = modifier.pointerInput(sharerPeerId) {
            detectDragGestures(
                onDragStart = { at ->
                    ShareControl.sendMouse("move", at.x / size.width, at.y / size.height)
                    ShareControl.sendMouse(
                        "down",
                        at.x / size.width,
                        at.y / size.height,
                        button = "left",
                    )
                },
                onDrag = { change, _ ->
                    ShareControl.sendMouse(
                        "move",
                        change.position.x / size.width,
                        change.position.y / size.height,
                    )
                },
                onDragEnd = { ShareControl.sendMouse("up", 0f, 0f, button = "left") },
                // A cancelled gesture must still release the button. A press
                // that is never lifted is a mouse held down on somebody else's
                // machine, which is the worst thing this can leave behind.
                onDragCancel = { ShareControl.sendMouse("up", 0f, 0f, button = "left") },
            )
        },
    ) {
        // A tap is a click in place: press and release at the same point.
        Box(
            Modifier
                .matchParentSize()
                .pointerInput(sharerPeerId) {
                    detectTapGestures { at ->
                        val x = at.x / size.width
                        val y = at.y / size.height
                        ShareControl.sendMouse("move", x, y)
                        ShareControl.sendMouse("down", x, y, button = "left")
                        ShareControl.sendMouse("up", x, y, button = "left")
                    }
                },
        )
    }
}
