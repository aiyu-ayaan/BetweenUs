package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.EditHistoryRules
import com.aatech.betweenus.core.data.OpenedVersion
import com.aatech.betweenus.core.store.EditHistory
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate400
import kotlinx.coroutines.CancellationException

private sealed interface HistoryLoad {
    data object Loading : HistoryLoad
    data object Failed : HistoryLoad
    data class Ready(val versions: List<OpenedVersion>) : HistoryLoad
}

/**
 * What a message said before it was edited, newest first. Each version arrives
 * sealed and is opened here with the channel key; a version that will not open
 * is listed as such so the count matches what the server holds.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditHistorySheet(
    channelId: String,
    messageId: String,
    /** Reloads when the message is edited again with the sheet open. */
    editCount: Int,
    onDismiss: () -> Unit,
) {
    var load by remember { mutableStateOf<HistoryLoad>(HistoryLoad.Loading) }
    var attempt by remember { mutableIntStateOf(0) }

    LaunchedEffect(messageId, editCount, attempt) {
        load = HistoryLoad.Loading
        load = try {
            HistoryLoad.Ready(EditHistory.load(channelId, messageId))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            HistoryLoad.Failed
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 24.dp)
                .padding(bottom = 24.dp),
        ) {
            Text(
                text = "Earlier versions",
                style = MaterialTheme.typography.titleMedium,
                color = Slate100,
            )
            Spacer(Modifier.height(12.dp))
            when (val state = load) {
                HistoryLoad.Loading -> CircularProgressIndicator()
                HistoryLoad.Failed -> {
                    Text(
                        text = "Could not load the history.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Slate400,
                    )
                    TextButton(onClick = { attempt += 1 }) { Text("Try again") }
                }
                is HistoryLoad.Ready ->
                    if (state.versions.isEmpty()) {
                        Text(
                            text = "No earlier versions are kept for this message.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Slate400,
                        )
                    } else {
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            items(state.versions, key = { it.id }) { version ->
                                Column {
                                    Text(
                                        text = EditHistoryRules.versionTime(version.writtenAt),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = Slate400,
                                    )
                                    Text(
                                        text = if (version.readable) {
                                            version.text.ifEmpty { "No text" }
                                        } else {
                                            "This version cannot be opened on this device."
                                        },
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = if (version.readable) Slate100 else Slate400,
                                    )
                                }
                            }
                        }
                    }
            }
        }
    }
}
