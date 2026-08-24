package com.aatech.betweenus.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ripple
import androidx.compose.material3.Text
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.ui.theme.BetweenUsMotion

/**
 * The pieces every screen is assembled from, in Material 3 Expressive.
 *
 * The old version of this file drew panels: a rounded card with a hairline
 * border, on a near-black ground. Expressive draws the same separation with
 * *tone* - a container one step up the surface ramp - and keeps the hairline
 * for the few places where two containers of the same tone meet. Fewer lines on
 * screen, and the depth survives someone turning the contrast up.
 *
 * The second change is that things react. A row's corner opens up under a
 * finger and springs back; a selected row is a different shape as well as a
 * different colour. Shape is information here, not decoration.
 */

/** The uppercase divider the sidebars group things under. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier, trailing: @Composable (() -> Unit)? = null) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 20.dp, end = 12.dp, top = 16.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = text.uppercase(),
            style = MaterialTheme.typography.labelSmallEmphasized,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        trailing?.invoke()
    }
}

/**
 * One tappable row.
 *
 * 56dp is the floor, not the target: a list of names is the thing people miss
 * when a row is 40dp and a thumb is 9mm across.
 *
 * Selected is drawn three ways at once - a secondary container, a wider corner,
 * and an emphasized label - because one of the three is always the one somebody
 * cannot see. Pressing widens the corner further and it springs back, which is
 * the expressive shape-morph applied to a list item rather than a button.
 */
@Composable
fun ListRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    selected: Boolean = false,
    leading: @Composable (() -> Unit)? = null,
    trailing: @Composable (RowScope.() -> Unit)? = null,
    titleColor: Color = Color.Unspecified,
    onClick: (() -> Unit)? = null,
) {
    val scheme = MaterialTheme.colorScheme
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.collectIsPressedAsState()

    val corner by animateDpAsState(
        targetValue = when {
            pressed -> 26.dp
            selected -> 20.dp
            else -> 14.dp
        },
        animationSpec = BetweenUsMotion.spatialFast(),
        label = "row-corner",
    )
    val container by animateColorAsState(
        targetValue = if (selected) scheme.secondaryContainer else Color.Transparent,
        animationSpec = BetweenUsMotion.effect(),
        label = "row-container",
    )
    val content = when {
        titleColor != Color.Unspecified -> titleColor
        selected -> scheme.onSecondaryContainer
        else -> scheme.onSurface
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 10.dp, vertical = 2.dp)
            .clip(RoundedCornerShape(corner))
            .background(container)
            .let {
                if (onClick != null) {
                    it.clickable(interactionSource = interactions, indication = ripple(), onClick = onClick)
                } else {
                    it
                }
            }
            .heightIn(min = 56.dp)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        leading?.invoke()
        Column(Modifier.weight(1f)) {
            Text(
                text = title,
                style = if (selected) {
                    MaterialTheme.typography.bodyLargeEmphasized
                } else {
                    MaterialTheme.typography.bodyLarge
                },
                color = content,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (selected) content.copy(alpha = 0.75f) else scheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        trailing?.invoke(this)
    }
}

/**
 * A panel: the region every screen is divided into.
 *
 * Tone rather than a border. [tone] steps it up or down the container ramp for
 * the rare case where two panels sit against each other and need telling apart.
 */
@Composable
fun Panel(
    modifier: Modifier = Modifier,
    tone: Color = MaterialTheme.colorScheme.surfaceContainer,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .clip(MaterialTheme.shapes.extraLarge)
            .background(tone),
    ) {
        content()
    }
}

/**
 * An icon that is a button.
 *
 * The expressive icon button morphs between a round resting shape and a squarer
 * pressed one, so this hands the toolkit a shape *set* rather than a corner.
 * [prominent] fills it tonally, for the one action in a group that matters.
 *
 * [compact] is the 40dp size, for a button that lives *inside* something - the
 * composer's well - where the 56dp default sets the height of whatever it is
 * in. Still over the 48dp touch target, because the button's own hit area is
 * expanded past its container.
 */
@Composable
fun IconAction(
    icon: Int,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = Color.Unspecified,
    enabled: Boolean = true,
    prominent: Boolean = false,
    compact: Boolean = false,
) {
    val resolved = if (tint == Color.Unspecified) MaterialTheme.colorScheme.onSurfaceVariant else tint
    val container =
        if (compact) IconButtonDefaults.smallContainerSize() else IconButtonDefaults.mediumContainerSize()
    val glyph = IconButtonDefaults.run { if (compact) smallIconSize else mediumIconSize }
    // No tint on the icon: it inherits the button's content colour, so pressed
    // and disabled are the toolkit's business rather than this call site's.
    val content = @Composable {
        BetweenUsIcon(icon = icon, size = glyph, contentDescription = contentDescription)
    }
    if (prominent) {
        FilledTonalIconButton(
            onClick = onClick,
            enabled = enabled,
            shapes = IconButtonDefaults.shapes(),
            modifier = modifier.size(container),
            content = content,
        )
    } else {
        IconButton(
            onClick = onClick,
            enabled = enabled,
            shapes = IconButtonDefaults.shapes(),
            colors = IconButtonDefaults.iconButtonColors(contentColor = resolved),
            modifier = modifier.size(container),
            content = content,
        )
    }
}

/**
 * What a list says when it is empty, rather than saying nothing at all.
 *
 * The icon sits inside one of the Material shapes - a cookie, not a circle -
 * because an empty state is the one screen with nothing else on it to look at,
 * and a circle there reads as a missing image.
 */
@Composable
fun EmptyState(
    icon: Int,
    title: String,
    detail: String,
    modifier: Modifier = Modifier,
    action: @Composable (() -> Unit)? = null,
) {
    val scheme = MaterialTheme.colorScheme
    Column(
        modifier = modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(96.dp)
                .clip(MaterialShapes.Cookie9Sided.toShape())
                .background(scheme.surfaceContainerHigh),
            contentAlignment = Alignment.Center,
        ) {
            BetweenUsIcon(icon, tint = scheme.onSurfaceVariant, size = 36.dp)
        }
        Spacer(Modifier.height(20.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.titleMediumEmphasized,
            color = scheme.onSurface,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = detail,
            style = MaterialTheme.typography.bodyMedium,
            color = scheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        if (action != null) {
            Spacer(Modifier.height(20.dp))
            action()
        }
    }
}

/** A pill: a role, a permission, a count. */
@Composable
fun Chip(
    text: String,
    modifier: Modifier = Modifier,
    tone: Color = Color.Unspecified,
    selected: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    val scheme = MaterialTheme.colorScheme
    FilterChip(
        selected = selected,
        onClick = { onClick?.invoke() },
        enabled = onClick != null || !selected,
        label = {
            Text(
                text = text,
                style = if (selected) {
                    MaterialTheme.typography.labelMediumEmphasized
                } else {
                    MaterialTheme.typography.labelMedium
                },
            )
        },
        shape = MaterialTheme.shapes.small,
        colors = FilterChipDefaults.filterChipColors(
            containerColor = scheme.surfaceContainerHighest,
            labelColor = if (tone == Color.Unspecified) scheme.onSurfaceVariant else tone,
            selectedContainerColor = scheme.primaryContainer,
            selectedLabelColor = scheme.onPrimaryContainer,
            disabledContainerColor = scheme.surfaceContainerHighest,
            disabledLabelColor = if (tone == Color.Unspecified) scheme.onSurfaceVariant else tone,
        ),
        border = null,
        modifier = modifier,
    )
}
