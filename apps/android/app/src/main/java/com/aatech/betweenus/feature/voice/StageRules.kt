package com.aatech.betweenus.feature.voice

/**
 * A pin, kept for the call rather than for the screen.
 *
 * The call screen is a composable, and backing out to the conversation - which
 * is what people do mid-call - throws its state away. A pin held there was
 * gone every time somebody came back. It lives on [VoiceEngine] now, which
 * belongs to the process, keyed by the channel it was made in.
 *
 * @property peerId the pinned peer, or [StageRules.SELF] for your own tile.
 * @property userId who that is, so a reconnect - which gives them a new peer
 *   id - still finds them. Null for yourself.
 */
data class StagePin(
    val channelId: String,
    val peerId: String,
    val userId: String?,
)

/**
 * The call stage's decisions, without Compose, so they can be unit-tested.
 *
 * The desktop's twins are `stage-order.ts` and `stage-pin.ts`; the hero rule
 * is the same one on both clients - a pin wins, and with nobody pinned the
 * stage goes to whoever spoke *last* and stays there.
 */
object StageRules {
    /** The pin that means your own tile. */
    const val SELF = "self"

    /** Just enough of a participant to decide with. */
    data class Seat(
        val peerId: String,
        val userId: String?,
        /** A camera or a joined share - something to look at. */
        val hasPicture: Boolean,
    )

    /**
     * Which peer the pin means on this stage: their peer id, [SELF], or null
     * when the pin is for another call or they are not here.
     *
     * The peer id first; then the user id, because a reconnect gave them a
     * new one.
     */
    fun resolvePin(pin: StagePin?, channelId: String?, seats: List<Seat>): String? {
        if (pin == null || pin.channelId != channelId) return null
        if (pin.peerId == SELF) return SELF
        seats.firstOrNull { it.peerId == pin.peerId }?.let { return it.peerId }
        val userId = pin.userId ?: return null
        return seats.firstOrNull { it.userId == userId }?.peerId
    }

    /**
     * Who takes the stage - and the picture-in-picture window, which is the
     * same decision with less room. Returns a peer id, or null for your own
     * tile.
     *
     * - A resolved pin wins, yourself included.
     * - Otherwise whoever spoke last, sticky, because a call is mostly gaps
     *   and falling back between two sentences flicks faces for the whole
     *   conversation.
     * - Nobody has spoken yet: the first with something to look at, then
     *   anybody at all. Alone in the call, yourself.
     */
    fun hero(seats: List<Seat>, pinned: String?, lastSpeaker: String?): String? {
        if (pinned == SELF) return null
        if (pinned != null && seats.any { it.peerId == pinned }) return pinned
        return seats.firstOrNull { it.peerId == lastSpeaker }?.peerId
            ?: seats.firstOrNull { it.hasPicture }?.peerId
            ?: seats.firstOrNull()?.peerId
    }

    /**
     * The pin after [left] hung up, with [remaining] still in the call. Only a
     * pin on that person goes: a pin on somebody who hung up would hold an
     * empty stage. Matched by user id as well, because a pin that followed
     * them to a new peer id still names the old one - unless another of their
     * devices is still here, which the pin then resolves to.
     *
     * [channelId] is the call [left] hung up from. A pin made in another call
     * is never touched, even by somebody with the same user id.
     */
    fun pinAfterLeft(pin: StagePin?, channelId: String?, left: Seat, remaining: List<Seat>): StagePin? {
        if (pin == null || pin.peerId == SELF || pin.channelId != channelId) return pin
        if (pin.peerId == left.peerId) return null
        val userId = pin.userId ?: return pin
        if (left.userId != userId) return pin
        return if (remaining.any { it.userId == userId }) pin else null
    }

    /**
     * The pin after [channelId]'s voice roster changed. The call is over when
     * it goes from somebody to nobody, and a pin kept for rejoining it has
     * nothing left to rejoin. A roster first heard empty says nothing.
     */
    fun pinAfterRoster(
        pin: StagePin?,
        channelId: String,
        before: List<String>,
        after: List<String>,
    ): StagePin? =
        if (pin?.channelId == channelId && before.isNotEmpty() && after.isEmpty()) null else pin

    /**
     * The share this client has joined, after the call changed: dropped once
     * that person is no longer sharing, so a stopped share puts the call back
     * rather than leaving a stage with nothing on it - and says so on the
     * wire, which is what lets their encoder stay off.
     */
    fun watchingAfter(watching: String?, sharers: Collection<String>): String? =
        watching?.takeIf { it in sharers }

    /**
     * Whether a peer has joined *this* client's share, from their `watching`:
     * a peer id, null for none, or absent for a client that has never said.
     * Absent reads as watching, because such a client shows every share it
     * receives. The desktop's `joinedShare` in `media-presence.ts`.
     */
    fun joinedShare(declared: Declared, self: String?): Boolean = when (declared) {
        Declared.Unsaid -> true
        Declared.Nobody -> false
        is Declared.Peer -> self != null && declared.peerId == self
    }

    /** `watching` as it came off the wire. */
    sealed interface Declared {
        data object Unsaid : Declared
        data object Nobody : Declared
        data class Peer(val peerId: String) : Declared
    }
}
