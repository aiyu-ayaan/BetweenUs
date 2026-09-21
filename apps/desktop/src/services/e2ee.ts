/**
 * Client side of end-to-end encryption: the account vault, channel-key
 * exchange, and the encrypt/decrypt calls the chat and call features use.
 *
 * The server is a courier here. It stores public keys and sealed blobs,
 * decides who may publish them, and never holds anything that opens a message.
 *
 * ## The one thing to understand before changing anything in this file
 *
 * A channel key is wrapped for an **account**, not for a machine. Every
 * machine that can open the vault opens the same rows, which is why signing in
 * somewhere new brings the whole history with it and needs nothing from
 * anybody else.
 *
 * v1 wrapped per machine, and every conversation this project lost was that
 * decision playing out: a machine that did not exist when an epoch was minted
 * held nothing for it, only another machine already holding that epoch could
 * seal one, and if none ever came online again those messages were ciphertext
 * forever. Worse, a machine that could not open the account backup minted an
 * identity of its own and carried on - so an account grew several identities,
 * each reading a different slice of its own history.
 *
 * Three rules keep that from coming back, and each of them is load-bearing:
 *
 * 1. **This machine never mints an account identity.** If the vault will not
 *    open, the machine is locked and says so. It has written nothing, so
 *    nothing about the state is one-way.
 * 2. **Every wrap this file publishes is account-scoped.** The server refuses
 *    anything else, and the one exception - promoting a v1 row this machine
 *    can already open - is re-addressing a key to itself.
 * 3. **A message is not sealed until every member can open the epoch.** The
 *    coverage check runs before the seal, not after it. Under v1 it ran after,
 *    so a message could be written under an epoch a member had no wrap for -
 *    and nothing ever repaired that.
 */
import type {
  AccountKeyRecipient,
  AccountVaultResponse,
  BackupSecretKind,
  ChannelKeyEntry,
  ChannelKeysResponse,
  EncryptedEnvelope,
  KeyHealthResponse,
  PortableFactorKind,
  StatusEntry,
  StatusKeyEntry,
  VaultGrantRequest,
} from '@betweenus/shared-types';
import { ACCOUNT_SCOPE } from '@betweenus/shared-types';
import { ApiError, api } from './api';
import { setIdentityStatus } from '../stores/identity';
import {
  currentIdentityOf,
  decryptBytes,
  decryptMessage,
  encryptBytes,
  encryptMessage,
  generateChannelKey,
  generateIdentity,
  generateMasterKey,
  generateRecoveryCode,
  keyFingerprint,
  openKeyring,
  openMasterKeyFromGrant,
  openMasterKeyWithSecret,
  parseEnvelope,
  sealKeyring,
  sealMasterKeyForDevice,
  sealMasterKeyWithSecret,
  unwrapChannelKey,
  wrapChannelKey,
  type IdentityKeyPair,
  type KeyringEntry,
  type OpenVault,
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


/**
 * Thrown when this machine cannot open the vault.
 *
 * Distinct from `MissingChannelKeyError` because the two need different
 * screens: one is a channel nobody has keyed yet, the other is this machine
 * not being in the account yet, and conflating them is how v1 came to tell
 * people to go and open the app on another laptop.
 */
export class VaultLockedError extends Error {
  constructor() {
    super('This machine has not been let into the account vault yet');
    this.name = 'VaultLockedError';
  }
}

/** What opens the vault. Held only for the moment a sign-in needs it. */
export interface VaultSecret {
  value: string;
  kind: PortableFactorKind;
}

/** @deprecated The v1 name for {@link VaultSecret}, kept for callers. */
export type BackupSecret = { value: string; kind: BackupSecretKind };

interface ChannelKeyState {
  epoch: number;
  /** Every epoch this account can open, so old history stays readable. */
  keys: Map<number, string>;
}

/** The open vault: the master key, and every identity generation it seals. */
let vault: OpenVault | null = null;
/**
 * This machine's own key pair. Not the account identity - it receives vault
 * grants and opens the v1 rows addressed to this installation, and that second
 * job is the whole of how history written before the vault is rescued.
 */
let deviceKeys: IdentityKeyPair | null = null;
let vaultUserId: string | null = null;
/** Set by initIdentity; everything that needs a key awaits it. */
let vaultReady: Promise<OpenVault> | null = null;
const channels = new Map<string, ChannelKeyState>();
const inFlight = new Map<string, Promise<ChannelKeyState>>();
/**
 * Channels this session has already re-keyed for itself. Without it, a machine
 * that cannot open its own wrapped keys would mint a fresh epoch every time
 * the channel is opened and drag the whole channel along with it.
 */
const rekeyed = new Set<string>();

/** Channel-and-epoch pairs already promoted, so a re-open does not re-send. */
const promoted = new Set<string>();

/**
 * The secret this session signed in with, kept for the length of the session.
 *
 * It used to be an argument and nothing else, so a sign-in whose setup failed
 * once - the network dropped, the token was a moment late - lost it, and the
 * retry ran with no secret at all. Under v1 that retry minted a machine-local
 * key and forked the account permanently. It cannot do that now, but it would
 * still lock a machine whose owner typed the right password, which is its own
 * small betrayal. A password typed into a login form is dropped when the
 * session ends, and that is the only thing keeping it here has to guarantee.
 */
let signInSecret: VaultSecret | null = null;

/**
 * Opens this account's vault and publishes this machine's device key. Called
 * once per sign-in, with the password when there is one to hand.
 *
 * It resolves in one of two states and never in a third. Either the vault is
 * open - and then *everything* the account has ever been wrapped for opens,
 * including history from before this machine existed - or this machine is
 * locked and says so.
 *
 * What it will not do, under any circumstance, is mint an identity of its own.
 * That is the change. v1 did exactly that whenever it could not open a backup,
 * because stopping to ask for a secret is a question a provider sign-in cannot
 * answer - and the cost was an account with several identities, each able to
 * read a different slice of its own history, permanently. A locked machine has
 * written nothing, so nothing about it is one-way.
 */
export function initIdentity(userId: string, secret?: VaultSecret): Promise<OpenVault> {
  if (vaultReady && vaultUserId === userId) return vaultReady;

  vaultUserId = userId;
  // Held past this call on purpose: a retry below has no secret of its own,
  // and under v1 a retry without one forked the identity permanently. It
  // cannot do that any more, but a retry that silently locks a machine whose
  // owner typed the right password is its own small betrayal.
  if (secret) signInSecret = secret;

  // A failure here - the network was down, the token had not been minted yet -
  // must not be remembered. Keeping the rejected promise left the machine
  // unregistered for the whole session, and every channel it tried to key
  // afterwards ended in "no channel key on this device yet".
  vaultReady = openVault(userId, secret ?? signInSecret ?? undefined).catch((error: unknown) => {
    if (vaultUserId === userId) vaultReady = null;
    throw error;
  });
  return vaultReady;
}

/**
 * The sequence, in the order it has to happen.
 *
 * Every branch here is a former bug written as a rule, so the order is not
 * incidental:
 *
 * 1. **This machine's device key first.** It is needed to receive a grant and
 *    to open the v1 rows this machine already holds, and it is not the
 *    account's identity - publishing it takes nothing away from anybody.
 * 2. **Read the vault, and treat a failure as a failure.** Only a definite
 *    "this account has no vault" is allowed to create one. A network error
 *    read as "no vault" would publish a second identity over a standing one
 *    and orphan every key wrapped for the first.
 * 3. **No vault: create one, and show the recovery code.** This is the only
 *    moment an account is created into a recoverable state, so the code is
 *    minted here rather than offered later in a settings panel nobody opens.
 * 4. **A vault, and a way in: open it.** The cached master key first (a
 *    relaunch should not ask), then the typed secret, then a grant somebody
 *    approved.
 * 5. **A vault and no way in: lock, and ask.** Never mint.
 */
async function openVault(userId: string, secret?: VaultSecret): Promise<OpenVault> {
  const device = await deviceIdentity(userId);

  // Throws on a failed request, which is the point: the caller retries, and
  // nothing has been written.
  const { vault } = await api.vault();

  if (!vault) {
    return adoptOrCreateVault(userId, device, secret);
  }

  const opened = await unlock(userId, vault, device, secret);
  if (opened) {
    await adopt(userId, device, opened);
    return opened;
  }

  // Nothing opens it: no cached key, no key held by the server, no secret or
  // grant that fits. That is a vault created before the server held a key, on
  // a launch with no password, whose recovery code nobody kept - and nobody
  // anywhere can open it. Start it over rather than leave this machine on a
  // screen it cannot leave. The server refuses the reset if it does hold a
  // key, so a vault somebody *can* open is never replaced from here.
  await api.resetVault();
  return adoptOrCreateVault(userId, device, secret);
}

/**
 * Tries every way this machine might already be entitled to the master key.
 *
 * Null is an ordinary outcome, not a failure: it is what a machine signing in
 * for the first time with no password looks like.
 */
async function unlock(
  userId: string,
  vault: NonNullable<AccountVaultResponse['vault']>,
  device: IdentityKeyPair,
  secret?: VaultSecret,
): Promise<OpenVault | null> {
  // 1. The master key this machine already opened, from the keychain. A
  //    relaunch must not ask for a password that a launch already took.
  const cached = await secureGet(masterKeyStore(userId));
  if (cached) {
    const opened = await openWith(vault, cached);
    if (opened) return opened;
    // The cached key does not open the current keyring: the account rotated,
    // or this is a stale key from a vault that was replaced. Drop it and carry
    // on rather than failing - the other routes below are still open.
    await secureSet(masterKeyStore(userId), '');
  }

  // 2. The key the server holds for this account - what makes a new phone, a
  //    reinstall or a provider sign-in open everything with nothing typed.
  //    A failed request throws: it is not "the server holds nothing", and
  //    reading it as that would reset a vault somebody can open.
  const { masterKey: held } = await api.vaultEscrow();
  if (held) {
    const opened = await openWith(vault, held);
    if (opened) {
      await secureSet(masterKeyStore(userId), held);
      return opened;
    }
  }

  // 3. A secret somebody typed or a sign-in carried.
  if (secret) {
    for (const factor of vault.factors.filter((it) => it.kind === secret.kind)) {
      const masterKey = await tryOpen(() => openMasterKeyWithSecret(factor, secret.value));
      if (!masterKey) continue;
      const opened = await openWith(vault, masterKey);
      if (opened) {
        await secureSet(masterKeyStore(userId), masterKey);
        return opened;
      }
    }
  }

  // 4. A grant somebody approved for this machine.
  const grant = vault.factors.find(
    (it) => it.kind === 'device' && it.deviceId === deviceId(),
  );
  if (grant) {
    const masterKey = await tryOpen(() => openMasterKeyFromGrant(grant, device.privateKey));
    if (masterKey) {
      const opened = await openWith(vault, masterKey);
      if (opened) {
        await secureSet(masterKeyStore(userId), masterKey);
        return opened;
      }
    }
  }

  return null;
}

/** The keyring behind a master key, or null when that key is not the one. */
async function openWith(
  vault: NonNullable<AccountVaultResponse['vault']>,
  masterKey: string,
): Promise<OpenVault | null> {
  try {
    return { masterKey, keyring: await openKeyring(vault.keyring, masterKey) };
  } catch {
    return null;
  }
}

/** A wrong secret is an ordinary outcome here, not an error: null, and on. */
async function tryOpen(open: () => Promise<string>): Promise<string | null> {
  try {
    return await open();
  } catch {
    return null;
  }
}

/**
 * An account with no vault: either one that predates it, or a brand-new one.
 *
 * The two are handled the same way and deliberately so. The v1 identity is
 * *not* promoted into the keyring even when this machine holds it, because
 * generation 1 of an account identity and the private key of one laptop are
 * different things, and conflating them would mean every future rotation had
 * to reason about a key that a machine also holds outside the vault. What
 * rescues the old history is promotion of the wraps, not reuse of the key -
 * see `promoteEpochs`.
 *
 * The recovery code is minted here, once, and handed to the caller to show.
 * Offering it later in a settings panel is offering it to the small number of
 * people who go looking, and the whole value of the factor is that everybody
 * has one.
 */
async function adoptOrCreateVault(
  userId: string,
  device: IdentityKeyPair,
  secret?: VaultSecret,
): Promise<OpenVault> {
  const identity = await generateIdentity();
  const masterKey = generateMasterKey();
  const keyring: KeyringEntry[] = [{ generation: 1, ...identity }];

  // The server holds the key from the first moment, in the same request, so
  // there is never a vault only this machine can open. The password factor
  // too when a sign-in carried one. No recovery code is minted unasked: one
  // nobody wrote down opens nothing, and Settings can make one on request.
  const factors =
    secret && secret.kind !== 'recovery-code'
      ? [await sealMasterKeyWithSecret(masterKey, secret.value, secret.kind)]
      : [];

  const created = await api.createVault({
    publicKey: identity.publicKey,
    keyring: await sealKeyring(keyring, masterKey),
    factors,
    escrow: masterKey,
  });

  // Somebody else's machine created it a moment ago - two sign-ins at once, or
  // a retry after a response that was lost on the way back. Read theirs rather
  // than insisting on ours: the server refuses the second create for exactly
  // this reason, and the alternative is two identities again.
  if (!created.vault) {
    const { vault } = await api.vault();
    if (!vault) throw new Error('The vault could not be created or read');
    const opened = await unlock(userId, vault, device, secret);
    if (!opened) {
      setIdentityStatus({ status: 'locked', reason: 'no-secret', grantRequested: false });
      throw new VaultLockedError();
    }
    await adopt(userId, device, opened);
    return opened;
  }

  await secureSet(masterKeyStore(userId), masterKey);
  const opened: OpenVault = { masterKey, keyring };
  await adopt(userId, device, opened);
  return opened;
}

/**
 * Publishes this machine's device key and marks the vault open.
 *
 * `holdsVault` is what stops the owner's own settings panel describing a
 * working machine as one waiting for approval. It is an assertion rather than
 * a proof, and it is safe to be: the only thing it changes is how this
 * account's device list is drawn to this account.
 */
async function adopt(
  userId: string,
  device: IdentityKeyPair,
  opened: OpenVault,
): Promise<void> {
  vault = opened;
  deviceKeys = device;

  try {
    // Idempotent: re-publishing keeps the directory correct if the row was
    // lost, and refreshes when this machine was last seen.
    await api.registerDeviceKey({
      deviceId: deviceId(),
      publicKey: device.publicKey,
      label: deviceLabel(),
      holdsVault: true,
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

  // Every machine that holds the key makes sure the server does too. This is
  // how a vault from before the server held keys gets one, and how it comes
  // back if the deployment's settings secret was rotated. Not fatal: the next
  // sign-in tries again.
  await ensureEscrow(opened.masterKey).catch(() => undefined);

  setIdentityStatus({ status: 'ready', recoverable: true });
  // Everything this machine can still rescue from v1, in the background. It is
  // the only thing that can: those rows are addressed to this machine's device
  // key and nothing else in the world opens them.
  void promoteEverything();
}

/** Hands the server the master key when it does not already hold this one. */
async function ensureEscrow(masterKey: string): Promise<void> {
  const { masterKey: held } = await api.vaultEscrow();
  if (held !== masterKey) await api.putVaultEscrow(masterKey);
}

/** Machines of this account waiting to be let in, for the approval screen. */
export function pendingGrants(): Promise<VaultGrantRequest[]> {
  return api.vaultGrants().then((response) => response.requests);
}

/**
 * Lets one machine in.
 *
 * The fingerprint is recomputed here from the key that is about to be sealed
 * for, and compared against the one the request carried. That is not
 * belt-and-braces: the request's own `fingerprint` field arrived over the
 * wire beside the key, so trusting it would be checking a claim against
 * itself. What the person on this screen read aloud has to be a digest of
 * *this* key, computed on *this* machine.
 */
export async function approveGrant(request: VaultGrantRequest): Promise<void> {
  const open = await currentVault();
  const identity = currentIdentityOf(open);
  const fingerprint = await keyFingerprint(request.publicKey);
  if (fingerprint !== request.fingerprint) {
    throw new Error('That machine’s fingerprint does not match the key it published');
  }

  await api.putVaultFactor(
    await sealMasterKeyForDevice(
      open.masterKey,
      identity.privateKey,
      identity.publicKey,
      request.deviceId,
      request.publicKey,
    ),
  );
}

/** Withdraws a request, for somebody who did not recognise the machine. */
export function denyGrant(deviceId: string): Promise<void> {
  return api.denyVaultGrant(deviceId).then(() => undefined);
}

/**
 * Adds or replaces a door into the vault.
 *
 * Replacing is the ordinary case: a changed password re-seals the same master
 * key under a new derivation, and nothing that history depends on is touched -
 * which is the whole reason the master key is a layer of its own rather than
 * the identity being sealed four times.
 */
export async function setVaultFactor(secret: VaultSecret): Promise<void> {
  const open = await currentVault();
  await api.putVaultFactor(await sealMasterKeyWithSecret(open.masterKey, secret.value, secret.kind));
}

/**
 * Takes a door away. The server refuses the last portable one.
 *
 * Refused by the server rather than here, because this is the check that must
 * hold for every client that will ever exist - including one somebody writes
 * next year against the same six routes.
 */
export function removeVaultFactor(kind: PortableFactorKind): Promise<void> {
  return api.deleteVaultFactor(kind).then(() => undefined);
}

/**
 * Mints a fresh recovery code and replaces the old one.
 *
 * Returned rather than stored, for the same reason it is shown at creation and
 * never again: a recovery code this app can read is a recovery code that goes
 * with the machine.
 */
export async function regenerateRecoveryCode(): Promise<string> {
  const open = await currentVault();
  const code = generateRecoveryCode();
  await api.putVaultFactor(await sealMasterKeyWithSecret(open.masterKey, code, 'recovery-code'));
  return code;
}

/**
 * Appends an identity generation, after a machine was lost.
 *
 * Nothing is taken away by it, and that is what makes it usable. Every earlier
 * private half stays in the ring, so every channel key ever wrapped to an
 * older public half still opens; what changes is only what other people wrap
 * *next*. v1 could not do this at all - rotating an identity there meant
 * abandoning every row sealed for the old one, which is to say abandoning the
 * history - so a lost laptop was something an account simply lived with.
 */
export async function rotateAccountIdentity(): Promise<void> {
  const open = await currentVault();
  const next = currentIdentityOf(open).generation + 1;
  const identity = await generateIdentity();
  const keyring: KeyringEntry[] = [...open.keyring, { generation: next, ...identity }];

  await api.rotateVault({
    publicKey: identity.publicKey,
    generation: next,
    keyring: await sealKeyring(keyring, open.masterKey),
  });
  vault = { masterKey: open.masterKey, keyring };
}

/**
 * This machine's own key pair: for receiving a vault grant, and for opening
 * the v1 rows addressed to it.
 *
 * Stored where the v1 identity was, and reusing whatever is there. That is
 * deliberate and it is what makes promotion possible at all: the key in that
 * slot is the one `channel_keys` rows were sealed to before the vault existed,
 * and generating a fresh one here would throw away the only thing in the world
 * that can open them.
 */
async function deviceIdentity(userId: string): Promise<IdentityKeyPair> {
  const slot = `identity:${userId}`;
  const stored = await secureGet(slot);
  if (stored) {
    const saved = JSON.parse(stored) as IdentityKeyPair;
    if (typeof saved.publicKey === 'string' && typeof saved.privateKey === 'string') {
      return { publicKey: saved.publicKey, privateKey: saved.privateKey };
    }
  }

  const pair = await generateIdentity();
  await secureSet(slot, JSON.stringify(pair));
  return pair;
}

/** Where this machine keeps the master key once it has opened the vault. */
function masterKeyStore(userId: string): string {
  return `vault:${userId}`;
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
 * like a new machine and has to be let into the vault again. That is now a
 * prompt rather than a catastrophe: under v1 it meant a new identity and a
 * history nobody could open.
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
 * Whether the account password can still open the vault on a machine that has
 * never seen it.
 *
 * The one thing a settings panel has to be able to say plainly, because it is
 * the difference between "sign in anywhere" and "sign in anywhere and find the
 * piece of paper".
 */
export async function passwordRecoveryEnabled(): Promise<boolean> {
  const { vault: stored } = await api.vault();
  return stored?.factors.some((it) => it.kind === 'password') ?? false;
}

/**
 * Turns the password path off, for somebody who set a recovery passphrase
 * *because* a live server sees the password at sign-in and they would rather
 * it could not open anything.
 *
 * The server refuses this when it would leave the account with no portable
 * factor at all, which is not a security setting - it is losing every message
 * on the next reinstall.
 */
export async function setPasswordRecovery(enabled: boolean, password?: string): Promise<void> {
  if (enabled) {
    if (!password) throw new Error('The account password is needed to seal a factor with it');
    await setVaultFactor({ value: password, kind: 'password' });
    return;
  }
  await removeVaultFactor('password');
}

/**
 * Re-seals the password factor after a password change. Silently skipped when
 * the account does not have one.
 */
export async function rewrapBackupForPassword(newPassword: string): Promise<void> {
  if (!(await passwordRecoveryEnabled())) return;
  await setVaultFactor({ value: newPassword, kind: 'password' });
  // The secret this session holds is now the old one, and a retry that used it
  // would fail to open the factor it has just re-sealed.
  signInSecret = { value: newPassword, kind: 'password' };
}

/** How much of this account's history survives losing every machine it owns. */
export function keyHealth(): Promise<KeyHealthResponse> {
  return api.keyHealth();
}

export function resetE2ee(): void {
  // Key material is per-user; a sign-out must not leak it into the next session.
  vault = null;
  deviceKeys = null;
  vaultUserId = null;
  vaultReady = null;
  signInSecret = null;
  channels.clear();
  inFlight.clear();
  rekeyed.clear();
  promoted.clear();
  missedEpochs.clear();
  setIdentityStatus({ status: 'absent' });
}

/**
 * Seals a message, but not before every member can open the epoch it is
 * sealed under.
 *
 * The order is the fix. v1 fired the re-wrap for missing members in the
 * background and sent regardless, so a message could be - and routinely was -
 * written under an epoch somebody had no wrap for. Nothing ever repaired
 * that: the epoch was already minted, the message already stored, and the
 * member read a padlock until the channel happened to rotate. Waiting costs
 * one request on the rare send where somebody is genuinely uncovered, and it
 * is the difference between "encrypted" and "encrypted for the people it was
 * addressed to".
 */
export async function encryptForChannel(channelId: string, plaintext: string): Promise<string> {
  const state = await ensureChannelKey(channelId);
  const key = state.keys.get(state.epoch);
  if (!key) throw new MissingChannelKeyError();
  await coverEveryone(channelId, state.epoch, key);
  const envelope = await encryptMessage(plaintext, key, state.epoch);
  return JSON.stringify(envelope);
}

/**
 * Seals the current epoch for any member who has no wrap for it yet.
 *
 * Quiet about its own failure and deliberately so: the alternative is a
 * message somebody cannot send because a third party joined the channel a
 * second ago and the directory has not caught up. What it must not do is
 * *skip* the attempt, which is what running it in the background amounted to.
 */
async function coverEveryone(channelId: string, epoch: number, key: string): Promise<void> {
  try {
    const latest = await api.channelKeys(channelId);
    if (latest.epoch !== epoch || latest.missingRecipients.length === 0) return;
    await shareKey(channelId, epoch, key, latest.missingRecipients);
  } catch {
    // Offline, or somebody rotated underneath us. The send goes ahead: the
    // epoch is the one this client holds and the members who do have a wrap
    // read it. The next open asks again for the ones who do not.
  }
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
 * Brings a channel's key distribution up to date. Called when a channel is
 * opened.
 *
 * Three jobs, and the middle one is the migration:
 *
 * - rotate when somebody who is no longer a member holds the current key
 * - **promote** every epoch this machine holds only as a v1 per-device wrap
 * - fill the gaps of members who were let in with the history
 *
 * Much smaller than v1's version of this, because most of what it did is no
 * longer necessary. It used to hand every epoch this machine held to every
 * *other machine of the same account*, one at a time, whenever this one
 * happened to open the channel - which is why history arrived late, arrived
 * partially, or never arrived. An account-scoped wrap needs no such repair.
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

  await promoteEpochs(channelId, state, latest.promotable);
  await fillGaps(channelId, state, latest);
}

/**
 * Re-seals epochs this machine holds only as v1 per-device wraps, addressing
 * them to the account.
 *
 * This is the rescue, and it is the only thing that can perform it. Those rows
 * were sealed to *this installation's* key; no server, no other machine and no
 * future machine can open them. Re-addressing them to the account key costs
 * one request and takes that epoch permanently out of reach of every way v1
 * lost data - readable from then on by every machine of the account, including
 * ones that do not exist yet.
 *
 * It grants nothing to anybody. The wrap goes to the same account that already
 * held it, and the server checks exactly that.
 *
 * Failures are per epoch and never fatal: a racing rotation or a moment
 * offline costs one epoch this pass, and the next open asks again.
 */
async function promoteEpochs(
  channelId: string,
  state: ChannelKeyState,
  epochs: number[],
): Promise<void> {
  const open = vault;
  const userId = vaultUserId;
  if (!open || !userId || epochs.length === 0) return;
  const identity = currentIdentityOf(open);

  for (const epoch of epochs) {
    const at = `${channelId}#${epoch}`;
    if (promoted.has(at)) continue;
    const key = state.keys.get(epoch);
    // An epoch this machine cannot open is not one it can promote - which is
    // the honest boundary of the rescue, and worth being plain about: a v1
    // epoch whose only wrap was addressed to a machine that no longer exists
    // is not recoverable by anybody, and this loop is where that becomes
    // visible rather than where it is fixed.
    if (!key) continue;

    try {
      await shareKey(channelId, epoch, key, [
        { userId, publicKey: identity.publicKey, generation: identity.generation },
      ]);
      promoted.add(at);
    } catch {
      // Tried again on the next open.
    }
  }
}

/**
 * Promotes everything this machine can, across every channel it can see.
 *
 * Run once per sign-in, in the background, rather than waiting for somebody to
 * open each channel. The reason is that the window is closing: these wraps
 * exist only on this installation, and every day one of them is not promoted
 * is a day a reinstall would take that conversation with it. A channel nobody
 * has opened in six months is exactly the one most likely to be lost.
 */
async function promoteEverything(): Promise<void> {
  try {
    const health = await api.keyHealth();
    if (health.sealed === 0) return;

    for (const channelId of await api.channelsWithKeys()) {
      try {
        const state = await ensureChannelKey(channelId);
        const latest = await api.channelKeys(channelId);
        await promoteEpochs(channelId, state, latest.promotable);
      } catch {
        // One channel's worth of failure is not a reason to stop rescuing the
        // rest, and the next sign-in tries again.
      }
    }
  } catch {
    // A server older than this client, or an offline launch. Opening a channel
    // still promotes it - this pass only makes it happen sooner.
  }
}

/**
 * Hands epochs this machine holds to members who were let in with the history.
 *
 * All that is left of v1's gap filling, and it is the one case that was never
 * about repairing somebody's own second machine: a member somebody with
 * `MANAGE_MEMBER` deliberately added *with* the conversation that predates
 * them. The server says who is owed; it holds no key and can hand over
 * nothing itself.
 *
 * Failures are per epoch and never fatal. A racing rotation, or a member
 * removed between the read and the write, each fail one wrap, and none of them
 * is a reason to stop opening the channel.
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
    if (!key || gap.recipients.length === 0) continue;
    try {
      await shareKey(channelId, gap.epoch, key, gap.recipients);
    } catch {
      // Somebody else got there first, or a member was removed. Either way the
      // next open asks again.
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
  await currentVault();
  let response = await api.channelKeys(channelId);
  let keys = await openKeys(response.keys, privateHalves());

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
    keys = await openKeys(response.keys, privateHalves());
  }

  const state: ChannelKeyState = { epoch: response.epoch, keys };
  if (!keys.has(response.epoch)) throw new MissingChannelKeyError();

  channels.set(channelId, state);

  // Members who joined after the key was minted cannot read anything until a
  // holder re-wraps it for them. We hold it, so we do it. Older epochs are
  // `syncChannelKeys`' job - opening a channel is where that belongs, and
  // doing it here as well would publish every gap twice.
  //
  // Still fire-and-forget here, and that is now safe where it was not: a send
  // no longer relies on this having finished, because `encryptForChannel`
  // clears the same list itself before it seals. This is the read path getting
  // ahead of the write path, rather than the write path hoping.
  if (response.missingRecipients.length > 0) {
    const key = keys.get(response.epoch);
    if (key) void shareKey(channelId, response.epoch, key, response.missingRecipients);
  }

  // And whatever this machine alone can still rescue on this channel.
  void promoteEpochs(channelId, state, response.promotable);

  return state;
}

/**
 * Opens every entry sealed for us, keyed by epoch.
 *
 * Tried against every private half this machine has, and the list is the
 * design rather than a shotgun:
 *
 * - **every generation in the keyring**, so a rotation after a lost laptop
 *   leaves the history readable. This is what makes rotating safe at all.
 * - **this machine's device key**, so v1 rows addressed to this installation
 *   still open - which is what makes promoting them possible.
 *
 * An account-scoped row opens on the first; a v1 row opens on the last; and
 * a row addressed to *another* machine of this account opens on neither, which
 * is exactly as ordinary as it sounds and is skipped without comment.
 */
async function openKeys(
  entries: Array<ChannelKeyEntry & { epoch: number }>,
  privateKeys: string[],
): Promise<Map<number, string>> {
  const keys = new Map<number, string>();
  for (const entry of entries) {
    if (keys.has(entry.epoch)) continue;
    for (const privateKey of privateKeys) {
      try {
        keys.set(
          entry.epoch,
          await unwrapChannelKey(
            { wrappedKey: entry.wrappedKey, iv: entry.iv },
            privateKey,
            entry.senderPublicKey,
          ),
        );
        break;
      } catch {
        // Not this half. Try the next.
      }
    }
  }
  return keys;
}

/**
 * Every private half this machine can try a wrap against, newest identity
 * first.
 *
 * Order matters only for speed - the newest generation opens almost
 * everything - but the *device key going last* is worth keeping: it is the one
 * that opens the rows this machine has a duty to promote, and having it fail
 * first on every account-scoped row would be a wasted AES operation per
 * message on a busy channel.
 */
function privateHalves(): string[] {
  const halves = [...(vault?.keyring ?? [])]
    .sort((left, right) => right.generation - left.generation)
    .map((entry) => entry.privateKey);
  if (deviceKeys) halves.push(deviceKeys.privateKey);
  return halves;
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
  const open = await currentVault();
  const identity = currentIdentityOf(open);
  const key = generateChannelKey();
  const members = await api.channelRecipients(channelId);

  // Our own entry may not be in the directory yet on an account whose vault
  // was created a moment ago. Minting a key we cannot open - or, with an empty
  // directory, publishing nothing at all - leaves the channel unkeyed and the
  // sender told there is no key, so we always seal one for ourselves.
  const recipients = members.some((who) => who.userId === vaultUserId)
    ? members
    : [
        ...members,
        {
          userId: vaultUserId ?? '',
          publicKey: identity.publicKey,
          generation: identity.generation,
        },
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
 * Seals one channel key for every account that should hold it.
 *
 * One wrap per person rather than per machine, which is the change the whole
 * of this file exists for. Somebody signed in on a laptop and a phone gets one
 * entry, openable by both, and by the tablet they set up next month.
 *
 * Revocation still means something, and it means something different: the
 * wraps are not addressed to a machine, so revoking one does not delete them.
 * What it takes away is the machine's standing in the directory and its
 * ability to be granted the vault again; what closes the door on the copy it
 * already holds is rotating the account identity, which is
 * `rotateAccountIdentity` and is offered beside revoking.
 */
async function shareKey(
  channelId: string,
  epoch: number,
  key: string,
  recipients: AccountKeyRecipient[],
): Promise<void> {
  const open = await currentVault();
  const identity = currentIdentityOf(open);

  const entries = await Promise.all(
    recipients.map(async (recipient) => {
      const wrapped = await wrapChannelKey(key, identity.privateKey, recipient.publicKey);
      return {
        recipientUserId: recipient.userId,
        // Never a machine. The server refuses anything else, and a client that
        // wrote one would rebuild v1's failure channel by channel, invisibly,
        // because it all reads correctly on the machine that wrote it.
        recipientDeviceId: ACCOUNT_SCOPE,
        senderPublicKey: identity.publicKey,
        wrappedKey: wrapped.wrappedKey,
        iv: wrapped.iv,
      };
    }),
  );

  if (entries.length === 0) return;
  await api.publishChannelKeys({ channelId, epoch, senderDeviceId: deviceId(), entries });
}


// --- Statuses ---------------------------------------------------------------
//
// A status has no channel, so it has no epoch and nothing to rotate: one key
// per post, wrapped once per *account* that may read it, and gone in a day.
// That is why none of the machinery above applies - there is no
// `ChannelKeyState` to load, no gap to fill, and no rekey.
//
// The wrap list is the audience. It is built from the directory *at the moment
// of posting*, so a friendship made afterwards adds nothing to a post already
// written, and the person who made friends today cannot open yesterday's - the
// same rule every app with this feature has, kept here by arithmetic rather
// than by trusting a server to filter.
//
// Per account rather than per machine, for a day-long version of the reason
// channels changed: a friend who signed in on a new phone after the post was
// written held no wrap for it and saw a padlock until it expired. Freezing the
// *audience* at post time is the design; freezing the set of machines those
// people happened to own at post time never was.

/** A post, sealed and ready to send. */
export interface SealedStatus {
  /** The caption as an envelope, absent when there was none. */
  caption?: string;
  media?: { ciphertext: Uint8Array<ArrayBuffer>; iv: string };
  keys: StatusKeyEntry[];
  senderDeviceId: string;
}

/**
 * Seals one post for one audience.
 *
 * Our own account is included by the server's directory, but may not be there
 * yet on a vault created a moment ago, so we always wrap for ourselves.
 * Posting something we cannot open is the one failure with no way back.
 */
export async function sealStatus(
  plain: { caption?: string; media?: Uint8Array<ArrayBuffer> },
  audience: AccountKeyRecipient[],
): Promise<SealedStatus> {
  const open = await currentVault();
  const identity = currentIdentityOf(open);
  const key = generateChannelKey();
  const recipients = audience.some((who) => who.userId === vaultUserId)
    ? audience
    : [
        ...audience,
        {
          userId: vaultUserId ?? '',
          publicKey: identity.publicKey,
          generation: identity.generation,
        },
      ];

  const keys = await Promise.all(
    recipients.map(async (who) => {
      const wrapped = await wrapChannelKey(key, identity.privateKey, who.publicKey);
      return {
        recipientUserId: who.userId,
        recipientDeviceId: ACCOUNT_SCOPE,
        senderPublicKey: identity.publicKey,
        wrappedKey: wrapped.wrappedKey,
        iv: wrapped.iv,
      };
    }),
  );

  // Epoch 0 in the envelope: a status has no generations, and the field is
  // there because the envelope shape is shared with messages.
  const caption = plain.caption ? JSON.stringify(await encryptMessage(plain.caption, key, 0)) : undefined;
  const media = plain.media ? await encryptBytes(plain.media, key) : undefined;

  return {
    ...(caption ? { caption } : {}),
    ...(media ? { media: { ciphertext: media.ciphertext, iv: media.iv } } : {}),
    keys,
    senderDeviceId: deviceId(),
  };
}

/**
 * The key to one post, from whichever wrap this machine's private half opens.
 *
 * Null rather than a throw for the ordinary cases: a post written before this
 * device existed, or before the friendship did, carries no wrap for us. Both
 * are things that happen, not errors.
 */
export async function statusKey(entry: StatusEntry): Promise<string | null> {
  if (entry.keys.length === 0) return null;
  await currentVault();
  for (const wrap of entry.keys) {
    for (const privateKey of privateHalves()) {
      try {
        return await unwrapChannelKey(
          { wrappedKey: wrap.wrappedKey, iv: wrap.iv },
          privateKey,
          wrap.senderPublicKey,
        );
      } catch {
        // Not this half. An account-scoped wrap opens on a keyring
        // generation; a wrap a v1 client wrote opens on this machine's device
        // key; one addressed to another of our machines opens on neither.
      }
    }
  }
  return null;
}

/** A post's caption in the clear, or the placeholder. Never throws. */
export async function openStatusCaption(entry: StatusEntry): Promise<string | null> {
  if (!entry.caption) return null;
  const envelope = parseEnvelope(entry.caption);
  // Written before statuses were sealed. It expires within the day.
  if (!envelope) return entry.caption;
  try {
    const key = await statusKey(entry);
    return key ? await decryptMessage(envelope, key) : UNDECRYPTABLE;
  } catch {
    return UNDECRYPTABLE;
  }
}

/** A post's media in the clear. Throws: a picture either opens or it does not. */
export async function openStatusMedia(
  entry: StatusEntry,
  ciphertext: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  // No IV means it was stored in the clear, before this. Hand it back as it is.
  if (!entry.mediaIv) return ciphertext;
  const key = await statusKey(entry);
  if (!key) throw new MissingChannelKeyError();
  return decryptBytes(ciphertext, entry.mediaIv, key);
}

/** Waits for sign-in key setup instead of racing it, and retries a failed one. */
async function currentVault(): Promise<OpenVault> {
  if (vaultReady) return vaultReady;
  // With the session's secret, not without it. A retry that dropped it used to
  // open no backup, mint a machine-local key, and fork the account for good.
  if (vaultUserId) return initIdentity(vaultUserId, signInSecret ?? undefined);
  if (vault) return vault;
  throw new VaultLockedError();
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
