package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Where somebody this account blocked said something, folded away.
 *
 * Deliberately plain - no name and no avatar, since the point is not having
 * them in front of you. Show opens the run on this screen only. The port of
 * `BlockedRunRow` in `apps/desktop/src/features/chat/ChatView.tsx`; the rules
 * for what folds are [com.aatech.betweenus.core.data.BlockedRuns].
 */
@Composable
fun BlockedRunRow(label: String, onShow: () -> Unit, modifier: Modifier = Modifier) {
    val scheme = MaterialTheme.colorScheme
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = scheme.onSurfaceVariant,
        )
        Text(
            text = "·",
            style = MaterialTheme.typography.bodySmall,
            color = scheme.onSurfaceVariant,
        )
        TextButton(onClick = onShow) {
            Text(text = "Show", style = MaterialTheme.typography.labelMedium)
        }
    }
}
