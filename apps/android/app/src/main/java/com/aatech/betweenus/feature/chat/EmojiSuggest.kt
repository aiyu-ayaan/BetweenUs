package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.aatech.betweenus.core.data.EmojiNames
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.ServerEmoji
import com.aatech.betweenus.ui.theme.Edge
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Surface900

/**
 * The `:` menu: two letters and pick an emoji without leaving the keyboard.
 *
 * The picker sheet already exists and is the wrong tool mid-sentence - it takes
 * the keyboard away, covers the conversation, and has to be dismissed again.
 * The port of `EmojiSuggest.tsx`, ranked the same way and offering the same two
 * kinds of thing, drawn as a strip above the composer because a phone has no
 * room for a menu beside a caret.
 */

/** One row: a Unicode emoji from the table, or one of this server's own. */
sealed interface EmojiSuggestion {
    /** What goes into the box when it is chosen. */
    val insert: String

    data class Unicode(val entry: EmojiNames.Named) : EmojiSuggestion {
        override val insert: String get() = entry.emoji
    }

    /**
     * A custom one inserts its `:name:` rather than a picture: the shortcode is
     * what the message carries, and the picture is resolved from the manifest
     * the sender attaches.
     */
    data class Custom(val emoji: ServerEmoji) : EmojiSuggestion {
        override val insert: String get() = ":${emoji.name}:"
    }
}

private fun rank(name: String, needle: String): Int = when {
    name == needle -> 0
    name.startsWith(needle) -> 1
    else -> 2
}

/**
 * What to offer for a term. The server's own come first, because a server that
 * has invented `:shipit:` has invented it for a reason.
 */
fun emojiSuggestions(
    term: String,
    custom: List<ServerEmoji>,
    limit: Int = EmojiNames.SUGGESTION_LIMIT,
): List<EmojiSuggestion> {
    val needle = term.trim().trimStart(':').lowercase()
    if (needle.isEmpty()) return emptyList()

    val mine = custom
        .filter { it.name.contains(needle) }
        .sortedBy { rank(it.name, needle) }
        .map { EmojiSuggestion.Custom(it) }

    val rest = EmojiNames.search(needle, limit).map { EmojiSuggestion.Unicode(it) }

    return (mine + rest).take(limit)
}

@Composable
fun EmojiSuggestBar(
    suggestions: List<EmojiSuggestion>,
    onPick: (EmojiSuggestion) -> Unit,
) {
    if (suggestions.isEmpty()) return

    LazyRow(
        modifier = Modifier
            .fillMaxWidth()
            .background(Surface900)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        items(suggestions, key = { it.insert }) { suggestion ->
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(Edge.copy(alpha = 0.35f))
                    .clickable { onPick(suggestion) }
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                when (suggestion) {
                    is EmojiSuggestion.Unicode -> Text(
                        text = suggestion.entry.emoji,
                        fontSize = 20.sp,
                    )

                    is EmojiSuggestion.Custom -> Box(Modifier.size(20.dp)) {
                        AsyncImage(
                            model = Endpoint.absolute(suggestion.emoji.url),
                            contentDescription = ":${suggestion.emoji.name}:",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }

                Spacer(Modifier.width(6.dp))

                Text(
                    text = when (suggestion) {
                        is EmojiSuggestion.Unicode -> ":${suggestion.entry.names.first()}:"
                        is EmojiSuggestion.Custom -> ":${suggestion.emoji.name}:"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = if (suggestion is EmojiSuggestion.Custom) Slate100 else Slate400,
                )
            }
        }
    }
}
