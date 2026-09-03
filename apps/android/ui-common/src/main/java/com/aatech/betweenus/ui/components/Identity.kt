package com.aatech.betweenus.ui.components

import androidx.compose.animation.core.animateDpAsState
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.aatech.betweenus.core.store.Statuses
import com.aatech.betweenus.ui.theme.BetweenUsMotion
import com.aatech.betweenus.ui.theme.StatusDnd
import com.aatech.betweenus.ui.theme.StatusIdle
import com.aatech.betweenus.ui.theme.StatusOffline
import com.aatech.betweenus.ui.theme.StatusOnline
import com.aatech.betweenus.ui.theme.Surface700
import com.aatech.betweenus.ui.theme.Surface900
import kotlin.math.absoluteValue

/**
 * A person, or a server, as a circle.
 *
 * With no picture it falls back to an initial on a colour derived from the id
 * rather than a grey blank: a list of six grey circles is unreadable, and the
 * colour has to be stable across sessions and across clients, so it is a hash
 * of the id and not a random pick.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun Avatar(
    id: String,
    label: String,
    url: String?,
    modifier: Modifier = Modifier,
    size: Dp = 36.dp,
    shape: androidx.compose.ui.graphics.Shape = CircleShape,
    viewable: Boolean = true,
    /**
     * What a second tap asks, where anything asks it: who is this.
     *
     * Null everywhere it means nothing - a server's icon, a circle inside a
     * control - and the same gesture as a double tap on a message, so one
     * question has one answer wherever a face is drawn.
     */
    onDoubleTap: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    // Both the ring and what a tap does come from here, because every list in
    // the app draws people through this one composable - which is what makes a
    // ring appear in the drawer, the member list and a conversation header at
    // once rather than in whichever three of them somebody remembered.
    //
    // Collected rather than read: a run that arrives while a row is on screen
    // has to draw itself, and `ringFor` on its own is the value at the moment
    // it was called.
    val mine by Statuses.mine.collectAsState()
    val runs by Statuses.runs.collectAsState()
    val posted = remember(id, mine, runs) { if (viewable) Statuses.ringFor(id) else 0 to false }
    val postCount = posted.first
    val unseen = posted.second

    val tapped = {
        when {
            // Two things behind one circle: ask which. See `AvatarChoice`.
            postCount > 0 -> AvatarChoice.ask(
                AvatarChoice.Asking(userId = id, name = label, avatarUrl = url, count = postCount),
            )
            url != null -> ProfileViewer.open(label, url)
            else ->
                Toast.makeText(context, "Profile photo not available", Toast.LENGTH_SHORT).show()
        }
    }
    // A ring takes the outer edge and the picture is inset inside it, rather
    // than the ring being drawn outside the avatar's own box. Growing the box
    // would move everything laid out around it - a presence dot most visibly -
    // the moment somebody posted, so a list would twitch as statuses arrive.
    val ringed = postCount > 0
    val inner = if (ringed) size - RING_INSET * 2 else size

    Box(modifier = modifier.size(size), contentAlignment = Alignment.Center) {
        if (ringed) {
            StatusRing(
                count = postCount,
                unseen = unseen,
                size = size,
                modifier = Modifier.size(size),
            )
        }

    Box(
        modifier = Modifier
            .size(inner)
            .clip(shape)
            .background(if (url == null) tintFor(id) else Surface700)
            // Tapping a face shows the face, and a second tap asks who it
            // belongs to. It has to be taken before the row underneath gets it
            // - a row is usually clickable too - which is what a gesture on the
            // circle itself does.
            .then(
                when {
                    !viewable -> Modifier
                    onDoubleTap == null -> Modifier.clickable { tapped() }
                    // `combinedClickable` rather than two modifiers: a single
                    // tap has to wait out the double-tap window before it can
                    // know it was single, and only one gesture detector can be
                    // the thing that waits.
                    else -> Modifier.combinedClickable(
                        onClick = tapped,
                        onDoubleClick = onDoubleTap,
                    )
                }
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (url != null) {
            AsyncImage(
                model = url,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(inner).clip(shape),
            )
        } else {
            Text(
                text = label.take(1).uppercase(),
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.SemiBold,
                fontSize = (size.value * 0.4f).sp,
                textAlign = TextAlign.Center,
                // A single glyph in a `Box` is centred on its *line*, not on
                // itself, and a line carries the font's own ascent and descent
                // padding - which is asymmetric, so the letter sat high and
                // left of the circle it is supposed to be in the middle of.
                // Dropping the platform padding and trimming the line to the
                // glyph is what makes "centre" mean the letter.
                lineHeight = (size.value * 0.4f).sp,
                style = MaterialTheme.typography.bodyMedium.copy(
                    platformStyle = PlatformTextStyle(includeFontPadding = false),
                    lineHeightStyle = LineHeightStyle(
                        alignment = LineHeightStyle.Alignment.Center,
                        trim = LineHeightStyle.Trim.Both,
                    ),
                ),
            )
        }
    }
    }
}

/** How much the ring takes off the edge of a ringed avatar: stroke plus air. */
private val RING_INSET = 3.5.dp

/** Avatar with the presence dot the other clients hang off the bottom-right. */
@Composable
fun AvatarWithStatus(
    id: String,
    label: String,
    url: String?,
    status: String,
    modifier: Modifier = Modifier,
    size: Dp = 36.dp,
    viewable: Boolean = true,
    onDoubleTap: (() -> Unit)? = null,
    /** The colour the dot is punched out of. See [StatusDot]. */
    ring: Color = Surface900,
) {
    Box(modifier = modifier) {
        Avatar(id, label, url, size = size, viewable = viewable, onDoubleTap = onDoubleTap)
        StatusDot(
            status = status,
            modifier = Modifier.align(Alignment.BottomEnd),
            size = (size.value * 0.32f).dp,
            ring = ring,
        )
    }
}

/**
 * The presence dot, punched out of whatever it is sitting on.
 *
 * [ring] is the cut-out, and it has to match the background behind the avatar
 * or the dot reads as a coloured circle inside a grey one. Only the caller knows
 * what that background is - a member row sits on a surface container and a
 * message sits on the conversation's own background - so it is a parameter, the
 * same way the desktop's `ringColour` is.
 */
@Composable
fun StatusDot(
    status: String,
    modifier: Modifier = Modifier,
    size: Dp = 10.dp,
    ring: Color = Surface900,
) {
    Box(
        modifier = modifier
            .size(size + 4.dp)
            .background(ring, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(size).background(statusColor(status), CircleShape))
    }
}

fun statusColor(status: String): Color = when (status.lowercase()) {
    "online" -> StatusOnline
    "idle" -> StatusIdle
    "dnd" -> StatusDnd
    else -> StatusOffline
}

/**
 * A server's tile in the rail.
 *
 * The shape is the state. A tile at rest is a squircle; the one being looked at
 * springs open to a circle and grows a ring, and the corner is animated rather
 * than swapped so switching servers is one continuous movement instead of a
 * cut. This is the expressive shape-morph doing the job an underline used to.
 */
@Composable
fun ServerTile(
    id: String,
    name: String,
    iconUrl: String?,
    selected: Boolean,
    unread: Int,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit = {},
) {
    val corner by animateDpAsState(
        targetValue = if (selected) 23.dp else 16.dp,
        animationSpec = BetweenUsMotion.spatial(),
        label = "server-tile-corner",
    )
    val shape = RoundedCornerShape(corner)
    Box(modifier = modifier.size(56.dp), contentAlignment = Alignment.Center) {
        Avatar(
            id = id,
            label = name,
            url = iconUrl,
            size = 46.dp,
            shape = shape,
            viewable = false,
            modifier = if (selected) {
                Modifier.border(2.dp, MaterialTheme.colorScheme.primary, shape)
            } else {
                Modifier
            },
        )
        if (unread > 0) {
            Badge(
                count = unread,
                modifier = Modifier.align(Alignment.TopEnd),
            )
        }
        content()
    }
}

/** An unread count. Tertiary, not error: unread is news, it is not a failure. */
@Composable
fun Badge(count: Int, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .background(MaterialTheme.colorScheme.tertiary, CircleShape)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = if (count > 99) "99+" else count.toString(),
            style = MaterialTheme.typography.labelSmallEmphasized,
            color = MaterialTheme.colorScheme.onTertiary,
        )
    }
}

/**
 * The colour this person is drawn in.
 *
 * Stable across sessions and clients, because it is a hash and not a choice -
 * which is what lets a name in a conversation be tinted to match the avatar
 * beside it without the two being told about each other.
 */
fun tintFor(id: String): Color {
    val palette = listOf(
        Color(0xFF7C5CFF), Color(0xFF3FD68C), Color(0xFFF5B83D),
        Color(0xFF4CA5FF), Color(0xFFFF7A9C), Color(0xFF3FD1D6),
    )
    return palette[(id.hashCode().absoluteValue) % palette.size]
}
