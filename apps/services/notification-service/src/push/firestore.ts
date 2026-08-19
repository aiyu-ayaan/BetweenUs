/**
 * The push device registry lives in Firestore.
 *
 * It is the one piece of BetweenUs state that is not in Postgres, and
 * deliberately: a registration token is Firebase's own identifier, it is
 * meaningless without the project that minted it, and it is the only thing here
 * whose lifetime is decided by Google rather than by us. Keeping it beside the
 * project that issues it means a deployment with no Firebase has no registry to
 * keep consistent, rather than a Postgres table full of tokens nobody can send
 * to.
 *
 * One document per (uid, installation), id `<uid>_<deviceId>`:
 *
 *   deviceTokens/{uid}_{deviceId}
 *     uid         the BetweenUs user id
 *     deviceId    client-minted, stable per installation
 *     token       the FCM registration token
 *     platform    android | ios | web
 *     label       "Pixel 8", untrusted, display only
 *     appVersion  the client build
 *     createdAt   / updatedAt
 *
 * Keyed on the installation and not on the token, because a token rotates - and
 * a collection keyed on it grows a document per rotation and then pushes to
 * every dead one.
 *
 * The database is created on first write: Firestore has no schema and no
 * migration, so the collection exists as soon as something is registered. The
 * one thing an operator must do is enable Firestore in the Firebase console
 * once - see FCM/README.md.
 */
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { firebaseApp } from './firebase';

export const DEVICE_COLLECTION = 'deviceTokens';

/** Firestore's own ceiling on an `in` query, which is what the fan-out uses. */
export const MAX_IN_CLAUSE = 30;

let store: Firestore | null = null;
let resolved = false;

/** Null when Firebase is not configured, exactly as `messaging()` is. */
export function firestore(): Firestore | null {
  if (!resolved) {
    resolved = true;
    const app = firebaseApp();
    if (app) {
      store = getFirestore(app);
      // A field this service never reads back is a field it should not fail on.
      store.settings({ ignoreUndefinedProperties: true });
    }
  }
  return store;
}

/** One document per installation per account, and the id says so. */
export function deviceDocumentId(uid: string, deviceId: string): string {
  return `${uid}_${deviceId}`;
}
