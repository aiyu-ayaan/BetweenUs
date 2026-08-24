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
    onSend: (String) -> Unit,
) {
    // A caret position, not just a string: the `:` menu has to know what is
    // behind the cursor, and inserting an emoji mid-sentence has to put it
    // where the cursor is rather than at the end.
    var field by remember(channelId) { mutableStateOf(TextFieldValue("")) }
    var showEmojiPicker by remember { mutableStateOf(false) }
    val text = field.text

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
    val showCamera = !isImeVisible && text.isEmpty()

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

        // Main input bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
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
                    .heightIn(min = 52.dp)
                    .clip(ComposerWellShape)
                    .background(scheme.surfaceContainerHigh)
                    .border(1.dp, outline, ComposerWellShape)
                    .padding(horizontal = 4.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconAction(
                    icon = BetweenUsIcons.Smile,
                    contentDescription = "Emoji",
                    onClick = { showEmojiPicker = true },
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
                        onValueChange = {
                            field = it
                            if (it.text.isNotEmpty()) Presence.noteTyping(channelId)
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
            val sendContainer by animateColorAsState(
                targetValue = if (canSend) scheme.primary else scheme.surfaceContainerHigh,
                animationSpec = BetweenUsMotion.effect(),
                label = "send-container",
            )
            val sendContent by animateColorAsState(
                targetValue = if (canSend) scheme.onPrimary else scheme.onSurfaceVariant,
                animationSpec = BetweenUsMotion.effect(),
                label = "send-content",
            )
            FilledIconButton(
                onClick = {
                    val payload = text.trim()
                    field = TextFieldValue("")
                    onSend(payload)
                },
                enabled = canSend,
                shapes = IconButtonDefaults.shapes(),
                colors = IconButtonDefaults.filledIconButtonColors(
                    containerColor = sendContainer,
                    contentColor = sendContent,
                    disabledContainerColor = sendContainer,
                    disabledContentColor = sendContent,
                ),
                modifier = Modifier.size(IconButtonDefaults.largeContainerSize()),
            ) {
                BetweenUsIcon(BetweenUsIcons.Send, size = IconButtonDefaults.largeIconSize)
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
