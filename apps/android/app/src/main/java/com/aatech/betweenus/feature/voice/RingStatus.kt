package com.aatech.betweenus.feature.voice

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.store.OutgoingRing
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.RingState
import com.aatech.betweenus.ui.theme.Amber200
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Slate50
import kotlinx.coroutines.launch

/**
 * What the person who rang is told about their ring.
 *
 * A caller used to be told nothing, so a call to somebody who had said no
 * looked exactly like one to a phone that was switched off, and they sat in an
 * empty call unable to tell which. Pure so the words are pinned: the same three
 * lines the desktop draws (`ring-status.ts`).
 */
object RingStatus {
    fun text(state: RingState, name: String): String {
        val who = name.trim().ifEmpty { "They" }
        return when (state) {
            RingState.RINGING -> "Ringing $who…"
            RingState.DECLINED -> "$who declined the call"
            RingState.UNANSWERED -> "$who didn't answer"
        }
    }

    /** The ring is over and nobody came. Ringing twice at once is how somebody gets blocked. */
    fun canRingAgain(state: RingState): Boolean = state != RingState.RINGING

    /** Only the ring sent for the call this screen is showing. */
    fun showsFor(ring: OutgoingRing?, channelId: String?): OutgoingRing? =
        ring?.takeIf { channelId != null && it.channelId == channelId }
}

@Composable
fun OutgoingRingBanner(ring: OutgoingRing, modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    val tone = when (ring.state) {
        RingState.RINGING -> Slate50
        RingState.DECLINED -> Danger
        RingState.UNANSWERED -> Amber200
    }
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(tone.copy(alpha = 0.16f))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = RingStatus.text(ring.state, ring.targetName),
            style = MaterialTheme.typography.bodySmall,
            color = tone,
        )
        if (RingStatus.canRingAgain(ring.state)) {
            Text(
                text = "Ring again",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.clickable {
                    // The cooldown may refuse a second ring inside thirty
                    // seconds, and the line above is already the status.
                    scope.launch {
                        runCatching { BetweenUsApi.callRing(ring.channelId, ring.targetId) }
                    }
                },
            )
            Text(
                text = "Dismiss",
                style = MaterialTheme.typography.labelLarge,
                color = tone,
                modifier = Modifier.clickable { Presence.clearOutgoingRing() },
            )
        }
    }
}
