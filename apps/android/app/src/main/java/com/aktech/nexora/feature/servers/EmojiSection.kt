package com.aktech.nexora.feature.servers

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.aktech.nexora.core.data.Endpoint
import com.aktech.nexora.core.data.NexoraApi
import com.aktech.nexora.core.data.Pictures
import com.aktech.nexora.core.data.ServerEmoji
import com.aktech.nexora.feature.chat.readPicked
import com.aktech.nexora.ui.components.Chip
import com.aktech.nexora.ui.components.IconAction
import com.aktech.nexora.ui.components.ListRow
import com.aktech.nexora.ui.components.NexoraField
import com.aktech.nexora.ui.components.NexoraIcon
import com.aktech.nexora.ui.components.NexoraIcons
import com.aktech.nexora.ui.components.SectionLabel
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Slate500
import kotlinx.coroutines.launch

/** A picker is a grid somebody looks through; past a couple of hundred it stops being one. */
private const val MAX_SERVER_EMOJI = 200

/** Two to thirty-two lowercase letters, digits or underscores - `EMOJI_NAME_PATTERN`. */
private val NAME_PATTERN = Regex("^[a-z0-9_]{2,32}$")

/**
 * A server's own emoji.
 *
 * This client could draw them and not add them, so the set could only ever have
 * been filled in from a desktop.
 *
 * They are stored in the clear, like avatars and for the same reason: an emoji
 * is drawn by an image request a hundred times a screen, and an image request
 * cannot carry a channel key. That is stated on the screen rather than left for
 * somebody to assume otherwise.
 */
@Composable
fun EmojiSection(serverId: String, mayManage: Boolean, onNote: (String?) -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var emoji by remember(serverId) { mutableStateOf<List<ServerEmoji>?>(null) }
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    suspend fun reload() {
        emoji = runCatching { NexoraApi.serverEmoji(serverId) }.getOrNull().orEmpty()
    }

    LaunchedEffect(serverId) { reload() }

    val picker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            busy = true
            onNote(
                runCatching {
                    val picked = readPicked(context, uri)
                    val wanted = name.trim().ifBlank { stemOf(picked.name) }.lowercase()
                    require(NAME_PATTERN.matches(wanted)) {
                        "A name is two to thirty-two lowercase letters, digits or underscores"
                    }

                    // An animated file goes up exactly as it came. Re-encoding
                    // one keeps its first frame and throws the rest away, which
                    // is the whole of what somebody uploading it wanted.
                    val animated = Pictures.isAnimated(picked.contentType)
                    val bytes = if (animated) {
                        picked.bytes
                    } else {
                        Pictures.square(picked.bytes)
                            ?: error("That file could not be read as a picture")
                    }
                    require(bytes.size <= Pictures.MAX_EMOJI_BYTES) {
                        "That is ${bytes.size / 1024} KB. An emoji has to be under " +
                            "${Pictures.MAX_EMOJI_BYTES / 1024} KB - it is drawn at 22 pixels."
                    }

                    val stored = NexoraApi.uploadPicture(bytes, picked.name, picked.contentType)
                    NexoraApi.addServerEmoji(serverId, wanted, stored.url, animated)
                    name = ""
                    reload()
                    null
                }.exceptionOrNull()?.message,
            )
            busy = false
        }
    }

    SectionLabel("Emoji")

    Column(Modifier.padding(horizontal = 16.dp)) {
        Text(
            text = "Pictures this server can type by name. A GIF or an animated WebP stays " +
                "animated. They are public, like avatars: an emoji is drawn by an image " +
                "request, and an image request cannot carry a key.",
            style = MaterialTheme.typography.bodySmall,
            color = Slate500,
        )

        if (mayManage) {
            Spacer(Modifier.height(10.dp))
            NexoraField(
                label = "Name",
                value = name,
                onValueChange = { name = it.lowercase() },
                placeholder = "party_parrot",
                imeAction = ImeAction.Done,
                enabled = !busy,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Left empty, the file's own name is used.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
            )
            Spacer(Modifier.height(10.dp))
            Chip(
                text = if (busy) "Uploading…" else "Pick a picture",
                onClick = {
                    if (busy) return@Chip
                    if (emoji.orEmpty().size >= MAX_SERVER_EMOJI) {
                        onNote("This server already holds $MAX_SERVER_EMOJI emoji")
                        return@Chip
                    }
                    picker.launch(
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                    )
                },
            )
        }
    }

    val list = emoji
    when {
        list == null -> ListRow(title = "Loading emoji", leading = { NexoraIcon(NexoraIcons.Smile) })
        list.isEmpty() -> ListRow(
            title = "No emoji yet",
            subtitle = "Add one and it can be typed as :name:",
            leading = { NexoraIcon(NexoraIcons.Smile) },
        )
        else -> list.forEach { one ->
            ListRow(
                title = ":${one.name}:",
                subtitle = if (one.animated) "Animated" else null,
                leading = {
                    AsyncImage(
                        model = Endpoint.absolute(one.url),
                        contentDescription = one.name,
                        modifier = Modifier.size(24.dp),
                    )
                },
                trailing = {
                    if (mayManage) {
                        IconAction(NexoraIcons.Trash, "Remove this emoji", tint = Danger, onClick = {
                            scope.launch {
                                busy = true
                                onNote(
                                    runCatching {
                                        NexoraApi.removeServerEmoji(serverId, one.id)
                                        reload()
                                    }.exceptionOrNull()?.message,
                                )
                                busy = false
                            }
                        })
                    }
                },
            )
        }
    }
}

/** `party_parrot.png` as `party_parrot`, which is the name somebody meant. */
private fun stemOf(fileName: String): String =
    fileName.substringBeforeLast('.').replace(Regex("[^A-Za-z0-9_]"), "_")
