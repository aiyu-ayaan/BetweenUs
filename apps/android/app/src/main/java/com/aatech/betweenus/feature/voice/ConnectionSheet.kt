package com.aatech.betweenus.feature.voice

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.theme.Amber200
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate50
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.Surface800
import com.aatech.betweenus.ui.theme.Surface900

/**
 * What the call is doing, in numbers, for the person in it.
 *
 * The port of `apps/desktop/src/features/voice/ConnectionPanel.tsx`, as a sheet
 * rather than a popover because a phone has no room for one. Same four numbers,
 * same thresholds, same closing sentence - a person in a call with somebody on
 * the other client should be reading the same thing they are.
 *
 * "It looks bad" and "the link is bad" were the same sentence on a phone, and
 * the phone is the client with no `chrome://webrtc-internals` to fall back on.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectionSheet(stats: List<LinkStats>, onDismiss: () -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val warning = CallStats.healthWarning(stats)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Surface900,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 20.dp)
                .padding(bottom = 20.dp)
                .heightIn(max = 460.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text(
                text = "Connection",
                style = MaterialTheme.typography.titleMedium,
                color = Slate50,
            )

            if (warning != null) {
                Spacer(Modifier.height(10.dp))
                Notice(warning, Danger)
            }

            Spacer(Modifier.height(12.dp))

            if (stats.isEmpty()) {
                Text(
                    text = "Nobody else is connected yet, so there is nothing to measure.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate400,
                )
            } else {
                stats.forEach { link ->
                    PeerRow(link)
                    Spacer(Modifier.height(8.dp))
                }
            }

            Spacer(Modifier.height(6.dp))
            Text(
                text = "Media goes straight between the two machines, so these are the two of " +
                    "you and whatever is between - no server is in this path to blame.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
            )
        }
    }
}

@Composable
private fun PeerRow(link: LinkStats) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Surface800, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Text(
            text = link.name,
            style = MaterialTheme.typography.bodyMedium,
            color = Slate100,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(6.dp))

        // Two columns, like the desktop's grid: down beside up, loss beside
        // round trip. Four numbers read as two pairs and not as a list.
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Stat("Down", CallStats.rate(link.downKbps), Modifier.weight(1f))
            Stat("Up", CallStats.rate(link.upKbps), Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Stat(
                label = "Loss",
                value = link.lossPercent?.let { "$it%" } ?: "—",
                modifier = Modifier.weight(1f),
                tone = CallStats.lossTone(link.lossPercent),
            )
            Stat(
                label = "Round trip",
                value = link.roundTripMs?.let { "$it ms" } ?: "—",
                modifier = Modifier.weight(1f),
                tone = CallStats.roundTripTone(link.roundTripMs),
            )
        }
        CallStats.resolution(link)?.let {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Stat("Video", it, Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun Stat(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    tone: CallStats.Tone = CallStats.Tone.PLAIN,
) {
    Row(
        modifier = modifier.padding(vertical = 2.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = Slate500)
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall,
            color = when (tone) {
                CallStats.Tone.BAD -> Danger
                CallStats.Tone.WARN -> Amber200
                CallStats.Tone.PLAIN -> Slate100
            },
        )
    }
}
