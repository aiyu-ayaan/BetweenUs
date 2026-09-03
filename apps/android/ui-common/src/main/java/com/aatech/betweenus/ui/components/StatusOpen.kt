package com.aatech.betweenus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.annotation.DrawableRes
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog

/**
 * Where a tap on a ringed avatar goes.
 *
 * Two small state holders rather than one, because they answer different
 * questions and are opened from different places:
 *
 * [StatusStory] is "show me this person's posts", which the tray, a ring and
 * the chooser below all ask for. The player that answers it lives in the app
 * module - this is only the door, so that an [Avatar] in this module can open
 * something it cannot import.
 *
 * [AvatarChoice] is the question a tap has to ask when there are two answers
 * behind one circle: the profile photo, or the status. Before statuses existed
 * a tap had one answer and [Avatar] simply opened it; picking one now would
 * make the ring decoration, since a tap on it would ignore the only thing it
 * was drawn to say.
 */
object StatusStory {
    /** Whose run is open, or null. */
    var authorId: String? by mutableStateOf(null)
        private set

    fun open(authorId: String) {
        this.authorId = authorId
    }

    fun close() {
        authorId = null
    }
}

/** The composer, opened from the tray and from the "My status" row. */
object StatusComposerDoor {
    var open: Boolean by mutableStateOf(false)
        private set

    fun show() {
        open = true
    }

    fun close() {
        open = false
    }
}

object AvatarChoice {
    data class Asking(
        val userId: String,
        val name: String,
        val avatarUrl: String?,
        /** How many live posts they have, for the line under the status choice. */
        val count: Int,
    )

    var asking: Asking? by mutableStateOf(null)
        private set

    fun ask(asking: Asking) {
        this.asking = asking
    }

    fun close() {
        asking = null
    }
}

/** Mounted once, at the root, beside `ProfileDialogHost`. */
@Composable
fun AvatarChoiceHost() {
    val asking = AvatarChoice.asking ?: return
    Dialog(onDismissRequest = { AvatarChoice.close() }) {
        Column(
            modifier = Modifier
                .widthIn(max = 320.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(MaterialTheme.colorScheme.surfaceContainerHigh),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(
                    id = asking.userId,
                    label = asking.name,
                    url = asking.avatarUrl,
                    size = 40.dp,
                    viewable = false,
                )
                Text(
                    text = asking.name,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 12.dp),
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Choice(
                icon = BetweenUsIcons.User,
                label = "View profile photo",
                onClick = {
                    val url = asking.avatarUrl
                    AvatarChoice.close()
                    if (url != null) ProfileViewer.open(asking.name, url)
                },
            )
            Choice(
                icon = BetweenUsIcons.Eye,
                label = "View status",
                hint = if (asking.count == 1) "1 update" else "${asking.count} updates",
                onClick = {
                    val id = asking.userId
                    AvatarChoice.close()
                    StatusStory.open(id)
                },
            )
        }
    }
}

@Composable
private fun Choice(
    @DrawableRes icon: Int,
    label: String,
    hint: String? = null,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BetweenUsIcon(icon, contentDescription = null)
        Text(
            text = label,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f).padding(start = 16.dp),
        )
        if (hint != null) {
            Text(
                text = hint,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
