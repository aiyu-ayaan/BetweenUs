package com.aatech.betweenus.feature.chat

import android.graphics.Bitmap
import android.net.Uri
import android.util.LruCache
import java.util.concurrent.ConcurrentHashMap

/**
 * What has already been decrypted, kept for as long as the app is running.
 *
 * A `LazyColumn` throws a row away the moment it leaves the screen and builds a
 * new one when it comes back. Every piece of state a row held goes with it, and
 * for an attachment that state was the whole of the work: the ciphertext had
 * been downloaded, decrypted under the channel key, and decoded into a bitmap -
 * and scrolling a picture off the top and back threw all three away and did
 * them again. That is what "it goes back to loading" was. Not a slow network: a
 * cache that did not exist.
 *
 * The desktop has had one since attachments landed - a `Map` of blobs in
 * `services/attachments.ts` - and this is the same idea with the same bound.
 * Keyed on the attachment key, which is the object's name in storage: unique
 * per file, and the same across every message that carries it.
 *
 * Bitmaps are the expensive half and are held under a memory budget, so a long
 * scroll through a channel of photos drops the oldest rather than growing until
 * the process is killed. Videos are cached as the `Uri` of the plaintext file
 * already written into the app's cache directory - the bytes are on disk
 * either way, and it is Android that decides when that directory is cleared.
 */
object MediaCache {

    /**
     * An eighth of the heap. The conventional share for a bitmap cache: enough
     * that a screen or two of photos survives a scroll, small enough that the
     * rest of the app is not squeezed out by pictures nobody is looking at.
     */
    private val bitmaps = object : LruCache<String, Bitmap>(
        ((Runtime.getRuntime().maxMemory() / 1024) / 8).toInt().coerceAtLeast(4 * 1024),
    ) {
        // The cache is measured in kilobytes, so the sizes stay inside an Int.
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount / 1024
    }

    /** Small, and read from whichever thread a row happens to compose on. */
    private val videos = ConcurrentHashMap<String, Uri>()

    fun bitmap(key: String): Bitmap? = bitmaps.get(key)

    fun putBitmap(key: String, bitmap: Bitmap) {
        bitmaps.put(key, bitmap)
    }

    /** A video's first frame is a bitmap too, under a key of its own. */
    fun poster(key: String): Bitmap? = bitmaps.get(posterKey(key))

    fun putPoster(key: String, frame: Bitmap) {
        bitmaps.put(posterKey(key), frame)
    }

    fun video(key: String): Uri? = videos[key]

    fun putVideo(key: String, uri: Uri) {
        videos[key] = uri
    }

    /**
     * Emptied on sign-out: the plaintext of another account's conversation has
     * no business surviving into the next one.
     */
    fun clear() {
        bitmaps.evictAll()
        videos.clear()
    }

    private fun posterKey(key: String): String = "$key#poster"
}
