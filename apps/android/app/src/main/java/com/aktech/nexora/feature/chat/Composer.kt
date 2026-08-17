package com.aktech.nexora.feature.chat

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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aktech.nexora.core.data.MessageAttachment
import com.aktech.nexora.core.data.MessageReply
import com.aktech.nexora.core.store.Presence
import com.aktech.nexora.core.store.ReadableMessage
import com.aktech.nexora.ui.components.IconAction
import com.aktech.nexora.ui.components.NexoraIcon
import com.aktech.nexora.ui.components.NexoraIcons
import com.aktech.nexora.ui.theme.Accent
import com.aktech.nexora.ui.theme.Edge
import com.aktech.nexora.ui.theme.Slate100
import com.aktech.nexora.ui.theme.Slate300
import com.aktech.nexora.ui.theme.Slate400
import com.aktech.nexora.ui.theme.Slate50
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.Surface700
import com.aktech.nexora.ui.theme.Surface800
import com.aktech.nexora.ui.theme.Surface850
import com.aktech.nexora.ui.theme.Surface900
import com.aktech.nexora.ui.theme.Surface950

/**
 * WhatsApp-style Composer with:
 * - Emoji picker button on the left of input well
 * - Text input field with typing indicator dispatch
 * - Attachment paperclip button
 * - Quick Camera button (automatically hidden when keyboard is open or when typing)
 * - Circular Accent Send button
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Composer(
    channelId: String,
    editing: ReadableMessage?,
    replyingTo: MessageReply?,
    attachments: List<MessageAttachment>,
    uploading: Boolean,
    onCancelEdit: () -> Unit,
    onCancelReply: () -> Unit,
    onRemoveAttachment: (MessageAttachment) -> Unit,
    onPickFile: () -> Unit,
    onCameraClick: () -> Unit,
    onSend: (String) -> Unit,
) {
    var text by remember(channelId) { mutableStateOf("") }
    var showEmojiPicker by remember { mutableStateOf(false) }

    LaunchedEffect(editing?.id) {
        text = editing?.text ?: ""
    }

    val isImeVisible = WindowInsets.isImeVisible
    val canSend = text.isNotBlank() || attachments.isNotEmpty()
    val showCamera = !isImeVisible && text.isEmpty()

    Column(
        Modifier
            .fillMaxWidth()
            .background(Surface950),
    ) {
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
                NexoraIcon(NexoraIcons.Pencil, tint = Accent, size = 16.dp)
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
                    icon = NexoraIcons.X,
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
                NexoraIcon(NexoraIcons.Reply, tint = Accent, size = 16.dp)
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
                    icon = NexoraIcons.X,
                    contentDescription = "Cancel reply",
                    onClick = onCancelReply,
                    tint = Slate400,
                )
            }
        }

        // Attachments preview tray
        AnimatedVisibility(
            visible = attachments.isNotEmpty() || uploading,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Surface900.copy(alpha = 0.6f))
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                attachments.forEach { attachment ->
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(Surface800)
                            .border(1.dp, Edge, RoundedCornerShape(8.dp))
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            NexoraIcon(
                                icon = if (attachment.isImage) NexoraIcons.Image else NexoraIcons.File,
                                tint = Accent,
                                size = 14.dp,
                            )
                            Text(
                                text = attachment.name,
                                style = MaterialTheme.typography.labelSmall,
                                color = Slate100,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.heightIn(max = 18.dp),
                            )
                            Box(
                                modifier = Modifier
                                    .clip(CircleShape)
                                    .clickable { onRemoveAttachment(attachment) }
                                    .padding(2.dp),
                            ) {
                                NexoraIcon(NexoraIcons.X, tint = Slate400, size = 12.dp)
                            }
                        }
                    }
                }

                if (uploading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = Accent,
                    )
                    Text(
                        text = "Encrypting attachment…",
                        style = MaterialTheme.typography.labelSmall,
                        color = Slate500,
                    )
                }
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
                    NexoraIcon(
                        icon = NexoraIcons.Smile,
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
                        value = text,
                        onValueChange = {
                            text = it
                            if (it.isNotEmpty()) Presence.noteTyping(channelId)
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
                    NexoraIcon(
                        icon = NexoraIcons.Paperclip,
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
                        NexoraIcon(
                            icon = NexoraIcons.Video,
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
                            text = ""
                            onSend(payload)
                        } else it
                    },
                contentAlignment = Alignment.Center,
            ) {
                NexoraIcon(
                    icon = NexoraIcons.Send,
                    tint = if (canSend) Color.White else Slate500,
                    size = 19.dp,
                )
            }
        }
    }

    if (showEmojiPicker) {
        EmojiPickerSheet(
            onDismiss = { showEmojiPicker = false },
            onEmojiPicked = { emoji ->
                text = text + emoji
            },
        )
    }
}
