package com.aatech.betweenus.ui.components

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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.aatech.betweenus.ui.theme.Slate100
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
                color = Slate100,
                fontWeight = FontWeight.SemiBold,
                fontSize = (size.value * 0.4f).sp,
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
 * A server's tile in the rail. Square with a large radius when idle, rounder
 * and accented when it is the one being looked at - the same shape language the
 * desktop rail uses to say "you are here".
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
    Box(modifier = modifier.size(52.dp), contentAlignment = Alignment.Center) {
        Avatar(
            id = id,
            label = name,
            url = iconUrl,
            size = 46.dp,
            shape = RoundedCornerShape(if (selected) 14.dp else 22.dp),
            modifier = if (selected) {
                Modifier.border(2.dp, com.aatech.betweenus.ui.theme.Accent, RoundedCornerShape(14.dp))
            } else {
                Modifier
            },
        )
        if (unread > 0) {
            Badge(
                count = unread,
                modifier = Modifier.align(Alignment.TopEnd).padding(top = 2.dp, end = 2.dp),
            )
        }
        content()
    }
}

@Composable
fun Badge(count: Int, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .background(com.aatech.betweenus.ui.theme.Danger, CircleShape)
            .padding(horizontal = 5.dp, vertical = 1.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = if (count > 99) "99+" else count.toString(),
            style = MaterialTheme.typography.labelSmall,
            color = Color.White,
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
