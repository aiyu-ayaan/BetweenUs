package com.aatech.betweenus.feature.status

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.Image
import com.aatech.betweenus.core.data.StatusEntry
import com.aatech.betweenus.core.data.StatusKind
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.StatusRing

/**
 * The circle at the start of a moments row: what somebody posted, not who
 * they are.
 *
 * A face is the right thing in every other list in the app, because every
 * other list is about people. This one is about posts - the row already says
 * whose they are - so the circle shows the newest one, which is what the tap
 * is about to open. It keeps the ring, so the count and the unopened state
 * still read exactly as they do on an avatar.
 *
 * The bytes come through [StatusMedia], the same cache the player uses, so
 * opening a run after seeing it here is not a second download.
 *
 * ponytail: a video draws a play mark rather than a poster frame - a frame
 * means fetching and decrypting the whole clip for a 36dp circle. Server-side
 * thumbnails are the upgrade if that ever matters.
 *
 * The port of `apps/desktop/src/features/status/MomentThumb.tsx`.
 */
@Composable
fun MomentThumb(
    /** One person's run, oldest first. The newest is what gets drawn. */
    posts: List<StatusEntry>,
    unseen: Boolean,
    modifier: Modifier = Modifier,
    size: Dp = 36.dp,
) {
    val context = LocalContext.current
    val newest = posts.lastOrNull()
    var picture by remember(newest?.id) { mutableStateOf<ImageBitmap?>(null) }

    LaunchedEffect(newest?.id) {
        // A post this device holds no key for stays blank rather than failing,
        // the same way the player draws it.
        picture = if (newest?.kind == StatusKind.PHOTO) {
            StatusMedia.photo(newest)?.asImageBitmap()
        } else {
            null
        }
    }

    // The ring takes the outer edge and the picture is inset inside it, the
    // way `Avatar` does it, so a row does not twitch as runs arrive.
    val inner = if (posts.isNotEmpty()) size - RING_INSET * 2 else size

    Box(modifier = modifier.size(size), contentAlignment = Alignment.Center) {
        StatusRing(
            count = posts.size,
            unseen = unseen,
            size = size,
            modifier = Modifier.size(size),
        )
        Box(
            modifier = Modifier
                .size(inner)
                .clip(CircleShape)
                .background(
                    if (newest?.kind == StatusKind.TEXT) colourOf(newest.background) else Color.Black,
                ),
            contentAlignment = Alignment.Center,
        ) {
            val drawn = picture
            when {
                drawn != null -> Image(
                    bitmap = drawn,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(inner).clip(CircleShape),
                )

                newest?.kind == StatusKind.VIDEO ->
                    BetweenUsIcon(BetweenUsIcons.Play, tint = Color.White, size = inner * 0.4f)

                newest?.kind == StatusKind.TEXT -> Text(
                    text = newest.caption?.trim()?.take(1)?.uppercase().orEmpty(),
                    style = MaterialTheme.typography.labelLarge,
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

/** How much the ring takes off the edge: stroke plus air. Matches `Avatar`. */
private val RING_INSET = 3.5.dp
