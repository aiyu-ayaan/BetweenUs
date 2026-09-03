package com.aatech.betweenus.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.ui.R

/**
 * The icon set, converted from `apps/desktop/src/components/icons.tsx` - the
 * same Lucide geometry at the same 24-unit viewport, so the three clients draw
 * the same marks rather than three sets that nearly agree.
 *
 * Generated from that file rather than redrawn; regenerate when it changes.
 */
object BetweenUsIcons {
    val Activity = R.drawable.ic_activity
    val Bell = R.drawable.ic_bell
    val BellOff = R.drawable.ic_bell_off
    val Block = R.drawable.ic_block
    val Check = R.drawable.ic_check
    val Clock = R.drawable.ic_clock
    val ChevronDown = R.drawable.ic_chevron_down
    val ChevronLeft = R.drawable.ic_chevron_left
    val ChevronRight = R.drawable.ic_chevron_right
    val Compass = R.drawable.ic_compass
    val Copy = R.drawable.ic_copy
    val Crop = R.drawable.ic_crop
    val Download = R.drawable.ic_download
    val Eye = R.drawable.ic_eye
    val File = R.drawable.ic_file
    val Globe = R.drawable.ic_globe
    val Hash = R.drawable.ic_hash
    val Image = R.drawable.ic_image
    val LayoutBottom = R.drawable.ic_layout_bottom
    val LayoutSidebar = R.drawable.ic_layout_sidebar
    val Lock = R.drawable.ic_lock
    val LogOut = R.drawable.ic_log_out
    val Maximize = R.drawable.ic_maximize
    val Message = R.drawable.ic_message
    val Mic = R.drawable.ic_mic
    val MicOff = R.drawable.ic_mic_off
    val Minimize = R.drawable.ic_minimize
    val Monitor = R.drawable.ic_monitor
    /** The empty moments tray. Not a 24-unit icon: see the drawable. */
    val MomentsEmpty = R.drawable.ic_moments_empty
    val More = R.drawable.ic_more_vertical
    val OneTime = R.drawable.ic_one_time
    val Palette = R.drawable.ic_palette
    val Paperclip = R.drawable.ic_paperclip
    val Pause = R.drawable.ic_pause
    val Pencil = R.drawable.ic_pencil
    val Phone = R.drawable.ic_phone
    val Pin = R.drawable.ic_pin
    val Pip = R.drawable.ic_pip
    val Play = R.drawable.ic_play
    val Plus = R.drawable.ic_plus
    val Reply = R.drawable.ic_reply
    val RotateLeft = R.drawable.ic_rotate_left
    val RotateRight = R.drawable.ic_rotate_right
    val ScreenShare = R.drawable.ic_screen_share
    val Search = R.drawable.ic_search
    val Send = R.drawable.ic_send
    val Settings = R.drawable.ic_settings
    val Shield = R.drawable.ic_shield
    val Smile = R.drawable.ic_smile
    val Speaker = R.drawable.ic_speaker
    val Trash = R.drawable.ic_trash
    val User = R.drawable.ic_user
    val UserPlus = R.drawable.ic_user_plus
    val Users = R.drawable.ic_users
    val Video = R.drawable.ic_video
    val VideoOff = R.drawable.ic_video_off
    val X = R.drawable.ic_x
    val Logo = R.drawable.ic_betweenus_logo
}

/**
 * One icon. The default size is 20dp because that is what reads correctly next
 * to 14sp body text; a tap target is made by the thing around it, never by
 * growing the glyph.
 *
 * The default tint resolves from [tint] if provided, or from [LocalContentColor]
 * if explicitly set to a valid non-black content color, falling back to
 * [MaterialTheme.colorScheme.onSurfaceVariant] so icons always have appropriate
 * contrast and never default to invisible black on dark backgrounds.
 */
@Composable
fun BetweenUsIcon(
    @DrawableRes icon: Int,
    modifier: Modifier = Modifier,
    tint: Color = Color.Unspecified,
    size: Dp = 20.dp,
    contentDescription: String? = null,
) {
    val currentContent = LocalContentColor.current
    val resolvedTint = when {
        tint != Color.Unspecified -> tint
        currentContent != Color.Unspecified && currentContent != Color.Black -> currentContent
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Icon(
        painter = painterResource(icon),
        contentDescription = contentDescription,
        tint = resolvedTint,
        modifier = modifier.size(size),
    )
}

@Composable
fun BetweenUsLogo(
    modifier: Modifier = Modifier,
    tint: Color = MaterialTheme.colorScheme.primary,
    size: Dp = 24.dp,
) {
    BetweenUsIcon(BetweenUsIcons.Logo, modifier, tint, size)
}

/**
 * The logo in the tile every entry screen opens with.
 *
 * A cookie rather than a rounded square. It is the first thing anybody sees of
 * this app, it is the one moment with nothing else on screen to compete with,
 * and Material's own shape set is what says "expressive" before a single word
 * has been read.
 */
@Composable
fun BetweenUsLogoTile(modifier: Modifier = Modifier, size: Int = 64) {
    Box(
        modifier = modifier
            .size(size.dp)
            .clip(MaterialShapes.Cookie12Sided.toShape())
            .background(MaterialTheme.colorScheme.primaryContainer),
        contentAlignment = Alignment.Center,
    ) {
        BetweenUsLogo(
            tint = MaterialTheme.colorScheme.onPrimaryContainer,
            size = (size * 0.45f).dp,
        )
    }
}

@Composable
fun GlobeIcon(modifier: Modifier = Modifier, tint: Color) {
    BetweenUsIcon(BetweenUsIcons.Globe, modifier, tint, 16.dp)
}
