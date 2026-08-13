import { create } from 'zustand';
import type { BackupSecretKind } from '@nexora/shared-types';

/**
 * Where this machine stands on encryption keys, for the parts of the UI that
 * have to say something about it.
 *
 *  - `absent`  nobody is signed in yet
 *  - `ready`   the identity is loaded; `backedUp` says whether it could be
 *              recovered elsewhere, which is the difference between "portable
 *              account" and "one machine away from unreadable history"
 *  - `locked`  a backup exists but nothing here can open it: the app must ask
 *              for the secret rather than mint a new identity, because a new
 *              identity silently orphans every key already sealed for the old
 */
export type IdentityStatus =
  | { status: 'absent' }
  | { status: 'ready'; backedUp: boolean }
  | { status: 'locked'; kind: BackupSecretKind };

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
