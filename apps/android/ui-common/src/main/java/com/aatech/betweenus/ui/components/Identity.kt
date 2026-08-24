package com.aatech.betweenus.ui.components

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
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
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
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
@Composable
fun Avatar(
    id: String,
    label: String,
    url: String?,
    modifier: Modifier = Modifier,
    size: Dp = 36.dp,
    shape: androidx.compose.ui.graphics.Shape = CircleShape,
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(shape)
            .background(if (url == null) tintFor(id) else Surface700),
        contentAlignment = Alignment.Center,
    ) {
        if (url != null) {
            AsyncImage(
                model = url,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(size).clip(shape),
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

/** Avatar with the presence dot the other clients hang off the bottom-right. */
@Composable
fun AvatarWithStatus(
    id: String,
    label: String,
    url: String?,
    status: String,
    modifier: Modifier = Modifier,
    size: Dp = 36.dp,
) {
    Box(modifier = modifier) {
        Avatar(id, label, url, size = size)
        StatusDot(
            status = status,
            modifier = Modifier.align(Alignment.BottomEnd),
            size = (size.value * 0.32f).dp,
        )
    }
}

@Composable
fun StatusDot(status: String, modifier: Modifier = Modifier, size: Dp = 10.dp) {
    Box(
        modifier = modifier
            .size(size + 4.dp)
            .background(Surface900, CircleShape),
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

/** Stable across sessions and clients, because it is a hash and not a choice. */
private fun tintFor(id: String): Color {
    val palette = listOf(
        Color(0xFF7C5CFF), Color(0xFF3FD68C), Color(0xFFF5B83D),
        Color(0xFF4CA5FF), Color(0xFFFF7A9C), Color(0xFF3FD1D6),
    )
    return palette[(id.hashCode().absoluteValue) % palette.size]
}
