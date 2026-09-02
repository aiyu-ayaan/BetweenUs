package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.store.ReadableMessage
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.EmptyState
import com.aatech.betweenus.ui.components.ListRow

/**
 * Search inside the open conversation.
 *
 * It runs on the phone, over the history this process has already decrypted,
 * and it has to: `content` on the wire is an envelope, so the server cannot
 * match a word in one without being handed the channel key, which is the thing
 * the design will not do. The reach is therefore whatever has been paged in -
 * stated in the footer rather than implied, because a search that quietly
 * stops at a fortnight ago is worse than one that says where it stopped.
 *
 * The port of `apps/desktop/src/features/chat/SearchPanel.tsx`, which is a
 * right-hand panel there and a sheet here for the same reason pins are: a
 * phone has one column and a panel would be the whole screen anyway.
 */

/** Below this a term matches most of the channel, which is not a search. */
const val SEARCH_MIN_TERM = 2

/** Newest first, and this many. Past it the list is a scroll, not an answer. */
const val SEARCH_LIMIT = 100

/**
 * Messages whose body carries [query], newest first.
 *
 * Deleted rows are skipped: a tombstone has an empty body, so it can only ever
 * match a blank term, and drawing one as a result offers something to jump to
 * that is no longer there. System rows - somebody arriving - have no body
 * either and fall out on the same test.
 */
fun searchMessages(
    messages: List<ReadableMessage>,
    query: String,
    limit: Int = SEARCH_LIMIT,
): List<ReadableMessage> {
    val needle = query.trim().lowercase()
    if (needle.length < SEARCH_MIN_TERM) return emptyList()
    return messages
        .filter { !it.message.deleted && it.text.lowercase().contains(needle) }
        // The last N, then reversed: the newest matches, which is what somebody
        // scrolling back for a thing they said on Tuesday actually wants.
        .takeLast(limit)
        .reversed()
}

/**
 * The line drawn under a result: the part of a long body the term is in.
 *
 * A message that matches on its four-hundredth character is otherwise a result
 * showing four hundred characters that do not contain what was typed.
 */
fun searchSnippet(text: String, query: String): String {
    val needle = query.trim().lowercase()
    val at = if (needle.isEmpty()) -1 else text.lowercase().indexOf(needle)
    if (at <= 60) return text.take(160)
    return "…" + text.substring(at - 40, minOf(text.length, at + 120))
}

/**
 * The sheet itself.
 *
 * [messages] is the list the conversation is drawing, not the store's own: a
 * channel this device holds no key for hides its unreadable rows on screen, and
 * a search that found them would jump to something that is not there.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchSheet(
    messages: List<ReadableMessage>,
    onJump: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var query by remember { mutableStateOf("") }
    val results = remember(messages, query) { searchMessages(messages, query) }
    val scheme = MaterialTheme.colorScheme

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding()) {
            BetweenUsField(
                label = "Search",
                value = query,
                onValueChange = { query = it },
                placeholder = "Search this channel",
                imeAction = ImeAction.Search,
                modifier = Modifier.padding(horizontal = 20.dp),
            )

            when {
                query.trim().length < SEARCH_MIN_TERM -> Text(
                    text = "Type at least $SEARCH_MIN_TERM characters.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = scheme.onSurfaceVariant,
                    modifier = Modifier.padding(20.dp),
                )

                results.isEmpty() -> EmptyState(
                    icon = BetweenUsIcons.Search,
                    title = "No matches",
                    detail = "Nothing in the history this phone has opened matches that. " +
                        "Scrolling further back widens the search.",
                )

                else -> LazyColumn(Modifier.heightIn(max = 420.dp)) {
                    items(results, key = { it.id }) { readable ->
                        ListRow(
                            title = readable.message.author.label,
                            subtitle = searchSnippet(readable.text, query),
                            leading = { BetweenUsIcon(BetweenUsIcons.Message) },
                            trailing = {
                                Text(
                                    text = dayLabel(readable.message.createdAt),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = scheme.onSurfaceVariant,
                                )
                            },
                            onClick = {
                                onJump(readable.id)
                                onDismiss()
                            },
                        )
                    }
                }
            }

            // Said rather than implied. The number is the honest answer to "why
            // is that message not in here" - it is older than what this phone
            // has opened, and the server cannot be asked to look.
            Text(
                text = "Searches the ${messages.size} messages this phone has decrypted. " +
                    "Messages are encrypted, so the server cannot search them.",
                style = MaterialTheme.typography.bodySmall,
                color = scheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            )
        }
    }
}
