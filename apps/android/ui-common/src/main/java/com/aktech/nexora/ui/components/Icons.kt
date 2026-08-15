package com.aktech.nexora.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.aktech.nexora.ui.R
import com.aktech.nexora.ui.theme.Accent
import com.aktech.nexora.ui.theme.Edge

/**
 * The marks the three clients share. The path data is copied from
 * `apps/desktop/src/components/icons.tsx` rather than redrawn, so one mark
 * stays one mark.
 */

@Composable
fun NexoraLogo(modifier: Modifier = Modifier, tint: Color = Accent) {
    Icon(
        painter = painterResource(R.drawable.ic_nexora_logo),
        contentDescription = null,
        tint = tint,
        modifier = modifier.size(24.dp),
    )
}

/** The logo in the rounded accent tile every entry screen opens with. */
@Composable
fun NexoraLogoTile(modifier: Modifier = Modifier, size: Int = 48) {
    Box(
        modifier = modifier
            .size(size.dp)
            .border(1.dp, Edge, RoundedCornerShape(12.dp))
            .background(Accent.copy(alpha = 0.15f), RoundedCornerShape(12.dp)),
        contentAlignment = Alignment.Center,
    ) {
        NexoraLogo(modifier = Modifier.size((size * 0.55f).dp))
    }
}

@Composable
fun GlobeIcon(modifier: Modifier = Modifier, tint: Color) {
    Icon(
        painter = painterResource(R.drawable.ic_globe),
        contentDescription = null,
        tint = tint,
        modifier = modifier.size(16.dp),
    )
}
