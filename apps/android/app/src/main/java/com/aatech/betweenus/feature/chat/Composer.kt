package com.aatech.betweenus.feature.chat

import android.content.ClipboardManager
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.RowScope
import androidx.compose.runtime.mutableFloatStateOf
import com.aatech.betweenus.feature.settings.BetweenUsPermissions
import com.aatech.betweenus.feature.settings.rememberPermission
import androidx.compose.foundation.background
import androidx.compose.foundation.content.MediaType
import androidx.compose.foundation.content.consume
import androidx.compose.foundation.content.contentReceiver
import androidx.compose.foundation.content.hasMediaType
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.animation.animateColorAsState
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.aatech.betweenus.core.data.MessageReply
import com.aatech.betweenus.core.data.EmojiNames
import com.aatech.betweenus.core.data.Markup
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.core.store.ReadableMessage
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.theme.BetweenUsMotion
import com.aatech.betweenus.ui.components.BetweenUsIcons

/**
 * WhatsApp-style Composer with:
 * - Emoji picker button on the left of input well
 * - Text input field with typing indicator dispatch
 * - Attachment paperclip button (what it picks goes to the preview, never to a
 *   chip on this bar: nothing is uploaded until the preview is sent from)
 * - Quick Camera button (automatically hidden when keyboard is open or when typing)
 * - A send button that lights up as the first character lands, and squares off
 *   under a finger
 * - A pasted or keyboard-inserted picture, which goes to the send preview
 *   rather than into the text - see [onPasteMedia]
 */
@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
fun Composer(
    channelId: String,
    editing: ReadableMessage?,
    replyingTo: MessageReply?,
    onCancelEdit: () -> Unit,
    onCancelReply: () -> Unit,
    onPickFile: () -> Unit,
    onCameraClick: () -> Unit,
    /**
     * A picture that arrived through the text field rather than the paperclip:
     * pasted from the clipboard, or inserted by the keyboard - a Gboard sticker
     * or GIF comes down the same path.
     *
     * It is handed on rather than handled here, because it is not text and this
     * bar has nowhere to keep it. The screen puts it in the send preview, which
     * is where everything about to be sent is looked at first.
     */
    onPasteMedia: (Uri) -> Unit,
    /**
     * A finished recording, on its way to the outbox.
     *
     * It does not go through the send preview like everything else the
     * paperclip picks: a voice message is sent by the same gesture that
     * finishes it, and there is no moment in between where anybody would look
     * at it and change their mind.
     */
    onSendVoice: (VoiceNote.Recorded, Boolean) -> Unit,
    onSend: (String) -> Unit,
) {
    // A caret position, not just a string: the `:` menu has to know what is
    // behind the cursor, and inserting an emoji mid-sentence has to put it
    // where the cursor is rather than at the end.
    var field by remember(channelId) { mutableStateOf(TextFieldValue("")) }
    var showEmojiPicker by remember { mutableStateOf(false) }
    val text = field.text

    /**
     * The recording in progress, and its counter.
     *
     * The recorder holds a microphone, so it is kept in a plain `remember` box
     * rather than in state that a recomposition could hand a stale copy of -
     * and the state beside it is only what the screen draws.
     */
    val recorder = remember { mutableStateOf<VoiceNote.Recording?>(null) }
    var recording by remember { mutableStateOf(false) }
    var recordedFor by remember { mutableFloatStateOf(0f) }
    /** The tail of the level, so the bar shows the microphone is live. */
    var levels by remember { mutableStateOf<List<Float>>(emptyList()) }
    var recordingFailed by remember { mutableStateOf(false) }
    /**
     * Whether the recording about to be sent is one-time.
     *
     * On the composer rather than per file, because it is a property of the
     * message: a one-time message with one ordinary file in it would be a
     * message whose parts disagree about whether they still exist.
     */
    var voiceOnce by remember { mutableStateOf(false) }

    /**
     * A picture sitting on the clipboard, offered as a button rather than
     * waited for as a paste.
     *
     * [contentReceiver] below catches what the *keyboard* inserts - a Gboard
     * sticker or GIF - and that is the only path it catches. A screenshot or a
     * copied image goes on the clipboard instead, and the text field's paste is
     * text: the menu does not even offer Paste for a clip with no text in it,
     * so there was no gesture that could put a copied picture in a message.
     * This is that gesture.
     *
     * Only the clip's *description* is read to decide whether to offer it,
     * which is metadata and not the content - the picture itself is read when
     * the button is pressed, which is the moment somebody asked for it.
     */
    val context = LocalContext.current
    val clipboard = remember(context) { context.getSystemService(ClipboardManager::class.java) }
    var clipboardImage by remember { mutableStateOf(false) }

    fun readClipboardDescription() {
        clipboardImage = clipboard?.primaryClipDescription?.hasMimeType("image/*") == true
    }

    DisposableEffect(clipboard) {
        val listener = ClipboardManager.OnPrimaryClipChangedListener { readClipboardDescription() }
        clipboard?.addPrimaryClipChangedListener(listener)
        readClipboardDescription()
        onDispose { clipboard?.removePrimaryClipChangedListener(listener) }
    }
    // Copying happens in another app, and Android stops delivering the change
    // to one that is not in front. Coming back is therefore the other moment
    // the clipboard can have turned into something worth offering.
    LifecycleResumeEffect(Unit) {
        readClipboardDescription()
        onPauseOrDispose { }
    }

    /** Every image on the clip, into the send preview. */
    fun pasteFromClipboard() {
        val clip = clipboard?.primaryClip
        for (index in 0 until (clip?.itemCount ?: 0)) {
            clip?.getItemAt(index)?.uri?.let(onPasteMedia)
        }
        // Offered once. The clip is left alone - it is not this app's to empty -
        // but a banner that stayed up after it had been acted on would be
        // asking the same question for the rest of the conversation.
        clipboardImage = false
    }

    LaunchedEffect(editing?.id) {
        val body = editing?.text ?: ""
        field = TextFieldValue(body, TextRange(body.length))
    }

    val customEmoji = remember(channelId) {
        Workspace.emojiFor(Workspace.channel(channelId)?.serverId)
    }
    val query = remember(field) { EmojiNames.queryAt(field.text, field.selection.start) }
    val suggestions = remember(query, customEmoji) {
        query?.let { emojiSuggestions(it.term, customEmoji) }.orEmpty()
    }

    /** Put a chosen emoji where the caret is, and leave the caret after it. */
    fun insert(insertion: String, replacing: EmojiNames.Query?) {
        val caret = field.selection.start
        val from = replacing?.start ?: caret
        val before = field.text.substring(0, from)
        val after = field.text.substring(caret)
        // A space after it, because the next thing typed is a word and not
        // part of the shortcode that was just resolved.
        val body = "$insertion "
        field = TextFieldValue(before + body + after, TextRange(from + body.length))
    }

    val isImeVisible = WindowInsets.isImeVisible
    val canSend = text.isNotBlank()
    val showCamera = !isImeVisible && text.isEmpty() && !recording

    /**
     * Starts recording once the microphone has been granted.
     *
     * Asked here rather than at launch, like every other permission in this
     * app: a microphone prompt somebody has not asked for is a prompt whose
     * honest answer is no.
     */
    val microphone = rememberPermission(BetweenUsPermissions.MICROPHONE) {
        val started = VoiceNote.start(context)
        recorder.value = started
        recording = started != null
        recordedFor = 0f
        levels = emptyList()
        recordingFailed = started == null
    }

    fun finishRecording() {
        val current = recorder.value ?: return
        recorder.value = null
        recording = false
        // Under a second is a tap that was meant to be a hold, and `stop`
        // answers null for it. Nothing is said: an error over a gesture nobody
        // meant to make is noise.
        current.stop()?.let { onSendVoice(it, voiceOnce) }
        voiceOnce = false
    }

    fun cancelRecording() {
        recorder.value?.cancel()
        recorder.value = null
        recording = false
        voiceOnce = false
    }

    // The counter and the meter, on one loop for as long as a recording is
    // happening and none at all the rest of the time.
    //
    // A hundred milliseconds rather than two hundred, because this loop is now
    // also what samples the waveform: `getMaxAmplitude` reports the peak since
    // it was last read, so the beat it is read on *is* the resolution of the
    // recorded shape. Ten a second is a syllable or so per bar.
    LaunchedEffect(recording) {
        while (recording) {
            val current = recorder.value
            recordedFor = current?.elapsed() ?: 0f
            current?.sample()
            levels = current?.levels()?.takeLast(LIVE_BARS).orEmpty()
            kotlinx.coroutines.delay(100)
        }
    }

    // A microphone must not outlive the screen that opened it. Leaving the
    // conversation mid-recording is exactly how the indicator gets left on.
    DisposableEffect(Unit) {
        onDispose { recorder.value?.cancel() }
    }

    val scheme = MaterialTheme.colorScheme
    Column(
        Modifier
            .fillMaxWidth()
            .background(scheme.surfaceContainerLow),
    ) {
        EmojiSuggestBar(suggestions) { suggestion -> insert(suggestion.insert, query) }

        // A picture on the clipboard, and the one gesture that can send it.
        AnimatedVisibility(
            visible = clipboardImage,
            enter = fadeIn(BetweenUsMotion.effect()) + expandVertically(BetweenUsMotion.spatial()),
            exit = fadeOut(BetweenUsMotion.effect()) + shrinkVertically(BetweenUsMotion.spatial()),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(scheme.tertiaryContainer)
                    .clickable { pasteFromClipboard() }
                    .padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                BetweenUsIcon(BetweenUsIcons.Image, tint = scheme.onTertiaryContainer, size = 18.dp)
                Text(
                    text = "Image on the clipboard",
                    style = MaterialTheme.typography.bodyMedium,
                    color = scheme.onTertiaryContainer,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = "PASTE",
                    style = MaterialTheme.typography.labelSmallEmphasized,
                    color = scheme.onTertiaryContainer,
                )
                IconAction(
                    icon = BetweenUsIcons.X,
                    contentDescription = "Not this one",
                    onClick = { clipboardImage = false },
                    tint = scheme.onTertiaryContainer,
                )
            }
        }

        // Editing banner
        AnimatedVisibility(
            visible = editing != null,
            enter = fadeIn(BetweenUsMotion.effect()) + expandVertically(BetweenUsMotion.spatial()),
            exit = fadeOut(BetweenUsMotion.effect()) + shrinkVertically(BetweenUsMotion.spatial()),
        ) {
            ComposerBanner(
                icon = BetweenUsIcons.Pencil,
                title = "Editing message",
                detail = editing?.text.orEmpty(),
                dismissDescription = "Cancel editing",
                onDismiss = onCancelEdit,
            )
        }

        // Replying banner. Same shape as the editing one above, and the two
        // never appear together: an edit rewrites a message that already chose
        // what it was answering.
        AnimatedVisibility(
            visible = editing == null && replyingTo != null,
            enter = fadeIn(BetweenUsMotion.effect()) + expandVertically(BetweenUsMotion.spatial()),
            exit = fadeOut(BetweenUsMotion.effect()) + shrinkVertically(BetweenUsMotion.spatial()),
        ) {
            ComposerBanner(
                icon = BetweenUsIcons.Reply,
                title = "Replying to ${replyingTo?.author.orEmpty()}",
                detail = replyingTo?.preview?.ifBlank { "Sent an attachment" }.orEmpty(),
                dismissDescription = "Cancel reply",
                onDismiss = onCancelReply,
            )
        }

        // The microphone was refused, or another app is holding it. Said once,
        // where the button is, rather than as a dialog over the conversation.
        AnimatedVisibility(
            visible = recordingFailed,
            enter = fadeIn(BetweenUsMotion.effect()) + expandVertically(BetweenUsMotion.spatial()),
            exit = fadeOut(BetweenUsMotion.effect()) + shrinkVertically(BetweenUsMotion.spatial()),
        ) {
            ComposerBanner(
                icon = BetweenUsIcons.Mic,
                title = "The microphone is not available",
                detail = if (microphone.refused) {
                    "Allow it in settings to record a voice message"
                } else {
                    "Something else may be using it"
                },
                dismissDescription = "Dismiss",
                onDismiss = { recordingFailed = false },
            )
        }

        // Main input bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // The well the message is typed into.
            //
            // The outline is the focus, and it fades in and out on the theme's
            // spring rather than switching: a border that appears the instant a
            // character lands reads as a flicker.
            val outline by animateColorAsState(
                targetValue = if (text.isEmpty()) scheme.outlineVariant else scheme.primary,
                animationSpec = BetweenUsMotion.effect(),
                label = "composer-outline",
            )
            Row(
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 56.dp)
                    .clip(ComposerWellShape)
                    .background(scheme.surfaceContainerHigh)
                    .border(1.dp, outline, ComposerWellShape)
                    .padding(horizontal = 4.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // While a microphone is open the well has nothing else to
                // usefully do, and a text field beside a running recorder
                // invites typing into a message about to be sent as audio.
                if (recording) {
                    RecordingStrip(
                        seconds = recordedFor,
                        levels = levels,
                        oneTime = voiceOnce,
                        onOneTime = { voiceOnce = it },
                        onDiscard = { cancelRecording() },
                    )
                    return@Row
                }

                IconAction(
                    icon = BetweenUsIcons.Smile,
                    contentDescription = "Emoji",
                    onClick = { showEmojiPicker = true },
                    compact = true,
                )

                Spacer(Modifier.width(2.dp))

                // Text Input Field
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .padding(vertical = 4.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    if (text.isEmpty()) {
                        Text(
                            text = "Message…",
                            style = MaterialTheme.typography.bodyLarge,
                            color = scheme.onSurfaceVariant,
                        )
                    }

                    BasicTextField(
                        value = field,
                        onValueChange = { next ->
                            // A list carries on to its next item, and an empty
                            // item ends it. There is no key event to hang this
                            // off - the IME hands over a whole new value - so
                            // the newline is recognised by what it did: one
                            // character longer, that character a newline, and
                            // the rest of the text unchanged.
                            val carried = newlineAt(field.text, next)
                                ?.let { at -> Markup.continueList(field.text, at) }

                            field = if (carried != null) {
                                TextFieldValue(carried.text, TextRange(carried.caret))
                            } else {
                                next
                            }
                            if (field.text.isNotEmpty()) Presence.noteTyping(channelId)
                        },
                        textStyle = MaterialTheme.typography.bodyLarge.copy(color = scheme.onSurface),
                        cursorBrush = SolidColor(scheme.primary),
                        maxLines = 6,
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.Sentences,
                            imeAction = ImeAction.Default,
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .contentReceiver { received ->
                                if (!received.hasMediaType(MediaType.Image)) {
                                    return@contentReceiver received
                                }
                                // What is consumed here does not reach the
                                // field; whatever is left - the text half of a
                                // rich paste - still does.
                                received.consume { item ->
                                    val uri = item.uri
                                    if (uri != null) {
                                        onPasteMedia(uri)
                                        true
                                    } else {
                                        false
                                    }
                                }
                            },
                    )
                }

                IconAction(
                    icon = BetweenUsIcons.Paperclip,
                    contentDescription = "Attach a file",
                    onClick = onPickFile,
                    compact = true,
                )

                // The camera stands down while there is a keyboard up or a
                // message half-typed: at that point the screen is about words.
                AnimatedVisibility(
                    visible = showCamera,
                    enter = fadeIn(BetweenUsMotion.effect()) +
                        expandHorizontally(BetweenUsMotion.spatial()),
                    exit = fadeOut(BetweenUsMotion.effect()) +
                        shrinkHorizontally(BetweenUsMotion.spatial()),
                ) {
                    IconAction(
                        icon = BetweenUsIcons.Video,
                        contentDescription = "Camera",
                        onClick = onCameraClick,
                        compact = true,
                    )
                }
            }

            // Send.
            //
            // Filled and primary the moment there is something to send, tonal
            // and quiet before that - and the change is animated, so the button
            // lights up as the first character lands rather than blinking. The
            // shape set is the toolkit's: it squares off under a finger and
            // springs back round.
            val lit = canSend || recording
            val sendContainer by animateColorAsState(
                targetValue = if (lit) scheme.primary else scheme.surfaceContainerHighest,
                animationSpec = BetweenUsMotion.effect(),
                label = "send-container",
            )
            val sendContent by animateColorAsState(
                targetValue = if (lit) scheme.onPrimary else scheme.onSurfaceVariant,
                animationSpec = BetweenUsMotion.effect(),
                label = "send-content",
            )
            FilledIconButton(
                onClick = {
                    when {
                        // Finishing a recording is the gesture that sends it.
                        recording -> finishRecording()
                        // Nothing typed, so this is the microphone: the moment
                        // a character lands it becomes send again. One button
                        // rather than two, because two would mean a
                        // permanently disabled one next to the one always
                        // wanted.
                        !canSend -> {
                            recordingFailed = false
                            microphone.request()
                        }

                        else -> {
                            val payload = text.trim()
                            field = TextFieldValue("")
                            onSend(payload)
                        }
                    }
                },
                enabled = true,
                shapes = IconButtonDefaults.shapes(),
                colors = IconButtonDefaults.filledIconButtonColors(
                    containerColor = sendContainer,
                    contentColor = sendContent,
                    disabledContainerColor = sendContainer,
                    disabledContentColor = sendContent,
                ),
                // Medium, which is 56dp. Large is 96dp on this scale - a
                // circle wider than the well is tall, which is what it looked
                // like: a button that had swallowed the bar rather than sat
                // beside it.
                modifier = Modifier.size(IconButtonDefaults.mediumContainerSize()),
            ) {
                BetweenUsIcon(
                    if (canSend || recording) BetweenUsIcons.Send else BetweenUsIcons.Mic,
                    size = IconButtonDefaults.mediumIconSize,
                )
            }
        }
    }

    if (showEmojiPicker) {
        EmojiPickerSheet(
            onDismiss = { showEmojiPicker = false },
            onEmojiPicked = { emoji -> insert(emoji, replacing = null) },
            custom = customEmoji,
        )
    }
}

/**
 * What the composer's well becomes while a recording is running.
 *
 * A pulsing dot, a counter, the one-time switch, and a way to throw it away.
 * Sending is the button outside this - the same one that sends everything
 * else, which is what makes finishing a recording feel like sending a message
 * rather than operating a tape deck.
 */
@Composable
private fun RowScope.RecordingStrip(
    seconds: Float,
    levels: List<Float>,
    oneTime: Boolean,
    onOneTime: (Boolean) -> Unit,
    onDiscard: () -> Unit,
) {
    val scheme = MaterialTheme.colorScheme

    // The dot, breathing rather than blinking: a hard on/off at one hertz
    // reads as a fault indicator, which is not what a recording is.
    val pulse = rememberInfiniteTransition(label = "recording-pulse")
    val alpha by pulse.animateFloat(
        initialValue = 0.35f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(700),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "recording-dot",
    )

    IconAction(
        icon = BetweenUsIcons.Trash,
        contentDescription = "Discard this recording",
        onClick = onDiscard,
        compact = true,
    )

    Spacer(Modifier.width(4.dp))

    Box(
        Modifier
            .size(10.dp)
            .clip(CircleShape)
            .background(scheme.error.copy(alpha = alpha)),
    )

    Spacer(Modifier.width(10.dp))

    Text(
        text = VoiceNote.formatDuration(seconds),
        style = MaterialTheme.typography.bodyLarge,
        color = scheme.onSurface,
    )

    Spacer(Modifier.width(10.dp))

    // Live level, so the bar answers "is this hearing me" without anybody
    // having to send a message to find out. Scaled against a fixed ceiling
    // rather than against its own loudest sample: a self-normalising meter
    // shows full bars in a silent room, which is the opposite of the point.
    Row(
        modifier = Modifier
            .weight(1f)
            .height(24.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        val leading = LIVE_BARS - levels.size
        repeat(LIVE_BARS) { index ->
            val level = levels.getOrElse(index - leading) { 0f }
            Box(
                Modifier
                    .weight(1f)
                    .height((2f + (level / 0.25f).coerceAtMost(1f) * 20f).dp)
                    .clip(RoundedCornerShape(1.dp))
                    .background(scheme.onSurfaceVariant),
            )
        }
    }

    Spacer(Modifier.width(6.dp))

    OneTimeAction(on = oneTime, onChange = onOneTime)
}

/** How much of the live level the recording bar shows. Roughly three seconds. */
private const val LIVE_BARS = 32

/**
 * The one-time switch.
 *
 * Next to what it applies to, because it changes what sending means: this
 * message's files may be opened once by whoever receives them, and that
 * opening destroys them everywhere.
 */
@Composable
fun OneTimeAction(on: Boolean, onChange: (Boolean) -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val tint by animateColorAsState(
        targetValue = if (on) scheme.primary else scheme.onSurfaceVariant,
        animationSpec = BetweenUsMotion.effect(),
        label = "one-time-tint",
    )
    IconAction(
        icon = BetweenUsIcons.OneTime,
        contentDescription = if (on) "One-time is on" else "Send as a one-time message",
        onClick = { onChange(!on) },
        tint = tint,
        compact = true,
    )
}

/**
 * Where a newline was just typed, or null if that is not what happened.
 *
 * A software keyboard reports an edit as a whole new value rather than as a
 * key, so "the user pressed return" has to be recognised from what changed:
 * one character longer, that character a newline sitting just behind the
 * caret, and the rest of the text exactly as it was. Anything else - a paste
 * carrying newlines, a word swapped by autocorrect, a character deleted - fails
 * one of the three and is left alone.
 *
 * The answer is the caret's position *before* the newline, which is where the
 * line being continued ends.
 */
private fun newlineAt(previous: String, next: TextFieldValue): Int? {
    if (next.text.length != previous.length + 1) return null
    if (!next.selection.collapsed) return null
    val caret = next.selection.start
    if (caret <= 0 || next.text[caret - 1] != '\n') return null
    if (next.text.removeRange(caret - 1, caret) != previous) return null
    return caret - 1
}

/**
 * The corner the composer's well is drawn with.
 *
 * A constant rather than a call to the shape scale, because the border and the
 * clip have to be the same shape to the pixel - two calls that happen to agree
 * today are a hairline that stops matching the day one of them is changed.
 */
private val ComposerWellShape = RoundedCornerShape(26.dp)

/**
 * The strip above the composer that says what this message is going to be: a
 * reply, or an edit. Both look the same because they are the same thing - a
 * note about the message being typed - and they never appear together.
 */
@Composable
private fun ComposerBanner(
    icon: Int,
    title: String,
    detail: String,
    dismissDescription: String,
    onDismiss: () -> Unit,
) {
    val scheme = MaterialTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(scheme.surfaceContainerHigh)
            .padding(start = 16.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        BetweenUsIcon(icon, tint = scheme.primary, size = 18.dp)
        Column(Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.labelMediumEmphasized,
                color = scheme.primary,
            )
            Text(
                text = detail,
                style = MaterialTheme.typography.bodySmall,
                color = scheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconAction(
            icon = BetweenUsIcons.X,
            contentDescription = dismissDescription,
            onClick = onDismiss,
        )
    }
}
