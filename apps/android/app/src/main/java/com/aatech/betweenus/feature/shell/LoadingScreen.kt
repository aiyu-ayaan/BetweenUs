package com.aatech.betweenus.feature.shell

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.ui.components.BetweenUsLogoTile
import kotlinx.coroutines.delay

/**
 * What the phone shows while a session is being restored.
 *
 * The same screen the desktop draws, in this platform's own idiom - a mark
 * breathing inside a travelling arc, rather than a spinner. A spinner says
 * something is happening; a brand mark says *which application* is being waited
 * for, which matters most on the one screen that appears before anything else
 * identifies it.
 *
 * **The tip is deliberately late, and that is this file's one real decision.**
 * The comment this screen replaced said it outright: a splash that says
 * "Loading…" for 200ms is worse than one that says nothing. So the mark is
 * there at once and [TIP_DELAY_MS] passes before anything is written under it -
 * an ordinary restore finishes first and nobody ever sees a word.
 *
 * [problem] is the other half, unchanged: a refresh token is worth keeping
 * through a server being down, so the restore keeps trying behind this, and
 * after the first failure the address it cannot reach is the one fact that
 * separates a stopped service from a wrong address from a phone with no signal.
 * A real problem outranks a tip and replaces it - somebody who cannot get in
 * does not want to be told about keyboard shortcuts.
 */
object BootTips {
    /**
     * How long a wait has to last before it is worth saying something into.
     *
     * Strictly greater than `Session.MIN_SPLASH_MS`, and `BootTipsTest` holds
     * it there: a tip that appears before the splash is allowed to leave is on
     * screen for a few hundred milliseconds, which is the unreadable flash this
     * delay exists to prevent. So an ordinary start shows the mark and no words
     * at all, and the tip is kept for a start that is genuinely dragging.
     */
    const val TIP_DELAY_MS = 2300L

    /** How long each tip stays up before the next one takes over. */
    const val TIP_ROTATE_MS = 4500L

    /**
     * Mirrors `TIPS` in `apps/desktop/src/features/shell/LoadingScreen.tsx`,
     * because this module cannot read a TypeScript constant and a phone and a
     * laptop telling the same person two different sets of facts about one
     * product is worse than either list alone. Asserted on both sides -
     * `LoadingScreen.check.ts` here, `BootTipsTest` there.
     */
    val TIPS: List<String> = listOf(
        "Messages are sealed on your device. The server stores ciphertext it cannot read.",
        "Voice and video go straight between you. No server sits in the middle of a call.",
        "Press Ctrl K to jump to any channel or conversation.",
        "A one-time photo is destroyed once everyone it was sent to has opened it.",
        "Type @ to mention somebody, a role, or everyone in the channel.",
        "Screen sharing keeps the picture sharp and spends frames instead - text stays readable.",
        "Your remote machines dial out. No inbound port is ever opened for them.",
    )

    /**
     * The tips this platform shows.
     *
     * A phone has no Ctrl key, so the shortcut line is dropped here rather than
     * from the shared list: advice somebody physically cannot follow reads as
     * the app having been written for a different device.
     */
    val phoneTips: List<String> = TIPS.filterNot { it.startsWith("Press Ctrl") }
}

@Composable
fun LoadingScreen(
    problem: String? = null,
    onRetry: () -> Unit = {},
    onSignIn: () -> Unit = {},
) {
    val scheme = MaterialTheme.colorScheme
    val transition = rememberInfiniteTransition(label = "boot")

    val sweep by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(1150), RepeatMode.Restart),
        label = "sweep",
    )
    // A slower beat than the ring, so the two read as one object rather than as
    // two things that happen to be moving.
    val breath by transition.animateFloat(
        initialValue = 1f,
        targetValue = 0.94f,
        animationSpec = infiniteRepeatable(tween(1200), RepeatMode.Reverse),
        label = "breath",
    )

    // Null until the wait has become a wait. `-1` would be the first tip, which
    // is the thing this is avoiding.
    var tip by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(Unit) {
        delay(BootTips.TIP_DELAY_MS)
        // A random opening tip rather than always the first: this screen is
        // seen every launch, and a list that always starts at the top is one
        // whose first entry is the only one anybody ever reads.
        tip = BootTips.phoneTips.indices.random()
        while (true) {
            delay(BootTips.TIP_ROTATE_MS)
            tip = ((tip ?: 0) + 1) % BootTips.phoneTips.size
        }
    }

    Box(
        modifier = Modifier.fillMaxSize().background(scheme.background),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Box(
                    modifier = Modifier
                        .size(88.dp)
                        .rotate(sweep)
                        .drawBehind {
                            // One arc rather than a full ring, so it reads as
                            // travelling rather than merely glowing.
                            drawArc(
                                color = scheme.primary,
                                startAngle = 0f,
                                sweepAngle = 96f,
                                useCenter = false,
                                topLeft = Offset(0f, 0f),
                                size = Size(size.width, size.height),
                                style = Stroke(width = 3.dp.toPx()),
                            )
                        },
                )
                BetweenUsLogoTile(size = 56, modifier = Modifier.scale(breath))
            }

            Text(
                text = "BETWEENUS",
                style = MaterialTheme.typography.labelLarge,
                color = scheme.onSurfaceVariant,
            )

            // Reserved height, so the mark does not jump upwards when the line
            // below arrives - a layout that shifts under somebody already
            // waiting reads as a second thing going wrong.
            Box(
                modifier = Modifier.heightIn(min = 72.dp).padding(horizontal = 32.dp),
                contentAlignment = Alignment.TopCenter,
            ) {
                if (problem != null) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(
                            text = problem,
                            style = MaterialTheme.typography.bodyMedium,
                            color = scheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                        Text(
                            text = "Still trying…",
                            style = MaterialTheme.typography.bodySmall,
                            color = scheme.onSurfaceVariant,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = onRetry) { Text("Try now") }
                            TextButton(onClick = onSignIn) { Text("Sign in instead") }
                        }
                    }
                } else {
                    AnimatedContent(
                        targetState = tip,
                        transitionSpec = { fadeIn(tween(300)) togetherWith fadeOut(tween(200)) },
                        label = "tip",
                    ) { at ->
                        Text(
                            text = at?.let { BootTips.phoneTips[it] } ?: "",
                            style = MaterialTheme.typography.bodySmall,
                            color = scheme.onSurfaceVariant.copy(alpha = 0.7f),
                            textAlign = TextAlign.Center,
                            modifier = Modifier.alpha(if (at == null) 0f else 1f),
                        )
                    }
                }
            }
        }
    }
}
