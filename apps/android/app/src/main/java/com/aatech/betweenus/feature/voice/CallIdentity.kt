package com.aatech.betweenus.feature.voice

/**
 * The two rules that hang off a peer id, kept apart from the engine because
 * both were silently wrong for months and neither is reachable from a test
 * while it lives inside a class that needs WebRTC to construct.
 *
 * A peer id belongs to a *device*, not to an account and not to a socket. The
 * call service derives it from the device this connection named in its
 * handshake and announces it in `ready`, so a reconnect comes back under the
 * same name and the mesh is left alone.
 *
 * It was per socket, which is why [changed] exists at all: a phone that lost
 * its signalling for a second came back as a stranger, every link in the call
 * had been built against an id nobody could see any more, and the only way out
 * was to throw the whole mesh away and build it again. [changed] is now the
 * guard for the case that is left - an older service, or a build that names no
 * device - rather than the thing that happens on every train journey.
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
