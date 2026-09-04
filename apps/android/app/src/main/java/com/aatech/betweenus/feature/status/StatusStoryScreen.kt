package com.aatech.betweenus.feature.status

import android.widget.VideoView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
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
import com.aatech.betweenus.core.store.Conversation
import com.aatech.betweenus.core.store.Statuses
import com.aatech.betweenus.ui.components.Avatar
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.StatusStory
import kotlinx.coroutines.android.awaitFrame
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The one-tap reactions offered under somebody else's moment. The same six the
 * desktop offers, so a reaction reads the same on both.
 */
private val QUICK_REACTIONS = listOf("❤️", "😂", "😮", "😢", "🙏", "👏")

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

    // Where to start: the post the caller named, or - when it named only a
    // person - their first unopened one, because the beginning is where
    // somebody who has already watched half a run does not want to be. A run
    // watched through opens at the start again; there is nothing to resume to.
    var index by remember(authorId) {
        mutableIntStateOf(
            StatusStory.index ?: posts.indexOfFirst { !it.seen }.takeIf { it >= 0 } ?: 0,
        )
    }
    var paused by remember { mutableStateOf(false) }
    var viewers by remember { mutableStateOf<List<StatusViewer>?>(null) }

    /**
     * The post whose media has finished coming down. The clock does not run
     * before that, so a photo on a slow line gets its five seconds of being
     * looked at rather than five seconds of spinner. Held as an id rather than
     * a flag so moving on resets it: the next post is not this one, so it is
     * not ready. A post that failed counts as ready - the run has to move on
     * past something that is never going to arrive.
     */
    var loadedId by remember { mutableStateOf<String?>(null) }

    /**
     * True while somebody is writing an answer. The clock stops for it - a post
     * that moves on mid-sentence takes the sentence with it.
     */
    var answering by remember { mutableStateOf(false) }

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

    /** Who has looked at this one. The clock stops while the list is up. */
    val showViewers: () -> Unit = {
        val id = post?.id
        if (id != null) {
            paused = true
            scope.launch {
                viewers = runCatching { Statuses.viewersOf(id) }.getOrDefault(emptyList())
            }
        }
        Unit
    }

    if (post == null || author == null) return

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            // A drag up opens the viewer list - the gesture this shape has
            // everywhere else, and the only way to reach the list without
            // aiming at a pill in the corner. Its own `pointerInput` rather
            // than a branch inside the tap detector: a tap and a drag are two
            // gestures, and the tap detector abandons a press the moment it
            // travels far enough to be this one.
            .pointerInput(post.id, isSelf) {
                if (!isSelf) return@pointerInput
                val threshold = 48.dp.toPx()
                var travelled = 0f
                detectVerticalDragGestures(
                    onDragStart = { travelled = 0f },
                    onDragEnd = { if (travelled <= -threshold) showViewers() },
                ) { change, delta ->
                    travelled += delta
                    change.consume()
                }
            }
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
        Slide(
            post = post,
            paused = paused || answering,
            onReady = { loadedId = it },
            modifier = Modifier.fillMaxSize(),
        )

        Column(Modifier.fillMaxWidth().statusBarsPadding()) {
            Bars(
                count = posts.size,
                index = index,
                holdMs = post.holdMs,
                postId = post.id,
                paused = paused || answering || loadedId != post.id,
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
                        text = if (isSelf) "My moments" else author.label,
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
                    contentDescription = "Close moments",
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

            // Somebody else's post gets the two things you can do to it,
            // which are one thing: a message to its author with a pointer at
            // it. See `Conversation.answerMoment`.
            if (!isSelf) {
                AnswerBar(
                    post = post,
                    name = author.label,
                    onHold = { answering = it },
                )
            }

            // Your own post gets the two things nobody else may have: who saw
            // it, and the way to take it down.
            if (isSelf) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Pill(
                        icon = BetweenUsIcons.Eye,
                        // What they said in the same pill as how many of them
                        // there were: one fact about one post, with the list
                        // behind it for reading either person by person.
                        label = listOf(
                            (post.viewCount ?: 0).toString(),
                            post.reactions.joinToString(" ") { "${it.emoji}${it.count}" },
                        ).filter { it.isNotBlank() }.joinToString("  "),
                        onClick = showViewers,
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
                            // Beside the name rather than in a list of its
                            // own: what somebody said back is a fact about
                            // their having watched.
                            viewer.reaction?.let { said ->
                                Text(
                                    text = said,
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.padding(end = 8.dp),
                                )
                            }
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

/**
 * The post itself: a picture, a video, or words on a colour.
 *
 * [onReady] is called with the post's id once there is something to look at -
 * or once there never will be. The player holds the clock and this holds the
 * bytes, so the one that knows has to say.
 */
@Composable
private fun Slide(
    post: StatusEntry,
    paused: Boolean,
    onReady: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current

    // Words, and anything with nothing to download, are ready on arrival.
    LaunchedEffect(post.id) {
        if (post.kind == StatusKind.TEXT || post.mediaUrl == null) onReady(post.id)
    }

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

    if (post.mediaUrl == null) return

    if (post.kind == StatusKind.VIDEO) {
        var uri by remember(post.id) { mutableStateOf<android.net.Uri?>(null) }
        LaunchedEffect(post.id) {
            uri = StatusMedia.video(context, post)
            // Ready either way: a clip that will not come down must not hold
            // the run on a spinner forever.
            onReady(post.id)
        }
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
    LaunchedEffect(post.id) {
        bitmap = StatusMedia.photo(post)
        onReady(post.id)
    }
    val picture = bitmap
    if (picture == null) {
        Box(modifier, contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    Image(
        bitmap = picture.asImageBitmap(),
        contentDescription = post.caption ?: "Moment",
        contentScale = ContentScale.Fit,
        modifier = modifier,
    )
}

/**
 * The one-tap answers under somebody else's moment.
 *
 * Six, and these six: enough that the reaction somebody wants is usually there,
 * few enough to sit in a row on a phone without a picker in front of them. A
 * reaction and a reply send the same thing - see `Conversation.answerMoment` -
 * so the row and the field below it differ only in what the text is.
 *
 * Nothing is drawn back here afterwards: this is a player, not a thread. The
 * confirmation is a line that fades, and the answer is in the conversation.
 */
@Composable
private fun AnswerBar(post: StatusEntry, name: String, onHold: (Boolean) -> Unit) {
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    var text by remember(post.authorId) { mutableStateOf("") }
    var focused by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }

    // The clock stops while there is something half-written or a cursor in the
    // field. Reported up rather than held here: the bars belong to the player.
    LaunchedEffect(focused, text) { onHold(focused || text.isNotBlank()) }
    DisposableEffect(Unit) { onDispose { onHold(false) } }

    val send: (String) -> Unit = { words ->
        val said = words.trim()
        if (said.isNotEmpty()) {
            text = ""
            failed = false
            focus.clearFocus()
            scope.launch {
                runCatching { Conversation.answerMoment(post.authorId, post.id, said) }
                    .onSuccess {
                        sent = said
                        delay(2000)
                        sent = null
                    }
                    .onFailure { failed = true }
            }
        }
        Unit
    }

    /**
     * A reaction does both: it is counted on the post and it is said in the
     * conversation.
     *
     * Two records of one tap, on purpose. The tally is what the author reads
     * off their own moment while it is alive; the message is what is still
     * there tomorrow, when the moment is not. Picking the symbol already chosen
     * takes the tally back and says nothing further - a second message would be
     * the same reaction twice.
     */
    val react: (String) -> Unit = { emoji ->
        val undoing = post.myReaction == emoji
        scope.launch { Statuses.react(post.id, emoji) }
        if (!undoing) send(emoji)
        Unit
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        sent?.let {
            Text(
                text = "Sent to $name",
                style = MaterialTheme.typography.labelMedium,
                color = Color(0xFF6EE7B7),
            )
        }
        if (failed) {
            Text(
                text = "That could not be sent. You may no longer be friends.",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.error,
                textAlign = TextAlign.Center,
            )
        }

        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            QUICK_REACTIONS.forEach { emoji ->
                val picked = post.myReaction == emoji
                Text(
                    text = emoji,
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        .background(
                            if (picked) Color.White.copy(alpha = 0.2f) else Color.Transparent,
                        )
                        .clickable { react(emoji) }
                        .padding(horizontal = 6.dp, vertical = 4.dp),
                )
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            BasicTextField(
                value = text,
                onValueChange = { text = it },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(color = Color.White),
                cursorBrush = SolidColor(Color.White),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { send(text) }),
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(50))
                    .background(Color.White.copy(alpha = 0.12f))
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .onFocusChanged { focused = it.isFocused },
                decorationBox = { field ->
                    if (text.isEmpty()) {
                        Text(
                            text = "Reply to $name…",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color.White.copy(alpha = 0.5f),
                        )
                    }
                    field()
                },
            )
            IconAction(
                icon = BetweenUsIcons.Send,
                contentDescription = "Send reply",
                onClick = { send(text) },
                tint = if (text.isBlank()) Color.White.copy(alpha = 0.4f) else Color.White,
            )
        }
    }
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
