package com.aatech.betweenus.core.data

import org.json.JSONObject
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

// --- creating one ---

/**
 * What the server is told about a new poll: numbers, never words. The desktop's
 * `CreatePollSettings`. [durationSeconds] is one of [Polls.DURATIONS], or null
 * for a poll that runs until somebody closes it.
 */
data class PollSettings(
    val optionCount: Int,
    val multiChoice: Boolean,
    val durationSeconds: Int?,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("optionCount", optionCount)
        .put("multiChoice", multiChoice)
        .put("durationSeconds", durationSeconds ?: JSONObject.NULL)
}

/** A composer's draft checked: the words to seal, or why not. */
sealed interface PollReady {
    data class Ok(val question: String, val options: List<String>) : PollReady
    data class Refused(val reason: String) : PollReady
}

/**
 * The composer's rules, the same as the desktop's `readyPoll` in
 * `apps/desktop/src/services/polls.ts`. The server cannot check any of the
 * word limits - it never sees the words - so every client has to.
 */
object Polls {
    /** `POLL_QUESTION_MAX_CHARS` and `POLL_OPTION_MAX_CHARS`. */
    const val QUESTION_MAX_CHARS = 300
    const val OPTION_MAX_CHARS = 80

    /** A choice in the "closes" picker. Null seconds is "no limit". */
    data class Duration(val seconds: Int?, val label: String)

    /** An hour, a day, three days, a week: `POLL_DURATIONS`, the only lengths the server takes. */
    val DURATIONS: List<Duration> = listOf(
        Duration(null, "No limit"),
        Duration(3600, "1 hour"),
        Duration(86400, "1 day"),
        Duration(259200, "3 days"),
        Duration(604800, "1 week"),
    )

    /**
     * Empty option rows are dropped rather than refused - the composer always
     * has a spare one to type into - and duplicates are refused, because two
     * identical labels are a poll whose result nobody can read.
     */
    fun ready(question: String, options: List<String>): PollReady {
        val asked = question.trim()
        if (asked.isEmpty()) return PollReady.Refused("Ask a question")
        if (asked.length > QUESTION_MAX_CHARS) {
            return PollReady.Refused("Keep the question under $QUESTION_MAX_CHARS characters")
        }
        val offered = options.map { it.trim() }.filter { it.isNotEmpty() }
        if (offered.size < MessageBody.POLL_MIN_OPTIONS) {
            return PollReady.Refused("Give at least ${MessageBody.POLL_MIN_OPTIONS} options")
        }
        if (offered.size > MessageBody.POLL_MAX_OPTIONS) {
            return PollReady.Refused("A poll has at most ${MessageBody.POLL_MAX_OPTIONS} options")
        }
        if (offered.any { it.length > OPTION_MAX_CHARS }) {
            return PollReady.Refused("Keep each option under $OPTION_MAX_CHARS characters")
        }
        if (offered.map { it.lowercase() }.toSet().size != offered.size) {
            return PollReady.Refused("Two options say the same thing")
        }
        return PollReady.Ok(asked, offered)
    }
}
