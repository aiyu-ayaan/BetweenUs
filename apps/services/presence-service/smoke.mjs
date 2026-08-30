// Presence smoke: three sockets, one channel. Covers the handshake,
// presence.sync, online/offline fanout, typing echo rules, the voice roster and
// the scoping - who is entitled to hear any of it.
//
// Carol is the point of the third socket. She shares no server and no
// friendship with the other two, so every event they generate must miss her:
// presence used to go to every connected socket, which made the online list the
// whole deployment's user directory and a typing event a channel id handed to
// strangers.
//
// Needs Postgres, Redis, auth-service, server-service, call-service and
// presence-service - call-service because the voice roster is published by it.
import WebSocket from 'ws';

const AUTH = 'http://127.0.0.1:3001';
const SERVER = 'http://127.0.0.1:3003';
const PRESENCE = 'ws://127.0.0.1:3005/ws/presence';
const CALL = 'ws://127.0.0.1:3007/ws/call';

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

/** A bare /ws/call socket - this file needs it to make a roster, not to call. */
const callSocket = (token) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(CALL, { headers: { Authorization: `Bearer ${token}` } });
    socket.on('error', reject);
    socket.on('open', () => resolve(socket));
  });

const register = async (name) => {
  const suffix = `${Date.now().toString(36)}${name}`;
  return json(`${AUTH}/api/v1/auth/register`, {
    method: 'POST',
    body: JSON.stringify({
      email: `presence-${suffix}@betweenus.local`,
      username: `presence${suffix}`,
      password: 'hunter2000',
    }),
  });
};

/** Changes one account's last-seen privacy setting. */
const setLastSeenVisibility = (session, lastSeenVisibility) =>
  json(`${AUTH}/api/v1/auth/account`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${session.tokens.accessToken}` },
    body: JSON.stringify({ lastSeenVisibility }),
  });

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
        waitFor: async (match, ms = 4000, startFrom = 0) => {
          const deadline = Date.now() + ms;
          for (;;) {
            const hit = events.slice(startFrom).find(match);
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
const carol = await register('c');
console.log('accounts ok', alice.user.username, bob.user.username, carol.user.username);

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

// Bob shares the server, so he is entitled to Alice's presence. Carol is not
// added to anything, which is the whole of her job here.
//
// He joins on an invite rather than being added by name: adding by name needs
// a friendship, and a friendship would entitle Bob to Alice's presence on its
// own - which is exactly the entitlement this file is trying to isolate from
// shared membership. The invite keeps the two apart.
const invite = await json(`${SERVER}/api/v1/servers/${server.id}/invites`, {
  method: 'POST',
  headers: aliceAuth,
  body: JSON.stringify({}),
});
await json(`${SERVER}/api/v1/servers/join`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${bob.accessToken}` },
  body: JSON.stringify({ code: invite.code }),
});
console.log('membership ok', bob.user.username);

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

// Carol shares nothing with either of them, so Bob coming online is not news
// she is entitled to. Her socket opened before his did, so if it were going to
// arrive it would have by now.
const c = await connect(carol.accessToken);
await c.waitFor((event) => event.type === 'presence.sync');
ok(
  'a stranger is not in the sync',
  !c.events
    .filter((event) => event.type === 'presence.sync')
    .some((event) => event.users.some((user) => user.userId === alice.user.id)),
);

// Typing is broadcast to others and never echoed to its author.
a.send({ type: 'typing.start', channelId: voiceChannel.id });
const typing = await b.waitFor((event) => event.type === 'typing');
ok('typing fanout', typing?.userId === alice.user.id && typing.channelId === voiceChannel.id);
ok('typing not echoed to author', !a.events.some((event) => event.type === 'typing'));
ok('typing not sent to a stranger', !c.events.some((event) => event.type === 'typing'));

// Carol is not a member of Alice's server, so the channel is not hers to touch.
c.send({ type: 'voice.join', channelId: voiceChannel.id });
const forbidden = await c.waitFor((event) => event.type === 'error');
ok('non-member voice join refused', forbidden?.code === 'CHANNEL_FORBIDDEN');

// A member asking the same thing is told nothing, which is the answer: the
// only job left for `voice.join` on this socket is to refuse the people who
// may not.
a.send({ type: 'voice.join', channelId: voiceChannel.id });
ok(
  'member voice join is not refused',
  (await a.waitFor((event) => event.type === 'error', 500)) === null,
);

// The roster itself comes from call-service, which owns the signalling sockets
// and so is the only thing that knows who is really in a call - this socket
// used to write it from whatever a client claimed. So Alice joins the call for
// real, over /ws/call, and the fanout is watched here.
const aliceCall = await callSocket(alice.accessToken);
aliceCall.send(JSON.stringify({ type: 'join', channelId: voiceChannel.id }));

const joined = await b.waitFor(
  (event) => event.type === 'voice.changed' && event.voice.channelId === voiceChannel.id,
);
ok('voice roster join', joined?.voice.userIds.includes(alice.user.id));

aliceCall.send(JSON.stringify({ type: 'leave' }));
const left = await b.waitFor(
  (event) =>
    event.type === 'voice.changed' &&
    event.voice.channelId === voiceChannel.id &&
    !event.voice.userIds.includes(alice.user.id),
);
ok('voice roster leave', left !== null);
aliceCall.close();
ok(
  'voice roster not sent to a stranger',
  !c.events.some((event) => event.type === 'voice.changed'),
);

a.send({ type: 'ping' });
ok('heartbeat', (await a.waitFor((event) => event.type === 'pong')) !== null);

// Status. Bob is the one who changes, so the closing assertion about Alice
// going offline still means what it says - the buffer is scanned from the
// start, and two users' offline events would otherwise be indistinguishable.
b.send({ type: 'status.set', status: 'dnd' });
ok(
  'status echoed to its owner',
  (await b.waitFor((event) => event.type === 'status.self' && event.status === 'dnd')) !== null,
);
ok(
  'status fanout',
  (await a.waitFor(
    (event) =>
      event.type === 'presence.changed' &&
      event.user.userId === bob.user.id &&
      event.user.status === 'dnd',
  )) !== null,
);

// Invisible is the one status nobody else may see: it must arrive as offline.
b.send({ type: 'status.set', status: 'invisible' });
ok(
  'invisible echoed to its owner',
  (await b.waitFor(
    (event) => event.type === 'status.self' && event.status === 'invisible',
  )) !== null,
);
ok(
  'invisible reaches others as offline',
  (await a.waitFor(
    (event) =>
      event.type === 'presence.changed' &&
      event.user.userId === bob.user.id &&
      event.user.status === 'offline',
  )) !== null,
);
ok(
  'invisible never leaks on the wire',
  !a.events.some(
    (event) => event.type === 'presence.changed' && event.user.status === 'invisible',
  ),
);

// --- last seen ---------------------------------------------------------------
//
// Bob is invisible by this point, which is exactly the case worth asserting: a
// status that hid him but went on publishing when he was last here would not be
// hiding him. Alice may ask - they share a server - and must be told `offline`
// without a timestamp that is ticking along behind the disguise.
const beforeBobQuery = a.events.length;
a.send({ type: 'presence.query', userIds: [bob.user.id] });
const bobSeen = await a.waitFor(
  (event) => event.type === 'presence.changed' && event.user.userId === bob.user.id,
  4000,
  beforeBobQuery,
);
ok('a query is answered', bobSeen !== null);
ok('an invisible user answers offline', bobSeen?.user.status === 'offline');

// Carol shares nothing with Alice, so asking about her must be answered with
// silence rather than with a status - a query anybody could aim at any id would
// be the "who is online" oracle the audience scoping exists to remove.
const before = a.events.length;
a.send({ type: 'presence.query', userIds: [carol.user.id] });
await new Promise((resolve) => setTimeout(resolve, 500));
ok(
  'a query about a stranger is answered with nothing',
  !a.events
    .slice(before)
    .some((event) => event.type === 'presence.changed' && event.user.userId === carol.user.id),
);

// Closing a socket takes that user offline for everyone still connected.
a.socket.close();
const offline = await b.waitFor(
  (event) =>
    event.type === 'presence.changed' &&
    event.user.userId === alice.user.id &&
    event.user.status === 'offline',
);
ok('offline fanout', offline !== null);
// And it carries no timestamp, deliberately. Who may read a last-seen time
// depends on the reader, and a broadcast has one payload for all of them - so
// the answer only ever travels down `presence.query`, which is per-asker.
ok('the offline broadcast carries no timestamp', offline?.user.lastSeenAt === undefined);

// Bob asks about Alice, who has just left and has never narrowed her setting.
// This is the path that may answer, and the only one.
const beforeAliceQuery = b.events.length;
b.send({ type: 'presence.query', userIds: [alice.user.id] });
const aliceSeen = await b.waitFor(
  (event) =>
    event.type === 'presence.changed' &&
    event.user.userId === alice.user.id &&
    typeof event.user.lastSeenAt === 'string',
  4000,
  beforeAliceQuery,
);
ok('a query answers with a last-seen time', aliceSeen !== null);
ok(
  'and it is when she actually left',
  Math.abs(Date.now() - new Date(aliceSeen.user.lastSeenAt).getTime()) < 5 * 60_000,
);

// --- the privacy setting, and the rule that makes it worth having ------------
//
// Alice narrows hers to friends. Bob shares a server with her and is not her
// friend, so the timestamp he could read a moment ago must stop arriving - the
// same query, the same account, a different answer.
await setLastSeenVisibility(alice, 'friends');
const beforeFriends = b.events.length;
b.send({ type: 'presence.query', userIds: [alice.user.id] });
await new Promise((resolve) => setTimeout(resolve, 500));
ok(
  'friends-only hides it from a server-mate',
  b.events
    .slice(beforeFriends)
    .filter((event) => event.type === 'presence.changed' && event.user.userId === alice.user.id)
    .every((event) => event.user.lastSeenAt === undefined),
);
// The status still arrives. It is the timestamp that is private, not the
// account - a query that went silent would say something by going silent.
ok(
  'but the status still arrives',
  b.events
    .slice(beforeFriends)
    .some((event) => event.type === 'presence.changed' && event.user.userId === alice.user.id),
);

// And reciprocity: Bob hides his own, Alice opens hers all the way back up, and
// Bob still gets nothing. This is the rule that stops the setting being a
// one-way mirror, and it is the one worth an end-to-end assertion because it
// depends on two accounts' settings at once.
await setLastSeenVisibility(alice, 'everyone');
await setLastSeenVisibility(bob, 'nobody');
const beforeHiding = b.events.length;
b.send({ type: 'presence.query', userIds: [alice.user.id] });
await new Promise((resolve) => setTimeout(resolve, 500));
ok(
  "somebody who hides their own reads nobody else's",
  b.events
    .slice(beforeHiding)
    .filter((event) => event.type === 'presence.changed' && event.user.userId === alice.user.id)
    .every((event) => event.user.lastSeenAt === undefined),
);
// Not "no presence.changed at all": Carol is in her own audience, so her own
// arrival comes back to her. Everything about anybody else is what must never
// reach her, and that is what this asserts.
ok(
  'no presence about strangers at all',
  c.events
    .filter((event) => event.type === 'presence.changed')
    .every((event) => event.user.userId === carol.user.id),
);

b.socket.close();
c.socket.close();
console.log('\nPRESENCE SMOKE PASSED');
process.exit(0);
