package com.aatech.betweenus.core.store

import android.content.Context
import org.json.JSONArray

/**
 * Which channel categories somebody has folded away, per account and per
 * server, on this device.
 *
 * The desktop's `useCollapsedCategories`. Local on purpose: how tidy somebody
 * wants their own list is nobody else's business, and it needs no permission
 * and no migration. Signing out forgets all of it, like the other things this
 * phone keeps about an account.
 *
 * `SharedPreferences`, like [LastPlace]: a handful of id lists does not need a
 * database. Every failure is swallowed - a fold that did not persist comes
 * back open on the next launch, which is all it costs.
 */
object CollapsedCategories {
    /** Where the lists live. An interface so the rules can be tested without a device. */
    interface Store {
        fun read(key: String): String?
        fun write(key: String, value: String?)
        fun clear()
    }

    @Volatile
    private var store: Store? = null

    fun init(context: Context) {
        val prefs = context.applicationContext
            .getSharedPreferences("betweenus.collapsed-categories", Context.MODE_PRIVATE)
        use(
            object : Store {
                override fun read(key: String): String? = prefs.getString(key, null)
                override fun write(key: String, value: String?) {
                    prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
                }
                override fun clear() {
                    prefs.edit().clear().apply()
                }
            },
        )
    }

    internal fun use(backing: Store) {
        store = backing
    }

    internal fun keyOf(userId: String, serverId: String) = "$userId:$serverId"

    /** The folded category ids in a stored list; anything unreadable is "none". */
    internal fun parse(raw: String?): Set<String> {
        if (raw.isNullOrEmpty()) return emptySet()
        return runCatching {
            val array = JSONArray(raw)
            (0 until array.length()).mapNotNull { array.opt(it) as? String }.toSet()
        }.getOrDefault(emptySet())
    }

    /** What this account has folded in this server. Empty before [init]. */
    fun folded(userId: String, serverId: String): Set<String> =
        runCatching { parse(store?.read(keyOf(userId, serverId))) }.getOrDefault(emptySet())

    /** Folds or unfolds one category and writes it down. Returns the new set. */
    fun toggle(userId: String, serverId: String, categoryId: String): Set<String> {
        val current = folded(userId, serverId)
        val next = if (categoryId in current) current - categoryId else current + categoryId
        runCatching {
            store?.write(keyOf(userId, serverId), if (next.isEmpty()) null else JSONArray(next.toList()).toString())
        }
        return next
    }

    /** Sign-out: every account's folds go with it. */
    fun forget() {
        runCatching { store?.clear() }
    }
}
