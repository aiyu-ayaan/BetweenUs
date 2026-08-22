package com.aatech.betweenus.ui.components

import androidx.annotation.DrawableRes
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.ui.R
import com.aatech.betweenus.ui.theme.Accent
import com.aatech.betweenus.ui.theme.Edge
import com.aatech.betweenus.ui.theme.Slate400

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
    val Check = R.drawable.ic_check
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
    val Palette = R.drawable.ic_palette
    val Paperclip = R.drawable.ic_paperclip
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
 */
@Composable
fun BetweenUsIcon(
    @DrawableRes icon: Int,
    modifier: Modifier = Modifier,
    tint: Color = Slate400,
    size: Dp = 20.dp,
    contentDescription: String? = null,
) {
    Icon(
        painter = painterResource(icon),
        contentDescription = contentDescription,
        tint = tint,
        modifier = modifier.size(size),
    )
}

@Composable
fun BetweenUsLogo(modifier: Modifier = Modifier, tint: Color = Accent, size: Dp = 24.dp) {
    BetweenUsIcon(BetweenUsIcons.Logo, modifier, tint, size)
}

/** The logo in the rounded accent tile every entry screen opens with. */
@Composable
fun BetweenUsLogoTile(modifier: Modifier = Modifier, size: Int = 48) {
    Box(
        modifier = modifier
            .size(size.dp)
            .border(1.dp, Edge, RoundedCornerShape(12.dp))
            .background(Accent.copy(alpha = 0.15f), RoundedCornerShape(12.dp)),
        contentAlignment = Alignment.Center,
    ) {
        BetweenUsLogo(size = (size * 0.55f).dp)
    }
}

@Composable
fun GlobeIcon(modifier: Modifier = Modifier, tint: Color) {
    BetweenUsIcon(BetweenUsIcons.Globe, modifier, tint, 16.dp)
}
