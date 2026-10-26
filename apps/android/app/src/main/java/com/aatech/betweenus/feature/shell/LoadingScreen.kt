package com.aatech.betweenus.feature.shell

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.ui.components.BetweenUsMark
import com.aatech.betweenus.ui.components.MarkMotion
import kotlinx.coroutines.delay

/**
 * What the phone shows while a session is being restored.
 *
 * The same screen the desktop draws, in this platform's own idiom - a mark
 * with typing dots playing in its bubble, rather than a spinner. A spinner says something is happening; a brand mark says *which
 * application* is being waited for, which matters most on the one screen that
 * appears before anything else identifies it.
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

/** The mark's size here: the same as `drawable/splash_mark` draws it, so the hand-over does not jump. */
private val MARK_DP = 88.dp

/** The desktop's entrance curve (`mark-word-in` in index.css). */
private val EnterEasing = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)

/**
 * When the wordmark starts rising in, from this screen appearing. The system
 * splash has just played the mark's entrance, so the line follows it a beat
 * later - the order the desktop's boot screen plays them in.
 */
private const val WORDMARK_DELAY_MS = 120L

@Composable
fun LoadingScreen(
    problem: String? = null,
    onRetry: () -> Unit = {},
    onSignIn: () -> Unit = {},
) {
    val scheme = MaterialTheme.colorScheme
    // 0 until the wordmark has risen in under the mark, then 1.
    // Previews draw it in place: they never run the effect that brings it in.
    val still = LocalInspectionMode.current
    val word = remember { Animatable(if (still) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (still) return@LaunchedEffect
        delay(WORDMARK_DELAY_MS)
        word.animateTo(1f, tween(420, easing = EnterEasing))
    }
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
        // The mark at the exact centre of the screen, where the system splash
        // drew it, and everything else hung underneath - two equal weights
        // either side of it - so the hand-over from the splash moves nothing.
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(1f))
            // The system splash has just played the mark's entrance, so it
            // carries on from rest with typing dots in the bubble - the same
            // motion the desktop's boot screen settles into, and the whole
            // "working" signal: there is no spinner beside it.
            BetweenUsMark(
                color = scheme.primary,
                modifier = Modifier.size(MARK_DP),
                motion = MarkMotion.Talk,
            )

            Column(
                modifier = Modifier.weight(1f).padding(top = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                Text(
                    text = "BETWEENUS",
                    style = MaterialTheme.typography.labelLarge,
                    color = scheme.onSurfaceVariant,
                    // Up 4dp and in, as on the desktop. A layer, not an
                    // offset: the line still takes its place from the first
                    // frame, so nothing under it moves.
                    modifier = Modifier.graphicsLayer {
                        alpha = word.value
                        translationY = (1f - word.value) * 4.dp.toPx()
                    },
                )

                // Everything here hangs from the top, so the line arriving
                // moves nothing above it - a layout that shifts under somebody
                // already waiting reads as a second thing going wrong.
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
}
