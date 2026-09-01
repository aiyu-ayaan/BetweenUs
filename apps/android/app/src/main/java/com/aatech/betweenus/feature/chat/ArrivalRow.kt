package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.store.ReadableMessage

/**
 * "VILEN is here."
 *
 * Somebody joined the server. It is the conversation talking rather than a
 * person, so it is a line rather than a bubble: an arrow, a name, a few words
 * and the time, the way Discord draws it - which reads as an event in the
 * history instead of as a message somebody could reply to or react to.
 *
 * The port of `ArrivalRow` in `apps/desktop/src/features/chat/ChatView.tsx`,
 * and the two have to agree on which sentence a given row gets: see
 * [arrivalLine].
 */
@Composable
fun ArrivalRow(readable: ReadableMessage, modifier: Modifier = Modifier) {
    val scheme = MaterialTheme.colorScheme
    val context = LocalContext.current
    val name = readable.message.author.label

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "→",
            style = MaterialTheme.typography.bodyMedium,
            color = scheme.primary,
        )
        Text(
            text = buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = scheme.onSurface)) {
                    append(name)
                }
                append(" ")
                append(arrivalLine(readable.message.id))
            },
            style = MaterialTheme.typography.bodyMedium,
            color = scheme.onSurfaceVariant,
        )
        Text(
            text = clockTime(context, readable.message.createdAt),
            style = MaterialTheme.typography.labelSmall,
            color = scheme.onSurfaceVariant.copy(alpha = 0.7f),
        )
    }
}

/**
 * What the line says, picked from the message id rather than stored.
 *
 * Nothing about the wording is in the database: the server writes the row, and
 * a sentence written there would be in whatever language that service was
 * written in for every reader on the deployment. So each client picks, and
 * picks deterministically from the id, which is what makes the same arrival say
 * the same thing on every device and on every reload without a column to hold
 * it.
 *
 * The hash and the list must match `ARRIVAL_LINES` in the desktop client, or a
 * phone and a laptop looking at the same conversation disagree about what
 * happened in it.
 */
fun arrivalLine(messageId: String): String {
    // Int overflows mod 2^32, which is the same arithmetic `>>> 0` gives the
    // desktop; the mask on the way out is what reads it back as unsigned.
    var hash = 0
    for (character in messageId) hash = hash * 31 + character.code
    val index = ((hash.toLong() and 0xFFFFFFFFL) % ARRIVAL_LINES.size).toInt()
    return ARRIVAL_LINES[index]
}

private val ARRIVAL_LINES = listOf(
    "is here.",
    "just landed.",
    "just slid into the server.",
    "joined the party.",
    "hopped into the server.",
    "has arrived.",
)
