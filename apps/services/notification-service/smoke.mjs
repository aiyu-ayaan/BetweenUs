// Notification smoke: preferences round-trip, unread counting and the read
// marker, plus the two rules that matter for privacy - your own messages are
// never unread, and a channel you cannot see cannot be marked read.
//
// Needs Postgres, auth-service, server-service, chat-service and
// notification-service.

const AUTH = 'http://127.0.0.1:3001';
const SERVER = 'http://127.0.0.1:3003';
const CHAT = 'http://127.0.0.1:3004';
const NOTIFY = 'http://127.0.0.1:3006';

const json = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${url} -> ${response.status} ${JSON.stringify(body)}`);
  return body;
};

const status = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  return response.status;
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
      email: `notify-${suffix}@betweenus.local`,
      username: `notify${suffix}`,
      password: 'hunter2000',
    }),
  });
};

const alice = await register('a');
const stranger = await register('s');
const aliceAuth = { Authorization: `Bearer ${alice.accessToken}` };
const strangerAuth = { Authorization: `Bearer ${stranger.accessToken}` };
console.log('accounts ok', alice.user.username, stranger.user.username);

const server = await json(`${SERVER}/api/v1/servers`, {
  method: 'POST',
  headers: aliceAuth,
  body: JSON.stringify({ name: `Notify ${Date.now().toString(36)}` }),
});
// A new server comes with its own #general; there is no need to make another.
const channels = await json(`${SERVER}/api/v1/channels?serverId=${server.id}`, {
  headers: aliceAuth,
});
const channel = channels.find((entry) => entry.type === 'TEXT');
ok('server has a text channel', channel !== undefined, JSON.stringify(channels));

// --- preferences -------------------------------------------------------------

const defaults = await json(`${NOTIFY}/api/v1/notifications/preferences`, { headers: aliceAuth });
ok(
  'defaults',
  defaults.enabled === true && defaults.mutedChannelIds.length === 0,
  JSON.stringify(defaults),
);

const muted = await json(`${NOTIFY}/api/v1/notifications/preferences`, {
  method: 'PATCH',
  headers: aliceAuth,
  body: JSON.stringify({ mutedChannelIds: [channel.id, channel.id], quietStartMinute: 1320 }),
});
ok(
  'mute stored, deduplicated',
  muted.mutedChannelIds.length === 1 && muted.mutedChannelIds[0] === channel.id,
  JSON.stringify(muted.mutedChannelIds),
);
ok('quiet hours stored', muted.quietStartMinute === 1320 && muted.quietEndMinute === null);

// Mentions only is the third level, and it is stored the same way. Whether a
// message counts as a mention is the client's answer - the body is sealed with
// the channel key and this service never sees one - so all that is asserted
// here is that the preference round-trips and does not disturb the mute list.
const mentions = await json(`${NOTIFY}/api/v1/notifications/preferences`, {
  method: 'PATCH',
  headers: aliceAuth,
  body: JSON.stringify({ mentionOnlyChannelIds: [channel.id, channel.id] }),
});
ok(
  'mentions-only stored, deduplicated',
  mentions.mentionOnlyChannelIds.length === 1 && mentions.mentionOnlyChannelIds[0] === channel.id,
  JSON.stringify(mentions.mentionOnlyChannelIds),
);
ok('the mute list is untouched by it', mentions.mutedChannelIds.length === 1);

// A patch touches only what it names.
const patched = await json(`${NOTIFY}/api/v1/notifications/preferences`, {
  method: 'PATCH',
  headers: aliceAuth,
  body: JSON.stringify({ enabled: false }),
});
ok(
  'patch leaves untouched fields alone',
  patched.enabled === false && patched.mutedChannelIds.length === 1,
  JSON.stringify(patched),
);

const outOfRange = await status(`${NOTIFY}/api/v1/notifications/preferences`, {
  method: 'PATCH',
  headers: aliceAuth,
  body: JSON.stringify({ quietStartMinute: 5000 }),
});
ok('a minute outside the day is refused', outOfRange === 400, String(outOfRange));

// --- unread ------------------------------------------------------------------

const send = (auth, text) =>
  json(`${CHAT}/api/v1/messages`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ channelId: channel.id, content: text }),
  });

await send(aliceAuth, 'mine, and therefore read');
const unreadAfterOwn = await json(`${NOTIFY}/api/v1/notifications/unread`, { headers: aliceAuth });
const own = unreadAfterOwn.find((entry) => entry.channelId === channel.id);
ok('own message is not unread', own !== undefined && own.count === 0, JSON.stringify(own));

// Someone else's message is unread, and counts from the moment this account
// could see the channel rather than from the start of its history.
const bob = await register('b');
const bobAuth = { Authorization: `Bearer ${bob.accessToken}` };
const invite = await json(`${SERVER}/api/v1/servers/${server.id}/invites`, {
  method: 'POST',
  headers: aliceAuth,
  body: JSON.stringify({}),
});
await json(`${SERVER}/api/v1/servers/join`, {
  method: 'POST',
  headers: bobAuth,
  body: JSON.stringify({ code: invite.code }),
});
await send(bobAuth, 'from someone else');

const unreadForAlice = await json(`${NOTIFY}/api/v1/notifications/unread`, { headers: aliceAuth });
const counted = unreadForAlice.find((entry) => entry.channelId === channel.id);
ok("someone else's message is unread", counted?.count === 1, JSON.stringify(counted));

const unreadForBob = await json(`${NOTIFY}/api/v1/notifications/unread`, { headers: bobAuth });
const beforeJoin = unreadForBob.find((entry) => entry.channelId === channel.id);
ok(
  'history from before joining is not unread',
  beforeJoin?.count === 0,
  JSON.stringify(beforeJoin),
);

const read = await json(`${NOTIFY}/api/v1/notifications/read`, {
  method: 'POST',
  headers: aliceAuth,
  body: JSON.stringify({ channelId: channel.id }),
});
ok('read marker set', read.lastReadAt !== null, read.lastReadAt);

const afterRead = await json(`${NOTIFY}/api/v1/notifications/unread`, { headers: aliceAuth });
const cleared = afterRead.find((entry) => entry.channelId === channel.id);
ok('channel reads as zero after marking', cleared?.count === 0, JSON.stringify(cleared));

// --- authorization -----------------------------------------------------------

const foreignRead = await status(`${NOTIFY}/api/v1/notifications/read`, {
  method: 'POST',
  headers: strangerAuth,
  body: JSON.stringify({ channelId: channel.id }),
});
ok(
  'a channel the caller cannot see is a 404, not a 403',
  foreignRead === 404,
  String(foreignRead),
);

const anonymous = await status(`${NOTIFY}/api/v1/notifications/preferences`);
ok('preferences need a token', anonymous === 401, String(anonymous));

const strangerUnread = await json(`${NOTIFY}/api/v1/notifications/unread`, {
  headers: strangerAuth,
});
ok(
  'unread lists only channels the caller can read',
  strangerUnread.every((entry) => entry.channelId !== channel.id),
  JSON.stringify(strangerUnread),
);

console.log('\nnotification smoke passed');
