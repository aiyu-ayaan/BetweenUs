package com.aatech.betweenus.core.store

import com.aatech.betweenus.core.data.Page

/**
 * Pure rules for the two lists that load a first page and then keep going: the
 * pinned list (server cursor) and search (a bounded walk back through history
 * this device opens itself, because the server cannot read message text).
 * Kept free of Android and of the network so they are unit-testable; the
 * desktop mirrors them in `pin-paging.ts` and `search-walk.ts`.
 */

/** A further page of pins appended to what is shown: no repeats, order kept. */
fun <T> appendPinPage(shown: List<T>, page: List<T>, id: (T) -> String): List<T> {
    val seen = shown.mapTo(HashSet()) { id(it) }
    val fresh = page.filter { id(it) !in seen }
    return if (fresh.isEmpty()) shown else shown + fresh
}

/** Most messages one search run opens. Another run is a deliberate tap. */
const val WALK_MESSAGE_CAP = 1000

enum class WalkStop { End, Cap, Stopped, Error }

data class WalkProgress<T>(
    val hits: List<T>,
    val scanned: Int,
    val oldestAt: String?,
    val cursor: String?,
)

data class WalkResult(
    val stop: WalkStop,
    val scanned: Int,
    val oldestAt: String?,
    val cursor: String?,
)

/**
 * Reads older pages one at a time from [cursor], matching each as it arrives.
 *
 * [fetchPage] fetches and opens a page (items oldest first, like the server's
 * pages). A stop that arrives while a page is in flight discards that page, so
 * a list the caller has moved on from is never touched. Bounded by
 * [maxMessages]: nobody typing two letters meant to decrypt a whole channel.
 */
suspend fun <T> walkOlder(
    cursor: String,
    fetchPage: suspend (String) -> Page<T>,
    matches: (T) -> Boolean,
    createdAt: (T) -> String,
    isStopped: () -> Boolean,
    onProgress: (WalkProgress<T>) -> Unit,
    maxMessages: Int = WALK_MESSAGE_CAP,
): WalkResult {
    var next: String? = cursor
    var scanned = 0
    var oldest: String? = null
    while (next != null) {
        if (isStopped()) return WalkResult(WalkStop.Stopped, scanned, oldest, next)
        if (scanned >= maxMessages) return WalkResult(WalkStop.Cap, scanned, oldest, next)
        val page = try {
            fetchPage(next)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            return WalkResult(WalkStop.Error, scanned, oldest, next)
        }
        if (isStopped()) return WalkResult(WalkStop.Stopped, scanned, oldest, next)
        scanned += page.items.size
        page.items.firstOrNull()?.let { first ->
            val at = createdAt(first)
            if (oldest == null || at < oldest!!) oldest = at
        }
        next = page.nextCursor
        onProgress(WalkProgress(page.items.filter(matches), scanned, oldest, next))
    }
    return WalkResult(WalkStop.End, scanned, oldest, null)
}
