package com.aatech.betweenus.feature.voice

/**
 * The two rules that hang off a peer id, kept apart from the engine because
 * both were silently wrong for months and neither is reachable from a test
 * while it lives inside a class that needs WebRTC to construct.
 *
 * A peer id belongs to a *socket*, not to an account and not to a call. The
 * call service mints one when a connection opens and announces it once, in
 * `ready`. Any new socket is a new identity, and everything below is computed
 * from it - which is why an identity that has quietly moved on is not a
 * cosmetic problem.
 */
internal object CallIdentity {

    /**
     * Whether this end yields on a collision. Both ends compute it from the
     * same two strings, so they always disagree - which is the point: exactly
     * one of them offers, and exactly one of them rolls back.
     *
     * Computed from an id the other end has never seen, both can come out
     * polite - and then nobody offers at all, and every tile sits on
     * "Connecting…" for the life of the call.
     */
    fun polite(self: String, peer: String): Boolean = self > peer

    /**
     * Whether a `ready` is announcing a *different* identity than the one the
     * call is already built on. True means the peer links were built against
     * an id nobody else can see any more, and have to go.
     */
    fun changed(held: String?, announced: String): Boolean =
        held != null && announced.isNotEmpty() && held != announced
}
