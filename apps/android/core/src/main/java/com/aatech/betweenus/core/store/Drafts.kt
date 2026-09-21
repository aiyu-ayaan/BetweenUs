package com.aatech.betweenus.core.store

import com.aatech.betweenus.core.data.MessageReply
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

/** What was left in a conversation's box: the text exactly as typed, and the reply if there was one. */
data class Draft(val text: String, val replyTo: MessageReply?)

/**
 * What somebody had started typing, per conversation, kept until they send it.
 *
 * The port of `apps/desktop/src/services/drafts.ts`, and the same three rules:
 *
 * - **Memory first.** The composer writes here on every keystroke and reads
 *   from here when it opens, so a conversation never opens on an empty box
 *   that fills a moment later.
 * - **Disk behind it**, as one row in [Cache] - debounced, because a Room
 *   write per letter is a write nobody needs. Living there is what makes a
 *   sign-out or a different account take the drafts with it: [Cache.clear] and
 *   [Cache.claim] are already the doors out.
 * - **Never to the server.** A draft is the one piece of plaintext this phone
 *   keeps, and it is the person's own words on their own device - the same
 *   trust as the text sitting in the box. Nothing here talks to the network.
 *
 * Every storage failure is swallowed: a draft that did not persist is one lost
 * on restart, and a composer that throws is one nobody can type into.
 */
object Drafts {
    /** How long typing has to pause before the draft is written down. */
    const val WRITE_DELAY_MS = 500L

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Any()
    private val loadLock = Mutex()

    private val drafts = mutableMapOf<String, Draft>()
    /**
     * Conversations whose box has been written to since the last read off
     * disk. Disk's copy of those is older than memory's - including when
     * memory's is "nothing, it was sent" - so the read leaves them alone.
     */
    private val touched = mutableSetOf<String>()

    @Volatile
    private var loaded = false
    private var pending: Job? = null

    /**
     * The conversations with something unsent in them, for the drawer's label.
     * Changes when a draft appears or goes, not on every letter.
     */
    private val _drafted = MutableStateFlow<Set<String>>(emptySet())
    val drafted: StateFlow<Set<String>> = _drafted.asStateFlow()

    /** What was left in a conversation's box, if anything. */
    fun draftFor(channelId: String): Draft? = synchronized(lock) { drafts[channelId] }

    /**
     * A draft worth keeping, or null for one that is nothing.
     *
     * Whitespace alone is nothing - a label saying "Draft" beside a box
     * somebody pressed space in would be a lie. A reply with no words yet is
     * something: choosing Reply is the start of a message.
     */
    internal fun kept(text: String, replyTo: MessageReply?): Draft? =
        if (text.isBlank() && replyTo == null) null else Draft(text, replyTo)

    /**
     * Reads the drafts off disk, once. Safe to call from every screen that
     * wants them; the second call is free.
     */
    suspend fun load() {
        if (loaded) return
        loadLock.withLock {
            if (loaded) return
            val stored = runCatching { Cache.drafts() }.getOrNull()?.let(::decode).orEmpty()
            synchronized(lock) {
                stored.forEach { (channelId, draft) ->
                    if (channelId !in touched) drafts[channelId] = draft
                }
                loaded = true
                publish()
            }
        }
    }

    /**
     * Remembers what is in a conversation's box. An empty box forgets it.
     * Memory now, disk after the pause.
     */
    fun save(channelId: String, text: String, replyTo: MessageReply?) {
        val next = kept(text, replyTo)
        synchronized(lock) {
            touched += channelId
            if (drafts[channelId] == next) return
            if (next == null) drafts.remove(channelId) else drafts[channelId] = next
            publish()
        }
        schedule(delayMs = WRITE_DELAY_MS)
    }

    /** A message went: its draft goes now, not after the pause. */
    fun clear(channelId: String) {
        synchronized(lock) {
            touched += channelId
            if (drafts.remove(channelId) == null) return
            publish()
        }
        schedule(delayMs = 0)
    }

    /**
     * Forgets every draft and drops the write that was waiting.
     *
     * For sign-out, before [Cache.clear]: that empties the disk, and a
     * debounced write landing half a second later would quietly fill it again -
     * or, worse, wait for the next account's claim and land in theirs.
     */
    fun forget() {
        synchronized(lock) {
            pending?.cancel()
            pending = null
            drafts.clear()
            touched.clear()
            loaded = false
            publish()
        }
    }

    private fun publish() {
        _drafted.value = drafts.keys.toSet()
    }

    private fun schedule(delayMs: Long) {
        synchronized(lock) {
            pending?.cancel()
            pending = scope.launch {
                delay(delayMs)
                // Only once the disk has been read: writing memory's map before
                // then would replace last session's drafts with this one's few.
                load()
                val snapshot = synchronized(lock) { drafts.toMap() }
                runCatching { Cache.putDrafts(encode(snapshot)) }
            }
        }
    }

    internal fun encode(drafts: Map<String, Draft>): String {
        val json = JSONObject()
        drafts.forEach { (channelId, draft) ->
            json.put(
                channelId,
                JSONObject()
                    .put("text", draft.text)
                    .put("replyTo", draft.replyTo?.toJson() ?: JSONObject.NULL),
            )
        }
        return json.toString()
    }

    /** Anything unreadable, or anything that is nothing, is dropped rather than thrown. */
    internal fun decode(stored: String): Map<String, Draft> = runCatching {
        val json = JSONObject(stored)
        json.keys().asSequence().mapNotNull { channelId ->
            val row = json.optJSONObject(channelId) ?: return@mapNotNull null
            val reply = row.optJSONObject("replyTo")?.let { MessageReply.from(it) }
            kept(row.optString("text"), reply)?.let { channelId to it }
        }.toMap()
    }.getOrDefault(emptyMap())
}
