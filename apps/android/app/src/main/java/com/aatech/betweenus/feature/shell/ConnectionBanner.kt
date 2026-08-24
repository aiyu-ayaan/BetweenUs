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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.Connectivity
import com.aatech.betweenus.ui.theme.BetweenUsMotion

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

    val scheme = MaterialTheme.colorScheme
    AnimatedVisibility(
        visible = state != Connectivity.State.ONLINE,
        // The banner pushes the screen down rather than covering it, and it
        // does so on the theme's spring: a bar that snaps into place reads as a
        // layout bug, one that springs reads as an arrival.
        enter = fadeIn(BetweenUsMotion.effect()) + slideInVertically(BetweenUsMotion.spatial()) { -it },
        exit = fadeOut(BetweenUsMotion.effect()) + slideOutVertically(BetweenUsMotion.spatial()) { -it },
        modifier = modifier,
    ) {
        val reconnecting = state == Connectivity.State.RECONNECTING
        // Trying is not failing. Reconnecting is the tertiary container - a
        // state worth knowing about - and only a connection that has given up
        // gets the error one.
        val container = if (reconnecting) scheme.tertiaryContainer else scheme.errorContainer
        val content = if (reconnecting) scheme.onTertiaryContainer else scheme.onErrorContainer
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(container)
                .statusBarsPadding()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (reconnecting) {
                LoadingIndicator(color = content, modifier = Modifier.size(20.dp))
            }
            Text(
                text = if (reconnecting) "Reconnecting…" else "Disconnected",
                style = MaterialTheme.typography.labelLargeEmphasized,
                color = content,
                modifier = Modifier.weight(1f),
            )
            if (!reconnecting) {
                TextButton(onClick = { Connectivity.retry() }) {
                    Text(
                        text = "Try again",
                        style = MaterialTheme.typography.labelLarge,
                        color = content,
                    )
                }
            }
        }
    }
}
