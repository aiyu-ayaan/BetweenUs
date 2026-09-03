package com.aatech.betweenus.feature.status

import android.widget.VideoView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aatech.betweenus.core.data.AuthPhase
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.data.StatusEntry
import com.aatech.betweenus.core.data.StatusKind
import com.aatech.betweenus.core.data.StatusViewer
import com.aatech.betweenus.core.data.UserSummary
import com.aatech.betweenus.core.store.Statuses
import com.aatech.betweenus.ui.components.Avatar
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.StatusStory
import kotlinx.coroutines.android.awaitFrame
import kotlinx.coroutines.launch

/**
 * Somebody's statuses, full screen, one after another.
 *
 * The shape is the one everybody already knows: a bar per post along the top
 * that fills while it plays, a tap on the left for the previous and on the
 * right for the next, a press-and-hold to stop the clock. Getting that right
 * matters more than anything visual here - it is the only interface in this app
 * people arrive already knowing, and every deviation from it reads as a bug
 * rather than as a choice.
 *
 * Runs are chained: the end of one person's posts moves on to the next person
 * who has some, which is what makes the tray a queue rather than a list of
 * things to open one at a time.
 *
 * The port of `apps/desktop/src/features/status/StatusViewer.tsx`. Mounted once
 * at the root beside `ProfileDialogHost`, so a ring in a list, a row in the
 * tray and an avatar in a conversation all open the same player.
 */
@Composable
fun StatusStoryHost() {
    val authorId = StatusStory.authorId ?: return
    Dialog(
        onDismissRequest = { StatusStory.close() },
        // A screen wearing a dialog's clothes; the default insets would leave
        // it a card in the middle of a dimmed window.
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        StatusStoryScreen(authorId = authorId, onClose = { StatusStory.close() })
    }
}

@Composable
private fun StatusStoryScreen(authorId: String, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    val me = (Session.state.collectAsState().value as? AuthPhase.SignedIn)?.user
    val mine by Statuses.mine.collectAsState()
    val runs by Statuses.runs.collectAsState()

    val isSelf = authorId == me?.id
    val run = runs.firstOrNull { it.author.id == authorId }
    val posts = if (isSelf) mine else run?.statuses.orEmpty()
    val author: UserSummary? = if (isSelf) me?.summary else run?.author

    // Where in the run to start: the first unopened post, because the
    // beginning is where somebody who has already watched half a run does not
    // want to be. A run watched through opens at the start again - there is
    // nothing to resume to.
    var index by remember(authorId) {
        mutableIntStateOf(posts.indexOfFirst { !it.seen }.takeIf { it >= 0 } ?: 0)
    }
    var paused by remember { mutableStateOf(false) }
    var viewers by remember { mutableStateOf<List<StatusViewer>?>(null) }

    val post = posts.getOrNull(index)

    // The run emptied underneath the player - the post expired, or was deleted
    // on another device.
    LaunchedEffect(posts.size) {
        if (posts.isEmpty()) onClose() else if (index >= posts.size) index = posts.lastIndex
    }

    // A post on screen has been looked at. Recorded on arrival rather than on
    // completion: opening it is the look, and a viewer list that counted only
    // the people who watched to the end would be a different feature.
    LaunchedEffect(post?.id) {
        val id = post?.id
        if (id != null && !isSelf) Statuses.markSeen(id)
    }

    val next: () -> Unit = {
        when {
            index + 1 < posts.size -> index++
            // Own posts are not part of the queue: they are opened
            // deliberately, and finishing them lands nowhere rather than in
            // somebody else's run.
            isSelf -> onClose()
            else -> {
                val at = runs.indexOfFirst { it.author.id == authorId }
                val following = runs.getOrNull(at + 1)
                if (following != null) StatusStory.open(following.author.id) else onClose()
            }
        }
        Unit
    }

    if (post == null || author == null) return

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .pointerInput(post.id, posts.size) {
                detectTapGestures(
                    // A hold is a press that outlives the tap: `tryAwaitRelease`
                    // is what waits, and the pause is lifted whether the finger
                    // was lifted or the gesture was cancelled.
                    onPress = {
                        paused = true
                        tryAwaitRelease()
                        paused = false
                    },
                    onTap = { offset ->
                        if (offset.x < size.width / 3f) {
                            if (index > 0) index--
                        } else {
                            next()
                        }
                    },
                )
            },
    ) {
        Slide(post = post, paused = paused, modifier = Modifier.fillMaxSize())

        Column(Modifier.fillMaxWidth().statusBarsPadding()) {
            Bars(
                count = posts.size,
                index = index,
                holdMs = post.holdMs,
                postId = post.id,
                paused = paused,
                onDone = next,
            )
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(
                    id = author.id,
                    label = author.label,
                    url = author.avatarUrl?.let { Endpoint.absolute(it) },
                    size = 34.dp,
                    viewable = false,
                )
                Column(Modifier.weight(1f).padding(start = 10.dp)) {
                    Text(
                        text = if (isSelf) "My status" else author.label,
                        style = MaterialTheme.typography.titleSmall,
                        color = Color.White,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = statusAge(post.createdAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White.copy(alpha = 0.7f),
                    )
                }
                IconAction(
                    icon = BetweenUsIcons.X,
                    contentDescription = "Close status",
                    onClick = onClose,
                )
            }
        }

        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (!post.caption.isNullOrBlank() && post.kind != StatusKind.TEXT) {
                Text(
                    text = post.caption.orEmpty(),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White,
                    textAlign = TextAlign.Center,
                )
            }

            // Your own post gets the two things nobody else may have: who saw
            // it, and the way to take it down.
            if (isSelf) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Pill(
                        icon = BetweenUsIcons.Eye,
                        label = (post.viewCount ?: 0).toString(),
                        onClick = {
                            paused = true
                            scope.launch {
                                viewers = runCatching { Statuses.viewersOf(post.id) }
                                    .getOrDefault(emptyList())
                            }
                        },
                    )
                    Pill(
                        icon = BetweenUsIcons.Trash,
                        label = "Delete",
                        onClick = { scope.launch { runCatching { Statuses.remove(post.id) } } },
                    )
                }
            }
        }
    }

    viewers?.let { list ->
        ModalBottomSheet(
            onDismissRequest = {
                viewers = null
                paused = false
            },
        ) {
            Text(
                text = "Viewed by ${list.size}",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            if (list.isEmpty()) {
                Text(
                    text = "Nobody has seen this yet.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(20.dp),
                )
            } else {
                LazyColumn(Modifier.fillMaxWidth().navigationBarsPadding()) {
                    items(list, key = { it.user.id }) { viewer ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 20.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Avatar(
                                id = viewer.user.id,
                                label = viewer.user.label,
                                url = viewer.user.avatarUrl?.let { Endpoint.absolute(it) },
                                size = 32.dp,
                                viewable = false,
                            )
                            Text(
                                text = viewer.user.label,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.weight(1f).padding(start = 12.dp),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                text = statusAge(viewer.viewedAt),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * The progress row: one bar per post, the current one filling.
 *
 * A frame loop rather than an animation with a callback, because the same
 * number has to do two jobs - paint the bar, and say when the post is over -
 * and a pause has to freeze both at once. Holding the elapsed time and reading
 * the clock each frame is what makes a resume continue rather than restart.
 */
@Composable
private fun Bars(
    count: Int,
    index: Int,
    holdMs: Long,
    postId: String,
    paused: Boolean,
    onDone: () -> Unit,
) {
    var elapsed by remember(postId) { mutableLongStateOf(0L) }

    LaunchedEffect(postId, paused) {
        if (paused) return@LaunchedEffect
        var previous = 0L
        while (elapsed < holdMs) {
            val frame = awaitFrame()
            if (previous != 0L) elapsed += (frame - previous) / 1_000_000
            previous = frame
        }
        onDone()
    }

    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        repeat(count) { at ->
            val filled = when {
                at < index -> 1f
                at > index -> 0f
                else -> (elapsed.toFloat() / holdMs.toFloat()).coerceIn(0f, 1f)
            }
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(3.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(Color.White.copy(alpha = 0.3f)),
            ) {
                Box(
                    Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(filled)
                        .clip(RoundedCornerShape(2.dp))
                        .background(Color.White),
                )
            }
        }
    }
}

/** The post itself: a picture, a video, or words on a colour. */
@Composable
private fun Slide(post: StatusEntry, paused: Boolean, modifier: Modifier = Modifier) {
    val context = LocalContext.current

    if (post.kind == StatusKind.TEXT) {
        Box(
            modifier = modifier.background(colourOf(post.background)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = post.caption.orEmpty(),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                color = Color.White,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(32.dp),
            )
        }
        return
    }

    val mediaUrl = post.mediaUrl
    if (mediaUrl == null) return

    if (post.kind == StatusKind.VIDEO) {
        var uri by remember(post.id) { mutableStateOf<android.net.Uri?>(null) }
        LaunchedEffect(post.id) { uri = StatusMedia.video(context, post.id, mediaUrl) }
        val target = uri
        if (target == null) {
            Box(modifier, contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            return
        }
        // A held finger stops the video as well as the bar; the two running out
        // of step is what people notice immediately.
        AndroidView(
            factory = { ctx ->
                VideoView(ctx).apply {
                    setVideoURI(target)
                    setOnPreparedListener { player ->
                        player.isLooping = true
                        start()
                    }
                }
            },
            update = { view -> if (paused) view.pause() else if (!view.isPlaying) view.start() },
            modifier = modifier,
        )
        return
    }

    var bitmap by remember(post.id) { mutableStateOf<android.graphics.Bitmap?>(null) }
    LaunchedEffect(post.id) { bitmap = StatusMedia.photo(post.id, mediaUrl) }
    val picture = bitmap
    if (picture == null) {
        Box(modifier, contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    Image(
        bitmap = picture.asImageBitmap(),
        contentDescription = post.caption ?: "Status",
        contentScale = ContentScale.Fit,
        modifier = modifier,
    )
}

@Composable
private fun Pill(icon: Int, label: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(Color.White.copy(alpha = 0.15f))
            .padding(horizontal = 16.dp, vertical = 10.dp)
            .pointerInput(label) { detectTapGestures(onTap = { onClick() }) },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BetweenUsIcon(icon, contentDescription = null, tint = Color.White, size = 18.dp)
        Spacer(Modifier.width(8.dp))
        Text(text = label, style = MaterialTheme.typography.labelLarge, color = Color.White)
    }
}

/** The colour a text status is drawn on, falling back to the darkest of them. */
internal fun colourOf(hex: String?): Color =
    runCatching { Color(android.graphics.Color.parseColor(hex ?: "#0F172A")) }
        .getOrDefault(Color(0xFF0F172A))
