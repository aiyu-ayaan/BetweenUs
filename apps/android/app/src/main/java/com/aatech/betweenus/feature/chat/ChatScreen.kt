package com.aatech.betweenus.feature.chat

import android.graphics.Bitmap
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.toShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.aatech.betweenus.feature.settings.BetweenUsPermissions
import com.aatech.betweenus.feature.settings.NotificationPermissionBanner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aatech.betweenus.core.crypto.E2ee
import com.aatech.betweenus.core.data.MessageReply
import com.aatech.betweenus.core.data.PublicUser
import com.aatech.betweenus.core.store.Conversation
import com.aatech.betweenus.core.store.Receipts
import com.aatech.betweenus.core.store.PendingShare
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.ReadableMessage
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.ui.components.EmptyState
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.StatusDot
import com.aatech.betweenus.ui.theme.BetweenUsMotion
import kotlinx.coroutines.launch

/**
 * Modern, polished chat screen with interactive media previews,
 * fullscreen image zoom viewer, integrated video player dialog, and WhatsApp-style attachment sheet.
 */
@Composable
fun ChatScreen(
    channelId: String,
    self: PublicUser,
    onOpenMenu: () -> Unit,
    onOpenMembers: () -> Unit,
    onStartCall: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val listState = rememberLazyListState()

    val everything by Conversation.messages.collectAsState()
    val loading by Conversation.loading.collectAsState()
    val typingByChannel by Presence.typing.collectAsState()
    val receiptsByChannel by Conversation.receipts.collectAsState()

    val messages = everything[channelId].orEmpty()
    val receipts = receiptsByChannel[channelId].orEmpty()
    /**
     * Where each reader's face is drawn: once, against the newest message of
     * yours they have read, rather than repeated down the conversation.
     */
    val anchors = remember(messages, receipts, self.id) {
        Receipts.anchorReceipts(messages, receipts, self.id)
    }
    val channel = Workspace.channel(channelId)
    val direct = Workspace.directChannel(channelId)
    val title = channel?.name ?: direct?.participant?.label ?: "Conversation"
    val busy = channelId in loading

    var acting by remember { mutableStateOf<ReadableMessage?>(null) }
    var editing by remember { mutableStateOf<ReadableMessage?>(null) }
    var replyingTo by remember(channelId) { mutableStateOf<MessageReply?>(null) }
    /** A quoted message that has just been jumped to, flashed so it is findable. */
    var highlighted by remember { mutableStateOf<String?>(null) }
    var showPins by remember { mutableStateOf(false) }
    /** The message whose "seen by" sheet is open, if any. */
    var seenFor by remember(channelId) { mutableStateOf<ReadableMessage?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }

    var showAttachmentSheet by remember { mutableStateOf(false) }
    /**
     * Media that has been picked but not yet looked at. Nothing is read off
     * disk, encrypted or uploaded until the preview is sent from - which is the
     * whole point of it.
     */
    var previewing by remember { mutableStateOf<List<PickedPreview>>(emptyList()) }
    var previewCaption by remember { mutableStateOf("") }

    // Media Viewer dialog states
    var viewingImage by remember { mutableStateOf<Pair<Bitmap, String>?>(null) }
    var playingVideo by remember { mutableStateOf<Pair<Uri, String>?>(null) }

    // Quick Camera capture
    var photoUri by remember { mutableStateOf<Uri?>(null) }
    val cameraCaptureLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.TakePicture(),
    ) { taken ->
        if (taken && photoUri != null) {
            // Straight to the preview: a photo just taken is the one most worth
            // looking at before it goes anywhere.
            scope.launch { previewing = previewing + describePicked(context, photoUri!!) }
        }
    }

    val cameraPermission = com.aatech.betweenus.feature.settings.rememberPermission(
        com.aatech.betweenus.feature.settings.BetweenUsPermissions.CAMERA,
    ) {
        photoUri = cameraTarget(context).also { cameraCaptureLauncher.launch(it) }
    }

    DisposableEffect(channelId) {
        Conversation.open(channelId)
        // Reading the conversation is what dismisses its notification. Leaving
        // it up would mean a shade full of messages already on screen.
        com.aatech.betweenus.feature.notifications.MessageNotifications
            .clear(context, channelId)
        onDispose { Conversation.close(channelId) }
    }

    /**
     * Whether the view is pinned to the newest message.
     *
     * It stops being pinned the moment somebody scrolls up to read something,
     * because dragging them back down every time a message arrives is worse
     * than not following at all - and only then. A row growing underneath them
     * is not somebody scrolling away, however far it pushes the end of the
     * conversation below the screen. See `Follow.kt`.
     */
    var following by remember(channelId) { mutableStateOf(true) }

    // What the outbox is doing, and whether it is doing it for this channel.
    // Everything it reports outlives this screen; drawing it is the only part
    // that does not.
    val outgoing by Outbox.progress.collectAsState()
    val outboxFailures by Outbox.failures.collectAsState()
    val sendingHere = outgoing?.takeIf { it.channelId == channelId }

    /**
     * Rows grow after they have been laid out.
     *
     * A picture decodes, a video's first frame arrives, and the row that was
     * one line tall becomes three hundred - under a scroll that had already
     * finished. The desktop answers this with a ResizeObserver; this is the
     * same idea with the tools Compose has: watch where the end of the
     * conversation is, and while the view is pinned, put it back on the bottom.
     *
     * The keyboard opening is the same event wearing a different hat: the
     * viewport gets shorter, so the end of the conversation ends up below it,
     * and putting it back is what makes typing feel like every other messenger.
     *
     * The same flow keeps the latch, because both answers come from one reading
     * of the layout: where the list is now, and where it was a moment ago.
     *
     * Everything it needs comes out of `layoutInfo` and nothing out of
     * `messages`. This effect is launched once per channel and never restarted,
     * so the list it closed over is the list as it was then - which, on a
     * channel opened before its first page arrived, is empty. It read
     * `messages.isNotEmpty()` off that and did nothing for the rest of the
     * session: no re-anchoring when a picture decoded, and none when the
     * keyboard came up.
     *
     * It is also the *only* thing that scrolls the list to the bottom, and
     * that is deliberate. There used to be two more: one on opening a channel
     * and one on every new message. A `LazyListState` serialises scrolls
     * through a mutex where the newcomer cancels the incumbent, and being
     * cancelled here does not mean "that scroll was skipped" - it means this
     * coroutine dies, taking the correction and the latch with it for the rest
     * of the channel. Which is what "the chat stops following after a while"
     * was: send a message, the new-message scroll cancels the correction
     * mid-flight, and nothing scrolls to the bottom again.
     *
     * Both are covered by the rule already here. A channel opening is a list
     * whose end is off screen, and a message arriving is a list whose end has
     * moved past the bottom; either way the gap is positive and the view is
     * still following. The remaining cancellations come from somewhere the
     * reader asked to go - jumping to a quote - so the scroll is caught rather
     * than allowed to end the collection.
     */
    LaunchedEffect(listState, channelId) {
        var previous = listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset
        snapshotFlow {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()
            val gap = if (last == null) 0 else bottomGap(
                lastVisibleIndex = last.index,
                lastVisibleBottom = last.offset + last.size,
                totalItems = info.totalItemsCount,
                viewportEnd = info.viewportEndOffset,
            )
            (listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset) to gap
        }.collect { (position, gap) ->
            following = nextFollow(following, scrolledUp(previous, position), gap)
            previous = position
            val last = listState.layoutInfo.totalItemsCount - 1
            if (following && gap > 0 && last >= 0) {
                // Cancelled by a scroll the reader started - a jump to a quote.
                // Theirs wins; this collection carries on.
                runCatching { listState.scrollToItem(last, SCROLL_PAST_END) }
            }
        }
    }

    // The flash marks where the jump landed, then gets out of the way.
    LaunchedEffect(highlighted) {
        if (highlighted != null) {
            kotlinx.coroutines.delay(2000)
            highlighted = null
        }
    }

    LaunchedEffect(listState.firstVisibleItemIndex) {
        if (listState.firstVisibleItemIndex <= 1 && messages.isNotEmpty()) {
            Conversation.loadOlder(channelId)
        }
    }

    /**
     * Hands the batch to [Outbox] and closes the preview at once.
     *
     * Nothing is awaited here on purpose. Sealing and uploading a video is
     * minutes, and doing it in this screen's scope meant the preview stayed
     * pinned open for all of them, and the upload died the moment the channel
     * was left. It runs under a foreground service now, and this screen only
     * watches the bar.
     */
    fun sendPreviewed() {
        val chosen = previewing
        if (chosen.isEmpty()) return
        Outbox.enqueue(
            context = context,
            channelId = channelId,
            caption = previewCaption.trim(),
            items = chosen,
            replyTo = replyingTo,
        )
        replyingTo = null
        previewing = emptyList()
        previewCaption = ""
    }

    /**
     * Something another app shared into BetweenUs.
     *
     * It lands in the same preview a paperclip does, on the conversation that
     * is open - which is what makes the flow from the system share sheet
     * "pick BetweenUs, look at what you are sending, send it" rather than a
     * photo appearing in a channel nobody chose. Taken once; see [PendingShare].
     */
    val shared by PendingShare.uris.collectAsState()
    LaunchedEffect(shared) {
        if (shared.isEmpty()) return@LaunchedEffect
        // Described first, cleared last. Clearing is a state change this
        // effect is keyed on, so doing it first would cancel this coroutine
        // in the middle of reading the names off the content resolver.
        val described = shared.map { describePicked(context, it) }
        previewing = previewing + described
        PendingShare.clear()
    }

    var permissionTick by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        permissionTick++
        onPauseOrDispose { }
    }

    var notificationBannerDismissed by rememberSaveable { mutableStateOf(false) }
    val notificationsGranted = remember(permissionTick) {
        BetweenUsPermissions.granted(context, BetweenUsPermissions.NOTIFICATIONS)
    }

    val notificationLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { allowed ->
        permissionTick++
        if (!allowed) {
            BetweenUsPermissions.openSettings(context)
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .navigationBarsPadding()
            .imePadding(),
    ) {
        // --- The header ---
        //
        // A container rather than a bar with a line under it: the tone is what
        // separates it from the conversation, and one fewer hairline on a
        // screen that is mostly text is one fewer thing to read past. The
        // channel's mark sits in a cookie, which is the shape this app uses
        // wherever a symbol stands for a place.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .statusBarsPadding()
                .padding(start = 4.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(BetweenUsIcons.LayoutSidebar, "Open the channel list", onOpenMenu)

            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(MaterialShapes.Cookie9Sided.toShape())
                    .background(
                        if (direct != null) {
                            MaterialTheme.colorScheme.primaryContainer
                        } else {
                            MaterialTheme.colorScheme.surfaceContainerHighest
                        },
                    ),
                contentAlignment = Alignment.Center,
            ) {
                BetweenUsIcon(
                    icon = if (direct != null) BetweenUsIcons.User else BetweenUsIcons.Hash,
                    tint = if (direct != null) {
                        MaterialTheme.colorScheme.onPrimaryContainer
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    size = 20.dp,
                )
            }

            Column(
                Modifier
                    .weight(1f)
                    .padding(start = 12.dp),
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMediumEmphasized,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val caption = when {
                    direct != null -> "Encrypted direct message"
                    !channel?.topic.isNullOrBlank() -> channel!!.topic!!
                    else -> null
                }
                if (caption != null) {
                    Text(
                        text = caption,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            IconAction(BetweenUsIcons.Pin, "Pinned messages", { showPins = true })
            IconAction(BetweenUsIcons.Users, "Members", onOpenMembers)
            // The one action here that starts something rather than showing
            // something, so it is the one that is filled.
            IconAction(BetweenUsIcons.Phone, "Start a call", onStartCall, prominent = true, compact = true)
            ChannelMenu(channelId = channelId, title = title, isDirect = direct != null)
        }

        // Notification Permission Warning Banner (if user denied or turned off notifications)
        if (BetweenUsPermissions.NOTIFICATIONS != null && !notificationsGranted && !notificationBannerDismissed) {
            NotificationPermissionBanner(
                onEnable = {
                    notificationLauncher.launch(BetweenUsPermissions.NOTIFICATIONS)
                },
                onDismiss = {
                    notificationBannerDismissed = true
                },
            )
        }

        // History on its way in. Wavy, because that is what "working" looks
        // like everywhere else in this app and a flat bar here would be the
        // one exception.
        if (busy && messages.isEmpty()) {
            LinearWavyProgressIndicator(Modifier.fillMaxWidth())
        }

        // --- Message History List ---
        Box(Modifier.weight(1f)) {
            if (messages.isEmpty() && !busy) {
                EmptyState(
                    icon = BetweenUsIcons.Message,
                    title = "Nothing here yet",
                    detail = "Messages in this channel are end-to-end encrypted. Say something or share a photo to start!",
                    modifier = Modifier.align(Alignment.Center),
                )
            }

            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 10.dp),
            ) {
                // Said once for the channel rather than once per message. A row
                // can say it is sealed; what somebody needs is why, and that it
                // repairs itself - a machine holding those keys hands them over
                // the next time it opens this channel.
                if (messages.any { it.text == E2ee.UNDECRYPTABLE }) {
                    item {
                        Text(
                            text = "Some of these messages were sealed for another of your " +
                                "devices. Open BetweenUs on the device you first signed in " +
                                "with and they will unlock here.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                        )
                    }
                }

                items(messages, key = { it.id }) { readable ->
                    val index = messages.indexOf(readable)
                    val previous = messages.getOrNull(index - 1)
                    MessageRow(
                        readable = readable,
                        previous = previous,
                        self = self,
                        channelId = channelId,
                        highlighted = highlighted == readable.id,
                        receipts = anchors[readable.id].orEmpty(),
                        onLongPress = { acting = readable },
                        onReply = { replyingTo = readable.quote() },
                        onOpenSeenBy = { seenFor = readable },
                        onOpenQuoted = { quotedId ->
                            val at = messages.indexOfFirst { it.id == quotedId }
                            // Not on this device yet: the quote carries enough
                            // to read, which is why it carries it at all.
                            if (at >= 0) {
                                scope.launch { listState.animateScrollToItem(at) }
                                highlighted = quotedId
                            }
                        },
                        onReact = { emoji ->
                            scope.launch {
                                failure = runCatching { Conversation.react(readable.message, emoji) }
                                    .exceptionOrNull()?.message
                            }
                        },
                        onViewImage = { bmp, name ->
                            viewingImage = bmp to name
                        },
                        onPlayVideo = { uri, name ->
                            playingVideo = uri to name
                        },
                    )
                }
            }

            /**
             * Back to the newest message.
             *
             * Only while the reader is somewhere else. `following` is already
             * the latch that says so - it is what stops the list dragging
             * somebody back down every time a message arrives - so the button
             * is that same state, drawn.
             *
             * It springs in and out rather than appearing, because it arrives
             * over a conversation somebody is reading and a control that blinks
             * into existence there reads as a glitch.
             */
            JumpToNewest(
                visible = !following && messages.isNotEmpty(),
                onClick = {
                    // Take the latch back first. The correction in the follow
                    // effect is what actually pins the view to the bottom, and
                    // it only runs while the latch is closed - scrolling
                    // without it would land near the end and then drift off it
                    // again as the next picture decoded.
                    following = true
                    scope.launch {
                        val last = listState.layoutInfo.totalItemsCount - 1
                        if (last >= 0) runCatching { listState.animateScrollToItem(last) }
                    }
                },
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 16.dp, bottom = 12.dp),
            )
        }

        // --- Typing Indicator ---
        val typing = typingByChannel[channelId].orEmpty().filter { it != self.username }
        if (typing.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(7.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary),
                )
                Text(
                    text = when (typing.size) {
                        1 -> "${typing.first()} is typing…"
                        else -> "${typing.size} people are typing…"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        failure?.let {
            Notice(
                it,
                MaterialTheme.colorScheme.error,
                Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
            )
        }

        // --- What is going out, if anything is ---
        //
        // Above the composer rather than over the whole screen, because the
        // send is no longer something to wait for: the next message can be
        // typed while a video is still on its way.
        sendingHere?.let { going ->
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceContainer)
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = going.name,
                        style = MaterialTheme.typography.labelMediumEmphasized,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = buildString {
                            if (going.total > 1) append("${going.index}/${going.total} · ")
                            append("${(going.fraction * 100).toInt()}%")
                        },
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.height(6.dp))
                // The wave travels while the upload does. A flat bar creeping
                // forward and a stalled one look the same; this pair does not.
                LinearWavyProgressIndicator(
                    progress = { going.fraction },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        // --- Composer Input Well ---
        Composer(
            channelId = channelId,
            editing = editing,
            replyingTo = replyingTo,
            onCancelEdit = { editing = null },
            onCancelReply = { replyingTo = null },
            onPickFile = { showAttachmentSheet = true },
            onCameraClick = { cameraPermission.request() },
            // A pasted picture is a picked picture. Same preview, same Send.
            onPasteMedia = { uri ->
                scope.launch { previewing = previewing + describePicked(context, uri) }
            },
            onSend = { text ->
                scope.launch {
                    val target = editing
                    failure = runCatching {
                        if (target != null) {
                            Conversation.edit(target.message, text)
                            editing = null
                        } else {
                            Conversation.send(channelId, text, emptyList(), replyingTo)
                            replyingTo = null
                        }
                        null
                    }.exceptionOrNull()?.message
                }
            },
        )
    }

    // --- Attachment Modal Bottom Sheet ---
    if (showAttachmentSheet) {
        AttachmentSheet(
            onDismiss = { showAttachmentSheet = false },
            onPicked = { uris ->
                scope.launch {
                    // Everything picked goes to the preview and then to
                    // [Outbox], a PDF as much as a photo. A document used to be
                    // read, sealed and uploaded here instead, in this screen's
                    // own scope - so it was never checked before it went, and
                    // leaving the channel killed it halfway.
                    previewing = previewing + uris.map { describePicked(context, it) }
                }
            },
        )
    }

    // --- What is about to be sent ---
    SendPreviewDialog(
        items = previewing,
        caption = previewCaption,
        onCaption = { previewCaption = it },
        onRemove = { previewing = previewing - it },
        onReplace = { original, edited ->
            previewing = previewing.map { if (it == original) edited else it }
        },
        onAdd = { showAttachmentSheet = true },
        onCancel = {
            previewing = emptyList()
            previewCaption = ""
        },
        onSend = { sendPreviewed() },
    )

    LaunchedEffect(outboxFailures[channelId]) {
        outboxFailures[channelId]?.let {
            failure = it
            Outbox.clearFailure(channelId)
        }
    }

    // --- Fullscreen Interactive Image Viewer ---
    viewingImage?.let { (bitmap, title) ->
        ImageViewerDialog(
            bitmap = bitmap,
            title = title,
            onDismiss = { viewingImage = null },
        )
    }

    // --- Integrated Video Player Dialog ---
    playingVideo?.let { (videoUri, title) ->
        VideoPlayerDialog(
            videoUri = videoUri,
            title = title,
            onDismiss = { playingVideo = null },
        )
    }

    // --- Who has read it, and when ---
    seenFor?.let { readable ->
        SeenBySheet(
            sentAt = readable.message.createdAt,
            receipts = Receipts.seenBy(readable.message.createdAt, receipts),
            onDismiss = { seenFor = null },
        )
    }

    // --- Message Context Actions Sheet ---
    acting?.let { readable ->
        MessageActionsSheet(
            readable = readable,
            self = self,
            canModerate = Workspace.server(channel?.serverId)?.can("DELETE_MESSAGE") == true,
            onDismiss = { acting = null },
            onReply = { replyingTo = readable.quote(); acting = null },
            onEdit = { editing = readable; acting = null },
            onDelete = {
                scope.launch {
                    failure = runCatching { Conversation.delete(readable.message) }
                        .exceptionOrNull()?.message
                }
                acting = null
            },
            onPin = {
                scope.launch {
                    failure = runCatching {
                        Conversation.pin(readable.message, !readable.message.pinned)
                    }.exceptionOrNull()?.message
                }
                acting = null
            },
            onReact = { emoji ->
                scope.launch {
                    failure = runCatching { Conversation.react(readable.message, emoji) }
                        .exceptionOrNull()?.message
                }
                acting = null
            },
        )
    }

    if (showPins) {
        PinnedSheet(channelId = channelId, self = self, onDismiss = { showPins = false })
    }
}

/**
 * The same ceiling the server enforces and the desktop honours.
 *
 * It was 25 MB here, which is the *per request* cap and not the file cap: this
 * client only knew how to send a file in one request, so it refused everything
 * a single request could not carry. It sends anything larger in parts now, so
 * the number that belongs here is the one the deployment actually enforces.
 */
const val MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024

/**
 * An offset far past the end of any row.
 *
 * `scrollToItem` puts the item's *start* at the top of the viewport, which for
 * a tall last message leaves its bottom off screen. A huge offset is clamped to
 * the maximum scroll instead, which is exactly "the bottom of the list" and
 * needs no measuring.
 */
private const val SCROLL_PAST_END = 100_000

/**
 * Back to the newest message.
 *
 * Only while the reader is somewhere else: the caller passes the same
 * `following` latch that stops the list dragging somebody back down every time
 * a message arrives, so this button is that state drawn rather than a second
 * opinion about it.
 *
 * It springs in and out rather than appearing. It arrives over a conversation
 * somebody is reading, and a control that blinks into existence there reads as
 * a glitch.
 */
@Composable
private fun JumpToNewest(visible: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(BetweenUsMotion.effect()) +
            scaleIn(BetweenUsMotion.spatial(), initialScale = 0.7f),
        exit = fadeOut(BetweenUsMotion.effect()) +
            scaleOut(BetweenUsMotion.spatial(), targetScale = 0.7f),
        modifier = modifier,
    ) {
        SmallFloatingActionButton(
            onClick = onClick,
            containerColor = MaterialTheme.colorScheme.secondaryContainer,
            contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        ) {
            BetweenUsIcon(
                icon = BetweenUsIcons.ChevronDown,
                size = 22.dp,
                contentDescription = "Jump to the newest message",
            )
        }
    }
}
