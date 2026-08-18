package com.aktech.nexora.core.data

/**
 * The permissions a server may hand out, in the order every client lists them.
 *
 * The port of `ASSIGNABLE_PERMISSIONS` in `packages/permissions`. It lives here
 * rather than beside a screen because two screens need it - a member's own
 * grants and denials, and a custom role's bundle - and the copy that used to
 * sit next to the member sheet had drifted: it was missing `MANAGE_MESSAGE` and
 * `MANAGE_EMOJI`, so neither could be granted from this client at all. A list
 * that is wrong in one place is a feature that silently does not exist.
 *
 * The server is what enforces every one of them. This is only what to draw.
 */
val ASSIGNABLE_PERMISSIONS = listOf(
    "VIEW_CHANNEL",
    "SEND_MESSAGE",
    "DELETE_MESSAGE",
    "MANAGE_MESSAGE",
    "MANAGE_CHANNEL",
    "MANAGE_MEMBER",
    "MANAGE_ROLE",
    "MANAGE_EMOJI",
    "START_CALL",
    "MANAGE_CALL",
)

/** `MANAGE_MEMBER` as "manage member": the label, not the constant. */
fun permissionLabel(permission: String): String = permission.lowercase().replace('_', ' ')
