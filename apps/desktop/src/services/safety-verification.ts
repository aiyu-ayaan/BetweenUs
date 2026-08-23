/**
 * Who this machine has checked a safety number with, and what it was.
 *
 * Local, and deliberately so. Verification is the one piece of state in the
 * whole E2EE design that the server must not be able to set: a server that
 * could mark somebody verified could substitute their key and then reassure
 * the person about it, which is the exact attack safety numbers exist to
 * catch. So this never leaves the machine, never syncs, and a second device
 * verifies for itself.
 *
 * What is stored is the *number*, not a boolean. That is what turns this from a
 * checkbox into a warning: on the next look the current fingerprint is compared
 * with the one that was checked, and a person whose key set has changed since
 * reads as changed rather than as verified. Adding a phone does that as well as
 * an attack does, and the client cannot tell them apart - which is why the
 * wording says what happened rather than what it means.
 */
const STORAGE_KEY = 'betweenus.safety.verified';

export type VerificationState = 'unverified' | 'verified' | 'changed';

/** userId -> the thirty digits that were checked. */
type Verified = Record<string, string>;

function read(): Verified {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // Values that are not strings are dropped rather than trusted: this file is
    // editable by anybody with the machine, and a non-string here would flow
    // into a comparison that then never matches anything.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

function write(value: Verified): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // A machine that cannot store this is a machine that verifies afresh each
    // time, which is worse but not broken.
  }
}

/**
 * Where this person stands, given the fingerprint they have right now.
 *
 * An empty current fingerprint - somebody with no published device at all -
 * reads as unverified rather than as changed. There is nothing to compare, and
 * telling somebody their contact's key changed because the directory was empty
 * would be a false alarm that teaches them to ignore the real one.
 */
export function verificationOf(userId: string, fingerprint: string): VerificationState {
  const stored = read()[userId];
  if (!stored) return 'unverified';
  if (!fingerprint) return 'unverified';
  return stored === fingerprint ? 'verified' : 'changed';
}

/** Records that this machine's owner looked at that number and said yes. */
export function markVerified(userId: string, fingerprint: string): void {
  if (!fingerprint) return;
  write({ ...read(), [userId]: fingerprint });
}

/** Takes it back, which is what somebody does when the number stopped matching. */
export function clearVerified(userId: string): void {
  const next = read();
  delete next[userId];
  write(next);
}
