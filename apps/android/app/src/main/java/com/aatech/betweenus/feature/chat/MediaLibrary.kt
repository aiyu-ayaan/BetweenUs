package com.aatech.betweenus.feature.chat

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** One item in the attachment sheet's grid. */
data class MediaItem(val uri: Uri, val isVideo: Boolean)

/** A file about to become an attachment, read and named. */
data class PickedFile(val name: String, val contentType: String, val bytes: ByteArray) {
    // A data class holding a ByteArray compares by reference and hashes by
    // identity unless told otherwise, which is a trap rather than a decision.
    override fun equals(other: Any?): Boolean =
        other is PickedFile && name == other.name && contentType == other.contentType &&
            bytes.contentEquals(other.bytes)

    override fun hashCode(): Int =
        31 * (31 * name.hashCode() + contentType.hashCode()) + bytes.contentHashCode()
}

/**
 * The phone's photos and videos, newest first.
 *
 * One query across `MediaStore.Files` rather than one per type, because the two
 * have to come back interleaved by date - a grid that showed every photo and
 * then every video would put this morning's clip below last year's screenshot.
 *
 * Whoever calls this has already been granted something; on API 34 that may be
 * "only these photos", and then this returns exactly those, which is correct
 * and not an error.
 */
suspend fun recentMedia(context: Context, limit: Int = 90): List<MediaItem> =
    withContext(Dispatchers.IO) {
        // "external" rather than `MediaStore.VOLUME_EXTERNAL`, which is API 29
        // and this module still runs on 24.
        val collection = MediaStore.Files.getContentUri("external")
        val columns = arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.MEDIA_TYPE)
        val image = MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE
        val video = MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO

        runCatching {
            context.contentResolver.query(
                collection,
                columns,
                "${MediaStore.Files.FileColumns.MEDIA_TYPE} IN (?, ?)",
                arrayOf(image.toString(), video.toString()),
                // No SQL LIMIT: MediaStore stopped honouring one appended to
                // the sort order, and the cursor is walked with a bound anyway.
                "${MediaStore.Files.FileColumns.DATE_MODIFIED} DESC",
            )?.use { cursor ->
                val idColumn = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
                val typeColumn = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MEDIA_TYPE)
                buildList {
                    while (cursor.moveToNext() && size < limit) {
                        add(
                            MediaItem(
                                uri = ContentUris.withAppendedId(collection, cursor.getLong(idColumn)),
                                isVideo = cursor.getInt(typeColumn) == video,
                            ),
                        )
                    }
                }
            }.orEmpty()
        }.getOrDefault(emptyList())
    }

/**
 * Reads a picked URI and gives it the name it is actually called.
 *
 * The last path segment is not a filename. For anything the document browser
 * or the photo picker returns it is an opaque id - `image:1000012345`, `msf:42`
 * - so every attachment sent from a phone arrived on the other clients called
 * something like that, with no extension for anything to open it by. The name
 * lives in `OpenableColumns.DISPLAY_NAME`, and the provider is the only thing
 * that knows it.
 */
suspend fun readPicked(context: Context, uri: Uri): PickedFile = withContext(Dispatchers.IO) {
    val described = describe(context, uri)
    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
        ?: error("That file could not be read")

    PickedFile(described.name, described.contentType, bytes)
}

/**
 * Everything knowable about a picked URI without opening it.
 *
 * One resolver for both callers, because they used to have one each and the
 * two did not agree: `describePicked` answered at pick time and `readPicked`
 * answered again at send time, and whichever was worse is the one that reached
 * the wire. Now there is a single answer and a single place to fix it.
 *
 * The order of what is asked matters, and it is the order in `PickedNames.kt`:
 * the provider first, then the URI, then a generated name carrying the right
 * extension. Every step exists because a real provider skipped the one above
 * it - the document browser gives an opaque id for a name, and a `file://` URI
 * has no provider to ask at all.
 */
private fun describe(context: Context, uri: Uri): PickedPreview {
    val resolver = context.contentResolver

    val displayName = runCatching {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (column >= 0 && cursor.moveToFirst()) cursor.getString(column) else null
        }
    }.getOrNull()

    // A `file://` URI has nothing to query, and `getType` on one answers from
    // the extension - so the name has to be worked out before the type, or the
    // type has nothing to be guessed from.
    val provided = runCatching { resolver.getType(uri) }.getOrNull()
    val fromSystem = if (typeIsUseful(provided)) provided else guessType(uri, displayName)

    val name = pickedName(displayName, uri.lastPathSegment, fromSystem ?: OPAQUE_TYPE)
    return PickedPreview(uri = uri, name = name, contentType = pickedType(fromSystem, name))
}

/**
 * The platform's own extension-to-type table, for anything not in ours.
 *
 * Wrapped because `MimeTypeMap` is an Android class: in a JVM unit test it is
 * an unmocked stub that throws, and this path is a fallback rather than
 * something worth failing a send over.
 */
private fun guessType(uri: Uri, displayName: String?): String? {
    val name = displayName?.takeIf { it.isNotBlank() } ?: nameFromSegment(uri.lastPathSegment) ?: return null
    val extension = name.substringAfterLast('.', "").lowercase()
    if (extension.isEmpty()) return null
    return runCatching {
        MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
    }.getOrNull()
}

/**
 * Name and kind without reading the file.
 *
 * The send preview needs to label what was picked and decide whether to draw a
 * player or a picture; reading a 200 MB video into memory to answer that would
 * be absurd, and the content resolver answers both from the index.
 */
suspend fun describePicked(context: Context, uri: Uri): PickedPreview =
    withContext(Dispatchers.IO) { describe(context, uri) }

/** Somewhere for the camera app to put a photo, and a URI it may write to. */
fun cameraTarget(context: Context): Uri {
    val directory = File(context.cacheDir, "camera").apply { mkdirs() }
    val file = File(directory, "photo-${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
}

/**
 * A picked file, made ready to send.
 *
 * The one thing that happens between the picker and the upload: a video is
 * re-encoded smaller. Everything else is read as it stands - pictures are
 * already normalised on the way through `Conversation.uploadAttachment`, and a
 * document has nothing to normalise.
 *
 * A temporary file the compressor wrote is deleted once it has been read, so
 * the cache does not fill up with copies of everything anybody has ever sent.
 */
suspend fun prepareForSending(
    context: Context,
    uri: Uri,
    name: String,
    contentType: String,
    onCompress: (Float) -> Unit = {},
): PickedFile {
    if (!contentType.startsWith("video/")) {
        // The bytes are read fresh; the name and the type are not re-derived.
        //
        // This used to `return readPicked(...)` and throw away both arguments,
        // which meant the send used a second lookup made minutes later in a
        // different coroutine rather than the one the picker itself produced.
        // Whichever of the two was worse won, and for an audio file that was
        // reliably the second: it arrived called `attachment`, typed as bytes,
        // and drew as an anonymous document instead of something playable.
        val read = readPicked(context, uri)
        return PickedFile(
            name = name.ifBlank { read.name },
            // The caller's type unless it never had one either.
            contentType = if (typeIsUseful(contentType)) contentType else read.contentType,
            bytes = read.bytes,
        )
    }

    val prepared = compressVideo(context, uri, sizeOf(context, uri), onCompress)
    val read = readPicked(context, prepared.uri)
    if (prepared.temporary) {
        withContext(Dispatchers.IO) { runCatching { context.contentResolver.delete(prepared.uri, null, null) } }
    }
    // The compressor always writes MP4/H.264, whatever went in, and the name
    // has to say so: a file that lies about its type confuses every client
    // that opens it.
    return if (prepared.temporary) {
        PickedFile(
            name = name.substringBeforeLast('.', name) + ".mp4",
            contentType = "video/mp4",
            bytes = read.bytes,
        )
    } else {
        PickedFile(name = name, contentType = contentType, bytes = read.bytes)
    }
}

/** What the provider says the file weighs, or 0 when it will not say. */
suspend fun sizeOf(context: Context, uri: Uri): Long = withContext(Dispatchers.IO) {
    runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)
            ?.use { cursor ->
                val column = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (column >= 0 && cursor.moveToFirst()) cursor.getLong(column) else 0L
            }
    }.getOrNull() ?: 0L
}
