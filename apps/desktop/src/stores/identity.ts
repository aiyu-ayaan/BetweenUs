import { create } from 'zustand';

/**
 * Where this machine stands on encryption keys, for the parts of the UI that
 * have to say something about it.
 *
 *  - `absent`  nobody is signed in yet
 *  - `ready`   the identity is loaded; `backedUp` says whether *this machine's*
 *              key is the one in the account backup, which is the difference
 *              between "portable account" and "one machine away from
 *              unreadable history". `provisional` says this machine minted its
 *              own key because it could not open the account's - so it reads
 *              what arrives from now on, and history is still sealed to an
 *              identity it does not hold
 *  - `revoked` the owner revoked this machine from another one. Nothing new is
 *              wrapped for it, so it can read what it already had and nothing
 *              since; saying so beats a screen of "no key on this device yet"
 *
 * There is no `locked`. A machine that cannot open the account backup mints a
 * key of its own and signs in anyway - see `services/e2ee.ts` - so there is no
 * state in which the app is signed in and waiting to be told a secret. That
 * fork used to be permanent; it is `provisional` now, and every later sign-in
 * with a secret that opens the backup undoes it.
 */
export type IdentityStatus =
  | { status: 'absent' }
  | { status: 'ready'; backedUp: boolean; provisional?: boolean }
  | { status: 'revoked' };

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
