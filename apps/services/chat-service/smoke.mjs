// End-to-end smoke: register -> server -> channel -> WS subscribe -> send -> receive.
import WebSocket from 'ws';

const AUTH = 'http://127.0.0.1:3001';
const SERVER = 'http://127.0.0.1:3003';
const CHAT = 'http://127.0.0.1:3004';

const json = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${url} -> ${response.status} ${JSON.stringify(body)}`);
  return body;
};

/** The status code alone, for the cases where the refusal is the point. */
const statusOf = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  return response.status;
};

/** A false assertion fails the run: this script is the CI integration test. */
const ok = (label, condition, detail = '') => {
  if (!condition) {
    console.error(`FAIL ${label} ${detail}`);
    process.exit(1);
  }
  console.log(`${label} ok`, detail);
};

const suffix = Date.now().toString(36);
const email = `smoke-${suffix}@nexora.local`;

const auth = await json(`${AUTH}/api/v1/auth/register`, {
  method: 'POST',
  body: JSON.stringify({ email, username: `smoke${suffix}`, password: 'hunter2000' }),
});
console.log('register ok', auth.user.username);

const token = auth.accessToken;
const authed = { Authorization: `Bearer ${token}` };

const me = await json(`${AUTH}/api/v1/auth/me`, { headers: authed });
ok('me', me.email === email);

const refreshed = await json(`${AUTH}/api/v1/auth/refresh`, {
  method: 'POST',
  body: JSON.stringify({ refreshToken: auth.refreshToken }),
});
ok('refresh', Boolean(refreshed.accessToken));

// Rotation: the consumed refresh token must not work twice.
let reuseRejected = false;
try {
  await json(`${AUTH}/api/v1/auth/refresh`, {
    method: 'POST',
    body: JSON.stringify({ refreshToken: auth.refreshToken }),
  });
} catch {
  reuseRejected = true;
}
ok('refresh rotation', reuseRejected);

const server = await json(`${SERVER}/api/v1/servers`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ name: `Smoke ${suffix}` }),
});
console.log('server ok', server.slug, server.role);

const channels = await json(
  `${SERVER}/api/v1/channels?serverId=${server.id}`,
  { headers: authed },
);
console.log('default channel ok', channels[0]?.name);

const channel = await json(`${SERVER}/api/v1/channels`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ serverId: server.id, name: 'Smoke Test Room' }),
});
console.log('channel ok', channel.name);

// WebSocket: subscribe, then post over REST and expect the push.
const socket = new WebSocket(`ws://127.0.0.1:3004/ws/chat?token=${encodeURIComponent(token)}`);
const received = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('no realtime message within 10s')), 10_000);
  socket.on('message', (raw) => {
    const event = JSON.parse(raw.toString());
    if (event.type === 'ready') {
      socket.send(JSON.stringify({ type: 'channel.subscribe', channelId: channel.id }));
      setTimeout(() => {
        json(`${CHAT}/api/v1/messages`, {
          method: 'POST',
          headers: authed,
          body: JSON.stringify({ channelId: channel.id, content: 'hello from smoke test' }),
        }).catch((error) => reject(new Error(`send failed: ${error.message}`)));
      }, 300);
    }
    if (event.type === 'message.created') {
      clearTimeout(timer);
      resolve(event.message);
    }
    if (event.type === 'error') reject(new Error(`ws error: ${event.code}`));
  });
  socket.on('error', reject);
});

const message = await received;
console.log('realtime ok', message.content, 'by', message.author.username);

const history = await json(`${CHAT}/api/v1/messages?channelId=${channel.id}`, { headers: authed });
ok('history', history.items.length === 1, `${history.items.length} item`);

// Unauthenticated socket must be closed, not downgraded.
const anonClosed = await new Promise((resolve) => {
  const anon = new WebSocket('ws://127.0.0.1:3004/ws/chat');
  anon.on('close', (code) => resolve(code));
  anon.on('error', () => resolve(-1));
});
ok('anonymous ws rejected', anonClosed === 4401, String(anonClosed));

// Traversal attempt must be refused. The uploads themselves are exercised
// further down, once there is a second account to prove a ticket is bound.
const traversal = await fetch(`${CHAT}/api/v1/uploads/..%2F..%2Fpackage.json`);
ok('traversal blocked', traversal.status >= 400, String(traversal.status));

// --- E2EE key directory -----------------------------------------------------
// Crypto correctness is covered by the desktop self-check; this proves the
// courier endpoints: publish a device key, read the member directory, store a
// wrapped channel key and read it back.

const devicePublicKey = JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'smoke-x', y: 'smoke-y' });
await json(`${CHAT}/api/v1/e2ee/devices`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ publicKey: devicePublicKey }),
});

const devices = await json(`${CHAT}/api/v1/e2ee/devices?channelId=${channel.id}`, {
  headers: authed,
});
ok('device directory', devices.some((device) => device.userId === me.id));

// Identity backup: absent for a fresh account, stored and returned once
// uploaded, and refused when the KDF is weaker than the floor.
const noBackup = await json(`${CHAT}/api/v1/e2ee/backup`, { headers: authed });
ok('no backup yet', noBackup.backup === null);

const backup = {
  v: 1,
  kind: 'password',
  kdf: 'PBKDF2-SHA256',
  iterations: 600000,
  salt: 'c21va2Utc2FsdC0xNmJ5dGVz',
  iv: 'c21va2UtaXY=',
  ct: 'c21va2Utc2VhbGVkLWlkZW50aXR5',
  publicKey: devicePublicKey,
};
await json(`${CHAT}/api/v1/e2ee/backup`, {
  method: 'PUT',
  headers: authed,
  body: JSON.stringify(backup),
});

const storedBackup = await json(`${CHAT}/api/v1/e2ee/backup`, { headers: authed });
ok(
  'backup round-trip',
  storedBackup.backup?.ct === backup.ct && storedBackup.backup?.kind === 'password',
);

let weakKdfRejected = false;
try {
  await json(`${CHAT}/api/v1/e2ee/backup`, {
    method: 'PUT',
    headers: authed,
    body: JSON.stringify({ ...backup, iterations: 1000 }),
  });
} catch {
  weakKdfRejected = true;
}
ok('weak KDF refused', weakKdfRejected);

const empty = await json(`${CHAT}/api/v1/e2ee/keys/${channel.id}`, { headers: authed });
ok('unkeyed channel', empty.epoch === 0 && empty.keys.length === 0);

await json(`${CHAT}/api/v1/e2ee/keys`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({
    channelId: channel.id,
    epoch: 1,
    entries: [
      {
        recipientUserId: me.id,
        senderPublicKey: devicePublicKey,
        wrappedKey: 'c21va2Utd3JhcHBlZC1rZXk=',
        iv: 'c21va2UtaXY=',
      },
    ],
  }),
});

const keys = await json(`${CHAT}/api/v1/e2ee/keys/${channel.id}`, { headers: authed });
ok('channel key', keys.epoch === 1 && keys.keys[0]?.wrappedKey === 'c21va2Utd3JhcHBlZC1rZXk=');

// Epoch 3 with epoch 1 in place must be refused: keys advance one step at a time.
let epochRejected = false;
try {
  await json(`${CHAT}/api/v1/e2ee/keys`, {
    method: 'POST',
    headers: authed,
    body: JSON.stringify({
      channelId: channel.id,
      epoch: 3,
      entries: [
        {
          recipientUserId: me.id,
          senderPublicKey: devicePublicKey,
          wrappedKey: 'c21va2Utd3JhcHBlZC1rZXk=',
          iv: 'c21va2UtaXY=',
        },
      ],
    }),
  });
} catch {
  epochRejected = true;
}
ok('epoch ordering enforced', epochRejected);

// --- Servers, permissions, private channels, friends and direct messages ---

// A second account, so every rule below has someone to be enforced against.
const otherAuth = await json(`${AUTH}/api/v1/auth/register`, {
  method: 'POST',
  body: JSON.stringify({
    email: `smoke-b-${suffix}@nexora.local`,
    username: `smokeb${suffix}`,
    password: 'hunter2000',
  }),
});
const other = { Authorization: `Bearer ${otherAuth.accessToken}` };
const otherId = otherAuth.user.id;

// Joining takes an invite now. The slug is a name, not a door.
const invite = await json(`${SERVER}/api/v1/servers/${server.id}/invites`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({}),
});
await json(`${SERVER}/api/v1/servers/join`, {
  method: 'POST',
  headers: other,
  body: JSON.stringify({ code: invite.code }),
});

const members = await json(`${SERVER}/api/v1/servers/${server.id}/members`, { headers: authed });
ok('member list', members.length === 2);

// An invite that has been used up, and one that has been taken back, are both
// refused - and refused the same way a code that never existed is, so guessing
// codes learns nothing from the answer.
const single = await json(`${SERVER}/api/v1/servers/${server.id}/invites`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ maxUses: 1 }),
});
const inviteeAuth = await json(`${AUTH}/api/v1/auth/register`, {
  method: 'POST',
  body: JSON.stringify({
    email: `smoke-invitee-${suffix}@nexora.local`,
    username: `smokeinvitee${suffix}`,
    password: 'hunter2000',
  }),
});
const invitee = { Authorization: `Bearer ${inviteeAuth.accessToken}` };
await json(`${SERVER}/api/v1/servers/join`, {
  method: 'POST',
  headers: invitee,
  body: JSON.stringify({ code: single.code }),
});

const spentAuth = await json(`${AUTH}/api/v1/auth/register`, {
  method: 'POST',
  body: JSON.stringify({
    email: `smoke-rejected-${suffix}@nexora.local`,
    username: `smokerejected${suffix}`,
    password: 'hunter2000',
  }),
});
const rejected = { Authorization: `Bearer ${spentAuth.accessToken}` };
ok(
  'a spent invite is refused',
  (await statusOf(`${SERVER}/api/v1/servers/join`, {
    method: 'POST',
    headers: rejected,
    body: JSON.stringify({ code: single.code }),
  })) === 404,
);

const revocable = await json(`${SERVER}/api/v1/servers/${server.id}/invites`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({}),
});
await json(`${SERVER}/api/v1/servers/${server.id}/invites/${revocable.code}`, {
  method: 'DELETE',
  headers: authed,
});
ok(
  'a revoked invite is refused',
  (await statusOf(`${SERVER}/api/v1/servers/join`, {
    method: 'POST',
    headers: rejected,
    body: JSON.stringify({ code: revocable.code }),
  })) === 404,
);

ok(
  'the slug is not a way in',
  (await statusOf(`${SERVER}/api/v1/servers/join`, {
    method: 'POST',
    headers: rejected,
    body: JSON.stringify({ code: server.slug }),
  })) === 404,
);

ok(
  'a member without MANAGE_MEMBER cannot mint one',
  (await statusOf(`${SERVER}/api/v1/servers/${server.id}/invites`, {
    method: 'POST',
    headers: other,
    body: JSON.stringify({}),
  })) === 403,
);
ok(
  'effective permissions',
  members.every((member) => Array.isArray(member.permissions) && member.permissions.length > 0),
);

// A plain member cannot create a channel until the permission is granted.
let createRefused = false;
try {
  await json(`${SERVER}/api/v1/channels`, {
    method: 'POST',
    headers: other,
    body: JSON.stringify({ serverId: server.id, name: `nope-${suffix}` }),
  });
} catch {
  createRefused = true;
}
ok('MANAGE_CHANNEL enforced', createRefused);

const promoted = await json(`${SERVER}/api/v1/servers/${server.id}/members/${otherId}`, {
  method: 'PATCH',
  headers: authed,
  body: JSON.stringify({ grantedPermissions: ['MANAGE_CHANNEL'] }),
});
ok('permission granted', promoted.permissions.includes('MANAGE_CHANNEL'));

const grantedChannel = await json(`${SERVER}/api/v1/channels`, {
  method: 'POST',
  headers: other,
  body: JSON.stringify({ serverId: server.id, name: `granted-${suffix}` }),
});
ok('granted permission takes effect', grantedChannel.name === `granted-${suffix}`);

// A denial beats the role, so taking the grant back with one closes the door.
const denied = await json(`${SERVER}/api/v1/servers/${server.id}/members/${otherId}`, {
  method: 'PATCH',
  headers: authed,
  body: JSON.stringify({ grantedPermissions: [], deniedPermissions: ['SEND_MESSAGE'] }),
});
ok('denial recorded', !denied.permissions.includes('SEND_MESSAGE'));

let sendRefused = false;
try {
  await json(`${CHAT}/api/v1/messages`, {
    method: 'POST',
    headers: other,
    body: JSON.stringify({ channelId: channel.id, content: 'should not arrive' }),
  });
} catch {
  sendRefused = true;
}
ok('denial enforced by chat-service', sendRefused);

// A private channel is invisible to a server member who is not on it.
const privateChannel = await json(`${SERVER}/api/v1/channels`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({
    serverId: server.id,
    name: `secret-${suffix}`,
    isPrivate: true,
    memberIds: [],
  }),
});
ok('private channel created', privateChannel.isPrivate === true);

const visibleToOther = await json(`${SERVER}/api/v1/channels?serverId=${server.id}`, {
  headers: other,
});
ok(
  'private channel hidden from a non-member',
  !visibleToOther.some((item) => item.id === privateChannel.id),
);

let historyRefused = false;
try {
  await json(`${CHAT}/api/v1/messages?channelId=${privateChannel.id}`, { headers: other });
} catch {
  historyRefused = true;
}
ok('private channel history refused', historyRefused);

// Friends gate direct messages, so a DM before the friendship must fail.
let dmRefused = false;
try {
  await json(`${CHAT}/api/v1/dm`, {
    method: 'POST',
    headers: authed,
    body: JSON.stringify({ userId: otherId }),
  });
} catch {
  dmRefused = true;
}
ok('direct message needs a friendship', dmRefused);

const found = await json(`${CHAT}/api/v1/users/search?q=smokeb${suffix}`, { headers: authed });
ok('user search', found.some((person) => person.id === otherId));

await json(`${CHAT}/api/v1/friends`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ username: otherAuth.user.username }),
});
const accepted = await json(`${CHAT}/api/v1/friends/${me.id}/accept`, {
  method: 'POST',
  headers: other,
});
ok('friend request accepted', accepted.status === 'ACCEPTED');

const direct = await json(`${CHAT}/api/v1/dm`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ userId: otherId }),
});
ok('direct channel opened', direct.participant.id === otherId);

// Opening it again must find the same conversation, not start a second one.
const reopened = await json(`${CHAT}/api/v1/dm`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ userId: otherId }),
});
ok('direct channel is reused', reopened.channelId === direct.channelId);

const dmMessage = await json(`${CHAT}/api/v1/messages`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ channelId: direct.channelId, content: 'hello over DM' }),
});
const dmHistory = await json(`${CHAT}/api/v1/messages?channelId=${direct.channelId}`, {
  headers: other,
});
ok('direct message delivered', dmHistory.items.some((item) => item.id === dmMessage.id));

// --- Editing, deleting, pinning and reacting -------------------------------

const edited = await json(`${CHAT}/api/v1/messages/${dmMessage.id}`, {
  method: 'PATCH',
  headers: authed,
  body: JSON.stringify({ content: 'hello over DM, corrected' }),
});
ok(
  'author edits their own message',
  edited.content === 'hello over DM, corrected' && edited.editedAt !== null,
);

const editRefused = await fetch(`${CHAT}/api/v1/messages/${dmMessage.id}`, {
  method: 'PATCH',
  headers: { ...other, 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: 'words in your mouth' }),
});
ok('only the author may edit', editRefused.status === 403);

// Either participant may pin in a direct message - there is no role to hold.
const pinned = await json(`${CHAT}/api/v1/messages/${dmMessage.id}/pin`, {
  method: 'PUT',
  headers: other,
});
ok('pinned in a direct message', pinned.pinnedAt !== null);

const pinList = await json(`${CHAT}/api/v1/messages/pins?channelId=${direct.channelId}`, {
  headers: authed,
});
ok('pin list', pinList.some((item) => item.id === dmMessage.id));

const unpinned = await json(`${CHAT}/api/v1/messages/${dmMessage.id}/pin`, {
  method: 'DELETE',
  headers: authed,
});
ok('unpinned', unpinned.pinnedAt === null);

const reacted = await json(`${CHAT}/api/v1/messages/${dmMessage.id}/reactions`, {
  method: 'POST',
  headers: other,
  body: JSON.stringify({ emoji: '👍' }),
});
ok(
  'reaction added',
  reacted.reactions.some((entry) => entry.emoji === '👍' && entry.userIds.includes(otherId)),
);

const unreacted = await json(`${CHAT}/api/v1/messages/${dmMessage.id}/reactions`, {
  method: 'POST',
  headers: other,
  body: JSON.stringify({ emoji: '👍' }),
});
ok('reacting again takes it back', unreacted.reactions.length === 0);

const badEmoji = await fetch(`${CHAT}/api/v1/messages/${dmMessage.id}/reactions`, {
  method: 'POST',
  headers: { ...other, 'Content-Type': 'application/json' },
  body: JSON.stringify({ emoji: 'not an emoji' }),
});
ok('a sentence is not an emoji', badEmoji.status === 400);

await fetch(`${CHAT}/api/v1/messages/${dmMessage.id}`, { method: 'DELETE', headers: authed });
const afterDelete = await json(`${CHAT}/api/v1/messages?channelId=${direct.channelId}`, {
  headers: other,
});
const tombstone = afterDelete.items.find((item) => item.id === dmMessage.id);
ok(
  'a deleted message leaves a tombstone',
  tombstone !== undefined && tombstone.deletedAt !== null && tombstone.content === '',
);
ok('the author deleting is not attributed', tombstone?.deletedBy === null);

// Someone else's message, without the permission: refused.
const doomed = await json(`${CHAT}/api/v1/messages`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ channelId: channel.id, content: 'delete me if you can' }),
});
const strangerDelete = await fetch(`${CHAT}/api/v1/messages/${doomed.id}`, {
  method: 'DELETE',
  headers: other,
});
ok('deleting another message needs DELETE_MESSAGE', strangerDelete.status === 403);

await json(`${SERVER}/api/v1/servers/${server.id}/members/${otherId}`, {
  method: 'PATCH',
  headers: authed,
  body: JSON.stringify({ grantedPermissions: ['DELETE_MESSAGE'] }),
});
const moderatorDelete = await fetch(`${CHAT}/api/v1/messages/${doomed.id}`, {
  method: 'DELETE',
  headers: other,
});
ok('DELETE_MESSAGE lets a moderator delete it', moderatorDelete.status === 204);

const afterModeration = await json(`${CHAT}/api/v1/messages?channelId=${channel.id}`, {
  headers: authed,
});
const moderated = afterModeration.items.find((item) => item.id === doomed.id);
ok(
  'a moderator deletion names who did it',
  moderated?.deletedAt !== null && moderated?.deletedBy?.id === otherId,
);

// Deleting it twice is a 404, not a second deletion.
const secondDelete = await fetch(`${CHAT}/api/v1/messages/${doomed.id}`, {
  method: 'DELETE',
  headers: authed,
});
ok('an already deleted message is not found', secondDelete.status === 404);

// --- Adding someone to a server --------------------------------------------

const thirdAuth = await json(`${AUTH}/api/v1/auth/register`, {
  method: 'POST',
  body: JSON.stringify({
    email: `smoke-c-${suffix}@nexora.local`,
    username: `smokec${suffix}`,
    password: 'hunter2000',
  }),
});
const third = { Authorization: `Bearer ${thirdAuth.accessToken}` };

// A stranger cannot be conscripted. Managing members is permission to bring in
// your own people, not to drop any account on the deployment into a room it has
// never heard of - which is what this endpoint used to do for any username.
const stranger = await fetch(`${SERVER}/api/v1/servers/${server.id}/members`, {
  method: 'POST',
  headers: { ...authed, 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: thirdAuth.user.username }),
});
ok('adding a non-friend is refused', stranger.status === 403);

// A pending request is not a friendship, or "ask and add anyway" would be the
// way straight past the check.
await json(`${CHAT}/api/v1/friends`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ username: thirdAuth.user.username }),
});
const pending = await fetch(`${SERVER}/api/v1/servers/${server.id}/members`, {
  method: 'POST',
  headers: { ...authed, 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: thirdAuth.user.username }),
});
ok('a pending friend request is not a friendship', pending.status === 403);

await json(`${CHAT}/api/v1/friends/${me.id}/accept`, { method: 'POST', headers: third });

const added = await json(`${SERVER}/api/v1/servers/${server.id}/members`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ username: thirdAuth.user.username }),
});
ok('a friend can be added by username', added.userId === thirdAuth.user.id && added.role === 'MEMBER');

// And the picker that offers candidates is narrowed the same way, so nobody is
// offered a person the add would refuse.
const everybody = await json(
  `${CHAT}/api/v1/users/search?q=smoke`,
  { headers: authed },
);
const friendsOnly = await json(
  `${CHAT}/api/v1/users/search?q=smoke&friendsOnly=true`,
  { headers: authed },
);
ok(
  'friendsOnly search is a subset of the directory',
  friendsOnly.length < everybody.length &&
    friendsOnly.every((person) => everybody.some((row) => row.id === person.id)),
  `${friendsOnly.length} of ${everybody.length}`,
);
ok(
  'friendsOnly search lists the friend',
  friendsOnly.some((person) => person.id === thirdAuth.user.id),
);

const theirServers = await json(`${SERVER}/api/v1/servers`, { headers: third });
ok('the added member sees the server', theirServers.some((item) => item.id === server.id));

// Adding again is the outcome they asked for, not an error.
const addedTwice = await json(`${SERVER}/api/v1/servers/${server.id}/members`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ username: thirdAuth.user.username }),
});
ok('adding an existing member is idempotent', addedTwice.userId === added.userId);

const unprivileged = await fetch(`${SERVER}/api/v1/servers/${server.id}/members`, {
  method: 'POST',
  headers: { ...third, 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: `smokeb${suffix}` }),
});
ok('adding a member needs MANAGE_MEMBER', unprivileged.status === 403);

const unknown = await fetch(`${SERVER}/api/v1/servers/${server.id}/members`, {
  method: 'POST',
  headers: { ...authed, 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: `nobody${suffix}` }),
});
ok('adding an unknown username is not found', unknown.status === 404);

// --- Realtime fanout: deletions, friendships, membership -------------------
//
// One socket for the second account, watching a channel it can read and the
// server it belongs to. Everything below is driven over REST by somebody else
// and has to arrive here without a refresh.

const watcher = new WebSocket(`ws://127.0.0.1:3004/ws/chat?token=${encodeURIComponent(otherAuth.accessToken)}`);
const seen = [];
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('watcher socket never became ready')), 10_000);
  watcher.on('message', (raw) => {
    const event = JSON.parse(raw.toString());
    seen.push(event);
    if (event.type === 'ready') {
      watcher.send(JSON.stringify({ type: 'channel.subscribe', channelId: channel.id }));
      watcher.send(JSON.stringify({ type: 'server.subscribe', serverId: server.id }));
      // The subscriptions are answered in order, so a short wait is enough for
      // both to have been applied before anything is published.
      setTimeout(() => {
        clearTimeout(timer);
        resolve();
      }, 300);
    }
  });
  watcher.on('error', reject);
});

/**
 * Waits for the first event of a type to land, or gives up. A matched event is
 * taken out of the list, so a later assertion cannot pass on an earlier
 * event that happened to look the same.
 */
const awaitEvent = async (type, predicate = () => true, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const at = seen.findIndex((event) => event.type === type && predicate(event));
    if (at >= 0) return seen.splice(at, 1)[0];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
};

const doomedLive = await json(`${CHAT}/api/v1/messages`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ channelId: channel.id, content: 'about to vanish' }),
});
await fetch(`${CHAT}/api/v1/messages/${doomedLive.id}`, { method: 'DELETE', headers: authed });
ok(
  'a deletion fans out as the tombstone',
  (await awaitEvent(
    'message.updated',
    (event) => event.message.id === doomedLive.id && event.message.deletedAt !== null,
  )) !== null,
);

// An edit, a pin and a reaction share the same event.
const liveEdit = await json(`${CHAT}/api/v1/messages`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ channelId: channel.id, content: 'first draft' }),
});
await json(`${CHAT}/api/v1/messages/${liveEdit.id}`, {
  method: 'PATCH',
  headers: authed,
  body: JSON.stringify({ content: 'second draft' }),
});
ok(
  'an edit fans out to the channel',
  (await awaitEvent(
    'message.updated',
    (event) => event.message.id === liveEdit.id && event.message.editedAt !== null,
  )) !== null,
);

await json(`${CHAT}/api/v1/messages/${liveEdit.id}/reactions`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ emoji: '🎉' }),
});
ok(
  'a reaction fans out to the channel',
  (await awaitEvent(
    'message.updated',
    (event) =>
      event.message.id === liveEdit.id &&
      event.message.reactions.some((entry) => entry.emoji === '🎉'),
  )) !== null,
);

// Pinning in a server channel is MANAGE_MESSAGE, which a plain member lacks.
const pinRefused = await fetch(`${CHAT}/api/v1/messages/${liveEdit.id}/pin`, {
  method: 'PUT',
  headers: other,
});
ok('pinning a channel message needs MANAGE_MESSAGE', pinRefused.status === 403);

const channelPin = await json(`${CHAT}/api/v1/messages/${liveEdit.id}/pin`, {
  method: 'PUT',
  headers: authed,
});
ok('the owner can pin', channelPin.pinnedAt !== null);

// Granting a permission has to reach the person it was granted to: their client
// holds a server list fetched at sign-in, and that is where its UI reads
// permissions from.
await json(`${SERVER}/api/v1/servers/${server.id}/members/${otherId}`, {
  method: 'PATCH',
  headers: authed,
  body: JSON.stringify({ grantedPermissions: ['DELETE_MESSAGE', 'MANAGE_MESSAGE'] }),
});
ok(
  'a permission change fans out to the member it is about',
  (await awaitEvent('server.members.changed', (event) => event.serverId === server.id)) !== null,
);

const theirServersNow = await json(`${SERVER}/api/v1/servers`, { headers: other });
ok(
  'the granted permission is in their own server list',
  theirServersNow
    .find((item) => item.id === server.id)
    ?.permissions.includes('MANAGE_MESSAGE') === true,
);

const grantedPin = await json(`${CHAT}/api/v1/messages/${liveEdit.id}/pin`, {
  method: 'DELETE',
  headers: other,
});
ok('and the grant lets them pin', grantedPin.pinnedAt === null);

// --- Removing a friend -----------------------------------------------------

const unfriended = await fetch(`${CHAT}/api/v1/friends/${otherId}`, {
  method: 'DELETE',
  headers: authed,
});
ok('friend removed', unfriended.status === 204);
ok('friends.changed reaches the other side', (await awaitEvent('friends.changed')) !== null);

const remaining = await json(`${CHAT}/api/v1/friends`, { headers: authed });
ok('friend list drops them', !remaining.some((entry) => entry.user.id === otherId));

// A membership change is server news, not channel news.
await fetch(`${SERVER}/api/v1/servers/${server.id}/members/${thirdAuth.user.id}`, {
  method: 'DELETE',
  headers: authed,
});
ok(
  'server.members.changed fans out to the server',
  (await awaitEvent('server.members.changed', (event) => event.serverId === server.id)) !== null,
);

// The person who was removed may no longer watch the server.
const strangerSocket = new WebSocket(
  `ws://127.0.0.1:3004/ws/chat?token=${encodeURIComponent(thirdAuth.accessToken)}`,
);
const strangerRefused = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve(null), 5000);
  strangerSocket.on('message', (raw) => {
    const event = JSON.parse(raw.toString());
    if (event.type === 'ready') {
      strangerSocket.send(JSON.stringify({ type: 'server.subscribe', serverId: server.id }));
    }
    if (event.type === 'error') {
      clearTimeout(timer);
      resolve(event.code);
    }
  });
  strangerSocket.on('error', reject);
});
ok('server subscription is membership-checked', strangerRefused === 'SERVER_FORBIDDEN');
strangerSocket.close();
watcher.close();

// With the friendship gone, so is the right to open a new conversation.
let reopenRefused = false;
try {
  await json(`${CHAT}/api/v1/dm`, {
    method: 'POST',
    headers: authed,
    body: JSON.stringify({ userId: otherId }),
  });
} catch {
  reopenRefused = true;
}
ok('a removed friend cannot be messaged again', reopenRefused);

// --- Uploads ---------------------------------------------------------------
//
// Attachments are ciphertext by the time they arrive, so the interesting parts
// are: any bytes are accepted, the object comes back byte for byte, a large one
// survives being cut into parts, and a ticket belongs to the account that
// opened it.

const form = (parts) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(parts)) {
    if (value instanceof Blob) body.append(key, value, 'blob');
    else body.append(key, String(value));
  }
  return body;
};

const post = async (url, body, headers) => {
  const response = await fetch(url, { method: 'POST', body, headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${url} -> ${response.status} ${JSON.stringify(payload)}`);
  return payload;
};

const attachmentBytes = Buffer.from('nexora attachment ciphertext');
const stored = await post(
  `${CHAT}/api/v1/uploads`,
  form({ file: new Blob([attachmentBytes]) }),
  authed,
);
ok('attachment uploaded', stored.key.startsWith('attachments/'), stored.key);

const fetched = await fetch(`${CHAT}${stored.url}`);
const fetchedBytes = Buffer.from(await fetched.arrayBuffer());
ok('attachment round-trips', fetchedBytes.equals(attachmentBytes));
ok(
  'attachment is never served inline',
  fetched.headers.get('content-type') === 'application/octet-stream' &&
    fetched.headers.get('content-disposition') === 'attachment',
  `${fetched.headers.get('content-type')} ${fetched.headers.get('content-disposition')}`,
);

// Multipart: three parts, uploaded out of order, must assemble in part order.
const chunks = [Buffer.alloc(1024, 1), Buffer.alloc(1024, 2), Buffer.alloc(1024, 3)];
const started = await json(`${CHAT}/api/v1/uploads/multipart`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ size: 3072 }),
});
ok('multipart opened', Boolean(started.ticket) && started.maxPartBytes > 0);

const uploadedParts = [];
for (const index of [2, 0, 1]) {
  uploadedParts.push(
    await post(
      `${CHAT}/api/v1/uploads/multipart/part`,
      form({ ticket: started.ticket, partNumber: index + 1, file: new Blob([chunks[index]]) }),
      authed,
    ),
  );
}

// A ticket is bound to the account that opened it, not merely unguessable.
let foreignPartRejected = false;
try {
  await post(
    `${CHAT}/api/v1/uploads/multipart/part`,
    form({ ticket: started.ticket, partNumber: 4, file: new Blob([Buffer.alloc(8)]) }),
    other,
  );
} catch {
  foreignPartRejected = true;
}
ok('upload ticket is bound to its account', foreignPartRejected);

const assembled = await json(`${CHAT}/api/v1/uploads/multipart/complete`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ ticket: started.ticket, parts: uploadedParts }),
});
ok('multipart assembled', assembled.size === 3072, String(assembled.size));

const assembledBytes = Buffer.from(
  await (await fetch(`${CHAT}${assembled.url}`)).arrayBuffer(),
);
ok('multipart assembled in part order', assembledBytes.equals(Buffer.concat(chunks)));

// Scratch space for parts is not an object anyone may read.
const scratch = await fetch(`${CHAT}/api/v1/uploads/.multipart/anything/00001`);
ok('multipart scratch is not downloadable', scratch.status === 400, String(scratch.status));

// --- Pictures ---------------------------------------------------------------
//
// These are stored in the clear and served inline, so the type allowlist is
// the whole of their safety.

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const picture = await post(
  `${CHAT}/api/v1/uploads/picture`,
  form({ file: new File([png], 'me.png', { type: 'image/png' }) }),
  authed,
);
ok('picture uploaded', picture.key.startsWith('pictures/'), picture.key);

let scriptablePictureRejected = false;
try {
  await post(
    `${CHAT}/api/v1/uploads/picture`,
    form({ file: new File(['<svg onload="alert(1)"/>'], 'x.svg', { type: 'image/svg+xml' }) }),
    authed,
  );
} catch {
  scriptablePictureRejected = true;
}
ok('svg is refused as a picture', scriptablePictureRejected);

const withAvatar = await json(`${AUTH}/api/v1/auth/account`, {
  method: 'PATCH',
  headers: authed,
  body: JSON.stringify({ avatarUrl: picture.url }),
});
ok('avatar set', withAvatar.avatarUrl === picture.url);

// An avatar pointing anywhere else would report back who looked at it.
let foreignAvatarRejected = false;
try {
  await json(`${AUTH}/api/v1/auth/account`, {
    method: 'PATCH',
    headers: authed,
    body: JSON.stringify({ avatarUrl: 'https://tracker.example/beacon.png' }),
  });
} catch {
  foreignAvatarRejected = true;
}
ok('avatar must be an uploaded picture', foreignAvatarRejected);

const cleared = await json(`${AUTH}/api/v1/auth/account`, {
  method: 'PATCH',
  headers: authed,
  body: JSON.stringify({ avatarUrl: null }),
});
ok('avatar cleared', cleared.avatarUrl === null);

socket.close();
console.log('\nSMOKE PASSED');
process.exit(0);
