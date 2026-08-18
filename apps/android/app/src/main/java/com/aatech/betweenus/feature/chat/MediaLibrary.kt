package com.aatech.betweenus.feature.chat

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import android.provider.OpenableColumns
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
    val resolver = context.contentResolver
    val type = resolver.getType(uri) ?: "application/octet-stream"

    val name = runCatching {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (column >= 0 && cursor.moveToFirst()) cursor.getString(column) else null
        }
    }.getOrNull()?.takeIf { it.isNotBlank() }
        ?: "attachment${extensionFor(type)}"

    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
        ?: error("That file could not be read")

    PickedFile(name, type, bytes)
}

/**
 * Name and kind without reading the file.
 *
 * The send preview needs to label what was picked and decide whether to draw a
 * player or a picture; reading a 200 MB video into memory to answer that would
 * be absurd, and the content resolver answers both from the index.
 */
suspend fun describePicked(context: Context, uri: Uri): PickedPreview = withContext(Dispatchers.IO) {
    val resolver = context.contentResolver
    val type = resolver.getType(uri) ?: "application/octet-stream"
    val name = runCatching {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (column >= 0 && cursor.moveToFirst()) cursor.getString(column) else null
        }
    }.getOrNull()?.takeIf { it.isNotBlank() } ?: "attachment${extensionFor(type)}"

    PickedPreview(uri = uri, name = name, contentType = type)
}

/** Somewhere for the camera app to put a photo, and a URI it may write to. */
fun cameraTarget(context: Context): Uri {
    val directory = File(context.cacheDir, "camera").apply { mkdirs() }
    val file = File(directory, "photo-${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
}

private fun extensionFor(contentType: String): String = when {
    contentType.startsWith("image/") -> "." + contentType.substringAfter('/').substringBefore('+')
    contentType.startsWith("video/") -> "." + contentType.substringAfter('/')
    else -> ""
}
