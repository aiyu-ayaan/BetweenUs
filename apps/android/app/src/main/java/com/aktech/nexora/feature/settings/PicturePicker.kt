package com.aktech.nexora.feature.settings

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
import com.aktech.nexora.core.data.NexoraApi
import com.aktech.nexora.core.data.Pictures
import com.aktech.nexora.feature.chat.readPicked
import com.aktech.nexora.ui.components.Chip
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Slate500
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
    preview: @Composable () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current

    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }

    val picker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            busy = true
            failure = runCatching {
                val picked = readPicked(context, uri)
                val square = Pictures.square(
                    bytes = picked.bytes,
                    edge = Pictures.PICTURE_EDGE,
                    format = Bitmap.CompressFormat.WEBP,
                ) ?: error("That file could not be read as a picture")
                val stored = NexoraApi.uploadPicture(square, "picture.webp", "image/webp")
                onPicked(stored.url)
            }.exceptionOrNull()?.message
            busy = false
        }
    }

    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        preview()

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
                    text = "Squared and stored at ${Pictures.PICTURE_EDGE}px. Not encrypted: " +
                        "a $label is drawn for people who hold no key.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate500,
                )
            }
        }
    }
}
