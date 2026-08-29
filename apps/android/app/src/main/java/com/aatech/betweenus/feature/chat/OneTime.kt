package com.aatech.betweenus.feature.chat

import android.view.WindowManager
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.compose.foundation.Image
import com.aatech.betweenus.core.data.MessageAttachment
import com.aatech.betweenus.core.store.Conversation
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons

/**
 * A one-time message in the conversation, and the viewer behind it.
 *
 * Three states, and the middle one is the feature. Before: a card naming what
 * is inside, deliberately not a thumbnail - a thumbnail is a look, and it
 * would be a look nobody chose to spend. During: a viewer with the ordinary
 * affordances removed. After: a line saying it is gone, which is all that is
 * left, because the server destroyed the row and the blobs the moment the
 * viewer opened.
 *
 * The author is not a viewer. Somebody re-reading what they themselves sent
 * has not spent anybody's one look, so their own copy opens as often as they
 * like and burns nothing - and the server agrees, which is what makes that
 * safe rather than a client-side courtesy.
 *
 * ## What "protected" can and cannot mean here
 *
 * The viewer sets `FLAG_SECURE` on the window, which is the strongest thing
 * Android offers: the screenshot gesture fails, the screen recorder captures
 * black, the app does not appear in the recents thumbnail, and the window
 * refuses to render onto a non-secure external display. It is real, it is
 * enforced by the platform rather than by this app, and it is more than a
 * desktop can do.
 *
 * It is still not a guarantee, and the copy on screen says so. A second phone
 * pointed at the first one defeats it and always will, and no amount of DRM on
 * a device somebody physically holds changes that. What this feature honestly
 * provides is that the file stops existing - on the server, in the object
 * store, and in every client's cache - the moment it has been seen once.
 */
@Composable
fun OneTimeCard(
    channelId: String,
    messageId: String,
    attachments: List<MessageAttachment>,
    /** Whether *this account* has already spent its look. One look each. */
    viewedByMe: Boolean,
    mine: Boolean,
) {
    val scheme = MaterialTheme.colorScheme
    var open by remember(messageId) { mutableStateOf(false) }

    // This account has already looked. Somebody else's look does not close it -
    // a one-time message holds one for each person who can see it, and being
    // told "Opened" for something never shown is what that used to mean here.
    if (viewedByMe && !mine) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            BetweenUsIcon(BetweenUsIcons.OneTime, tint = scheme.onSurfaceVariant, size = 16.dp)
            Text(
                text = "Opened",
                style = MaterialTheme.typography.bodyMedium,
                color = scheme.onSurfaceVariant,
            )
        }
        return
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(scheme.primary.copy(alpha = 0.08f))
            .border(1.dp, scheme.primary.copy(alpha = 0.4f), RoundedCornerShape(12.dp))
            .clickable {
                open = true
                // Held before the burn, not after. Burning is what opening
                // *means* - closing the viewer is not a promise anybody can
                // keep, a phone can be killed and a battery can go - so the
                // server destroys the row while the viewer is still open, and
                // without the hold the row's removal took the viewer down with
                // it. That was the picture vanishing the instant it was
                // opened.
                Conversation.holdMessage(messageId)
                if (!mine) Conversation.burn(messageId)
            }
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        BetweenUsIcon(BetweenUsIcons.OneTime, tint = scheme.primary, size = 26.dp)
        Column(Modifier.weight(1f)) {
            Text(
                text = describeOneTime(attachments),
                style = MaterialTheme.typography.bodyMedium,
                color = scheme.onSurface,
            )
            Text(
                text = if (mine) {
                    "One-time — they get one look"
                } else {
                    "One-time — opening it uses your one look"
                },
                style = MaterialTheme.typography.bodySmall,
                color = scheme.onSurfaceVariant,
            )
        }
    }

    if (open) {
        OneTimeViewer(
            channelId = channelId,
            attachments = attachments,
            onDismiss = {
                open = false
                // Now it may go, if the server said so while it was open.
                Conversation.releaseMessage(messageId)
            },
        )
    }
}

/** What is inside, said in the words a person would use for it. */
fun describeOneTime(attachments: List<MessageAttachment>): String {
    val kinds = attachments.map { attachment ->
        when {
            attachment.contentType.startsWith("image/") -> "Photo"
            attachment.contentType.startsWith("video/") -> "Video"
            attachment.contentType.startsWith("audio/") -> "Voice message"
            else -> "File"
        }
    }.toSet()
    val only = if (kinds.size == 1) kinds.first() else "File"
    return if (attachments.size > 1) "${attachments.size} ${only.lowercase()}s" else only
}

/**
 * The viewer, behind `FLAG_SECURE`.
 *
 * The flag is set on the dialog's own window and cleared when it closes, so it
 * covers exactly the moment the picture is on screen and does not leave the
 * rest of the app unable to be screenshotted. See the note above for what it
 * does and does not buy.
 */
@Composable
private fun OneTimeViewer(
    channelId: String,
    attachments: List<MessageAttachment>,
    onDismiss: () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        DisposableEffect(window) {
            window?.setFlags(
                WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE,
            )
            onDispose { window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
        }

        var at by remember { mutableStateOf(0) }
        val index = at.coerceIn(0, attachments.lastIndex)
        val current = attachments[index]

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.94f))
                .clickable(onClick = onDismiss),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                OneTimeMedia(channelId, current)

                if (attachments.size > 1) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        attachments.forEachIndexed { position, _ ->
                            Box(
                                Modifier
                                    .size(8.dp)
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(
                                        if (position == index) Color.White
                                        else Color.White.copy(alpha = 0.3f),
                                    )
                                    .clickable { at = position },
                            )
                        }
                    }
                }

                // Said plainly. Screenshots really are blocked here - Android
                // enforces it - but a second phone pointed at this one is not,
                // and a viewer that implied otherwise would be lying to the
                // person who decided what to send.
                Text(
                    text = "This is gone once you close it. Screenshots are blocked, but " +
                        "another camera is not — only send what you would trust them with.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = 0.6f),
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

/** One file inside the viewer: decrypted here, never written anywhere. */
@Composable
private fun OneTimeMedia(channelId: String, attachment: MessageAttachment) {
    val scheme = MaterialTheme.colorScheme
    var bitmap by remember(attachment.key) { mutableStateOf<android.graphics.Bitmap?>(null) }
    var failed by remember(attachment.key) { mutableStateOf(false) }

    val isImage = attachment.contentType.startsWith("image/")

    // Decrypted here and held nowhere. Deliberately not put in `MediaCache`,
    // unlike every other picture: this one is about to stop existing, and a
    // copy in a cache keyed on the storage key would outlive the message that
    // the whole feature exists to destroy.
    LaunchedEffect(attachment.key) {
        if (!isImage) return@LaunchedEffect
        runCatching { Conversation.openAttachment(channelId, attachment) }
            .onSuccess { bytes -> bitmap = decodeDownsampled(bytes, MAX_DECODE_EDGE_PX) }
            .onFailure { failed = true }
    }

    when {
        failed -> Text(
            text = "That could not be opened",
            style = MaterialTheme.typography.bodyMedium,
            color = scheme.error,
        )

        isImage && bitmap == null -> Text(
            text = "Decrypting…",
            style = MaterialTheme.typography.bodyMedium,
            color = Color.White.copy(alpha = 0.7f),
        )

        isImage -> Image(
            bitmap = bitmap!!.asImageBitmap(),
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxWidth(),
        )

        // Video and audio: the ordinary player, inside a secure window. It has
        // no download affordance of its own, and the file it is playing is
        // already gone from the server by the time this is on screen.
        else -> {
            Spacer(Modifier.height(8.dp))
            AttachmentCard(channelId, attachment, { _, _ -> }, { _, _ -> })
        }
    }
}
