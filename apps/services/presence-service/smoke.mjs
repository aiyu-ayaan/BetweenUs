// Presence smoke: two sockets, one channel. Covers the handshake, presence.sync,
// online/offline fanout, typing echo rules and the voice roster.
//
// Needs Postgres, Redis, auth-service, server-service and presence-service.
import WebSocket from 'ws';

const AUTH = 'http://127.0.0.1:3001';
const SERVER = 'http://127.0.0.1:3003';
const PRESENCE = 'ws://127.0.0.1:3005/ws/presence';

const json = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${url} -> ${response.status} ${JSON.stringify(body)}`);
  return body;
};

const ok = (label, condition, detail = '') => {
  if (!condition) {
    console.error(`FAIL ${label} ${detail}`);
    process.exit(1);
  }
  console.log(`${label} ok`, detail);
};

const register = async (name) => {
  const suffix = `${Date.now().toString(36)}${name}`;
  return json(`${AUTH}/api/v1/auth/register`, {
    method: 'POST',
    body: JSON.stringify({
      email: `presence-${suffix}@nexora.local`,
      username: `presence${suffix}`,
      password: 'hunter2000',
    }),
  });
};

/**
 * A socket that keeps every server event, so a test can wait for one that may
 * already have arrived. Polling a buffer beats racing a listener.
 */
const connect = (token) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(PRESENCE, { headers: { Authorization: `Bearer ${token}` } });
    const events = [];
    socket.on('message', (raw) => events.push(JSON.parse(raw.toString())));
    socket.on('error', reject);
    socket.on('open', () =>
      resolve({
        socket,
        events,
        send: (event) => socket.send(JSON.stringify(event)),
        /** Resolves with the first event matching `match`, or null after `ms`. */
        waitFor: async (match, ms = 4000) => {
          const deadline = Date.now() + ms;
          for (;;) {
            const hit = events.find(match);
            if (hit) return hit;
            if (Date.now() > deadline) return null;
            await new Promise((r) => setTimeout(r, 50));
          }
        },
      }),
    );
  });

const alice = await register('a');
const bob = await register('b');
console.log('accounts ok', alice.user.username, bob.user.username);

const aliceAuth = { Authorization: `Bearer ${alice.accessToken}` };
const server = await json(`${SERVER}/api/v1/servers`, {
  method: 'POST',
  headers: aliceAuth,
  body: JSON.stringify({ name: `Presence ${Date.now().toString(36)}` }),
});

const voiceChannel = await json(`${SERVER}/api/v1/channels`, {
  method: 'POST',
  headers: aliceAuth,
  body: JSON.stringify({ serverId: server.id, name: 'lounge', type: 'VOICE' }),
});
console.log('voice channel ok', voiceChannel.name, voiceChannel.type);

const a = await connect(alice.accessToken);
const ready = await a.waitFor((event) => event.type === 'ready');
ok('handshake', ready?.userId === alice.user.id);

const sync = await a.waitFor((event) => event.type === 'presence.sync');
ok('presence.sync', Array.isArray(sync?.users) && Array.isArray(sync?.voice));
ok(
  'self online in sync',
  sync.users.some((user) => user.userId === alice.user.id && user.status === 'online'),
);

// An unauthenticated socket is closed, not downgraded to an anonymous session.
const anonClose = await new Promise((resolve) => {
  const anon = new WebSocket(PRESENCE);
  anon.on('close', (code) => resolve(code));
  anon.on('error', () => resolve(-1));
});
ok('anonymous rejected', anonClose === 4401, String(anonClose));

// Bob connecting must reach Alice's socket.
const b = await connect(bob.accessToken);
const bobOnline = await a.waitFor(
  (event) => event.type === 'presence.changed' && event.user.userId === bob.user.id,
);
ok('online fanout', bobOnline?.user.status === 'online');

// Typing is broadcast to others and never echoed to its author.
a.send({ type: 'typing.start', channelId: voiceChannel.id });
const typing = await b.waitFor((event) => event.type === 'typing');
ok('typing fanout', typing?.userId === alice.user.id && typing.channelId === voiceChannel.id);
ok('typing not echoed to author', !a.events.some((event) => event.type === 'typing'));

// Bob is not a member of Alice's server, so the channel is not his to touch.
b.send({ type: 'voice.join', channelId: voiceChannel.id });
const forbidden = await b.waitFor((event) => event.type === 'error');
ok('non-member voice join refused', forbidden?.code === 'CHANNEL_FORBIDDEN');

a.send({ type: 'voice.join', channelId: voiceChannel.id });
const joined = await b.waitFor(
  (event) => event.type === 'voice.changed' && event.voice.channelId === voiceChannel.id,
);
ok('voice roster join', joined?.voice.userIds.includes(alice.user.id));

a.send({ type: 'voice.leave', channelId: voiceChannel.id });
const left = await b.waitFor(
  (event) =>
    event.type === 'voice.changed' &&
    event.voice.channelId === voiceChannel.id &&
    !event.voice.userIds.includes(alice.user.id),
);
ok('voice roster leave', left !== null);

a.send({ type: 'ping' });
ok('heartbeat', (await a.waitFor((event) => event.type === 'pong')) !== null);

// Closing a socket takes that user offline for everyone still connected.
a.socket.close();
const offline = await b.waitFor(
  (event) =>
    event.type === 'presence.changed' &&
    event.user.userId === alice.user.id &&
    event.user.status === 'offline',
);
ok('offline fanout', offline !== null);

b.socket.close();
console.log('\nPRESENCE SMOKE PASSED');
process.exit(0);
