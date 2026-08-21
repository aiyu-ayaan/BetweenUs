package com.aatech.betweenus.feature.chat

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * Text messages that have not been sent yet, on disk.
 *
 * [Outbox] is a queue in memory, which is right for a message with a video in
 * it: a content URI is not worth persisting because the permission behind it
 * does not survive the process either. A reply typed into the notification
 * shade is the opposite case - it is a sentence, it is worth keeping, and the
 * process that took it is a broadcast receiver Android may kill the moment it
 * returns. Dropping one because the phone was in a lift is what this closes,
 * and it was dropped *silently*, which is worse than the drop.
 *
 * A file rather than a database: this holds a handful of sentences at most, and
 * a Room table for that is a migration to maintain for no gain.
 */
internal object PendingReplies {

    data class Pending(val id: Long, val channelId: String, val text: String)

    private const val FILE = "betweenus.outbox"
    private const val KEY = "pending"

    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        if (::prefs.isInitialized) return
        prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    }

    @Synchronized
    fun add(channelId: String, text: String): Pending {
        val pending = Pending(System.currentTimeMillis(), channelId, text)
        write(all() + pending)
        return pending
    }

    @Synchronized
    fun remove(id: Long) {
        write(all().filterNot { it.id == id })
    }

    @Synchronized
    fun all(): List<Pending> {
        if (!::prefs.isInitialized) return emptyList()
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            (0 until array.length()).map { index ->
                val row = array.getJSONObject(index)
                Pending(
                    id = row.getLong("id"),
                    channelId = row.getString("channelId"),
                    text = row.getString("text"),
                )
            }
        }.getOrDefault(emptyList())
    }

    /**
     * Everything queued is thrown away with the account it belonged to. An
     * unsent reply is a message somebody wrote, and sending it from the next
     * account to sign in on this phone would be the worst possible outcome.
     */
    @Synchronized
    fun clear() {
        if (::prefs.isInitialized) prefs.edit().remove(KEY).apply()
    }

    private fun write(rows: List<Pending>) {
        val array = JSONArray()
        rows.forEach { row ->
            array.put(
                JSONObject()
                    .put("id", row.id)
                    .put("channelId", row.channelId)
                    .put("text", row.text),
            )
        }
        prefs.edit().putString(KEY, array.toString()).apply()
    }
}
