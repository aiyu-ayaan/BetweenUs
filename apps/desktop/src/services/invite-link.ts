/**
 * An invite as a link somebody can send.
 *
 * A code is eight characters of base32 and is perfectly good, right up to the
 * moment it has to travel: pasted into a chat it looks like a typo, and the
 * person receiving it has to be told where to type it. A link is the same code
 * with the answer to "where" attached.
 *
 * The link points at this deployment, because that is the one thing a code
 * cannot carry. Two Nexora deployments can both have an invite `k3m9x2qp` and
 * neither is wrong; a link says which.
 *
 * The parsing is pure and self-checked - it takes whatever somebody pasted,
 * which is a URL about half the time and a bare code the rest, and both have to
 * work. A field that accepts one and silently ignores the other is a field
 * people report as broken.
 */

/** Where an invite lands. Kept here so the writer and the reader cannot drift. */
export const INVITE_PATH = '/invite/';

/** The full link for a code, against a deployment's base URL. */
export function inviteLink(base: string, code: string): string {
  return `${base.replace(/\/+$/, '')}${INVITE_PATH}${encodeURIComponent(code)}`;
}

/**
 * The code inside whatever was pasted, or null when there is none.
 *
 * Accepts the link, the link with a query or a fragment on it, and the bare
 * code. Anything else is null rather than a guess: turning arbitrary text into
 * a code produces a join attempt that fails for a reason nobody can act on.
 */
export function inviteCodeFrom(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // A link, from anywhere - including another deployment's, which is worth
  // taking: the code is what matters and the server refuses one it never
  // issued, which is a clearer failure than pretending not to understand.
  const path = trimmed.match(/\/invite\/([^/?#\s]+)/i);
  if (path?.[1]) return decodeURIComponent(path[1]);

  // `?invite=` as well, because that is what a link that has been through an
  // email tracker or a chat preview often comes back as.
  const query = trimmed.match(/[?&]invite=([^&#\s]+)/i);
  if (query?.[1]) return decodeURIComponent(query[1]);

  // A bare code. Deliberately strict: letters and digits only, and no spaces,
  // so a sentence with the word "invite" in it does not become a code.
  if (/^[a-z0-9-]{4,64}$/i.test(trimmed)) return trimmed;

  return null;
}

const PENDING_KEY = 'nexora.pendingInvite';

/**
 * Takes the invite off the address bar, if this window was opened by one.
 *
 * Remembered rather than acted on: a link opened while signed out has to
 * survive a sign-in, an account creation and the page reload the server picker
 * does. Reading it clears the address bar, because a spent invite left in the
 * history is a link that rejoins on every refresh.
 */
export function captureInviteFromUrl(): void {
  if (typeof window === 'undefined') return;
  const code = inviteCodeFrom(window.location.href);
  if (!code) return;

  try {
    localStorage.setItem(PENDING_KEY, code);
  } catch {
    // No storage: the invite is still used this session, just not across one.
  }
  window.history.replaceState(null, '', window.location.pathname.startsWith(INVITE_PATH) ? '/' : window.location.pathname);
}

/** The invite waiting to be redeemed, if any. */
export function pendingInvite(): string | null {
  try {
    return localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

/** Forgets it - once redeemed, or once refused for a reason a retry will not fix. */
export function clearPendingInvite(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to clear.
  }
}
