package com.aatech.betweenus.core.data

/**
 * An invite as a link somebody can send.
 *
 * The port of `apps/desktop/src/services/invite-link.ts`, case for case. A code
 * is eight characters of base32 and is perfectly good right up to the moment it
 * has to travel: pasted into a chat it looks like a typo, and whoever receives
 * it has to be told where to type it. A link is the same code with the answer
 * to "where" attached, which matters more here than anywhere - BetweenUs is
 * self-hosted, so two deployments can both have an invite `k3m9x2qp` and
 * neither is wrong.
 */
object InviteLink {
    /** Where an invite lands. Kept in step with `INVITE_PATH` on the desktop. */
    const val PATH = "/invite/"

    /** The full link for a code, against a deployment's base URL. */
    fun of(base: String, code: String): String = base.trimEnd('/') + PATH + code

    /**
     * The code inside whatever was pasted, or null when there is none.
     *
     * Accepts the link, the link with a query or a fragment on it, and the bare
     * code, because what somebody pastes is a link about half the time and a
     * field that silently ignores one of the two is a field people report as
     * broken. Anything else is null rather than a guess: turning arbitrary text
     * into a code produces a join attempt that fails for a reason nobody can
     * act on.
     */
    fun codeIn(input: String): String? {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return null

        // A link from anywhere, including another deployment's: the code is
        // what matters, and a server refuses one it never issued - which is a
        // clearer failure than pretending not to understand.
        Regex("/invite/([^/?#\\s]+)", RegexOption.IGNORE_CASE).find(trimmed)?.let {
            return it.groupValues[1]
        }

        // `?invite=` as well, which is what a link often comes back as after a
        // chat preview or an email tracker has been through it.
        Regex("[?&]invite=([^&#\\s]+)", RegexOption.IGNORE_CASE).find(trimmed)?.let {
            return it.groupValues[1]
        }

        // A bare code. Deliberately strict, so a sentence with the word invite
        // in it does not become one.
        return if (Regex("^[a-zA-Z0-9-]{4,64}$").matches(trimmed)) trimmed else null
    }
}
