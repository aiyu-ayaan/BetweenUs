package com.aatech.betweenus.feature.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
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
import com.aatech.betweenus.core.data.MessageReply
import com.aatech.betweenus.core.data.EmojiNames
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.core.store.ReadableMessage
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.theme.Accent
import com.aatech.betweenus.ui.theme.Edge
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate300
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate50
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.Surface700
import com.aatech.betweenus.ui.theme.Surface800
import com.aatech.betweenus.ui.theme.Surface850
import com.aatech.betweenus.ui.theme.Surface900
import com.aatech.betweenus.ui.theme.Surface950

/**
 * WhatsApp-style Composer with:
 * - Emoji picker button on the left of input well
 * - Text input field with typing indicator dispatch
 * - Attachment paperclip button (what it picks goes to the preview, never to a
 *   chip on this bar: nothing is uploaded until the preview is sent from)
 * - Quick Camera button (automatically hidden when keyboard is open or when typing)
 * - Circular Accent Send button
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Composer(
    channelId: String,
    editing: ReadableMessage?,
    replyingTo: MessageReply?,
    onCancelEdit: () -> Unit,
    onCancelReply: () -> Unit,
    onPickFile: () -> Unit,
    onCameraClick: () -> Unit,
    onSend: (String) -> Unit,
) {
    // A caret position, not just a string: the `:` menu has to know what is
    // behind the cursor, and inserting an emoji mid-sentence has to put it
    // where the cursor is rather than at the end.
    var field by remember(channelId) { mutableStateOf(TextFieldValue("")) }
    var showEmojiPicker by remember { mutableStateOf(false) }
    val text = field.text

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

    Column(
        Modifier
            .fillMaxWidth()
            .background(Surface950),
    ) {
        EmojiSuggestBar(suggestions) { suggestion -> insert(suggestion.insert, query) }

        HorizontalDivider(color = Edge)

        // Editing banner
        AnimatedVisibility(
            visible = editing != null,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Surface900)
                    .padding(horizontal = 16.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                BetweenUsIcon(BetweenUsIcons.Pencil, tint = Accent, size = 16.dp)
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "Editing message",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = Accent,
                    )
                    Text(
                        text = editing?.text.orEmpty(),
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate400,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                IconAction(
                    icon = BetweenUsIcons.X,
                    contentDescription = "Cancel editing",
                    onClick = onCancelEdit,
                    tint = Slate400,
                )
            }
        }

        // Replying banner. Same shape as the editing one above, and the two
        // never appear together: an edit rewrites a message that already chose
        // what it was answering.
        AnimatedVisibility(
            visible = editing == null && replyingTo != null,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Surface900)
                    .padding(horizontal = 16.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                BetweenUsIcon(BetweenUsIcons.Reply, tint = Accent, size = 16.dp)
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "Replying to ${replyingTo?.author.orEmpty()}",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = Accent,
                    )
                    Text(
                        text = replyingTo?.preview?.ifBlank { "Sent an attachment" }.orEmpty(),
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate400,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                IconAction(
                    icon = BetweenUsIcons.X,
                    contentDescription = "Cancel reply",
                    onClick = onCancelReply,
                    tint = Slate400,
                )
            }
        }

        // Main input bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            // Text Input Pill Container (holding Emoji, text, Paperclip, and Camera)
            Row(
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 46.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(Surface900)
                    .border(
                        1.dp,
                        if (text.isNotEmpty()) Accent.copy(alpha = 0.45f) else Surface700,
                        RoundedCornerShape(24.dp),
                    )
                    .padding(horizontal = 6.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Emoji Picker Button
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .clickable { showEmojiPicker = true },
                    contentAlignment = Alignment.Center,
                ) {
                    BetweenUsIcon(
                        icon = BetweenUsIcons.Smile,
                        tint = Slate400,
                        size = 20.dp,
                    )
                }

                Spacer(Modifier.width(4.dp))

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
                            color = Slate500,
                            fontSize = 15.sp,
                        )
                    }

                    BasicTextField(
                        value = field,
                        onValueChange = {
                            field = it
                            if (it.text.isNotEmpty()) Presence.noteTyping(channelId)
                        },
                        textStyle = TextStyle(
                            color = Slate100,
                            fontSize = 15.sp,
                        ),
                        cursorBrush = SolidColor(Accent),
                        maxLines = 6,
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.Sentences,
                            imeAction = ImeAction.Default,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                // Paperclip Attachment Button
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .clickable(onClick = onPickFile),
                    contentAlignment = Alignment.Center,
                ) {
                    BetweenUsIcon(
                        icon = BetweenUsIcons.Paperclip,
                        tint = Slate400,
                        size = 19.dp,
                    )
                }

                // Camera Button (hidden when keyboard is open or when typing)
                AnimatedVisibility(
                    visible = showCamera,
                    enter = fadeIn() + expandHorizontally(),
                    exit = fadeOut() + shrinkHorizontally(),
                ) {
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .clickable(onClick = onCameraClick),
                        contentAlignment = Alignment.Center,
                    ) {
                        BetweenUsIcon(
                            icon = BetweenUsIcons.Video,
                            tint = Slate400,
                            size = 19.dp,
                        )
                    }
                }
            }

            // Circular Send Button
            Box(
                modifier = Modifier
                    .size(46.dp)
                    .clip(CircleShape)
                    .background(if (canSend) Accent else Surface850)
                    .border(1.dp, if (canSend) Accent else Edge, CircleShape)
                    .let {
                        if (canSend) it.clickable {
                            val payload = text.trim()
                            field = TextFieldValue("")
                            onSend(payload)
                        } else it
                    },
                contentAlignment = Alignment.Center,
            ) {
                BetweenUsIcon(
                    icon = BetweenUsIcons.Send,
                    tint = if (canSend) Color.White else Slate500,
                    size = 19.dp,
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
