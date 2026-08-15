package com.aktech.nexora.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.aktech.nexora.core.data.MessageAttachment
import com.aktech.nexora.core.store.Presence
import com.aktech.nexora.core.store.ReadableMessage
import com.aktech.nexora.ui.components.Chip
import com.aktech.nexora.ui.components.IconAction
import com.aktech.nexora.ui.components.NexoraIcons
import com.aktech.nexora.ui.theme.Accent
import com.aktech.nexora.ui.theme.Edge
import com.aktech.nexora.ui.theme.Slate100
import com.aktech.nexora.ui.theme.Slate400
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.Surface700
import com.aktech.nexora.ui.theme.Surface900
import com.aktech.nexora.ui.theme.Surface950

/** The message box: text, attachments waiting to go, and the send button. */
@Composable
fun Composer(
    channelId: String,
    editing: ReadableMessage?,
    attachments: List<MessageAttachment>,
    uploading: Boolean,
    onCancelEdit: () -> Unit,
    onRemoveAttachment: (MessageAttachment) -> Unit,
    onPickFile: () -> Unit,
    onSend: (String) -> Unit,
) {
    var text by remember(channelId) { mutableStateOf("") }

    // Editing loads the existing body in, which is what "edit" has to mean.
    LaunchedEffect(editing?.id) {
        text = editing?.text ?: ""
    }

    val canSend = text.isNotBlank() || attachments.isNotEmpty()

    Column(Modifier.fillMaxWidth().background(Surface950)) {
        HorizontalDivider(color = Edge)

        if (editing != null) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Editing a message",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate400,
                    modifier = Modifier.weight(1f),
                )
                IconAction(NexoraIcons.X, "Stop editing", onCancelEdit)
            }
        }

        if (attachments.isNotEmpty() || uploading) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                attachments.forEach { attachment ->
                    Chip(text = "${attachment.name} ✕", onClick = { onRemoveAttachment(attachment) })
                }
                if (uploading) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Accent)
                    Text(
                        text = "Encrypting…",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate500,
                    )
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            IconAction(NexoraIcons.Paperclip, "Attach a file", onPickFile)

            OutlinedTextField(
                value = text,
                onValueChange = {
                    text = it
                    if (it.isNotEmpty()) Presence.noteTyping(channelId)
                },
                placeholder = {
                    Text("Message", style = MaterialTheme.typography.bodyLarge, color = Slate500)
                },
                maxLines = 6,
                shape = RoundedCornerShape(20.dp),
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Sentences,
                    imeAction = ImeAction.Default,
                ),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = Surface900,
                    unfocusedContainerColor = Surface900,
                    focusedBorderColor = Accent,
                    unfocusedBorderColor = Surface700,
                    focusedTextColor = Slate100,
                    unfocusedTextColor = Slate100,
                    cursorColor = Accent,
                ),
                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
            )

            Box(Modifier.padding(start = 4.dp)) {
                IconAction(
                    icon = NexoraIcons.Send,
                    contentDescription = "Send",
                    tint = if (canSend) Accent else Slate500,
                    enabled = canSend,
                    onClick = {
                        val payload = text.trim()
                        text = ""
                        onSend(payload)
                    },
                )
            }
        }
    }
}
