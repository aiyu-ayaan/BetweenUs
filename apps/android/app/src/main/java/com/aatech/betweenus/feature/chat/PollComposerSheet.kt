package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.MessageBody
import com.aatech.betweenus.core.data.PollReady
import com.aatech.betweenus.core.data.Polls
import com.aatech.betweenus.core.store.Conversation
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.theme.Danger
import kotlinx.coroutines.launch

/**
 * The create-a-poll sheet: a question, two to ten options, a multi-choice
 * switch and an optional length. The desktop's `PollComposer`.
 *
 * The words never leave this phone unsealed. [Conversation.sendPoll] puts them
 * in the envelope and tells the server only how many options there are.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun PollComposerSheet(channelId: String, onDismiss: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    var question by remember { mutableStateOf("") }
    val options = remember { mutableStateListOf("", "") }
    var multiChoice by remember { mutableStateOf(false) }
    var duration by remember { mutableStateOf<Int?>(null) }
    var sending by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }

    val ready = Polls.ready(question, options)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 20.dp),
        ) {
            Text(
                text = "Create a poll",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )

            Spacer(Modifier.height(16.dp))
            BetweenUsField(
                label = "Question",
                value = question,
                onValueChange = { question = it.take(Polls.QUESTION_MAX_CHARS); failure = null },
                placeholder = "What should we have for lunch?",
                enabled = !sending,
            )

            Spacer(Modifier.height(16.dp))
            Text(
                text = "OPTIONS",
                style = MaterialTheme.typography.labelSmallEmphasized,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            options.forEachIndexed { index, option ->
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = option,
                        onValueChange = { options[index] = it.take(Polls.OPTION_MAX_CHARS); failure = null },
                        enabled = !sending,
                        singleLine = true,
                        shape = MaterialTheme.shapes.large,
                        placeholder = { Text("Option ${index + 1}") },
                        label = { Text("Option ${index + 1}") },
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.Sentences,
                            imeAction = ImeAction.Next,
                        ),
                        modifier = Modifier.weight(1f).heightIn(min = 56.dp),
                    )
                    if (options.size > MessageBody.POLL_MIN_OPTIONS) {
                        IconAction(
                            icon = BetweenUsIcons.X,
                            contentDescription = "Remove option ${index + 1}",
                            onClick = { options.removeAt(index) },
                            enabled = !sending,
                        )
                    }
                }
            }
            if (options.size < MessageBody.POLL_MAX_OPTIONS) {
                TextButton(onClick = { options.add("") }, enabled = !sending) {
                    Text("Add an option")
                }
            }

            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .toggleable(
                        value = multiChoice,
                        enabled = !sending,
                        role = Role.Switch,
                        onValueChange = { multiChoice = it },
                    )
                    .heightIn(min = 48.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Allow more than one choice",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
                // The row is the control; the switch only draws it.
                Switch(checked = multiChoice, onCheckedChange = null)
            }

            Spacer(Modifier.height(8.dp))
            Text(
                text = "CLOSES",
                style = MaterialTheme.typography.labelSmallEmphasized,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            FlowRow(
                modifier = Modifier.padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Polls.DURATIONS.forEach { choice ->
                    Chip(
                        text = if (choice.seconds == null) "When I close it" else "After ${choice.label}",
                        selected = duration == choice.seconds,
                        onClick = { duration = choice.seconds },
                    )
                }
            }

            Spacer(Modifier.height(12.dp))
            Text(
                text = "The question and options are encrypted like any message. The server only counts votes.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            failure?.let {
                Spacer(Modifier.height(8.dp))
                Notice(it, Danger)
            }

            Spacer(Modifier.height(16.dp))
            BetweenUsButton(
                text = "Send poll",
                busy = sending,
                enabled = ready is PollReady.Ok,
                onClick = {
                    val checked = ready
                    if (checked !is PollReady.Ok) {
                        failure = (checked as PollReady.Refused).reason
                        return@BetweenUsButton
                    }
                    sending = true
                    scope.launch {
                        runCatching {
                            Conversation.sendPoll(channelId, checked.question, checked.options, multiChoice, duration)
                        }.onSuccess {
                            onDismiss()
                        }.onFailure {
                            failure = it.message ?: "The poll was not sent"
                            sending = false
                        }
                    }
                },
            )
        }
    }
}
