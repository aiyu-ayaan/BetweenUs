package com.aatech.betweenus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage

/**
 * The wide band behind a name at the top of a profile.
 *
 * One composable for every place that draws one - the account screen, the
 * profile sheet - because the fallback is the interesting part and it has to be
 * the same fallback everywhere. An account with no cover gets the theme's
 * primary colour, which is what those places drew before covers existed, so
 * nothing looks broken on somebody who has not chosen a picture.
 *
 * A gradient rather than a flat fill on the fallback: a flat band under a round
 * avatar reads as a placeholder that failed to load, where two stops read as a
 * decision. Same colour either way, so a theme swap takes the cover with it -
 * which matters here, because this app ships sixteen of them.
 */
@Composable
fun ProfileCover(
    coverUrl: String?,
    modifier: Modifier = Modifier,
    height: Dp = 120.dp,
    /** Drawn over the band - a close button, usually. */
    content: @Composable BoxScope.() -> Unit = {},
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(height)
            .background(
                Brush.linearGradient(
                    listOf(
                        MaterialTheme.colorScheme.primary,
                        MaterialTheme.colorScheme.tertiary,
                    ),
                ),
            ),
    ) {
        if (coverUrl != null) {
            AsyncImage(
                model = coverUrl,
                // Decorative: the name under it is the label, and a screen
                // reader announcing "cover photo" before every profile is noise.
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            // A scrim only under a real picture. The name and the avatar sit on
            // the bottom edge of this band, and a photograph with a bright
            // lower half makes both unreadable - where the gradient never does,
            // so darkening that would mute the theme for nothing.
            Box(
                Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            listOf(Color.Transparent, Color.Black.copy(alpha = 0.45f)),
                        ),
                    ),
            )
        }
        content()
    }
}
