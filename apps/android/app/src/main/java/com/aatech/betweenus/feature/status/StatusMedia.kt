package com.aatech.betweenus.feature.status

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import com.aatech.betweenus.core.crypto.E2ee
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.StatusEntry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * The bytes behind a status, opened, as something the screen can draw.
 *
 * The object comes down as ciphertext - the server has never held anything
 * else - so this is exactly the attachment path with a different key: fetch,
 * decrypt, and hand back a bitmap or a file. It is fetched rather than linked
 * for the older reason too: the download route wants an Authorization header
 * and no image loader here sends one.
 *
 * Cached by status id, because a run is opened, closed and opened again, and
 * the second look should not be a second download and a second decryption. The
 * cache is the app's own cache directory, which is Android's to clear - and
 * what lands in it is plaintext, so it is cleared with the post.
 */
object StatusMedia {
    private val bitmaps = ConcurrentHashMap<String, Bitmap>()
    private val videos = ConcurrentHashMap<String, Uri>()

    /**
     * A photo status, opened and decoded. Null when it could not be fetched,
     * could not be opened - no wrap for this phone - or is not a picture.
     */
    suspend fun photo(post: StatusEntry): Bitmap? {
        bitmaps[post.id]?.let { return it }
        val url = post.mediaUrl ?: return null
        return withContext(Dispatchers.IO) {
            runCatching {
                val bytes = E2ee.openStatusMedia(post, BetweenUsApi.fetchObject(url))
                    ?: return@runCatching null
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            }.getOrNull()?.also { bitmaps[post.id] = it }
        }
    }

    /**
     * A video status, written to the cache directory.
     *
     * A file rather than a byte array because the player wants a `Uri`, and a
     * `file://` in the app's own cache is the shortest way to give it one -
     * nothing outside this process ever reads it.
     */
    suspend fun video(context: Context, post: StatusEntry): Uri? {
        videos[post.id]?.let { return it }
        val url = post.mediaUrl ?: return null
        return withContext(Dispatchers.IO) {
            runCatching {
                val directory = File(context.cacheDir, "status").apply { mkdirs() }
                val file = File(directory, "${post.id}.mp4")
                if (!file.exists() || file.length() == 0L) {
                    // Opened before it is written: the player reads a file, and
                    // a file of ciphertext is a file that plays nothing.
                    val bytes = E2ee.openStatusMedia(post, BetweenUsApi.fetchObject(url))
                        ?: return@runCatching null
                    file.writeBytes(bytes)
                }
                Uri.fromFile(file)
            }.getOrNull()?.also { videos[post.id] = it }
        }
    }

    /**
     * Frees one post - it was deleted, or it expired.
     *
     * ponytail: the decrypted video file stays in the app's private cache
     * until Android reclaims it, which is what `MediaViewer` does with an
     * opened attachment too. Deleting it here as well is the upgrade if a post
     * outliving itself on disk for an hour matters.
     */
    fun release(statusId: String) {
        bitmaps.remove(statusId)
        videos.remove(statusId)
    }
}
