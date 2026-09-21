package com.aatech.betweenus.core.data

import java.time.Instant

/**
 * What a poll card draws, worked out from the referee's counts and the labels
 * out of the sealed body. Pure, and the same arithmetic as the desktop's
 * `apps/desktop/src/services/polls.ts` - asserted case for case in PollViewTest.
 */
data class PollBar(
    val option: Int,
    val label: String,
    val count: Int,
    /** Share of the people who voted, not of the ballots cast. */
    val percent: Int,
    val mine: Boolean,
    val userIds: List<String>,
)

data class PollView(
    val bars: List<PollBar>,
    val voters: Int,
    val closed: Boolean,
    val multiChoice: Boolean,
    val mine: List<Int>,
) {
    /**
     * The ballot that tapping [option] produces. Single choice: tapping your
     * choice takes it back, tapping another moves it. Multi choice: toggles
     * that one and leaves the rest. The whole ballot is what is sent, so the
     * server's answer is idempotent.
     */
    fun ballotAfter(option: Int): List<Int> {
        val had = option in mine
        if (!multiChoice) return if (had) emptyList() else listOf(option)
        return if (had) mine.filter { it != option } else (mine + option).sorted()
    }
}

/** Whether voting has stopped: closed early, or past `closesAt`. */
fun MessagePoll.isClosed(now: Long = System.currentTimeMillis()): Boolean {
    if (closedAt != null) return true
    val at = closesAt ?: return false
    return runCatching { Instant.parse(at).toEpochMilli() }.getOrNull()?.let { it <= now } ?: false
}

fun MessagePoll.view(labels: List<String>, selfId: String, now: Long = System.currentTimeMillis()): PollView {
    val voters = tallies.flatMap { it.userIds }.toSet().size
    val bars = (0 until optionCount).map { option ->
        val ids = tallies.firstOrNull { it.option == option }?.userIds.orEmpty()
        PollBar(
            option = option,
            // A missing label is named rather than dropped.
            label = labels.getOrNull(option) ?: "Option ${option + 1}",
            count = ids.size,
            percent = if (voters == 0) 0 else Math.round(ids.size * 100f / voters),
            mine = selfId in ids,
            userIds = ids,
        )
    }
    return PollView(
        bars = bars,
        voters = voters,
        closed = isClosed(now),
        multiChoice = multiChoice,
        mine = bars.filter { it.mine }.map { it.option },
    )
}
