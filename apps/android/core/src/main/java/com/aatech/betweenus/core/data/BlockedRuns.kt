package com.aatech.betweenus.core.data

/**
 * Which messages in a list were written by somebody this account blocked, and
 * how they fold.
 *
 * A block closes the direct message; it does not take anybody out of a server
 * they share. So in a server channel their messages still arrive, and what the
 * person who blocked them asked for is not to have to read them - one quiet
 * "Blocked message - Show" row in place of each run. A client-side fold and
 * nothing more: the rows are the ones every other member sees, and showing
 * one is a choice about this screen only.
 *
 * The same rules as `apps/desktop/src/features/chat/blocked-runs.ts`.
 */
object BlockedRuns {

    /** One folded run. [head] is its first message, the key a reveal is kept under. */
    data class Run(val head: String, val count: Int)

    /**
     * Every folded message id, mapped to the run it belongs to. A message that
     * is absent is drawn as it always was.
     *
     * A run is broken by anybody else speaking, exactly as a bubble group is. A
     * webhook's message is not the person who created the webhook talking, and
     * an arrival line is the channel talking, so neither folds.
     */
    fun of(messages: List<Message>, blockedIds: Set<String>): Map<String, Run> {
        if (blockedIds.isEmpty()) return emptyMap()
        val runs = HashMap<String, Run>()
        val members = ArrayList<String>()

        fun close() {
            val first = members.firstOrNull() ?: return
            val run = Run(first, members.size)
            for (id in members) runs[id] = run
            members.clear()
        }

        for (message in messages) {
            val folds = message.author.id in blockedIds && message.kind == Message.KIND_USER
            if (folds) members.add(message.id) else close()
        }
        close()
        return runs
    }

    /** The words on the folded row. */
    fun label(count: Int): String = if (count == 1) "Blocked message" else "$count blocked messages"
}
