/**
 * Client side of end-to-end encryption: device identity, channel-key exchange,
 * and the encrypt/decrypt calls the chat and call features use.
 *
 * The server is a courier here. It stores public keys and sealed blobs, decides
 * who may publish them, and never holds anything that opens a message.
 */
import type {
  BackupSecretKind,
  ChannelKeyEntry,
  ChannelKeysResponse,
  EncryptedEnvelope,
  IdentityBackup,
} from '@betweenus/shared-types';
import { ApiError, api } from './api';
import { setIdentityStatus } from '../stores/identity';
import {
  decryptBytes,
  decryptMessage,
  encryptBytes,
  encryptMessage,
  generateChannelKey,
  generateIdentity,
  openIdentity,
  parseEnvelope,
  sealIdentity,
  unwrapChannelKey,
  wrapChannelKey,
  type IdentityKeyPair,
} from './e2ee-crypto';

/**
 * Shown instead of a message we hold no key for. Never throws into the UI.
 *
 * Two words, because it is drawn once per message and a sentence repeated down
 * a whole screen is not eight times as informative as one - the explanation and
 * what to do about it belong in the single line the channel draws above them.
 */
export const UNDECRYPTABLE = '\u{1F512} Encrypted';

export class MissingChannelKeyError extends Error {
  constructor() {
    super('No channel key on this device yet');
    this.name = 'MissingChannelKeyError';
  }
}


/** What opens the backup. Held only for the moment a sign-in needs it. */
export interface BackupSecret {
  value: string;
  kind: BackupSecretKind;
}

interface ChannelKeyState {
  epoch: number;
  /** Every epoch this device can open, so old history stays readable. */
  keys: Map<number, string>;
}

let identity: IdentityKeyPair | null = null;
let identityUserId: string | null = null;
/** Set by initIdentity; everything that needs a key awaits it. */
let identityReady: Promise<IdentityKeyPair> | null = null;
const channels = new Map<string, ChannelKeyState>();
const inFlight = new Map<string, Promise<ChannelKeyState>>();
/**
 * Channels this session has already tried to re-key for itself. Without it, a
 * device that cannot open its own wrapped keys - a corrupt identity, a public
 * key in the directory that is not ours - would mint a fresh epoch every time
 * the channel is opened and drag the whole channel along with it.
 */
const rekeyed = new Set<string>();

/**
 * The secret this session signed in with, kept for the length of the session.
 *
 * It used to be an argument and nothing else, so a sign-in whose identity setup
 * failed once - the network dropped, the token was a moment late - lost it. The
 * retry then ran with no secret at all, could not open the account backup, and
 * minted a machine-local key instead, which is permanent (see `loadIdentity`).
 * A password typed into a login form is dropped when the session ends, and that
 * is the only thing keeping it here has to guarantee.
 */
let signInSecret: BackupSecret | null = null;

/**
 * What the keychain holds. `provisional` marks a key this machine minted for
 * itself *while the account had a backup it could not open* - the fork
 * described in `loadIdentity`. It is the flag that makes the fork recoverable:
 * without it the stored key short-circuits every later launch and the backup is
 * never tried again, on any sign-in, ever.
 */
interface StoredIdentity extends IdentityKeyPair {
  provisional?: boolean;
}

/**
 * Loads this device's identity key and publishes the public half. Called once
 * per sign-in, with the password when there is one to hand.
 *
 * It never fails for want of a secret, and it never asks for one. See
 * `loadIdentity` for why a machine that cannot open the account backup mints
 * its own key rather than stopping to ask.
 */
export function initIdentity(userId: string, secret?: BackupSecret): Promise<IdentityKeyPair> {
  if (identityReady && identityUserId === userId) return identityReady;

  identityUserId = userId;
  // Held past this call on purpose: the retry below has no secret of its own,
  // and a retry without one forks the identity permanently.
  if (secret) signInSecret = secret;
  // A failure here - the network was down, the token had not been minted yet -
  // must not be remembered. Keeping the rejected promise left the device
  // unregistered for the whole session, and every channel it tried to key
  // afterwards ended in "No channel key on this device yet".
  identityReady = loadIdentity(userId, secret ?? signInSecret ?? undefined).catch((error: unknown) => {
    if (identityUserId === userId) identityReady = null;
    throw error;
  });
  return identityReady;
}

async function loadIdentity(userId: string, secret?: BackupSecret): Promise<IdentityKeyPair> {
  const storageKey = `identity:${userId}`;
  const stored = await secureGet(storageKey);

  if (stored) {
    const saved = JSON.parse(stored) as StoredIdentity;
    const pair: IdentityKeyPair = { publicKey: saved.publicKey, privateKey: saved.privateKey };

    // A machine that forked gets another go, every time a secret is at hand.
    // This is the whole of "sign in on a new phone and your messages are
    // there": the fork below is silent and one-way, so the only thing that
    // makes it recoverable is trying the backup again on the next sign-in
    // rather than short-circuiting on the key the fork left behind.
    if (saved.provisional && secret) {
      const recovered = await restoreFromBackup(storageKey, secret);
      if (recovered) return recovered;
    }

    await adopt(pair, false, saved.provisional === true);
    // A machine that already worked may still have no backup - it predates
    // this, or nobody could supply a secret at the time. Fix it quietly when a
    // secret is at hand rather than waiting for the next reinstall to notice.
    void ensureBackup(pair, secret);
    return pair;
  }

  // A failed fetch must not be read as "there is no backup": that would seal a
  // fresh key over one that exists. It throws, and the sign-in retries.
  const { backups } = await identityBackups();

  // The account's own key, when the secret that opens it is at hand. This is
  // the good path and the only instant one: every epoch already sealed for
  // that identity opens the moment it lands, with nothing to wait for.
  if (secret) {
    const recovered = await restoreFromBackup(storageKey, secret, backups);
    if (recovered) return recovered;
  }

  // Otherwise this machine gets a key of its own, and the sign-in carries on.
  //
  // It used to stop here and ask - and asking is not something every sign-in
  // can answer. A GitHub sign-in has no account password to offer, and an
  // account that has only ever signed in that way has no password at all, so
  // the question had no answer and the app sat behind a box nobody could fill.
  //
  // Minting is safe because a channel key is wrapped per *device*, not per
  // account: this machine publishes its own public key under its own device id
  // and takes nothing away from the machines already in the directory. History
  // arrives from them - `fillGaps` hands every epoch a machine holds to the
  // owner's machines that are missing it - so the account converges without
  // anyone typing anything.
  //
  // What it costs: history is not instant. It appears as the other machines
  // open those channels. An account whose only other machine is offline, or
  // which has none, reads what arrives from now on until one of them is back.
  // Settings -> Encryption is where somebody who wants it sooner can say so.
  //
  // The fork is marked when the account *had* a backup this machine could not
  // open, and that mark is what lets the next sign-in undo it. Unmarked means
  // there was nothing to restore from, so this key is the account's own.
  const provisional = backups.length > 0;
  const pair = await generateIdentity();
  await secureSet(storageKey, JSON.stringify({ ...pair, provisional } satisfies StoredIdentity));
  await adopt(pair, false, provisional);
  await ensureBackup(pair, secret);
  return pair;
}

/**
 * Opens whichever backup `secret` fits and makes it this machine's identity.
 *
 * Null means "not this secret" - a wrong password, or a passphrase-only account
 * signing in with a password - which is an ordinary outcome, not a failure.
 *
 * Every channel key held on this machine is dropped on the way out. They are
 * still valid, but they are the *subset* a forked identity could reach, and the
 * caches in front of them would keep serving that subset while the wraps this
 * identity can now open sat unread in the directory. Dropping them costs one
 * re-read of a directory we have just been talking to.
 */
async function restoreFromBackup(
  storageKey: string,
  secret: BackupSecret,
  known?: IdentityBackup[],
): Promise<IdentityKeyPair | null> {
  const backups = known ?? (await identityBackups()).backups;
  const sealed = backups.find((it) => it.kind === secret.kind);
  if (!sealed) return null;

  const pair = await openBackup(sealed, secret);
  if (!pair) return null;

  await secureSet(storageKey, JSON.stringify({ ...pair } satisfies StoredIdentity));
  channels.clear();
  inFlight.clear();
  rekeyed.clear();
  missedEpochs.clear();
  await adopt(pair, true);
  return pair;
}

/**
 * The account's sealed identities. Reads the list, falling back to the single
 * blob a server older than per-kind backups sends.
 */
async function identityBackups(): Promise<{ backups: IdentityBackup[] }> {
  const response = await api.identityBackup();
  if (response.backups) return { backups: response.backups };
  return { backups: response.backup ? [response.backup] : [] };
}

/** The wrong secret is an ordinary outcome here, not an error: null, and on. */
async function openBackup(
  backup: IdentityBackup,
  secret: BackupSecret,
): Promise<IdentityKeyPair | null> {
  try {
    return await openIdentity(backup, secret.value);
  } catch {
    return null;
  }
}

/** Publishes the public half and marks this machine ready. */
async function adopt(
  pair: IdentityKeyPair,
  backedUp = false,
  provisional = false,
): Promise<void> {
  identity = pair;
  try {
    // Idempotent: re-publishing keeps the directory correct if the row was
    // lost, and refreshes when this machine was last seen.
    await api.registerDeviceKey({
      deviceId: deviceId(),
      publicKey: pair.publicKey,
      label: deviceLabel(),
    });
  } catch (error) {
    // Revoked from another machine. Not an error to retry and not a reason to
    // mint a new id - minting one is how a revoked machine would walk straight
    // back into the directory, which would make revoking it meaningless.
    if (error instanceof ApiError && error.code === 'DEVICE_REVOKED') {
      setIdentityStatus({ status: 'revoked' });
      throw error;
    }
    throw error;
  }
  setIdentityStatus({ status: 'ready', backedUp, provisional });
}

const DEVICE_ID_KEY = 'betweenus.deviceId';

/**
 * Which machine this is, as far as the key directory is concerned.
 *
 * Minted here and never by the server: it identifies an installation, and an
 * installation is the only thing that knows it is one. It survives sign-out and
 * a change of account on purpose - the machine has not changed - and it is not
 * a secret: it is published beside a public key.
 *
 * Losing it (a cleared profile, a fresh container) means the next launch looks
 * like a new device and gets wrapped for as one, which is the correct answer
 * rather than a failure.
 */
export function deviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;
    const minted = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, minted);
    return minted;
  } catch {
    // No storage at all: a per-session id, which is worse than a stable one and
    // far better than refusing to publish a key.
    return `session-${crypto.randomUUID()}`;
  }
}

/**
 * What to call this machine in a list of them. A guess from the user agent, and
 * deliberately a rough one: it is a label to recognise a row by, not identity,
 * and the server treats it as the untrusted string it is.
 */
function deviceLabel(): string {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const platform =
    /Windows/i.test(agent) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(agent) ? 'macOS'
    : /Android/i.test(agent) ? 'Android'
    : /Linux/i.test(agent) ? 'Linux'
    : 'Unknown';
  // Electron's user agent says Chrome too, so the runtime is asked separately.
  const shell = typeof window !== 'undefined' && window.betweenus ? 'BetweenUs' : 'Browser';
  return `${shell} on ${platform}`;
}

/**
 * Uploads a backup when the account has none for this identity and a secret is
 * available to seal it with. Never throws into a sign-in: an account without a
 * backup still works, it is only unrecoverable, and the settings panel says so.
 */
async function ensureBackup(pair: IdentityKeyPair, secret?: BackupSecret): Promise<void> {
  try {
    const { backups } = await identityBackups();
    const backedUp = backups.some((it) => it.publicKey === pair.publicKey);

    // A backup that already stands is not this machine's to replace unless it
    // is this machine's key in it. Since a machine that could not open one
    // mints its own, sealing over it here would take the account's recoverable
    // identity away from every machine still restoring from it - quietly, and
    // for good. Deliberately re-sealing is `backupIdentity`'s job, not this.
    //
    // Scoped to the *kind* now. An account that has a passphrase backup and no
    // password one is exactly the account that cannot recover on a fresh
    // sign-in, so filling that gap when the password is at hand is the point
    // rather than an overreach - and it only ever seals the key this machine
    // already holds, which is the identity the other machines restore from
    // whenever `backedUp` says so.
    if (!secret || backups.some((it) => it.kind === secret.kind) || !backedUp) {
      setIdentityStatus({
        status: 'ready',
        backedUp,
        provisional: backups.length > 0 && !backedUp,
      });
      return;
    }
    await api.putIdentityBackup(await sealIdentity(pair, secret.value, secret.kind));
    setIdentityStatus({ status: 'ready', backedUp: true });
  } catch {
    // Offline, or the server is older than this client. Nothing is lost that
    // was not already missing.
  }
}

/**
 * Seals the current identity under a secret the user chose, for an account that
 * has no password to derive from - a provider sign-in - or for anyone who would
 * rather not tie the two together.
 */
export async function backupIdentity(secret: BackupSecret): Promise<void> {
  const pair = await currentIdentity();
  await api.putIdentityBackup(await sealIdentity(pair, secret.value, secret.kind));
  setIdentityStatus({ status: 'ready', backedUp: true });
}

/**
 * Whether the account password can still recover this identity on a machine
 * that has never seen it.
 *
 * The one thing a settings panel has to be able to say plainly, because it is
 * the difference between "sign in anywhere" and "sign in anywhere and type a
 * passphrase you wrote down once".
 */
export async function passwordRecoveryEnabled(): Promise<boolean> {
  const { backups } = await identityBackups();
  return backups.some((it) => it.kind === 'password');
}

/**
 * Turns the password path off, for somebody who set a recovery passphrase
 * *because* a live server sees the password at sign-in and they would rather it
 * could not open anything.
 *
 * Refuses when it would leave the account with no backup at all, which is not a
 * security setting - it is losing every message on the next reinstall.
 */
export async function setPasswordRecovery(
  enabled: boolean,
  password?: string,
): Promise<void> {
  if (enabled) {
    if (!password) throw new Error('The account password is needed to seal a backup with it');
    await backupIdentity({ value: password, kind: 'password' });
    return;
  }
  const { backups } = await identityBackups();
  if (!backups.some((it) => it.kind === 'passphrase')) {
    throw new Error('Set a recovery passphrase first, or this account has no way back at all');
  }
  await api.deleteIdentityBackup('password');
}

/**
 * Re-seals the backup after a password change. Skipped silently when the backup
 * is keyed to a passphrase instead, which a password change does not touch.
 */
export async function rewrapBackupForPassword(newPassword: string): Promise<void> {
  const { backups } = await identityBackups();
  if (!backups.some((it) => it.kind === 'password')) return;
  await backupIdentity({ value: newPassword, kind: 'password' });
  // The secret this session holds is now the old one, and a retry that used it
  // would fail to open the blob it just re-sealed.
  signInSecret = { value: newPassword, kind: 'password' };
}

export function resetE2ee(): void {
  // Key material is per-user; a sign-out must not leak it into the next session.
  identity = null;
  identityUserId = null;
  identityReady = null;
  signInSecret = null;
  channels.clear();
  inFlight.clear();
  rekeyed.clear();
  missedEpochs.clear();
  setIdentityStatus({ status: 'absent' });
}

export async function encryptForChannel(channelId: string, plaintext: string): Promise<string> {
  const state = await ensureChannelKey(channelId);
  const key = state.keys.get(state.epoch);
  if (!key) throw new MissingChannelKeyError();
  const envelope = await encryptMessage(plaintext, key, state.epoch);
  return JSON.stringify(envelope);
}

/** Never throws: undecryptable content renders as a placeholder. */
export async function decryptForChannel(channelId: string, content: string): Promise<string> {
  const envelope = parseEnvelope(content);
  // Messages written before E2EE (and any future plaintext system message).
  if (!envelope) return content;

  try {
    const key = await keyForEpoch(channelId, envelope.epoch);
    return await decryptMessage(envelope, key);
  } catch {
    return UNDECRYPTABLE;
  }
}

/**
 * Seals a file under the channel's current key. The epoch comes back with it,
 * because the recipient has to know which generation opens it - the same
 * bookkeeping `EncryptedEnvelope` does for a message.
 */
export async function encryptFileForChannel(
  channelId: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<{ ciphertext: Uint8Array<ArrayBuffer>; iv: string; epoch: number }> {
  const state = await ensureChannelKey(channelId);
  const key = state.keys.get(state.epoch);
  if (!key) throw new MissingChannelKeyError();
  const { iv, ciphertext } = await encryptBytes(bytes, key);
  return { ciphertext, iv, epoch: state.epoch };
}

/** Throws rather than returning a placeholder: a file either opens or it does not. */
export async function decryptFileForChannel(
  channelId: string,
  ciphertext: Uint8Array<ArrayBuffer>,
  iv: string,
  epoch: number,
): Promise<Uint8Array<ArrayBuffer>> {
  return decryptBytes(ciphertext, iv, await keyForEpoch(channelId, epoch));
}

/**
 * The channel key, for the one thing a call still needs it for: signing this
 * client's DTLS fingerprint so the signalling server cannot substitute one of
 * its own and stand in the middle of a peer connection. The media itself is
 * encrypted by DTLS-SRTP between the two peers, with no server in between to
 * keep it from - see `mesh.ts`.
 */
export async function callKeyForChannel(channelId: string, refresh = false): Promise<string> {
  // `refresh` is what a call asks for when somebody new arrives: joining a
  // channel you hold no key for mints the next epoch, so the newcomer's key is
  // a generation ahead of the one everybody in the call snapshotted. Without
  // the re-read the two sides sign with different keys and refuse each other.
  if (refresh) channels.delete(channelId);
  const state = await ensureChannelKey(channelId);
  const key = state.keys.get(state.epoch);
  if (!key) throw new MissingChannelKeyError();
  return key;
}

/**
 * Re-wraps the keys this machine holds for the machines that hold none. Called
 * when a channel is opened, so a member who joined after a key was minted -
 * and a second machine somebody signed in on yesterday - becomes able to read
 * without anyone restarting anything.
 */
export async function syncChannelKeys(channelId: string): Promise<void> {
  const state = await ensureChannelKey(channelId);
  const key = state.keys.get(state.epoch);
  if (!key) return;

  const latest = await api.channelKeys(channelId);
  if (latest.epoch !== state.epoch) return;

  // Somebody who is no longer a member holds this key, so everything sent from
  // now on has to be sealed with a different one. Rotating is a job for a
  // holder, which is us: the server has no key and could not mint one that
  // meant anything.
  if (latest.rekeyNeeded) {
    await rekeyChannel(channelId, state.epoch);
    return;
  }

  await fillGaps(channelId, state, latest);
}

/**
 * Hands every epoch this machine holds to the machines that are missing it.
 *
 * This is what makes a second device able to read *history* rather than only
 * what is written after it arrives. The old answer re-wrapped the current epoch
 * and nothing else, so a machine signing in today was missing every epoch
 * before today, could not re-wrap them for itself (it holds none of them), and
 * had nobody looking on its behalf - it minted a fresh epoch and the whole
 * conversation before that moment stayed a padlock for good.
 *
 * Failures are per epoch and never fatal. A racing rotation, a device revoked
 * between the read and the write, a member removed - each of them fails one
 * wrap, and none of them is a reason to stop opening the channel.
 */
async function fillGaps(
  channelId: string,
  state: ChannelKeyState,
  latest: ChannelKeysResponse,
): Promise<void> {
  for (const gap of latest.gaps) {
    const key = state.keys.get(gap.epoch);
    // An epoch we cannot open is not ours to hand out, and the server would
    // refuse it anyway: only a holder may add to an existing epoch.
    if (!key || gap.devices.length === 0) continue;
    try {
      await shareKey(channelId, gap.epoch, key, gap.devices);
    } catch {
      // Somebody else got there first, or one of those devices has just been
      // revoked. Either way the next open asks again.
    }
  }
}

/**
 * Mints the next epoch and seals it for the people who are members *now*.
 *
 * This is what makes removing somebody from a private channel mean anything.
 * Their key still opens every message sent before this moment - there is no
 * taking a key back off a machine, and any design that claims otherwise is
 * lying - but it opens nothing after it.
 *
 * The local state is dropped rather than extended, so the next send goes out
 * under the new epoch even if the publish raced somebody else's: whoever won,
 * the re-read finds the epoch that counts.
 */
export async function rekeyChannel(channelId: string, currentEpoch: number): Promise<void> {
  try {
    await createChannelKey(channelId, currentEpoch + 1);
  } finally {
    channels.delete(channelId);
    for (const seen of [...missedEpochs]) {
      if (seen.startsWith(`${channelId}#`)) missedEpochs.delete(seen);
    }
  }
  await ensureChannelKey(channelId);
}

/**
 * Epochs this client has already gone back to the directory for and still not
 * found. Without it, a channel with one genuinely unreadable message would
 * re-read the key directory on every render of that message.
 */
const missedEpochs = new Set<string>();

async function keyForEpoch(channelId: string, epoch: number): Promise<string> {
  const cached = channels.get(channelId)?.keys.get(epoch);
  if (cached) return cached;

  const state = await ensureChannelKey(channelId);
  const key = state.keys.get(epoch);
  if (key) return key;

  // An epoch we hold nothing for, on a channel we already loaded. Somebody
  // re-keyed it while we were holding the old one - a member who joined after
  // it was minted and could not wait for a re-wrap does exactly that - and our
  // cached state is now behind. Re-read once.
  //
  // Without this the two clients sit on different epochs until one of them is
  // restarted, each rendering the other's messages as "no key on this device",
  // and each *sending* under its own stale epoch so the other cannot read the
  // reply either. Reloading also moves this client onto the newer epoch, which
  // is what makes the next message readable in both directions.
  const seen = `${channelId}#${epoch}`;
  if (missedEpochs.has(seen)) throw new MissingChannelKeyError();
  missedEpochs.add(seen);

  channels.delete(channelId);
  const reloaded = await ensureChannelKey(channelId);
  const fresh = reloaded.keys.get(epoch);
  if (!fresh) throw new MissingChannelKeyError();

  // It was there after all, so anything else we gave up on for this channel
  // deserves another go.
  for (const key of [...missedEpochs]) {
    if (key.startsWith(`${channelId}#`)) missedEpochs.delete(key);
  }
  return fresh;
}

/**
 * Keys a channel that was just created, so it is usable by whoever opens it
 * first rather than by whoever happens to type in it first.
 */
export async function keyChannel(channelId: string): Promise<void> {
  await ensureChannelKey(channelId);
}

/**
 * Resolves the channel's key, creating and distributing one if the channel has
 * never been keyed. Concurrent callers share one round-trip.
 */
function ensureChannelKey(channelId: string): Promise<ChannelKeyState> {
  const cached = channels.get(channelId);
  if (cached) return Promise.resolve(cached);

  const existing = inFlight.get(channelId);
  if (existing) return existing;

  const pending = loadChannelKey(channelId).finally(() => inFlight.delete(channelId));
  inFlight.set(channelId, pending);
  return pending;
}

async function loadChannelKey(channelId: string): Promise<ChannelKeyState> {
  const self = await currentIdentity();
  let response = await api.channelKeys(channelId);
  let keys = await openKeys(response.keys, self);

  // We hold nothing for the current epoch. Either nobody has keyed the channel
  // yet, or - the case that used to leave a member stuck on "no channel key on
  // this device yet" - it was keyed before we joined, and every holder who
  // could re-wrap it for us is offline. Waiting on them is not a fix, so mint
  // the next epoch and wrap it for everybody, which is exactly what the server
  // lets any member with SEND_MESSAGE do. Earlier epochs are untouched, so the
  // history from before we were a member stays closed to us.
  if (!keys.has(response.epoch) && !rekeyed.has(channelId)) {
    // Marked only after the mint succeeds. Marking it first meant a transient
    // failure here - a dropped request, a moment offline - poisoned the guard
    // for the rest of the session: every later message in this channel skipped
    // straight to "no key" instead of trying again next time it was opened.
    await createChannelKey(channelId, response.epoch + 1);
    rekeyed.add(channelId);
    // Re-read rather than trusting our own write: another member may have won
    // the race, and then theirs is the epoch that counts.
    response = await api.channelKeys(channelId);
    keys = await openKeys(response.keys, self);
  }

  const state: ChannelKeyState = { epoch: response.epoch, keys };
  if (!keys.has(response.epoch)) throw new MissingChannelKeyError();

  channels.set(channelId, state);

  // Members who joined after the key was minted cannot read anything until a
  // holder re-wraps it for them. We hold it, so we do it. Older epochs are
  // `syncChannelKeys`' job - opening a channel is where that belongs, and
  // doing it here as well would publish every gap twice.
  if (response.missingRecipients.length > 0) {
    const key = keys.get(response.epoch);
    if (key) void shareKey(channelId, response.epoch, key, response.missingRecipients);
  }

  return state;
}

/** Opens every entry sealed for us, keyed by epoch. */
async function openKeys(
  entries: Array<ChannelKeyEntry & { epoch: number }>,
  self: IdentityKeyPair,
): Promise<Map<number, string>> {
  const keys = new Map<number, string>();
  for (const entry of entries) {
    try {
      keys.set(
        entry.epoch,
        await unwrapChannelKey(
          { wrappedKey: entry.wrappedKey, iv: entry.iv },
          self.privateKey,
          entry.senderPublicKey,
        ),
      );
    } catch {
      // A key sealed for another of our machines, or for an identity we have
      // since replaced. Both are rows this private half cannot open, and both
      // are ordinary: skip it, keep the rest.
    }
  }
  return keys;
}

/**
 * Mints an epoch for a channel this device holds no key for - a channel nobody
 * has keyed, or one that was keyed before we were a member.
 *
 * Any member who may send a message may do this - waiting for an admin to open
 * the channel is not a rule the server has, and pretending otherwise is what
 * made an empty channel unusable until its owner typed into it first.
 */
async function createChannelKey(channelId: string, epoch: number): Promise<void> {
  const self = await currentIdentity();
  const key = generateChannelKey();
  const devices = await api.channelDevices(channelId);

  // Our own row may not be in the directory yet on a device that signed in a
  // moment ago. Minting a key we cannot open (or, with an empty directory,
  // publishing nothing at all) leaves the channel unkeyed and the sender told
  // there is no key - so we always seal one for ourselves.
  // Our own row may not be in the directory yet on a machine that signed in a
  // moment ago, and it is now a row per *device* - being listed under our user
  // id is no longer enough, because that may be the other laptop.
  const mine = deviceId();
  const recipients = devices.some(
    (device) => device.userId === identityUserId && device.deviceId === mine,
  )
    ? devices
    : [
        ...devices,
        { userId: identityUserId ?? '', deviceId: mine, publicKey: self.publicKey },
      ];

  try {
    await shareKey(channelId, epoch, key, recipients);
  } catch (error) {
    // Another member keyed it first: harmless, loadChannelKey re-reads and
    // finds theirs. Which of the two codes comes back depends on whether they
    // landed on the epoch we wanted or ran past it. Anything else is a real
    // failure and must not be mistaken for "this device has no key".
    const raced =
      error instanceof ApiError &&
      (error.code === 'EPOCH_OUT_OF_ORDER' || error.code === 'EPOCH_NOT_HELD');
    if (!raced) throw error;
  }
}

/**
 * Seals one channel key for every device that should hold it.
 *
 * One wrap per machine rather than per person. Somebody signed in on a laptop
 * and a phone gets two entries, each sealed to that machine's own key, which is
 * what makes revoking one of them mean anything: the wraps addressed to it are
 * deleted, and it is never sealed for again.
 */
async function shareKey(
  channelId: string,
  epoch: number,
  key: string,
  recipients: Array<{ userId: string; deviceId: string; publicKey: string }>,
): Promise<void> {
  const self = await currentIdentity();

  const entries = await Promise.all(
    recipients.map(async (recipient) => {
      const wrapped = await wrapChannelKey(key, self.privateKey, recipient.publicKey);
      return {
        recipientUserId: recipient.userId,
        recipientDeviceId: recipient.deviceId,
        senderPublicKey: self.publicKey,
        wrappedKey: wrapped.wrappedKey,
        iv: wrapped.iv,
      };
    }),
  );

  if (entries.length === 0) return;
  await api.publishChannelKeys({ channelId, epoch, senderDeviceId: deviceId(), entries });
}

/** Waits for sign-in key setup instead of racing it, and retries a failed one. */
async function currentIdentity(): Promise<IdentityKeyPair> {
  if (identityReady) return identityReady;
  // With the session's secret, not without it. A retry that dropped it opened
  // no backup, minted a machine-local key, and forked the account for good.
  if (identityUserId) return initIdentity(identityUserId, signInSecret ?? undefined);
  if (identity) return identity;
  throw new MissingChannelKeyError();
}

/**
 * Private keys go through the main process, which seals them with the OS
 * keychain (Electron `safeStorage`). Outside Electron - a browser opened on the
 * Vite dev server - there is no keychain, so localStorage is the fallback.
 */
export async function secureGet(key: string): Promise<string | null> {
  const bridge = window.betweenus?.secureGet;
  if (bridge) return bridge(key);
  return localStorage.getItem(`betweenus.secure.${key}`);
}

export async function secureSet(key: string, value: string): Promise<void> {
  const bridge = window.betweenus?.secureSet;
  if (bridge) {
    await bridge(key, value);
    return;
  }
  localStorage.setItem(`betweenus.secure.${key}`, value);
}

export type { EncryptedEnvelope };
