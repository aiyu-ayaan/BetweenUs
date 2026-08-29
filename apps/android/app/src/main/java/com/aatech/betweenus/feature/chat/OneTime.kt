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
import androidx.compose.ui.platform.LocalContext
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

    /**
     * The author does not get to open their own one-time message.
     *
     * They sent it. It was never theirs to look at again, and a sender who can
     * re-open it on another device has a message that is one-time for exactly
     * one of the two people in the conversation - which is not what the sender
     * chose when they turned the switch on.
     *
     * The server refuses them the bytes too; this only stops the app offering
     * something that would fail. See `mayOpenOneTime` in the uploads
     * controller, which is where the guarantee actually lives.
     */
    val spent = mine || viewedByMe

    // The viewer is drawn first, and outside everything below, because it must
    // outlive the state changes its own opening causes.
    //
    // Reporting the look comes back as an updated message with this account in
    // `viewedBy`, which flips `viewedByMe` true - and the card used to return
    // early on that, so the dialog was dropped a second or two after it opened.
    // That is what "it closes itself" was. Whether this account has looked
    // decides what the *card* says; it has nothing to do with whether a viewer
    // that is already open stays open.
    if (open) {
        OneTimeViewer(
            channelId = channelId,
            attachments = attachments,
            onSpend = { Conversation.spendLook(messageId) },
            onDismiss = {
                open = false
                // Now it may go, if the server said so while it was open.
                Conversation.releaseMessage(messageId)
            },
        )
    }

    // Nothing left to open: this account has looked, or it is the author's own
    // and never was theirs to open. Somebody *else's* look does not close it -
    // a one-time message holds one for each person who can see it.
    if (spent) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            BetweenUsIcon(BetweenUsIcons.OneTime, tint = scheme.onSurfaceVariant, size = 16.dp)
            Text(
                text = if (mine) "One-time — only they can open it" else "Opened",
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
                // Held first, and burned later - by the viewer, once it
                // actually has the bytes.
                //
                // Burning from here was the bug: the burn deletes the blob
                // from the object store, and the viewer was still downloading
                // that blob. The two raced, and on a phone the download always
                // lost, so the picture never arrived at all. "You have had
                // your look" has to mean the bytes reached you, not that you
                // tapped something.
                Conversation.holdMessage(messageId)
                open = true
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
                text = "One-time — you get one look",
                style = MaterialTheme.typography.bodySmall,
                color = scheme.onSurfaceVariant,
            )
        }
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
    /**
     * Records this account's look. Awaited, and nothing is drawn until it
     * returns - a picture shown before the server has written the look down is
     * a look that was never spent.
     */
    onSpend: suspend () -> Unit,
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

        /**
         * Every file, fetched and decrypted before anything is reported as
         * seen.
         *
         * All of them, not the one on screen: burning destroys the blobs of
         * the whole message, so a second picture still to fetch when the first
         * is reported would be a picture whose bytes are already gone. One
         * message, one look, and everything in it has to arrive first.
         *
         * Held here and nowhere else - deliberately not in `MediaCache`, which
         * is keyed on the storage key and would outlive the message this whole
         * feature exists to destroy.
         */
        var loaded by remember { mutableStateOf<List<android.graphics.Bitmap?>?>(null) }
        var spentLook by remember { mutableStateOf(false) }
        var failure by remember { mutableStateOf<String?>(null) }

        val context = LocalContext.current
        LaunchedEffect(attachments) {
            runCatching {
                attachments.map { attachment ->
                    val bytes = Conversation.openAttachment(channelId, attachment)
                    if (attachment.contentType.startsWith("image/")) {
                        decodeDownsampled(bytes, MAX_DECODE_EDGE_PX)
                    } else {
                        // A video or a voice note cannot be played from a byte
                        // array, so it goes to disk under the key the ordinary
                        // players already look in - otherwise they would fetch
                        // it themselves, from a blob this look is about to
                        // destroy.
                        //
                        // It does not linger: the plaintext is removed with
                        // the message, and the removal is what `releaseMessage`
                        // applies when this viewer closes.
                        MediaCache.putVideo(
                            attachment.key,
                            cacheDecryptedMedia(context, bytes, attachment.name),
                        )
                        null
                    }
                }
            }.onSuccess { decoded ->
                loaded = decoded
                // Two orderings meet here and both matter. The burn deletes
                // the blobs, so it cannot come first - that raced the download
                // and lost. And the picture cannot come first either: drawing
                // it and then recording is a look spent only if the write
                // happened to succeed, which is one look on a good network
                // rather than one look.
                //
                // So: fetch, record, draw. A failure draws nothing and spends
                // nothing, and the person may try again - the server has no
                // row for it, so nothing has been taken from them.
                runCatching { onSpend() }
                    .onSuccess { spentLook = true }
                    .onFailure {
                        failure = "That could not be opened. Nothing has been used up — try again."
                    }
            }.onFailure {
                failure = "That could not be opened"
            }
        }

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
                when {
                    failure != null -> Text(
                        text = failure.orEmpty(),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                    )

                    loaded == null || !spentLook -> Text(
                        text = "Decrypting…",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.White.copy(alpha = 0.7f),
                    )

                    else -> OneTimeMedia(channelId, current, loaded?.getOrNull(index))
                }

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

/**
 * One file inside the viewer.
 *
 * Handed its bitmap rather than fetching one: the viewer above has already
 * downloaded and decrypted every file, because reporting the look is what
 * destroys the blobs and nothing may still be waiting on them when it does.
 */
@Composable
private fun OneTimeMedia(
    channelId: String,
    attachment: MessageAttachment,
    bitmap: android.graphics.Bitmap?,
) {
    val isImage = attachment.contentType.startsWith("image/")
    // A local binding rather than the parameter: a nullable parameter cannot
    // be smart-cast across the branches below.
    val drawable = bitmap

    when {
        isImage && drawable == null -> Text(
            text = "That could not be drawn",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
        )

        isImage && drawable != null -> Image(
            bitmap = drawable.asImageBitmap(),
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxWidth(),
        )

        // A voice note, played in place. It reads the decrypted file the
        // prefetch above already put in `MediaCache`, so nothing here goes
        // back to a blob this look has destroyed.
        attachment.isAudio -> VoiceMessage(
            channelId = channelId,
            attachment = attachment,
            author = null,
            mine = false,
            fileName = attachment.name.takeUnless { attachment.isVoiceNote },
        )

        // Video: the ordinary card, inside a secure window, playing the file
        // the prefetch wrote rather than fetching one of its own.
        else -> {
            Spacer(Modifier.height(8.dp))
            AttachmentCard(channelId, attachment, { _, _ -> }, { _, _ -> })
        }
    }
}
