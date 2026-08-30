package com.aatech.betweenus.feature.chat

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.aatech.betweenus.feature.settings.BetweenUsPermissions
import com.aatech.betweenus.feature.settings.rememberAnyPermission
import com.aatech.betweenus.feature.settings.rememberPermission
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.theme.Accent
import com.aatech.betweenus.ui.theme.Edge
import com.aatech.betweenus.ui.theme.Ground
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate300
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.Surface700

/**
 * How many files one message may carry.
 *
 * The same number every client uses - `MAX_ATTACHMENTS_PER_MESSAGE` in
 * `packages/shared-types`, and the two have to agree. Past it the manifest
 * inside the encrypted envelope outgrows the length the server will store, and
 * a message the picker was happy to build comes back refused. Enforced here,
 * where the files are chosen and a refusal can be explained, rather than at the
 * end of an upload.
 */
const val MAX_ATTACHMENTS = 10

/**
 * WhatsApp-style media and attachment picker bottom sheet.
 *
 * Provides quick actions to send:
 *   - Document: browse any file, document, pdf
 *   - Camera: instant camera capture
 *   - Gallery: system visual media picker (images & videos)
 *   - Audio: audio files
 *
 * Plus an inline recent photos & videos grid for instant 1-tap or multi-select attachments.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttachmentSheet(
    onDismiss: () -> Unit,
    onPicked: (List<Uri>) -> Unit,
    /**
     * How many more files this message can take, counting what is already
     * waiting in the preview - the sheet is opened from there as well as from
     * the composer, so it cannot assume it is starting from nothing.
     */
    room: Int = MAX_ATTACHMENTS,
) {
    val context = LocalContext.current
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var media by remember { mutableStateOf<List<MediaItem>>(emptyList()) }
    var selected by remember { mutableStateOf<List<Uri>>(emptyList()) }
    /** Set when a tap was refused because [room] is already spoken for. */
    var full by remember { mutableStateOf(false) }
    var allowed by remember {
        mutableStateOf(BetweenUsPermissions.anyGranted(context, BetweenUsPermissions.MEDIA))
    }

    val access = rememberAnyPermission(BetweenUsPermissions.MEDIA) { allowed = true }

    LaunchedEffect(allowed) {
        if (allowed) media = recentMedia(context)
    }

    LaunchedEffect(Unit) {
        if (!allowed) access.request()
    }

    /**
     * The one door out of this sheet, so the cap is applied once however the
     * files were chosen: the system gallery stops at it itself, the document
     * and audio pickers have no way of being told about it.
     */
    fun finish(uris: List<Uri>) {
        if (uris.isNotEmpty()) onPicked(uris.take(room))
        onDismiss()
    }

    // Told the real remaining count, so it refuses the eleventh tap rather than
    // letting somebody choose fifteen and quietly handing back ten. The
    // contract will not take a maximum below two, which is what the single-item
    // picker underneath is for.
    val gallery = rememberLauncherForActivityResult(
        remember(room) { ActivityResultContracts.PickMultipleVisualMedia(room.coerceAtLeast(2)) },
    ) { uris -> finish(uris) }

    val onePhoto = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri -> finish(listOfNotNull(uri)) }

    val document = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris -> finish(uris) }

    val audio = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris -> finish(uris) }

    var photo by remember { mutableStateOf<Uri?>(null) }
    val capture = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicture(),
    ) { taken -> finish(if (taken) listOfNotNull(photo) else emptyList()) }

    val camera = rememberPermission(BetweenUsPermissions.CAMERA) {
        photo = cameraTarget(context).also { capture.launch(it) }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheet,
        dragHandle = {
            Box(
                modifier = Modifier
                    .padding(vertical = 10.dp)
                    .size(width = 36.dp, height = 4.dp)
                    .clip(CircleShape)
                    .background(Surface700),
            )
        },
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(bottom = 12.dp),
        ) {
            // --- WhatsApp-style action icon row ---
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AttachmentActionItem(
                    icon = BetweenUsIcons.File,
                    label = "Document",
                    backgroundColor = Color(0xFF5E5CE6),
                    onClick = { document.launch(arrayOf("*/*")) },
                    modifier = Modifier.weight(1f),
                )
                AttachmentActionItem(
                    icon = BetweenUsIcons.Video,
                    label = "Camera",
                    backgroundColor = Color(0xFFFF375F),
                    onClick = { camera.request() },
                    modifier = Modifier.weight(1f),
                )
                AttachmentActionItem(
                    icon = BetweenUsIcons.Image,
                    label = "Gallery",
                    backgroundColor = Color(0xFFAF52DE),
                    onClick = {
                        val request = PickVisualMediaRequest(
                            ActivityResultContracts.PickVisualMedia.ImageAndVideo,
                        )
                        if (room > 1) gallery.launch(request) else onePhoto.launch(request)
                    },
                    modifier = Modifier.weight(1f),
                )
                AttachmentActionItem(
                    icon = BetweenUsIcons.Speaker,
                    label = "Audio",
                    backgroundColor = Color(0xFFFF9500),
                    onClick = { audio.launch(arrayOf("audio/*")) },
                    modifier = Modifier.weight(1f),
                )
            }

            HorizontalDivider(color = Edge, modifier = Modifier.padding(vertical = 10.dp))

            // --- Inline Recent Media Grid ---
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Recent Photos & Videos",
                    style = MaterialTheme.typography.titleSmall,
                    color = Slate300,
                )
                if (selected.isNotEmpty()) {
                    Text(
                        text = "${selected.size} of $room selected",
                        style = MaterialTheme.typography.labelMedium,
                        color = Accent,
                    )
                }
            }

            Spacer(Modifier.height(6.dp))

            Box(Modifier.heightIn(max = 280.dp)) {
                when {
                    allowed && media.isNotEmpty() -> LazyVerticalGrid(
                        columns = GridCells.Fixed(3),
                        modifier = Modifier.fillMaxWidth(),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(
                            horizontal = 12.dp,
                        ),
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        items(media, key = { it.uri }) { item ->
                            Thumbnail(
                                item = item,
                                position = selected.indexOf(item.uri),
                                onClick = {
                                    selected = when {
                                        item.uri in selected -> selected - item.uri
                                        // Said at the tap that was refused, not
                                        // after the send that would have been.
                                        selected.size >= room -> {
                                            full = true
                                            selected
                                        }

                                        else -> selected + item.uri
                                    }
                                    if (selected.size < room) full = false
                                },
                            )
                        }
                    }

                    allowed -> Hint("No photos or videos on this device yet.")

                    else -> Hint(
                        "BetweenUs cannot see your photos to show them here. " +
                            "Document, Camera, Gallery and Audio above still work.",
                        action = if (access.refused) {
                            "Open app settings" to { access.openSettings() }
                        } else {
                            "Allow access" to { access.request() }
                        },
                    )
                }
            }

            if (full) {
                Text(
                    text = "A message can carry $MAX_ATTACHMENTS files at most. " +
                        "Send these, then pick the rest.",
                    style = MaterialTheme.typography.labelMedium,
                    color = Slate500,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                )
            }

            if (selected.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                BetweenUsButton(
                    text = if (selected.size == 1) "Send 1 item" else "Send ${selected.size} items",
                    onClick = { finish(selected) },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                )
            }
        }
    }
}

/** One WhatsApp-style circular action icon button with label. */
@Composable
private fun AttachmentActionItem(
    icon: Int,
    label: String,
    backgroundColor: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp, horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            modifier = Modifier
                .size(52.dp)
                .clip(CircleShape)
                .background(backgroundColor),
            contentAlignment = Alignment.Center,
        ) {
            BetweenUsIcon(
                icon = icon,
                tint = Color.White,
                size = 24.dp,
            )
        }
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = Slate300,
            maxLines = 1,
        )
    }
}

/** One photo/video in the grid, with selection badge. */
@Composable
private fun Thumbnail(item: MediaItem, position: Int, onClick: () -> Unit) {
    val chosen = position >= 0
    Box(
        modifier = Modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(8.dp))
            .background(Ground)
            .then(
                if (chosen) Modifier.border(2.dp, Accent, RoundedCornerShape(8.dp)) else Modifier,
            )
            .clickable(onClick = onClick),
    ) {
        AsyncImage(
            model = item.uri,
            contentDescription = if (item.isVideo) "A video" else "A photo",
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )

        if (item.isVideo) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(4.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(Color.Black.copy(alpha = 0.6f))
                    .padding(horizontal = 4.dp, vertical = 2.dp),
            ) {
                BetweenUsIcon(
                    icon = BetweenUsIcons.Play,
                    tint = Slate100,
                    size = 14.dp,
                )
            }
        }

        if (chosen) {
            Box(Modifier.fillMaxSize().background(Accent.copy(alpha = 0.25f)))
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(4.dp)
                    .size(22.dp)
                    .clip(CircleShape)
                    .background(Accent),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "${position + 1}",
                    style = MaterialTheme.typography.labelSmall,
                    color = Ground,
                )
            }
        }
    }
}

@Composable
private fun Hint(text: String, action: Pair<String, () -> Unit>? = null) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        BetweenUsIcon(BetweenUsIcons.Image, tint = Surface700, size = 32.dp)
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = Slate500,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        if (action != null) {
            BetweenUsButton(text = action.first, onClick = action.second)
        }
    }
}
