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

await json(`${SERVER}/api/v1/servers/join`, {
  method: 'POST',
  headers: other,
  body: JSON.stringify({ slug: server.slug }),
});

const members = await json(`${SERVER}/api/v1/servers/${server.id}/members`, { headers: authed });
ok('member list', members.length === 2);
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
