package com.aatech.betweenus.feature.chat

import android.media.MediaPlayer
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.MessageAttachment
import com.aatech.betweenus.core.data.UserSummary
import com.aatech.betweenus.core.store.Conversation
import com.aatech.betweenus.ui.components.Avatar
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import kotlin.math.roundToInt

/**
 * A voice message, drawn as one.
 *
 * What this replaces was the generic file card: an icon, a filename that is a
 * timestamp, "95 KB · Tap to decrypt", and a download button. Every part of it
 * was wrong for somebody talking - nobody wants to read
 * `voice_20260830_011311.ogg`, nobody wants to press download and then press
 * play, and the card announces "here is a file" when what arrived was a voice.
 *
 * So: a play button, the shape of the recording, and how long it is. The
 * waveform is the seek bar, because it is already a picture of the timeline and
 * a slider under it would be the same axis drawn twice.
 *
 * The bars are measured on the sender while the message is being recorded and
 * travel inside the encrypted manifest - see [MessageAttachment.waveform]. That
 * is what lets the shape be on screen before the audio has been fetched, which
 * is the whole reason to draw one.
 *
 * `MediaPlayer` rather than the Media3 player the video viewer uses: this is a
 * few seconds of speech from a local file with no surface, no transitions and
 * no controls of its own, which is the one job `MediaPlayer` is still the right
 * size for.
 */
@Composable
fun VoiceMessage(
    channelId: String,
    attachment: MessageAttachment,
    author: UserSummary?,
    mine: Boolean,
) {
    val context = LocalContext.current
    val scheme = MaterialTheme.colorScheme

    var player by remember(attachment.key) { mutableStateOf<MediaPlayer?>(null) }
    var playing by remember(attachment.key) { mutableStateOf(false) }
    var at by remember(attachment.key) { mutableFloatStateOf(0f) }
    var failed by remember(attachment.key) { mutableStateOf(false) }
    /**
     * The length the player reports, once there is one.
     *
     * Preferred over the manifest's number because it is what the seek maths
     * has to agree with - a bar tapped at 40% has to land at 40% of what will
     * actually play. The manifest's value is what gets drawn before there is a
     * player at all, which is most of the time this is on screen.
     */
    var measured by remember(attachment.key) { mutableStateOf<Float?>(null) }

    val bars = attachment.waveform.ifEmpty { PLACEHOLDER }
    val total = measured ?: attachment.duration ?: 0f

    /**
     * Fetched, decrypted and prepared as soon as the row is drawn, without
     * being asked.
     *
     * A voice message is seconds long and tens of kilobytes. Making somebody
     * tap download, wait, and then tap play is three interactions for
     * something that should be one - and the download button was the honest
     * answer only while the alternative was spending a video's worth of
     * somebody's connection on a message they scrolled past. That is not this.
     *
     * Keyed on the attachment, so a `LazyColumn` recycling this row does not
     * re-fetch: `MediaCache` already holds the decrypted file from the first
     * time it was on screen.
     */
    LaunchedEffect(attachment.key) {
        val uri = MediaCache.video(attachment.key) ?: runCatching {
            val bytes = Conversation.openAttachment(channelId, attachment)
            cacheDecryptedMedia(context, bytes, attachment.name)
        }.onFailure { failed = true }.getOrNull() ?: return@LaunchedEffect

        // Cached under the same key the pictures use. The file is on disk
        // either way, and this is what stops a scroll past re-decrypting it.
        MediaCache.putVideo(attachment.key, uri)

        runCatching {
            MediaPlayer().apply {
                setDataSource(context, uri)
                setOnPreparedListener { prepared ->
                    measured = prepared.duration / 1000f
                }
                setOnCompletionListener {
                    playing = false
                    // Back to the start, so the next tap replays rather than
                    // doing nothing - and so the waveform empties again.
                    at = 0f
                    runCatching { seekTo(0) }
                }
                prepare()
            }
        }.onSuccess { player = it }.onFailure { failed = true }
    }

    // A player holds a codec and an open file. Leaving the conversation has to
    // give both back, or a long scroll through a channel of voice messages is
    // a slow leak of decoder instances.
    DisposableEffect(attachment.key) {
        onDispose {
            runCatching { player?.release() }
            player = null
        }
    }

    // The position, while it is moving. One loop while playing and none at all
    // the rest of the time.
    LaunchedEffect(playing) {
        while (playing) {
            at = (player?.currentPosition ?: 0) / 1000f
            kotlinx.coroutines.delay(60)
        }
    }

    fun toggle() {
        val current = player ?: return
        if (current.isPlaying) {
            current.pause()
            playing = false
        } else {
            current.start()
            playing = true
        }
    }

    fun seekToFraction(fraction: Float) {
        val current = player ?: return
        val clamped = fraction.coerceIn(0f, 1f)
        val target = (clamped * (measured ?: return) * 1000).roundToInt()
        current.seekTo(target)
        at = target / 1000f
    }

    val accent = if (mine) scheme.primary else scheme.onSurface
    val spent = if (total > 0f) ((at / total).coerceIn(0f, 1f) * bars.size).roundToInt() else 0

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(scheme.surfaceContainerHigh)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (author != null) {
            Box {
                Avatar(author.id, author.label, author.avatarUrl, size = 40.dp)
                // The mark that says what kind of message this is, on the one
                // part of the bubble that is otherwise just a face.
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .size(16.dp)
                        .clip(CircleShape)
                        .background(scheme.surfaceContainerHigh),
                    contentAlignment = Alignment.Center,
                ) {
                    BetweenUsIcon(BetweenUsIcons.Mic, tint = accent, size = 11.dp)
                }
            }
        }

        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(CircleShape)
                .pointerInput(player) { detectTapGestures { toggle() } },
            contentAlignment = Alignment.Center,
        ) {
            BetweenUsIcon(
                if (playing) BetweenUsIcons.Pause else BetweenUsIcons.Play,
                tint = if (player == null) scheme.onSurfaceVariant else scheme.onSurface,
                size = 22.dp,
            )
        }

        Column(Modifier.weight(1f)) {
            // The waveform *is* the seek bar. A slider underneath would be the
            // same axis drawn twice.
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(28.dp)
                    .pointerInput(player, measured) {
                        detectTapGestures { offset ->
                            seekToFraction(offset.x / size.width)
                        }
                    }
                    .pointerInput(player, measured) {
                        detectHorizontalDragGestures { change, _ ->
                            seekToFraction(change.position.x / size.width)
                        }
                    },
                contentAlignment = Alignment.CenterStart,
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    bars.forEachIndexed { index, height ->
                        Box(
                            Modifier
                                .weight(1f)
                                // A floor in dp as well as in the data: a bar
                                // rounded below a pixel disappears, and a
                                // waveform with holes reads as a damaged file.
                                .height((2f + height.coerceIn(0f, 1f) * 22f).dp)
                                .clip(RoundedCornerShape(1.dp))
                                .background(
                                    if (index < spent) accent else scheme.onSurfaceVariant.copy(alpha = 0.4f),
                                ),
                        )
                    }
                }
            }

            Spacer(Modifier.height(2.dp))

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    // While it is playing, how far in; otherwise how long it
                    // is. Both are the number somebody wants at that moment,
                    // and "0:00 / 0:07" is showing one of them twice.
                    text = VoiceNote.formatDuration(if (playing || at > 0f) at else total),
                    style = MaterialTheme.typography.bodySmall,
                    color = scheme.onSurfaceVariant,
                )
                if (failed || player == null) {
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = if (failed) "Could not be opened" else "Decrypting…",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (failed) scheme.error else scheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/**
 * What to draw when the sender's client never measured a waveform - audio
 * picked off the phone, or a message sent before waveforms existed.
 *
 * A gentle repeating shape rather than a flat line or random noise. Flat reads
 * as a broken file; random reads as a real waveform and is a lie about where
 * the loud parts are. This is visibly a placeholder and still gives the finger
 * something to aim at.
 */
private val PLACEHOLDER: List<Float> =
    List(VoiceNote.WAVEFORM_BARS) { index ->
        0.35f + 0.25f * kotlin.math.sin(index / 2.2f)
    }
