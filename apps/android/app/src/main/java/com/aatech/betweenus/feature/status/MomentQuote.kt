package com.aatech.betweenus.feature.status

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.MessageMoment
import com.aatech.betweenus.core.data.StatusKind
import com.aatech.betweenus.core.store.Statuses
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.StatusStory

/**
 * The moment a message answers, drawn inside the bubble above it.
 *
 * Two states, and the second is the point of the block. While the post is alive
 * its picture is here and a tap opens the player at that post. Once the day is
 * up there is nothing to fetch and nothing to open - so the block stays where
 * it was, keeps its mark, and says the moment is gone. Removing it would leave
 * a bare "😂" in a conversation with nothing to say what it answered.
 *
 * The picture comes from the post itself rather than from a copy carried in the
 * message: both ends already hold the key to it while it is alive, and a
 * thumbnail copied into the conversation would outlive the thing it is of.
 *
 * The port of `MomentQuote` in `apps/desktop/src/features/chat/ChatView.tsx`.
 */
@Composable
fun MomentQuote(moment: MessageMoment, mine: Boolean, modifier: Modifier = Modifier) {
    val myPosts by Statuses.mine.collectAsState()
    val runs by Statuses.runs.collectAsState()

    // Recomputed whenever either list moves - a post that expires while the
    // conversation is open has to fall back to the gone state without a reload.
    val post = remember(moment.statusId, myPosts, runs) { Statuses.entry(moment.statusId) }

    var picture by remember(post?.id) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(post?.id) {
        // Through the player's own cache, so opening the run afterwards is not
        // a second download. A post this device holds no key for keeps the mark
        // and draws no picture, which is not an error here.
        picture = post
            ?.takeIf { it.kind == StatusKind.PHOTO }
            ?.let { StatusMedia.photo(it)?.asImageBitmap() }
    }

    val gone = post == null
    val open = {
        val at = (if (moment.authorId in runs.map { it.author.id }) {
            runs.first { it.author.id == moment.authorId }.statuses
        } else {
            myPosts
        }).indexOfFirst { it.id == moment.statusId }
        if (at >= 0) StatusStory.open(moment.authorId, at)
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(bottom = 6.dp)
            .clip(MaterialTheme.shapes.small)
            .background(MaterialTheme.colorScheme.surfaceContainerLowest.copy(alpha = 0.5f))
            // Not tappable when there is nothing behind it: a tap that opens an
            // empty player is worse than no tap at all.
            .let { if (gone) it else it.clickable { open() } }
            .padding(horizontal = 8.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            modifier = Modifier
                .width(26.dp)
                .height(34.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(
                    if (post?.kind == StatusKind.TEXT) colourOf(post.background) else Color.Black,
                ),
            contentAlignment = Alignment.Center,
        ) {
            val drawn = picture
            if (drawn != null) {
                Image(
                    bitmap = drawn,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                BetweenUsIcon(
                    if (post?.kind == StatusKind.VIDEO) {
                        BetweenUsIcons.Play
                    } else {
                        BetweenUsIcons.MomentsEmpty
                    },
                    tint = Color.White.copy(alpha = 0.7f),
                    size = 14.dp,
                )
            }
        }

        Column(Modifier.weight(1f)) {
            Text(
                // Reads correctly from both sides of the conversation: the
                // author sees their own post named as theirs, and whoever
                // answered sees whose it was.
                text = if (mine) "Answered a moment" else "Answered your moment",
                style = MaterialTheme.typography.labelSmallEmphasized,
                color = MaterialTheme.colorScheme.primary,
            )
            Text(
                text = if (gone) {
                    "This moment is no longer available"
                } else {
                    post.caption?.takeIf { it.isNotBlank() } ?: "Moment"
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
