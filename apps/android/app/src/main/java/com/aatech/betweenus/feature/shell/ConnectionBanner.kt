package com.aatech.betweenus.feature.shell

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.Connectivity
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Slate100

/**
 * What the realtime connection is doing, when it is not simply working.
 *
 * Nothing is drawn while the sockets are up, which is almost always. A phone
 * whose sockets are down looks identical to one nobody has written to - no
 * messages arrive either way - and that silence is what people read as the app
 * being broken. A bar rather than a dialog: what is already on screen came off
 * the local database and is still worth reading while the network is away.
 */
@Composable
fun ConnectionBanner(modifier: Modifier = Modifier) {
    val state by Connectivity.state.collectAsState()

    AnimatedVisibility(
        visible = state != Connectivity.State.ONLINE,
        enter = fadeIn() + slideInVertically { -it },
        exit = fadeOut() + slideOutVertically { -it },
        modifier = modifier,
    ) {
        val reconnecting = state == Connectivity.State.RECONNECTING
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    if (reconnecting) Color(0xFF3A2E12) else Danger.copy(alpha = 0.22f),
                )
                .padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (reconnecting) {
                CircularProgressIndicator(
                    modifier = Modifier.size(14.dp),
                    strokeWidth = 2.dp,
                    color = Slate100,
                )
            }
            Text(
                text = if (reconnecting) "Reconnecting…" else "Disconnected",
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Medium,
                color = Slate100,
            )
            if (!reconnecting) {
                TextButton(onClick = { Connectivity.retry() }) {
                    Text("Try again", style = MaterialTheme.typography.bodySmall, color = Slate100)
                }
            }
        }
    }
}
