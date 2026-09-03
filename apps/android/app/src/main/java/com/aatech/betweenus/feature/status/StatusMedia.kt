package com.aatech.betweenus.feature.status

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import com.aatech.betweenus.core.data.BetweenUsApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * The bytes behind a status, as something the screen can draw.
 *
 * A status is stored in the clear, unlike an attachment, but it is still
 * fetched rather than linked: the download route wants an Authorization header
 * and no image loader here sends one. So the bytes come down through the API
 * and become a bitmap or a file on disk - the same route an attachment takes,
 * minus the decryption.
 *
 * Cached by status id, because a run is opened, closed and opened again, and
 * the second look should not be a second download. The cache is the app's own
 * cache directory, which is Android's to clear.
 */
object StatusMedia {
    private val bitmaps = ConcurrentHashMap<String, Bitmap>()
    private val videos = ConcurrentHashMap<String, Uri>()

    /** A photo status, decoded. Null when it could not be fetched or decoded. */
    suspend fun photo(statusId: String, mediaUrl: String): Bitmap? {
        bitmaps[statusId]?.let { return it }
        return withContext(Dispatchers.IO) {
            runCatching {
                val bytes = BetweenUsApi.fetchObject(mediaUrl)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            }.getOrNull()?.also { bitmaps[statusId] = it }
        }
    }

    /**
     * A video status, written to the cache directory.
     *
     * A file rather than a byte array because the player wants a `Uri`, and a
     * `file://` in the app's own cache is the shortest way to give it one -
     * nothing outside this process ever reads it.
     */
    suspend fun video(context: Context, statusId: String, mediaUrl: String): Uri? {
        videos[statusId]?.let { return it }
        return withContext(Dispatchers.IO) {
            runCatching {
                val directory = File(context.cacheDir, "status").apply { mkdirs() }
                val file = File(directory, "$statusId.mp4")
                if (!file.exists() || file.length() == 0L) {
                    file.writeBytes(BetweenUsApi.fetchObject(mediaUrl))
                }
                Uri.fromFile(file)
            }.getOrNull()?.also { videos[statusId] = it }
        }
    }

    /** Frees one post - it was deleted, or it expired. */
    fun release(statusId: String) {
        bitmaps.remove(statusId)
        videos.remove(statusId)
    }
}
