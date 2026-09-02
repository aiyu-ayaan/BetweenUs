// Revocation smoke: a socket that is already open, and an account that stops
// being allowed to have one.
//
//   node revocation-smoke.mjs <adminUsername> <adminPassword>
//
// The gap this covers is the one `SECURITY.md` called "a live WebSocket outlives
// the token that opened it": a handshake is authenticated once and then trusted
// until it happens to disconnect, so disabling an account stopped new sessions
// and left every socket it already had delivering.
//
// Four cases, and the middle two are the ones worth having:
//
//   1. a chat, presence and call socket open on a healthy account stay open
//   2. disabling the account closes all three, with 4403
//   3. changing a password closes the sockets that predate it
//   4. and does *not* close one opened with the pair that request handed back
//
// Case 4 is the whole reason the event carries a timestamp rather than a flag.
// "Sign every session out" and "sign every *other* session out" are the same
// event with the line drawn in a different place, and without case 4 the one
// action meant to keep you signed in would sign you out.
//
// NEEDS auth-service, chat-service, presence-service and call-service running,
// plus Redis - the revocation travels over it - and an admin account to do the
// disabling.
import WebSocket from 'ws';

const AUTH = process.env.REVOKE_SMOKE_AUTH ?? 'http://127.0.0.1:3001';
const CHAT = process.env.REVOKE_SMOKE_CHAT ?? 'ws://127.0.0.1:3004/ws/chat';
const PRESENCE = process.env.REVOKE_SMOKE_PRESENCE ?? 'ws://127.0.0.1:3005/ws/presence';
const CALL = process.env.REVOKE_SMOKE_CALL ?? 'ws://127.0.0.1:3007/ws/call';

/** The close code a gateway uses for a revocation. See `SOCKET_REVOKED_CLOSE`. */
const REVOKED = 4403;

const [, , adminUser, adminPassword] = process.argv;
if (!adminUser || !adminPassword) {
  console.error('usage: node revocation-smoke.mjs <adminUsername> <adminPassword>');
  process.exit(2);
}

const json = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${url} -> ${response.status} ${JSON.stringify(body)}`);
  return body;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
const ok = (label, condition, detail = '') => {
  if (!condition) {
    console.error(`FAIL ${label} ${detail}`);
    failures += 1;
    return;
  }
  console.log(`${label} ok`, detail);
};

/**
 * A socket that remembers how it was closed.
 *
 * `closedWith` stays null while it is open, which is what the "still there"
 * assertions read - a socket that was never going to be closed and a socket
 * that has not been closed *yet* look identical, so every check that expects a
 * close waits for one and every check that expects survival waits the same
 * length of time first.
 */
const connect = (url, token) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
    const handle = { socket, closedWith: null };
    socket.on('close', (code) => {
      handle.closedWith = code;
    });
    socket.on('error', () => {
      // A close is delivered after the error for the cases here; failing the
      // promise on it would turn "closed by the server" into a crash.
    });
    socket.on('open', () => resolve(handle));
    setTimeout(() => reject(new Error(`${url} did not open`)), 8000);
  });

const openAll = async (token) => ({
  chat: await connect(CHAT, token),
  presence: await connect(PRESENCE, token),
  call: await connect(CALL, token),
});

const closeAll = (sockets) => {
  for (const handle of Object.values(sockets)) handle.socket.close();
};

const suffix = Date.now().toString(36);
const password = 'hunter2000';

const victim = await json(`${AUTH}/api/v1/auth/register`, {
  method: 'POST',
  body: JSON.stringify({
    email: `revoke-${suffix}@betweenus.local`,
    username: `revoke${suffix}`,
    password,
  }),
});
console.log('account ok', victim.user.username);

// --- 1. a healthy account keeps its sockets ----------------------------------
let sockets = await openAll(victim.accessToken);
await sleep(1500);
ok(
  'a healthy account keeps its sockets',
  Object.values(sockets).every((handle) => handle.closedWith === null),
  JSON.stringify(Object.fromEntries(Object.entries(sockets).map(([k, v]) => [k, v.closedWith]))),
);

// --- 2. disabling the account closes them ------------------------------------
const admin = await json(`${AUTH}/api/v1/auth/login`, {
  method: 'POST',
  body: JSON.stringify({ email: adminUser, password: adminPassword }),
});
const adminAuth = { Authorization: `Bearer ${admin.accessToken}` };

await json(`${AUTH}/api/v1/admin/users/${victim.user.id}`, {
  method: 'PATCH',
  headers: adminAuth,
  body: JSON.stringify({ disabled: true }),
});

await sleep(2000);
for (const [name, handle] of Object.entries(sockets)) {
  ok(`disabling closes the ${name} socket`, handle.closedWith === REVOKED, String(handle.closedWith));
}

// Re-enable, so the rest of the file is about a live account again.
await json(`${AUTH}/api/v1/admin/users/${victim.user.id}`, {
  method: 'PATCH',
  headers: adminAuth,
  body: JSON.stringify({ disabled: false }),
});
closeAll(sockets);

// --- 3 and 4. a password change draws the line -------------------------------
//
// Sign in again: the tokens above were minted before the account was disabled
// and re-enabled, and this is about the password change rather than about them.
const session = await json(`${AUTH}/api/v1/auth/login`, {
  method: 'POST',
  body: JSON.stringify({ email: `revoke-${suffix}@betweenus.local`, password }),
});

sockets = await openAll(session.accessToken);
await sleep(1200);

// A second apart, so `iat` in seconds can actually tell the two tokens apart -
// the whole comparison is at second granularity, and a test that mints both in
// the same second proves nothing either way.
await sleep(1200);

const changed = await json(`${AUTH}/api/v1/auth/account/password`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${session.accessToken}` },
  body: JSON.stringify({ currentPassword: password, newPassword: 'hunter3000' }),
});

// Opened with the pair the password change handed back, so it is dated at or
// after the line the same request drew.
const afterwards = await connect(CHAT, changed.accessToken);

await sleep(2000);
for (const [name, handle] of Object.entries(sockets)) {
  ok(
    `a password change closes the ${name} socket that predates it`,
    handle.closedWith === REVOKED,
    String(handle.closedWith),
  );
}
ok(
  'but not the one opened with the pair it handed back',
  afterwards.closedWith === null,
  String(afterwards.closedWith),
);

closeAll(sockets);
afterwards.socket.close();

if (failures > 0) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nrevocation smoke passed');
process.exit(0);
