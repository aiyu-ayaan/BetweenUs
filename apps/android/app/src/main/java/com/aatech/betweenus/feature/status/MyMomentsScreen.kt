package com.aatech.betweenus.feature.status

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aatech.betweenus.core.data.AuthPhase
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.data.StatusEntry
import com.aatech.betweenus.core.data.StatusKind
import com.aatech.betweenus.core.store.Statuses
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.MyMomentsDoor
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.StatusComposerDoor
import com.aatech.betweenus.ui.components.StatusStory

/**
 * What you have posted, and who has looked at it.
 *
 * The tray answers "is there anything to watch"; this answers "what did I put
 * up, and did anybody see it" - which is the question somebody has the moment
 * they have posted, and the reason the composer lands here rather than back on
 * the tray. Every moment is one tile with its own count, because a run of ten
 * with one number over the lot of them says nothing about which one people
 * actually watched.
 *
 * With nothing posted there is nothing to show, so it opens the composer
 * instead of drawing an empty screen with a button on it that does the same
 * thing.
 */
@Composable
fun MyMomentsHost() {
    if (!MyMomentsDoor.open) return
    Dialog(
        onDismissRequest = { MyMomentsDoor.close() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        MyMomentsScreen(onClose = { MyMomentsDoor.close() })
    }
}

@Composable
private fun MyMomentsScreen(onClose: () -> Unit) {
    val me = (Session.state.collectAsState().value as? AuthPhase.SignedIn)?.user
    val mine by Statuses.mine.collectAsState()
    val posting by Statuses.posting.collectAsState()
    val error by Statuses.error.collectAsState()

    // Read on arrival: this screen is usually reached from the composer, and
    // what it has to show is whatever has finished going up by now.
    LaunchedEffect(Unit) { Statuses.refresh() }

    // Nothing here and nothing on its way: the picker is what was wanted.
    LaunchedEffect(mine.isEmpty(), posting) {
        if (mine.isEmpty() && posting == 0) {
            onClose()
            StatusComposerDoor.show()
        }
    }

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconAction(
                    icon = BetweenUsIcons.ChevronLeft,
                    contentDescription = "Back",
                    onClick = onClose,
                )
                Column(Modifier.weight(1f).padding(start = 8.dp)) {
                    Text(
                        text = "My moments",
                        style = MaterialTheme.typography.titleLargeEmphasized,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = if (posting > 0) {
                            "$posting still uploading"
                        } else {
                            "${countLabel(mine.size)} · gone in 24 hours"
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconAction(
                    icon = BetweenUsIcons.Plus,
                    contentDescription = "Add a moment",
                    onClick = { StatusComposerDoor.show() },
                    prominent = true,
                )
            }

            // An upload that failed did so long after the composer was gone, so
            // this is where it gets to be said.
            error?.let {
                Notice(
                    message = it,
                    tone = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }

            LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                modifier = Modifier.fillMaxSize().navigationBarsPadding(),
                contentPadding = PaddingValues(12.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                // Newest first, unlike the player behind it. A run is watched
                // oldest to newest because that is the order it was lived in;
                // a grid of your own posts is read the way every grid of your
                // own things is read, with the thing you just did at the top.
                // Each tile carries the position it opens, so the two orders
                // never have to agree.
                items(
                    mine.withIndex().reversed(),
                    key = { (_, post) -> post.id },
                ) { (at, post) ->
                    MomentTile(
                        post = post,
                        onClick = { me?.id?.let { StatusStory.open(it, at) } },
                    )
                }
            }
        }
    }
}

/** One posted moment: what it looks like, when it went up, and who has seen it. */
@Composable
private fun MomentTile(post: StatusEntry, onClick: () -> Unit) {
    var picture by remember(post.id) { mutableStateOf<ImageBitmap?>(null) }

    LaunchedEffect(post.id) {
        // Through the player's own cache, so opening this run afterwards is not
        // a second download. A post this device holds no key for stays blank
        // rather than failing, the way the player draws it.
        picture = if (post.kind == StatusKind.PHOTO) {
            StatusMedia.photo(post)?.asImageBitmap()
        } else {
            null
        }
    }

    Box(
        modifier = Modifier
            .aspectRatio(9f / 16f)
            .clip(RoundedCornerShape(10.dp))
            .background(
                if (post.kind == StatusKind.TEXT) colourOf(post.background) else Color.Black,
            )
            .clickable(onClick = onClick),
    ) {
        val drawn = picture
        when {
            drawn != null -> Image(
                bitmap = drawn,
                contentDescription = post.caption ?: "Moment",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )

            post.kind == StatusKind.VIDEO -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                BetweenUsIcon(BetweenUsIcons.Play, tint = Color.White, size = 26.dp)
            }

            post.kind == StatusKind.TEXT -> Text(
                text = post.caption.orEmpty(),
                style = MaterialTheme.typography.labelMedium,
                color = Color.White,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.align(Alignment.Center).padding(8.dp),
            )
        }

        Text(
            text = statusAge(post.createdAt),
            style = MaterialTheme.typography.labelSmall,
            color = Color.White,
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(6.dp)
                .clip(RoundedCornerShape(50))
                .background(Color.Black.copy(alpha = 0.45f))
                .padding(horizontal = 6.dp, vertical = 2.dp),
        )

        Row(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(6.dp)
                .clip(RoundedCornerShape(50))
                .background(Color.Black.copy(alpha = 0.45f))
                .padding(horizontal = 6.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BetweenUsIcon(BetweenUsIcons.Eye, tint = Color.White, size = 12.dp)
            Spacer(Modifier.width(4.dp))
            Text(
                text = (post.viewCount ?: 0).toString(),
                style = MaterialTheme.typography.labelSmall,
                color = Color.White,
            )
        }
    }
}
