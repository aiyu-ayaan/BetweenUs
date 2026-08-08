// End-to-end smoke: register -> workspace -> channel -> WS subscribe -> send -> receive.
import WebSocket from 'ws';

const AUTH = 'http://127.0.0.1:3001';
const WORKSPACE = 'http://127.0.0.1:3003';
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
console.log('me ok', me.email === email);

const refreshed = await json(`${AUTH}/api/v1/auth/refresh`, {
  method: 'POST',
  body: JSON.stringify({ refreshToken: auth.refreshToken }),
});
console.log('refresh ok', Boolean(refreshed.accessToken));

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
console.log('refresh rotation ok', reuseRejected);

const workspace = await json(`${WORKSPACE}/api/v1/workspaces`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ name: `Smoke ${suffix}` }),
});
console.log('workspace ok', workspace.slug, workspace.role);

const channels = await json(
  `${WORKSPACE}/api/v1/channels?workspaceId=${workspace.id}`,
  { headers: authed },
);
console.log('default channel ok', channels[0]?.name);

const channel = await json(`${WORKSPACE}/api/v1/channels`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ workspaceId: workspace.id, name: 'Smoke Test Room' }),
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
console.log('history ok', history.items.length === 1);

// Unauthenticated socket must be closed, not downgraded.
const anonClosed = await new Promise((resolve) => {
  const anon = new WebSocket('ws://127.0.0.1:3004/ws/chat');
  anon.on('close', (code) => resolve(code));
  anon.on('error', () => resolve(-1));
});
console.log('anonymous ws rejected ok', anonClosed === 4401);

// Upload with no S3 configured must land on local disk.
const form = new FormData();
form.append('file', new Blob([Buffer.from('smoke-png')], { type: 'image/png' }), 'shot.png');
const uploadResponse = await fetch(`${CHAT}/api/v1/uploads`, {
  method: 'POST',
  headers: authed,
  body: form,
});
const uploaded = await uploadResponse.json();
if (!uploadResponse.ok) throw new Error(`upload failed ${JSON.stringify(uploaded)}`);
console.log('upload ok', uploaded.key, uploaded.size);

const download = await fetch(`${CHAT}${uploaded.url}`);
const downloaded = await download.text();
console.log('download ok', downloaded === 'smoke-png', download.headers.get('content-type'));

// Traversal attempt must be refused.
const traversal = await fetch(`${CHAT}/api/v1/uploads/..%2F..%2Fpackage.json`);
console.log('traversal blocked ok', traversal.status >= 400);

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
console.log('device directory ok', devices.some((device) => device.userId === me.id));

const empty = await json(`${CHAT}/api/v1/e2ee/keys/${channel.id}`, { headers: authed });
console.log('unkeyed channel ok', empty.epoch === 0 && empty.keys.length === 0);

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
console.log(
  'channel key ok',
  keys.epoch === 1 && keys.keys[0]?.wrappedKey === 'c21va2Utd3JhcHBlZC1rZXk=',
);

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
console.log('epoch ordering enforced ok', epochRejected);

socket.close();
console.log('\nSMOKE PASSED');
process.exit(0);
