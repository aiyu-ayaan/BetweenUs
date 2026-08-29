package com.aatech.betweenus.core.store

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import com.aatech.betweenus.core.data.Channel
import com.aatech.betweenus.core.data.DirectChannel
import com.aatech.betweenus.core.data.Friend
import com.aatech.betweenus.core.data.Message
import com.aatech.betweenus.core.data.ServerMember
import com.aatech.betweenus.core.data.ServerWithRole
import com.aatech.betweenus.core.data.jsonArrayOfObjects
import com.aatech.betweenus.core.data.map
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * A row of whatever list it is named after, as the JSON the server sent.
 *
 * Storing the wire shape rather than a column per field is deliberate. These
 * lists are read and written whole, never queried into, and `Models.kt` already
 * holds a parser for every one of them - a column layout would buy nothing and
 * would have to be migrated every time a field is added to the contract.
 */
@Entity(tableName = "cache")
internal data class CacheRow(@PrimaryKey val id: String, val json: String)

/**
 * One message, still sealed. `channelId` and `createdAt` are columns because
 * they are what the reads sort and filter on; the rest stays in the blob.
 */
@Entity(tableName = "message", indices = [Index("channelId")])
internal data class MessageRow(
    @PrimaryKey val id: String,
    val channelId: String,
    val createdAt: String,
    val json: String,
)

@Dao
internal interface CacheDao {
    @Query("SELECT json FROM cache WHERE id = :id")
    suspend fun read(id: String): String?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun write(row: CacheRow)

    @Query("DELETE FROM cache")
    suspend fun clearLists()

    /** Newest first, which is the cheap end of the index to read a page from. */
    @Query("SELECT * FROM message WHERE channelId = :channelId ORDER BY createdAt DESC LIMIT :limit")
    suspend fun latest(channelId: String, limit: Int): List<MessageRow>

    @Query(
        "SELECT * FROM message WHERE channelId = :channelId AND createdAt < :before " +
            "ORDER BY createdAt DESC LIMIT :limit",
    )
    suspend fun before(channelId: String, before: String, limit: Int): List<MessageRow>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun writeMessages(rows: List<MessageRow>)

    @Query("DELETE FROM message")
    suspend fun clearMessages()

    @Query("DELETE FROM message WHERE channelId = :channelId")
    suspend fun clearChannel(channelId: String)

    @Query("DELETE FROM message WHERE id IN (:ids)")
    suspend fun forgetMessages(ids: List<String>)
}

@Database(entities = [CacheRow::class, MessageRow::class], version = 1, exportSchema = false)
internal abstract class BetweenUsDatabase : RoomDatabase() {
    abstract fun cache(): CacheDao
}

/**
 * What the app knew last time it ran.
 *
 * The point of it is that opening BetweenUs shows a conversation rather than a
 * spinner: the stores draw from here first and let the network catch up behind
 * them, the way WhatsApp does. Nothing here is authoritative - the server is,
 * and every read is followed by a refresh - but on a cold start, on a train,
 * or against a backend that is having a bad day, this is what is on screen.
 *
 * Two things are deliberately *not* stored:
 *
 * - **Plaintext.** Messages are cached exactly as they arrived, still sealed.
 *   Decryption happens on the way to the screen. A database pulled off a rooted
 *   phone is worth what the server's own rows are worth, which is nothing
 *   without a channel key - and those live in the Keystore, not here.
 * - **Anything for another account.** [claim] wipes the lot when the user id
 *   changes, and every read waits for it, so a second account cannot flash the
 *   first one's servers on screen while the network catches up.
 *
 * Writes are fire-and-forget: a cache that cannot be written is a slower app,
 * never a broken one, so nothing here throws into a caller.
 */
object Cache {
    private const val OWNER = "owner"
    private const val PAGE = 50

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile
    private var db: BetweenUsDatabase? = null

    /** Completes when the cache is known to belong to whoever is signed in. */
    @Volatile
    private var claimed = CompletableDeferred<Unit>()

    fun init(context: Context) {
        db = Room.databaseBuilder(
            context.applicationContext,
            BetweenUsDatabase::class.java,
            "betweenus-cache.db",
        )
            // A cache has nothing in it that cannot be fetched again, so a
            // schema change throws it away rather than carrying a migration.
            .fallbackToDestructiveMigration(dropAllTables = true)
            .build()
    }

    /**
     * Binds the cache to an account. A different one than last time means
     * everything here belongs to somebody else and goes.
     */
    fun claim(userId: String) {
        scope.launch {
            runCatching {
                val dao = db?.cache() ?: return@runCatching
                if (dao.read(OWNER) != userId) {
                    dao.clearLists()
                    dao.clearMessages()
                    dao.write(CacheRow(OWNER, userId))
                }
            }
            claimed.complete(Unit)
        }
    }

    /**
     * Forgets everything. Signing out is the one moment a person has said they
     * are done with this device - a session that merely expired keeps its cache,
     * so signing back in is still instant.
     */
    suspend fun clear() {
        claimed = CompletableDeferred()
        runCatching {
            db?.cache()?.let {
                it.clearLists()
                it.clearMessages()
            }
        }
    }

    /**
     * Forgets one conversation's messages and nothing else.
     *
     * What "clear this chat" needs. [clear] would work and is shorter, but it
     * throws away every other conversation this phone has cached - so clearing
     * one chat would turn the next four things somebody opens into spinners,
     * for a reason they could not connect to what they just did.
     *
     * The lists are left alone: the channel still exists and still belongs in
     * the rail. What went is what was said in it.
     */
    suspend fun forgetChannel(channelId: String) {
        runCatching { db?.cache()?.clearChannel(channelId) }
    }

    /**
     * Forgets specific messages, by id.
     *
     * For the two deletions that leave no tombstone - a one-time message that
     * was opened, and one whose disappearing window closed. An ordinary delete
     * does not come through here: its tombstone is written over the old row by
     * [putMessages], which is what makes a conversation still say "this was
     * here and is gone" after the app is restarted.
     */
    suspend fun forgetMessages(ids: List<String>) {
        if (ids.isEmpty()) return
        runCatching { db?.cache()?.forgetMessages(ids) }
    }

    // --- lists ---

    suspend fun servers(): List<ServerWithRole>? = readList("servers") { ServerWithRole.from(it) }

    fun putServers(servers: List<ServerWithRole>) =
        writeList("servers", jsonArrayOfObjects(servers) { it.toJson() })

    suspend fun channels(): Map<String, List<Channel>>? =
        readMap("channels") { array -> array.map { Channel.from(it) } }

    fun putChannels(channels: Map<String, List<Channel>>) =
        writeMap("channels", channels.mapValues { (_, list) -> jsonArrayOfObjects(list) { it.toJson() } })

    suspend fun directChannels(): List<DirectChannel>? =
        readList("directChannels") { DirectChannel.from(it) }

    fun putDirectChannels(channels: List<DirectChannel>) =
        writeList("directChannels", jsonArrayOfObjects(channels) { it.toJson() })

    suspend fun friends(): List<Friend>? = readList("friends") { Friend.from(it) }

    fun putFriends(friends: List<Friend>) =
        writeList("friends", jsonArrayOfObjects(friends) { it.toJson() })

    suspend fun members(): Map<String, List<ServerMember>>? =
        readMap("members") { array -> array.map { ServerMember.from(it) } }

    fun putMembers(members: Map<String, List<ServerMember>>) =
        writeMap("members", members.mapValues { (_, list) -> jsonArrayOfObjects(list) { it.toJson() } })

    suspend fun unread(): Map<String, Int>? = read("unread")?.let { stored ->
        runCatching {
            val json = JSONObject(stored)
            json.keys().asSequence().associateWith { json.getInt(it) }
        }.getOrNull()
    }

    fun putUnread(unread: Map<String, Int>) {
        val json = JSONObject()
        unread.forEach { (channelId, count) -> json.put(channelId, count) }
        write("unread", json.toString())
    }

    // --- messages ---

    /** The newest page of a channel, oldest first, as the screen wants it. */
    suspend fun messages(channelId: String): List<Message> =
        readMessages { it.latest(channelId, PAGE) }

    /** The page before [before], which is a `createdAt`, not an id. */
    suspend fun messagesBefore(channelId: String, before: String): List<Message> =
        readMessages { it.before(channelId, before, PAGE) }

    /**
     * Keeps everything, and is meant to: history that has been fetched once
     * should never need fetching again, and a few thousand rows of text is not
     * a size worth pruning. If it ever becomes one, prune by channel here.
     */
    fun putMessages(messages: List<Message>) {
        if (messages.isEmpty()) return
        scope.launch {
            runCatching {
                dao()?.writeMessages(
                    messages.map {
                        MessageRow(it.id, it.channelId, it.createdAt, it.toJson().toString())
                    },
                )
            }
        }
    }

    // --- plumbing ---

    private suspend fun dao(): CacheDao? {
        claimed.await()
        return db?.cache()
    }

    private suspend fun readMessages(query: suspend (CacheDao) -> List<MessageRow>): List<Message> =
        runCatching {
            val dao = dao() ?: return emptyList()
            query(dao).mapNotNull { row ->
                runCatching { Message.from(JSONObject(row.json)) }.getOrNull()
            }.sortedBy { it.createdAt }
        }.getOrDefault(emptyList())

    private suspend fun read(id: String): String? =
        runCatching { dao()?.read(id) }.getOrNull()

    private fun write(id: String, json: String) {
        scope.launch { runCatching { dao()?.write(CacheRow(id, json)) } }
    }

    private suspend fun <T> readList(id: String, parse: (JSONObject) -> T): List<T>? =
        read(id)?.let { stored -> runCatching { JSONArray(stored).map(parse) }.getOrNull() }

    private fun writeList(id: String, array: JSONArray) = write(id, array.toString())

    private suspend fun <T> readMap(id: String, parse: (JSONArray) -> List<T>): Map<String, List<T>>? =
        read(id)?.let { stored ->
            runCatching {
                val json = JSONObject(stored)
                json.keys().asSequence().associateWith { parse(json.getJSONArray(it)) }
            }.getOrNull()
        }

    private fun writeMap(id: String, byKey: Map<String, JSONArray>) {
        val json = JSONObject()
        byKey.forEach { (key, array) -> json.put(key, array) }
        write(id, json.toString())
    }
}
