/**
 * The arithmetic the "no data is lost" guarantee actually rests on.
 *
 * Three rules, and every one of them is a way an account used to become
 * permanently unreadable. None needs a database to be wrong, so none needs one
 * to be checked.
 *
 * Run with: pnpm --filter @betweenus/chat-service check
 */
import assert from 'node:assert/strict';
import {
  ACCOUNT_SCOPE,
  PORTABLE_FACTOR_KINDS,
  isAccountScope,
  isClientDeviceId,
  isPortableFactor,
} from '@betweenus/shared-types';
import { createCipheriv, randomBytes } from 'node:crypto';
import { isStaleWrap, owedEpochs, promotableEpochs } from './e2ee.service';
import { opensKeyring } from './vault.service';

// --- The reserved namespace --------------------------------------------------
//
// `@account` is what an account-scoped wrap is filed under. A machine able to
// claim that device id is a machine able to write a row everybody else
// believes is addressed to the account - which is to say, able to make a
// channel key readable by exactly one laptop while every client reads it as
// portable. One prefix stands between those two worlds.

assert.equal(isAccountScope(ACCOUNT_SCOPE), true);
assert.equal(isClientDeviceId(ACCOUNT_SCOPE), false, 'a client may never mint the account scope');
assert.equal(isClientDeviceId('@anything'), false, 'the whole @ namespace is reserved');
assert.equal(isClientDeviceId(''), false);
assert.equal(isClientDeviceId('3f0c1a52-8f1e-4c77-9a3b-0d2e5f7a1b44'), true);

// --- Portable factors --------------------------------------------------------
//
// A vault whose only doors are grants sealed to machines is one wipe from
// losing every message the account has ever been sent. The invariant is that
// at least one portable factor always stands, so what counts as portable has
// to be exactly the three secrets a person can carry out of a fire.

assert.deepEqual([...PORTABLE_FACTOR_KINDS], ['password', 'passphrase', 'recovery-code']);
assert.equal(isPortableFactor('recovery-code'), true);
assert.equal(isPortableFactor('device'), false, 'a machine is not somewhere to keep a secret');

// --- Promotion ---------------------------------------------------------------
//
// The rescue path for every conversation written before the vault. A client
// holds v1 rows addressed to this machine; it can open them today and nothing
// else in the world can; so it re-seals them to its own account key and that
// epoch stops depending on this machine existing.
//
// What must not happen is re-promoting an epoch that already has an account
// wrap: the server would take it (the rows are distinct) and the client would
// do it on every open of every channel, forever.

const rows = [
  { epoch: 1, recipientDeviceId: 'laptop' },
  { epoch: 2, recipientDeviceId: 'laptop' },
  { epoch: 2, recipientDeviceId: ACCOUNT_SCOPE },
  { epoch: 3, recipientDeviceId: ACCOUNT_SCOPE },
];

assert.deepEqual(
  promotableEpochs(rows),
  [1],
  'only the epoch held per device and not yet per account',
);

// Already portable: nothing to do, and saying otherwise is an infinite loop.
assert.deepEqual(promotableEpochs([{ epoch: 7, recipientDeviceId: ACCOUNT_SCOPE }]), []);

// A fresh v2 account has no legacy rows at all.
assert.deepEqual(promotableEpochs([]), []);

// Two machines' worth of legacy rows for the same epoch is still one promotion.
assert.deepEqual(
  promotableEpochs([
    { epoch: 4, recipientDeviceId: 'laptop' },
    { epoch: 4, recipientDeviceId: 'phone' },
  ]),
  [4],
);

// Ascending, because a client works through them in order and a channel's
// oldest history is the part most likely to be lost with the machine it
// arrived on.
assert.deepEqual(
  promotableEpochs([
    { epoch: 9, recipientDeviceId: 'laptop' },
    { epoch: 2, recipientDeviceId: 'laptop' },
    { epoch: 5, recipientDeviceId: 'laptop' },
  ]),
  [2, 5, 9],
);

// --- The server-held key ------------------------------------------------------
//
// The server only accepts a master key that opens the keyring, sealed the way
// WebCrypto seals it: AES-256-GCM with the tag on the end. An escrowed key to
// nothing would hand every new machine of the account a key to nothing.

const master = randomBytes(32);
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', master, iv);
const keyringCt = Buffer.concat([cipher.update('[{"generation":1}]'), cipher.final(), cipher.getAuthTag()]);
assert.equal(opensKeyring(master.toString('base64'), iv.toString('base64'), keyringCt.toString('base64')), true);
assert.equal(
  opensKeyring(randomBytes(32).toString('base64'), iv.toString('base64'), keyringCt.toString('base64')),
  false,
  'a key that does not open the keyring is refused',
);
assert.equal(opensKeyring('short', iv.toString('base64'), keyringCt.toString('base64')), false);

// --- A reset vault is owed its history back ---------------------------------
//
// A wrap older than the account's current vault was sealed to an identity that
// no longer exists. It must stop counting as held, and the epoch must be
// listed as owed, so another member's client re-seals it to the new identity.

const before = new Date('2026-09-01T00:00:00Z');
const resetAt = new Date('2026-09-21T00:00:00Z');
const after = new Date('2026-09-22T00:00:00Z');

assert.equal(isStaleWrap({ recipientDeviceId: ACCOUNT_SCOPE, createdAt: before }, resetAt), true);
assert.equal(isStaleWrap({ recipientDeviceId: ACCOUNT_SCOPE, createdAt: after }, resetAt), false);
assert.equal(isStaleWrap({ recipientDeviceId: 'laptop', createdAt: before }, resetAt), false, 'v1 rows are untouched');
assert.equal(isStaleWrap({ recipientDeviceId: ACCOUNT_SCOPE, createdAt: before }, undefined), false);

const owed = owedEpochs(
  [
    { epoch: 1, recipientUserId: 'me', recipientDeviceId: ACCOUNT_SCOPE, createdAt: before },
    { epoch: 1, recipientUserId: 'them', recipientDeviceId: ACCOUNT_SCOPE, createdAt: before },
    { epoch: 2, recipientUserId: 'me', recipientDeviceId: ACCOUNT_SCOPE, createdAt: after },
    { epoch: 2, recipientUserId: 'them', recipientDeviceId: ACCOUNT_SCOPE, createdAt: before },
  ],
  new Map([
    ['me', resetAt],
    ['them', before],
  ]),
  new Set(),
);
assert.deepEqual([...owed.entries()], [[1, ['me']]], 'only the epoch the reset account lost is owed');

// A member let in with the history is still owed every epoch they lack.
assert.deepEqual(
  [
    ...owedEpochs(
      [{ epoch: 3, recipientUserId: 'them', recipientDeviceId: ACCOUNT_SCOPE, createdAt: before }],
      new Map([
        ['them', before],
        ['newcomer', before],
      ]),
      new Set(['newcomer']),
    ).entries(),
  ],
  [[3, ['newcomer']]],
);

console.log('vault: ok');
