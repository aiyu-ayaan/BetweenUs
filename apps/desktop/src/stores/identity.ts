import { create } from 'zustand';

/**
 * Where this machine stands on encryption keys, for the parts of the UI that
 * have to say something about it.
 *
 *  - `absent`  nobody is signed in yet
 *  - `ready`   the vault is open on this machine. `recoverable` says whether a
 *              portable factor stands - a password, a passphrase or a recovery
 *              code - which is the difference between an account that survives
 *              losing every machine and one that does not
 *  - `locked`  the account has a vault and this machine cannot open it yet.
 *              It reads nothing and writes nothing until it can
 *  - `revoked` the owner revoked this machine from another one
 *
 * ## Why `locked` exists, having been deliberately avoided before
 *
 * v1 had no such state on purpose: a machine that could not open the account
 * backup minted a key of its own and signed in anyway, so that there was never
 * a screen asking for a secret nobody could supply.
 *
 * What that bought was a working sign-in. What it cost was the account. Such a
 * machine published a second identity, could read nothing already wrapped for
 * the first, and - holding no channel key - minted fresh epochs and dragged
 * conversations onto keys the rest of the account could not read either. The
 * banner people actually saw was "open BetweenUs on the device you first
 * signed in with", which is a message an app should never have to send.
 *
 * So the fork is gone and the honest state is back. A locked machine is not a
 * broken one: it has three ways out, all on one screen - a recovery code, a
 * passphrase, or approval from a machine that is already in - and none of them
 * can lose anything, because it has not written anything.
 */
export type IdentityStatus =
  | { status: 'absent' }
  | { status: 'ready'; recoverable: boolean }
  | { status: 'locked'; reason: LockedReason; grantRequested: boolean }
  | { status: 'revoked' };

/**
 * Why this machine cannot open the vault, which decides what the screen leads
 * with rather than what it offers - every route in is offered either way.
 */
export type LockedReason =
  /** Signed in from a stored token, or with a provider: no secret was to hand. */
  | 'no-secret'
  /** A secret was to hand and opened nothing. A wrong password, usually. */
  | 'wrong-secret'
  /** Waiting for somebody to approve this machine from one that is already in. */
  | 'awaiting-approval';

interface IdentityState {
  identity: IdentityStatus;
  setIdentityStatus: (next: IdentityStatus) => void;
}

export const useIdentityStore = create<IdentityState>((set) => ({
  identity: { status: 'absent' },
  setIdentityStatus: (next) => set({ identity: next }),
}));

export function setIdentityStatus(next: IdentityStatus): void {
  useIdentityStore.getState().setIdentityStatus(next);
}
