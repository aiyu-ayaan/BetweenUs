package com.aatech.betweenus.feature.voice

/**
 * When to try a broken link again, and when to stop trying.
 *
 * A phone loses its connection constantly - a lift, a train, a handover from
 * wifi to mobile - and a call is the thing that suffers most: the signalling
 * socket comes back on its own, but the peer connection carrying the media does
 * not, because ICE has already given up on the addresses it had.
 *
 * The policy is here and pure so it can be reasoned about without a call. Every
 * number in it is a trade between two failures that both look like a bug:
 * giving up on a link that would have come back, and pretending for a minute
 * that a call is still alive when it is not.
 */
object CallRecovery {

    /**
     * How long a `DISCONNECTED` link is left alone before anything is done.
     *
     * ICE recovers by itself surprisingly often - a lost packet or two on a
     * handover puts a connection here and it climbs out unaided within a couple
     * of seconds. Restarting immediately would throw away a link that was about
     * to be fine, and an ICE restart is not free: it is a renegotiation, and on
     * a bad network it is a renegotiation over the network that is bad.
     */
    const val GRACE_MS = 4_000L

    /** How many ICE restarts one link gets before it is declared lost. */
    const val MAX_ATTEMPTS = 4

    /**
     * The longest a link may spend not carrying media before it is given up on,
     * whatever the attempt count says.
     *
     * Half a minute of a frozen tile is already longer than anybody waits
     * before saying "I think you've frozen" - past that it is kinder to say so
     * than to keep a hopeful spinner up.
     */
    const val DEADLINE_MS = 30_000L

    /**
     * How long the whole call survives with no signalling.
     *
     * Longer than one link's deadline on purpose: the socket reconnects itself
     * and rejoins, and a train tunnel is a real thing that ends. But a call
     * whose switchboard has been unreachable for this long is a call nobody
     * else can see this device in - the roster dropped it long ago - so keeping
     * the microphone open is a lie told to its owner.
     */
    const val SIGNALLING_DEADLINE_MS = 45_000L

    /**
     * How long a call with nobody else in it stays up.
     *
     * Joining an empty channel and waiting for somebody is normal, and being
     * left in one after the last person leaves is what happens at the end of
     * every meeting. What is not normal is a phone holding a microphone open
     * and a foreground service running for the rest of the afternoon because a
     * call was never left. Five minutes is long enough to be waiting for
     * somebody and short enough not to be a battery complaint.
     */
    const val ALONE_MS = 5 * 60 * 1000L

    /**
     * Which side restarts ICE.
     *
     * The impolite one, and only it. An ICE restart has to become an offer to
     * do anything at all, and only the impolite side offers - that is the whole
     * of the perfect-negotiation rule this call already follows. The polite
     * side calling `restartIce()` marks its connection as wanting a
     * renegotiation that it will never start, which looks like a recovery
     * attempt in a log and is not one.
     *
     * So the polite side waits. If the impolite side is alive it will offer; if
     * it is not, the roster is what says so.
     */
    fun restarts(polite: Boolean): Boolean = !polite

    /**
     * How long to wait before attempt [attempt], counting from one.
     *
     * Backed off, because the reason the first restart failed is usually that
     * the network is still bad, and four restarts inside a second is four
     * renegotiations that all fail together. Capped so the last attempt still
     * happens inside [DEADLINE_MS].
     */
    fun backoffMs(attempt: Int): Long = when {
        attempt <= 1 -> 0L
        attempt == 2 -> 2_000L
        attempt == 3 -> 4_000L
        else -> 8_000L
    }

    /**
     * Whether a link that has been down for [downForMs] across [attempts]
     * restarts should be given up on.
     *
     * Either bound is enough. The attempt count catches a link that is failing
     * fast and repeatedly; the deadline catches one that is failing slowly, or
     * that never reports a failure at all and simply sits in `DISCONNECTED`.
     */
    fun spent(attempts: Int, downForMs: Long): Boolean =
        attempts >= MAX_ATTEMPTS || downForMs >= DEADLINE_MS
}
