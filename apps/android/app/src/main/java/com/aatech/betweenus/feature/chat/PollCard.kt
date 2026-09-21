package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.MessagePoll
import com.aatech.betweenus.core.data.view

/**
 * A poll in a message bubble: a bar per option, your own choice filled, and the
 * controls to change it, take it back, or close the poll.
 *
 * Everything drawn is the referee's. A tap sends the whole ballot and the
 * server answers with the tally, which reaches this card the way a reaction
 * does - there is no optimistic bar, so what is on screen is what was counted.
 */
@Composable
internal fun PollCard(
    poll: MessagePoll,
    labels: List<String>,
    selfId: String,
    canClose: Boolean,
    onVote: (List<Int>) -> Unit,
    onClose: () -> Unit,
) {
    val view = poll.view(labels, selfId)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = (if (view.multiChoice) "Choose any" else "Choose one") +
                if (view.closed) " · Closed" else "",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        view.bars.forEach { bar ->
            val shape = RoundedCornerShape(10.dp)
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 44.dp)
                    .clip(shape)
                    .border(
                        1.dp,
                        if (bar.mine) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.outlineVariant,
                        shape,
                    )
                    .then(
                        if (view.closed) Modifier
                        else Modifier.clickable(role = Role.Button) { onVote(view.ballotAfter(bar.option)) },
                    )
                    .semantics {
                        contentDescription =
                            "${bar.label}, ${bar.count} votes, ${bar.percent} percent" +
                                if (bar.mine) ", your choice" else ""
                    },
            ) {
                // The bar itself, behind the words.
                Box(
                    modifier = Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(bar.percent / 100f)
                        .background(
                            if (bar.mine) MaterialTheme.colorScheme.primary.copy(alpha = 0.3f)
                            else MaterialTheme.colorScheme.surfaceContainerHighest,
                        ),
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        text = (if (bar.mine) "✓ " else "") + bar.label,
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = "${bar.count} · ${bar.percent}%",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "${view.voters} ${if (view.voters == 1) "vote" else "votes"}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            if (!view.closed && view.mine.isNotEmpty()) {
                TextButton(onClick = { onVote(emptyList()) }) { Text("Retract vote") }
            }
            if (!view.closed && canClose) {
                TextButton(onClick = onClose) { Text("Close poll") }
            }
        }
    }
}
