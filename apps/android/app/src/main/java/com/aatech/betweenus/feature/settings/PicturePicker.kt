package com.aatech.betweenus.feature.settings

import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.Pictures
import com.aatech.betweenus.feature.chat.ImageEditorDialog
import com.aatech.betweenus.feature.chat.readPicked
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Slate500
import kotlinx.coroutines.launch

/**
 * Choosing an avatar or a server icon.
 *
 * Both are the same job and neither existed on the phone: the API call has been
 * there all along and nothing called it, so a picture could only ever be set
 * from a desktop - on the client most likely to be holding the camera that took
 * it.
 *
 * The picture is squared and scaled here rather than on the way in, for the
 * reason the desktop does the same: these are the only objects served in the
 * clear and inline, and a member list draws a row of them. What is uploaded is
 * exactly what every other client will fetch.
 *
 * [onPicked] is handed the stored URL, and [onClear] is offered only when there
 * is something to clear - the caller decides what either means, because setting
 * an account's picture and a server's are different calls.
 */
@Composable
fun PicturePicker(
    /** Names it for a screen reader and in the failure line: "avatar", "server icon". */
    label: String,
    canClear: Boolean,
    onPicked: suspend (url: String) -> Unit,
    onClear: suspend () -> Unit,
    /** Drawn beside the buttons. Empty where the screen already shows one. */
    preview: @Composable () -> Unit = {},
    /**
     * Width over height of the frame the picture is cropped to. 1 for an avatar
     * or a server icon, [Pictures.COVER_ASPECT] for the band behind a name.
     *
     * The same number reaches the framing dialog and the stored output, because
     * somebody who moves a photograph inside a square frame and then gets a
     * wide crop of it has been shown a lie about what they were choosing.
     */
    aspect: Float = 1f,
    /** The widest the stored picture is kept. See [Pictures.COVER_WIDTH]. */
    maxWidth: Int = Pictures.PICTURE_EDGE,
) {
    val scope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current

    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }

    /**
     * The picked file, held while it is being framed. A centre crop is what
     * this used to do on its own, and it is the wrong crop for most photographs
     * of a person - who is rarely in the middle of their own picture.
     */
    var editing by remember { mutableStateOf<android.net.Uri?>(null) }

    val picker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        failure = null
        editing = uri
    }

    editing?.let { source ->
        ImageEditorDialog(
            source = source,
            title = "Frame your $label",
            aspect = aspect,
            maxOutputEdge = maxOf(Pictures.PICTURE_EDGE * 2, maxWidth),
            onCancel = { editing = null },
            onDone = { framed ->
                editing = null
                scope.launch {
                    busy = true
                    failure = runCatching {
                        val picked = readPicked(context, framed)
                        // The editor already framed it to `aspect`, so this is
                        // a scale to the stored size rather than a second crop -
                        // which is why the same aspect has to reach both.
                        val framedBytes = Pictures.framed(
                            bytes = picked.bytes,
                            maxWidth = maxWidth,
                            aspect = aspect,
                            format = Bitmap.CompressFormat.WEBP,
                        ) ?: error("That file could not be read as a picture")
                        val stored =
                            BetweenUsApi.uploadPicture(framedBytes, "picture.webp", "image/webp")
                        onPicked(stored.url)
                    }.exceptionOrNull()?.message
                    busy = false
                }
            },
        )
    }

    // A square preview sits beside its buttons; a 4:1 band cannot, so a cover
    // stacks instead of trying to share a row with them.
    val wide = aspect != 1f
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (!wide) preview()

        Column {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip(
                    text = if (busy) "Working…" else "Change $label",
                    onClick = {
                        if (busy) return@Chip
                        failure = null
                        picker.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                        )
                    },
                )
                if (canClear) {
                    Chip(
                        text = "Remove",
                        tone = Danger,
                        onClick = {
                            if (busy) return@Chip
                            scope.launch {
                                busy = true
                                failure = runCatching { onClear() }.exceptionOrNull()?.message
                                busy = false
                            }
                        },
                    )
                }
            }

            failure?.let {
                Spacer(Modifier.height(6.dp))
                Text(text = it, style = MaterialTheme.typography.bodySmall, color = Danger)
            }
            if (failure == null) {
                Spacer(Modifier.height(6.dp))
                Text(
                    text = if (wide) {
                        "Framed to ${aspect.toInt()}:1 and stored ${maxWidth}px wide. " +
                            "Not encrypted: a $label is drawn for people who hold no key."
                    } else {
                        "Squared and stored at ${maxWidth}px. Not encrypted: " +
                            "a $label is drawn for people who hold no key."
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate500,
                )
            }
        }
    }
}
