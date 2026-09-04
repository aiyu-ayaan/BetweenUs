package com.aatech.betweenus.feature.status

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.RectF
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageAndVideo
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aatech.betweenus.core.data.STATUS_BACKGROUNDS
import com.aatech.betweenus.core.data.STATUS_CAPTION_MAX_LENGTH
import com.aatech.betweenus.core.data.STATUS_VIDEO_MAX_MS
import com.aatech.betweenus.core.data.StatusKind
import com.aatech.betweenus.core.store.Statuses
import com.aatech.betweenus.feature.chat.MediaItem
import com.aatech.betweenus.feature.chat.MediaThumbnail
import com.aatech.betweenus.feature.chat.cameraTarget
import com.aatech.betweenus.feature.chat.recentMedia
import com.aatech.betweenus.feature.settings.BetweenUsPermissions
import com.aatech.betweenus.feature.settings.rememberAnyPermission
import com.aatech.betweenus.feature.settings.rememberPermission
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.MyMomentsDoor
import com.aatech.betweenus.ui.components.StatusComposerDoor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Posting a status: pictures and clips off the phone's roll, or words on a
 * colour.
 *
 * The roll opens first, because that is what posting a moment usually is: the
 * thing you want is one of the last nine photos, and asking which *kind* of
 * moment before showing any of them puts a menu in front of a decision that has
 * already been made. Photos and videos are one list - see `recentMedia` - since
 * "photo or video" is a question about the file, not about the person reaching
 * for it, and the kind is read off the item.
 *
 * Several at a time: each picked item becomes its own post, in the order it was
 * picked, unless Layout is on - and Layout is offered only when every picked
 * item is a picture, because it draws them onto one picture and a video cannot
 * be drawn onto anything.
 *
 * Nothing is uploaded until Post: the previews are the picked `Uri`s, so
 * choosing and changing your mind costs nothing and leaves nothing on the
 * server.
 *
 * The port of `apps/desktop/src/features/status/StatusComposer.tsx`.
 */
@Composable
fun StatusComposerHost() {
    if (!StatusComposerDoor.open) return
    Dialog(
        onDismissRequest = { StatusComposerDoor.close() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        StatusComposerScreen(
            onClose = { StatusComposerDoor.close() },
            // Posting lands on the run it was added to rather than back on the
            // tray: what somebody wants to see after posting is the thing they
            // just posted, and who has looked at it.
            onPosted = {
                StatusComposerDoor.close()
                MyMomentsDoor.show()
            },
        )
    }
}

@Composable
private fun StatusComposerScreen(onClose: () -> Unit, onPosted: () -> Unit) {
    val context = LocalContext.current

    /** The phone's roll, newest first, with anything captured here on the front. */
    var roll by remember { mutableStateOf<List<MediaItem>>(emptyList()) }
    var selected by remember { mutableStateOf<List<MediaItem>>(emptyList()) }
    /** True while the words composer is up instead of the roll. */
    var words by remember { mutableStateOf(false) }
    var layout by remember { mutableStateOf(false) }
    var text by remember { mutableStateOf("") }
    var caption by remember { mutableStateOf("") }
    var background by remember { mutableStateOf(STATUS_BACKGROUNDS.first()) }

    var allowed by remember {
        mutableStateOf(BetweenUsPermissions.anyGranted(context, BetweenUsPermissions.MEDIA))
    }
    val access = rememberAnyPermission(BetweenUsPermissions.MEDIA) { allowed = true }

    LaunchedEffect(allowed) {
        if (allowed) roll = recentMedia(context)
    }
    LaunchedEffect(Unit) {
        if (!allowed) access.request()
    }

    /** Adds picked URIs, keeping the order they were chosen in. */
    fun take(uris: List<Uri>) {
        val taken = uris.map { MediaItem(it, isVideo(context, it)) }
        roll = taken.filterNot { item -> roll.any { it.uri == item.uri } } + roll
        selected = selected + taken.filterNot { item -> selected.any { it.uri == item.uri } }
        words = false
    }

    // The system picker, for anything older than the grid shows. Both kinds, as
    // one list, exactly like the grid.
    val gallery = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(),
    ) { uris -> take(uris) }

    var captured by remember { mutableStateOf<Uri?>(null) }
    val capture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { taken ->
        if (taken) take(listOfNotNull(captured))
    }
    val camera = rememberPermission(BetweenUsPermissions.CAMERA) {
        captured = cameraTarget(context).also { capture.launch(it) }
    }

    // Offered on two or more, and only when every one of them is a picture.
    val layoutable = selected.size > 1 && selected.none { it.isVideo }
    val collaging = layout && layoutable
    val ready = if (selected.isNotEmpty()) true else words && text.isNotBlank()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(if (words && selected.isEmpty()) colourOf(background) else Color.Black)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(
                icon = BetweenUsIcons.X,
                contentDescription = "Cancel",
                onClick = onClose,
                tint = Color.White,
            )
            Text(
                text = "Add status",
                style = MaterialTheme.typography.titleMedium,
                color = Color.White,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
            TextButton(
                enabled = ready,
                onClick = {
                    // Handed over and gone. Sealing a photo is seconds and a
                    // clip is minutes, and none of that is a reason to hold the
                    // screen: the work runs on the store's own scope, the tray
                    // fills in as each post lands, and a failure surfaces there
                    // rather than on a composer nobody is looking at any more.
                    val app = context.applicationContext
                    val picked = selected
                    val together = collaging
                    val words = caption.trim().ifBlank { null }
                    val said = text.trim()
                    val colour = background
                    Statuses.postInBackground {
                        postAll(
                            context = app,
                            selected = picked,
                            collage = together,
                            caption = words,
                            text = said,
                            background = colour,
                        )
                    }
                    onPosted()
                },
            ) {
                Text("Post", color = Color.White)
            }
        }

        // The kinds, above the roll rather than under it: this is the row that
        // says what you are about to make, and it stays put while the grid
        // underneath scrolls.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            KindCard(BetweenUsIcons.Pencil, "Text", words && selected.isEmpty()) {
                selected = emptyList()
                layout = false
                caption = ""
                words = true
            }
            if (layoutable) {
                KindCard(BetweenUsIcons.LayoutSidebar, "Layout", collaging) { layout = !layout }
            }
        }

        Spacer(Modifier.height(10.dp))

        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                words && selected.isEmpty() -> WordsField(
                    text = text,
                    onText = { text = it },
                    modifier = Modifier.fillMaxSize(),
                )

                allowed && roll.isNotEmpty() -> LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    item(key = "camera") { CameraTile(onClick = { camera.request() }) }
                    items(roll, key = { it.uri }) { item ->
                        MediaThumbnail(
                            item = item,
                            position = selected.indexOfFirst { it.uri == item.uri },
                            onClick = {
                                selected = if (selected.any { it.uri == item.uri }) {
                                    selected.filterNot { it.uri == item.uri }
                                } else {
                                    selected + item
                                }
                                words = false
                            },
                        )
                    }
                }

                allowed -> Empty(
                    text = "No photos or videos on this device yet.",
                    action = "Browse files" to { gallery.launch(PickVisualMediaRequest(ImageAndVideo)) },
                )

                else -> Empty(
                    text = "BetweenUs cannot see your photos to show them here.",
                    action = if (access.refused) {
                        "Open app settings" to { access.openSettings() }
                    } else {
                        "Allow access" to { access.request() }
                    },
                )
            }

            if (!words || selected.isNotEmpty()) {
                // The way out of Recents into everything else, where the
                // system picker sits in every gallery: bottom right, over the
                // grid rather than taking a row from it.
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(16.dp)
                        .size(56.dp)
                        .clip(RoundedCornerShape(18.dp))
                        .background(Color.White.copy(alpha = 0.14f))
                        .clickable { gallery.launch(PickVisualMediaRequest(ImageAndVideo)) },
                    contentAlignment = Alignment.Center,
                ) {
                    BetweenUsIcon(BetweenUsIcons.File, tint = Color.White, size = 22.dp)
                }
            }
        }

        if (selected.isNotEmpty()) {
            Text(
                text = when {
                    collaging -> "${selected.size} photos on one moment"
                    selected.size == 1 -> "1 moment"
                    else -> "${selected.size} moments"
                },
                style = MaterialTheme.typography.labelMedium,
                color = Color.White.copy(alpha = 0.7f),
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
            )
            CaptionField(caption = caption, onCaption = { caption = it })
        } else if (words) {
            // A fixed set of colours rather than a picker: every one of these
            // is legible under white text, and a picker is how you get white
            // on yellow.
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                STATUS_BACKGROUNDS.forEach { colour ->
                    Box(
                        modifier = Modifier
                            .padding(horizontal = 5.dp)
                            .size(28.dp)
                            .clip(CircleShape)
                            .background(colourOf(colour))
                            .border(
                                width = if (colour == background) 2.dp else 0.dp,
                                color = if (colour == background) Color.White else Color.Transparent,
                                shape = CircleShape,
                            )
                            .clickable { background = colour },
                    )
                }
            }
        }
        Spacer(Modifier.height(12.dp))
    }
}

/** Words on a colour: the status that needs no file and no camera. */
@Composable
private fun WordsField(text: String, onText: (String) -> Unit, modifier: Modifier = Modifier) {
    Box(modifier, contentAlignment = Alignment.Center) {
        BasicTextField(
            value = text,
            onValueChange = { if (it.length <= STATUS_CAPTION_MAX_LENGTH) onText(it) },
            textStyle = MaterialTheme.typography.headlineSmall.copy(
                color = Color.White,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
            ),
            cursorBrush = SolidColor(Color.White),
            decorationBox = { field ->
                Box(contentAlignment = Alignment.Center) {
                    if (text.isEmpty()) {
                        Text(
                            text = "Type a moment",
                            style = MaterialTheme.typography.headlineSmall,
                            color = Color.White.copy(alpha = 0.6f),
                            textAlign = TextAlign.Center,
                        )
                    }
                    field()
                }
            },
            modifier = Modifier.fillMaxWidth().padding(32.dp),
        )
    }
}

/** One caption for everything being posted in this go. */
@Composable
private fun CaptionField(caption: String, onCaption: (String) -> Unit) {
    BasicTextField(
        value = caption,
        onValueChange = { if (it.length <= STATUS_CAPTION_MAX_LENGTH) onCaption(it) },
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = Color.White),
        cursorBrush = SolidColor(Color.White),
        decorationBox = { field ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(28.dp))
                    .background(Color.White.copy(alpha = 0.12f))
                    .padding(horizontal = 18.dp, vertical = 14.dp),
            ) {
                if (caption.isEmpty()) {
                    Text(
                        text = "Add a caption…",
                        style = MaterialTheme.typography.bodyLarge,
                        color = Color.White.copy(alpha = 0.6f),
                    )
                }
                field()
            }
        },
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
    )
}

/** The first cell of the grid: take one now instead of finding one. */
@Composable
private fun CameraTile(onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(8.dp))
            .background(Color.White.copy(alpha = 0.08f))
            .clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        BetweenUsIcon(BetweenUsIcons.Video, tint = Color.White, size = 26.dp)
        Spacer(Modifier.height(6.dp))
        Text("Camera", style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.8f))
    }
}

@Composable
private fun Empty(text: String, action: Pair<String, () -> Unit>) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        BetweenUsIcon(BetweenUsIcons.Image, tint = Color.White.copy(alpha = 0.4f), size = 32.dp)
        Spacer(Modifier.height(12.dp))
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = Color.White.copy(alpha = 0.7f),
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = action.second) { Text(action.first, color = Color.White) }
    }
}

/** One card in the row of kinds. */
@Composable
private fun KindCard(icon: Int, label: String, selected: Boolean, onClick: () -> Unit) {
    // Animated rather than switched, so the row reads as one control moving
    // between positions instead of cards that light independently.
    val background by animateColorAsState(
        targetValue = if (selected) Color.White.copy(alpha = 0.22f) else Color.White.copy(alpha = 0.06f),
        label = "kind-background",
    )
    val edge by animateColorAsState(
        targetValue = if (selected) Color.White else Color.White.copy(alpha = 0.25f),
        label = "kind-edge",
    )
    val shape = RoundedCornerShape(16.dp)

    Column(
        modifier = Modifier
            .widthIn(min = 96.dp)
            .clip(shape)
            .background(background)
            .border(width = if (selected) 2.dp else 1.dp, color = edge, shape = shape)
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp, horizontal = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        BetweenUsIcon(icon, tint = Color.White, size = 22.dp)
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            color = if (selected) Color.White else Color.White.copy(alpha = 0.75f),
        )
    }
}

/**
 * Everything this go posts, in the order it was picked.
 *
 * One function rather than a branch inside the button, because the three cases
 * - words, several items, several pictures drawn onto one - are one decision
 * about what to send and the button only has to know whether it worked.
 *
 * Sequential rather than parallel: each post seals against the audience as it
 * stands and appends to the tray, and the tray is one list.
 */
private suspend fun postAll(
    context: Context,
    selected: List<MediaItem>,
    collage: Boolean,
    caption: String?,
    text: String,
    background: String,
) {
    if (selected.isEmpty()) {
        Statuses.post(kind = StatusKind.TEXT, caption = text, background = background)
        return
    }
    if (collage) {
        Statuses.post(
            kind = StatusKind.PHOTO,
            caption = caption,
            media = collage(context, selected.map { it.uri }),
            mediaContentType = "image/jpeg",
        )
        return
    }
    selected.forEach { item ->
        Statuses.post(
            kind = if (item.isVideo) StatusKind.VIDEO else StatusKind.PHOTO,
            caption = caption,
            // Clamped rather than cut: the file goes up whole and the player
            // stops at the cap. See STATUS_VIDEO_MAX_MS.
            durationMs = if (item.isVideo) {
                videoDuration(context, item.uri).coerceAtMost(STATUS_VIDEO_MAX_MS)
            } else {
                null
            },
            media = readBytes(context, item.uri),
            mediaContentType = context.contentResolver.getType(item.uri),
        )
    }
}

/** Whether a picked URI is a clip. Asked of the provider, not of the name. */
private fun isVideo(context: Context, uri: Uri): Boolean =
    context.contentResolver.getType(uri)?.startsWith("video/") == true

private const val COLLAGE_CELL = 512

/**
 * Several pictures drawn onto one, as a square grid.
 *
 * A grid rather than a designed collage: the point is that four photos of one
 * afternoon post as one moment, and a layout engine to arrange them is a
 * feature nobody asked for. Each cell is cover-cropped and clipped to itself,
 * so a portrait beside a landscape fills its square rather than spilling into
 * the next one.
 *
 * ponytail: fixed 512px cells and one grid shape, matching the desktop
 * composer. Per-count layouts - the big one on the left, two stacked beside it
 * - are the upgrade if the grid ever looks wrong for three.
 */
private suspend fun collage(context: Context, uris: List<Uri>): ByteArray =
    withContext(Dispatchers.IO) {
        val columns = ceil(sqrt(uris.size.toDouble())).toInt().coerceAtLeast(1)
        val rows = ceil(uris.size / columns.toDouble()).toInt()
        val sheet = Bitmap.createBitmap(
            columns * COLLAGE_CELL,
            rows * COLLAGE_CELL,
            Bitmap.Config.ARGB_8888,
        )
        val canvas = Canvas(sheet)
        canvas.drawColor(android.graphics.Color.BLACK)

        uris.forEachIndexed { at, uri ->
            val picture = decodeScaled(context, uri) ?: return@forEachIndexed
            val left = ((at % columns) * COLLAGE_CELL).toFloat()
            val top = ((at / columns) * COLLAGE_CELL).toFloat()
            val scale = max(
                COLLAGE_CELL / picture.width.toFloat(),
                COLLAGE_CELL / picture.height.toFloat(),
            )
            val width = picture.width * scale
            val height = picture.height * scale
            canvas.save()
            canvas.clipRect(left, top, left + COLLAGE_CELL, top + COLLAGE_CELL)
            canvas.drawBitmap(
                picture,
                null,
                RectF(
                    left + (COLLAGE_CELL - width) / 2f,
                    top + (COLLAGE_CELL - height) / 2f,
                    left + (COLLAGE_CELL + width) / 2f,
                    top + (COLLAGE_CELL + height) / 2f,
                ),
                null,
            )
            canvas.restore()
            picture.recycle()
        }

        ByteArrayOutputStream().use { out ->
            sheet.compress(Bitmap.CompressFormat.JPEG, 90, out)
            sheet.recycle()
            out.toByteArray()
        }
    }

/**
 * A picture decoded no larger than it needs to be for one collage cell.
 *
 * Bounds first, then a power-of-two sample: a phone posting four 12-megapixel
 * originals onto one sheet would otherwise hold four full bitmaps at once,
 * which is how a composer runs out of memory on the device it was written on.
 */
private fun decodeScaled(context: Context, uri: Uri): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri)?.use {
        BitmapFactory.decodeStream(it, null, bounds)
    }
    var sample = 1
    val smallest = min(bounds.outWidth, bounds.outHeight)
    while (smallest > 0 && smallest / (sample * 2) >= COLLAGE_CELL) sample *= 2

    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    return context.contentResolver.openInputStream(uri)?.use {
        BitmapFactory.decodeStream(it, null, options)
    }
}

private suspend fun readBytes(context: Context, uri: Uri): ByteArray =
    withContext(Dispatchers.IO) {
        context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            ?: throw IllegalStateException("That file could not be read")
    }

/**
 * How long a picked video runs.
 *
 * A file that will not report its length is treated as the cap rather than as
 * a failure, so a clip whose metadata is missing still posts.
 */
private suspend fun videoDuration(context: Context, uri: Uri): Long =
    withContext(Dispatchers.IO) {
        runCatching {
            MediaMetadataRetriever().use { retriever ->
                retriever.setDataSource(context, uri)
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                    ?.toLongOrNull()
                    ?: STATUS_VIDEO_MAX_MS
            }
        }.getOrDefault(STATUS_VIDEO_MAX_MS)
    }
