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
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.store.Conversation
import com.aatech.betweenus.core.store.ReadableMessage
import com.aatech.betweenus.core.store.WalkStop
import com.aatech.betweenus.core.store.walkOlder
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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
 *
 * Matches in that window appear at once. Then, after a short pause so typing a
 * word does not start a decryption per letter, the sheet walks back through
 * older pages - ciphertext fetched with the ordinary history cursor, opened on
 * this phone - in a run capped at [WALK_MESSAGE_CAP] messages, with a line
 * saying how far back it has read and a Stop button. A hit older than the
 * window folds the pages read so far into it ([onReveal]) so the jump has a row
 * to land on.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchSheet(
    channelId: String,
    messages: List<ReadableMessage>,
    onJump: (String) -> Unit,
    onReveal: (List<ReadableMessage>) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var query by remember { mutableStateOf("") }
    var older by remember { mutableStateOf<List<ReadableMessage>>(emptyList()) }
    var walk by remember { mutableStateOf<SearchWalkState?>(null) }
    val walked = remember { mutableListOf<ReadableMessage>() }
    var resume by remember { mutableStateOf<String?>(null) }
    var stopped by remember { mutableStateOf(false) }
    var job by remember { mutableStateOf<Job?>(null) }
    val scope = rememberCoroutineScope()
    val term = query.trim().lowercase().takeIf { it.length >= SEARCH_MIN_TERM }

    val results = remember(messages, older, query) {
        mergeSearchHits(searchMessages(messages, query), older)
    }
    val scheme = MaterialTheme.colorScheme

    fun run(from: String, forTerm: String, base: Int) {
        job?.cancel()
        stopped = false
        job = scope.launch {
            walk = SearchWalkState(running = true, scanned = base, oldestAt = walk?.oldestAt, stop = null)
            val result = walkOlder(
                cursor = from,
                fetchPage = { c -> Conversation.searchPage(channelId, c).also { walked.addAll(it.items) } },
                matches = { !it.message.deleted && it.text.lowercase().contains(forTerm) },
                createdAt = { it.message.createdAt },
                isStopped = { stopped },
                onProgress = { p ->
                    older = mergeSearchHits(older, p.hits)
                    resume = p.cursor
                    walk = SearchWalkState(true, base + p.scanned, p.oldestAt, null)
                },
            )
            resume = result.cursor
            walk = SearchWalkState(false, base + result.scanned, result.oldestAt ?: walk?.oldestAt, result.stop)
        }
    }

    LaunchedEffect(term, channelId) {
        job?.cancel()
        older = emptyList()
        walked.clear()
        walk = null
        resume = null
        if (term == null) return@LaunchedEffect
        val from = Conversation.oldestLoadedId(channelId) ?: return@LaunchedEffect
        delay(400)
        run(from, term, 0)
    }

    ModalBottomSheet(onDismissRequest = { job?.cancel(); onDismiss() }, sheetState = sheet) {
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
                term == null -> Text(
                    text = "Type at least $SEARCH_MIN_TERM characters.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = scheme.onSurfaceVariant,
                    modifier = Modifier.padding(20.dp),
                )

                results.isEmpty() && walk?.running != true -> EmptyState(
                    icon = BetweenUsIcons.Search,
                    title = "No matches",
                    detail = if (walk != null) {
                        "Nothing in the part of the history searched matches that."
                    } else {
                        "Nothing in the history this phone has opened matches that."
                    },
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
                                if (messages.none { it.id == readable.id }) {
                                    // Older than the window: fold in what the
                                    // search read, contiguous with the window.
                                    onReveal(walked.toList())
                                }
                                onJump(readable.id)
                                onDismiss()
                            },
                        )
                    }
                }
            }

            // Said rather than implied: how far back this has read, and why it
            // stopped. The server cannot be asked to look.
            val state = walk
            Text(
                text = if (state == null) {
                    "Searches the ${messages.size} messages this phone has decrypted. " +
                        "Messages are encrypted, so the server cannot search them."
                } else {
                    walkStatusLine(state, state.oldestAt?.let { dayLabel(it) })
                },
                style = MaterialTheme.typography.bodySmall,
                color = scheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            if (state != null) {
                if (state.running) {
                    TextButton(
                        onClick = { stopped = true },
                        modifier = Modifier.padding(horizontal = 12.dp),
                    ) { Text("Stop") }
                } else if (state.stop != WalkStop.End && resume != null && term != null) {
                    TextButton(
                        onClick = { run(resume!!, term, state.scanned) },
                        modifier = Modifier.padding(horizontal = 12.dp),
                    ) { Text(if (state.stop == WalkStop.Error) "Try again" else "Search further back") }
                }
            }
        }
    }
}

/** What the sheet knows about the walk, for the status line and its buttons. */
data class SearchWalkState(
    val running: Boolean,
    val scanned: Int,
    val oldestAt: String?,
    val stop: WalkStop?,
)

/** One line under the results: how far back, and why it is not going further. */
fun walkStatusLine(state: SearchWalkState, oldestLabel: String?): String {
    val reach = oldestLabel?.let { " back to $it" }.orEmpty()
    return when {
        state.running -> "Searching$reach… ${state.scanned} older messages read"
        state.stop == WalkStop.End -> "Searched the whole conversation" +
            oldestLabel?.let { " ($it)" }.orEmpty()
        state.stop == WalkStop.Cap -> "Searched$reach. Stopped after ${state.scanned} older messages"
        state.stop == WalkStop.Stopped -> "Stopped$reach"
        else -> "Could not read further$reach"
    }
}

/** Adds matches to those shown: no repeats, newest first, capped like the window's. */
fun mergeSearchHits(current: List<ReadableMessage>, more: List<ReadableMessage>): List<ReadableMessage> {
    val seen = current.mapTo(HashSet()) { it.id }
    val added = more.filter { it.id !in seen }
    if (added.isEmpty()) return current
    return (current + added).sortedWith(
        compareByDescending<ReadableMessage> { it.message.createdAt }.thenByDescending { it.id },
    ).take(SEARCH_HIT_CAP)
}

/** Most matches drawn across the window and the walk together. */
const val SEARCH_HIT_CAP = 200
