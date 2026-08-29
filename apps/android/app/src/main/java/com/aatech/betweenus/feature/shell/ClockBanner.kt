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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.ServerClock
import com.aatech.betweenus.ui.theme.BetweenUsMotion

/**
 * One line when this phone's clock is wrong.
 *
 * A clock that is out by minutes cannot open anything - every expiry is decided
 * on the server, and `ServerClock` says why that is not negotiable - but it does
 * make the app lie quietly to the person reading it: yesterday's conversation
 * filed under "Today", an invite still offered after it lapsed. Saying so is
 * the difference between a wrong clock and software that looks broken.
 *
 * It stays while the clock is wrong rather than being dismissible, because
 * unlike a dropped connection there is nothing to wait for: it goes when the
 * phone's time is corrected, which is the only thing that fixes it.
 */
@Composable
fun ClockBanner(modifier: Modifier = Modifier) {
    val offset by ServerClock.offsetMs.collectAsState()
    val scheme = MaterialTheme.colorScheme

    AnimatedVisibility(
        visible = ServerClock.isWrong(offset),
        enter = fadeIn(BetweenUsMotion.effect()) + slideInVertically(BetweenUsMotion.spatial()) { -it },
        exit = fadeOut(BetweenUsMotion.effect()) + slideOutVertically(BetweenUsMotion.spatial()) { -it },
        modifier = modifier,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(scheme.tertiaryContainer)
                .statusBarsPadding()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = ServerClock.wording(offset),
                style = MaterialTheme.typography.labelLarge,
                color = scheme.onTertiaryContainer,
                modifier = Modifier.weight(1f),
            )
        }
    }
}
