// Remote desktop smoke: enrolment, the grant rules, and what the relay refuses.
//
// The interesting assertions are the negative ones. A stranger must not learn a
// machine exists, a viewer must not be able to type, and a revoked grant must
// end a session that is already running.
//
// Needs Postgres, auth-service and remote-gateway, and nothing else: a session
// hands back ICE servers, and no media is set up here.

import { WebSocket } from 'ws';

const AUTH = 'http://127.0.0.1:3001';
const REMOTE = 'http://127.0.0.1:3008';
const REMOTE_WS = 'ws://127.0.0.1:3008';

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
      email: `remote-${suffix}@nexora.local`,
      username: `remote${suffix}`,
      password: 'hunter2000',
    }),
  });
};

/** Resolves on the first event of a given type, or rejects after a timeout. */
const waitFor = (socket, type, timeoutMs = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
    const onMessage = (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type !== type) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(event);
    };
    socket.on('message', onMessage);
  });

const open = (url) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
    socket.once('close', (code) => reject(new Error(`closed ${code}`)));
  });

const owner = await register('o');
const viewer = await register('v');
const stranger = await register('s');
const ownerAuth = { Authorization: `Bearer ${owner.accessToken}` };
const viewerAuth = { Authorization: `Bearer ${viewer.accessToken}` };
const strangerAuth = { Authorization: `Bearer ${stranger.accessToken}` };
console.log('accounts ok', owner.user.username, viewer.user.username);

// --- Enrolment --------------------------------------------------------------

const enrolled = await json(`${REMOTE}/api/v1/remote/machines`, {
  method: 'POST',
  headers: ownerAuth,
  body: JSON.stringify({ name: 'Workshop PC', platform: 'win32' }),
});
const machineId = enrolled.machine.id;
ok('enrol', typeof enrolled.agentToken === 'string' && enrolled.agentToken.length > 20);
ok('owner holds everything', enrolled.machine.permissions.includes('REMOTE_ADMIN'));
ok('offline until an agent connects', enrolled.machine.online === false);

const mine = await json(`${REMOTE}/api/v1/remote/machines`, { headers: ownerAuth });
ok('owner sees it', mine.some((machine) => machine.id === machineId));

const strangerList = await json(`${REMOTE}/api/v1/remote/machines`, { headers: strangerAuth });
ok('stranger sees nothing', !strangerList.some((machine) => machine.id === machineId));

// 404, not 403: a machine id must not be confirmable by someone with no access.
ok(
  'stranger gets 404 on the audit trail',
  (await status(`${REMOTE}/api/v1/remote/machines/${machineId}/audit`, {
    headers: strangerAuth,
  })) === 404,
);
ok(
  'stranger cannot start a session',
  (await status(`${REMOTE}/api/v1/remote/sessions`, {
    method: 'POST',
    headers: strangerAuth,
    body: JSON.stringify({ machineId }),
  })) === 404,
);

// --- Grants -----------------------------------------------------------------

ok(
  'a viewer cannot hand out access',
  (await status(`${REMOTE}/api/v1/remote/machines/${machineId}/grants`, {
    method: 'PUT',
    headers: viewerAuth,
    body: JSON.stringify({ userId: stranger.user.id, permissions: ['REMOTE_VIEW'] }),
  })) === 404,
);

ok(
  'an invented permission is refused',
  (await status(`${REMOTE}/api/v1/remote/machines/${machineId}/grants`, {
    method: 'PUT',
    headers: ownerAuth,
    body: JSON.stringify({ userId: viewer.user.id, permissions: ['REMOTE_EVERYTHING'] }),
  })) === 400,
);

ok(
  'an expiry in the past is refused',
  (await status(`${REMOTE}/api/v1/remote/machines/${machineId}/grants`, {
    method: 'PUT',
    headers: ownerAuth,
    body: JSON.stringify({
      userId: viewer.user.id,
      permissions: ['REMOTE_VIEW'],
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    }),
  })) === 400,
);

const grants = await json(`${REMOTE}/api/v1/remote/machines/${machineId}/grants`, {
  method: 'PUT',
  headers: ownerAuth,
  body: JSON.stringify({ userId: viewer.user.id, permissions: ['REMOTE_VIEW'] }),
});
ok('grant stored', grants.some((grant) => grant.userId === viewer.user.id));

// Control implies view: a session that can type into a screen nobody is
// watching is not a thing worth being able to grant.
const implied = await json(`${REMOTE}/api/v1/remote/machines/${machineId}/grants`, {
  method: 'PUT',
  headers: ownerAuth,
  body: JSON.stringify({ userId: viewer.user.id, permissions: ['REMOTE_CONTROL'] }),
});
ok(
  'control implies view',
  implied.find((grant) => grant.userId === viewer.user.id)?.permissions.includes('REMOTE_VIEW'),
);

// Back to view-only, which is what the relay assertions below are about.
await json(`${REMOTE}/api/v1/remote/machines/${machineId}/grants`, {
  method: 'PUT',
  headers: ownerAuth,
  body: JSON.stringify({ userId: viewer.user.id, permissions: ['REMOTE_VIEW'] }),
});

const viewerList = await json(`${REMOTE}/api/v1/remote/machines`, { headers: viewerAuth });
ok('viewer now sees the machine', viewerList.some((machine) => machine.id === machineId));
ok(
  'viewer holds only what was granted',
  viewerList.find((machine) => machine.id === machineId)?.permissions.join() === 'REMOTE_VIEW',
);

// --- Sessions ---------------------------------------------------------------

ok(
  'no session while the agent is offline',
  (await status(`${REMOTE}/api/v1/remote/sessions`, {
    method: 'POST',
    headers: viewerAuth,
    body: JSON.stringify({ machineId }),
  })) === 503,
);

let refused = false;
try {
  await open(`${REMOTE_WS}/ws/remote?agent=not-a-real-token`);
} catch {
  refused = true;
}
ok('a wrong agent token is refused', refused);

const agent = await open(`${REMOTE_WS}/ws/remote?agent=${encodeURIComponent(enrolled.agentToken)}`);
const agentReady = await waitFor(agent, 'ready');
ok('agent connected', agentReady.machineId === machineId);

const session = await json(`${REMOTE}/api/v1/remote/sessions`, {
  method: 'POST',
  headers: viewerAuth,
  body: JSON.stringify({ machineId }),
});
ok('session opened', typeof session.sessionId === 'string');
ok('session carries the frozen permissions', session.permissions.join() === 'REMOTE_VIEW');
ok('session is told how to find the agent', Array.isArray(session.iceServers));
// STUN needs no configuration, so an answer with nothing in it would mean a
// controller that can never describe itself and therefore never connect.
ok('and there is always at least STUN', session.iceServers.length > 0);
// The screen goes peer to peer. A media-server address in this reply would be
// the whole of the old design coming back.
ok('and no media server is named', session.room === undefined && session.token === undefined);

const controller = await open(
  `${REMOTE_WS}/ws/remote?sessionId=${session.sessionId}&token=${encodeURIComponent(viewer.accessToken)}`,
);
await waitFor(controller, 'ready');
const started = await waitFor(agent, 'session.start');
ok('agent was asked', started.sessionId === session.sessionId);
ok('agent was told how to reach the controller', Array.isArray(started.iceServers));

// Somebody else's session id is not a way in, even with a valid account.
let borrowed = false;
try {
  await open(
    `${REMOTE_WS}/ws/remote?sessionId=${session.sessionId}&token=${encodeURIComponent(stranger.accessToken)}`,
  );
} catch {
  borrowed = true;
}
ok("a session cannot be borrowed", borrowed);

// The whole point: view-only means the relay drops input, whatever the UI does.
controller.send(JSON.stringify({ type: 'input.mouse', action: 'move', x: 10, y: 10 }));
const denied = await waitFor(controller, 'error');
ok('input refused without REMOTE_CONTROL', denied.code === 'REMOTE_CONTROL_REQUIRED');

// --- Requesting control, the way RDP does -----------------------------------
//
// A view-only session may ask; the machine answers. This is the one place a
// person sitting at the machine outranks the stored grant, so it is worth
// asserting that the answer is what changes the session and not the asking.

controller.send(JSON.stringify({ type: 'control.request' }));
const asked = await waitFor(agent, 'control.requested');
ok('the machine was asked', asked.sessionId === session.sessionId);

agent.send(JSON.stringify({ type: 'control.denied', sessionId: session.sessionId }));
const refusedControl = await waitFor(controller, 'control.changed');
ok('a refusal grants nothing', refusedControl.granted === false);
ok('and leaves the session view-only', refusedControl.permissions.join() === 'REMOTE_VIEW');

controller.send(JSON.stringify({ type: 'control.request' }));
await waitFor(agent, 'control.requested');
agent.send(JSON.stringify({ type: 'control.granted', sessionId: session.sessionId }));
const grantedControl = await waitFor(controller, 'control.changed');
ok('the machine can lend control', grantedControl.granted === true);
ok(
  'the session gains it',
  grantedControl.permissions.includes('REMOTE_CONTROL'),
  grantedControl.permissions.join(),
);

// And the input that was refused a moment ago now goes through.
controller.send(JSON.stringify({ type: 'input.mouse', action: 'move', x: 0.5, y: 0.5 }));
const relayed = await waitFor(agent, 'input.mouse');
ok('input reaches the machine once control is lent', relayed.action === 'move');

// Handing it back narrows the session again, without ending it.
controller.send(JSON.stringify({ type: 'control.release' }));
const released = await waitFor(controller, 'control.changed');
ok('releasing takes it away', !released.permissions.includes('REMOTE_CONTROL'));

const audit = await json(`${REMOTE}/api/v1/remote/machines/${machineId}/audit`, {
  headers: ownerAuth,
});
ok('the control request was audited', audit.some((entry) => entry.action === 'control.requested'));
ok('the grant was audited', audit.some((entry) => entry.action === 'control.granted'));
ok('the refusal was audited', audit.some((entry) => entry.action === 'input.refused'));
ok('the session start was audited', audit.some((entry) => entry.action === 'session.started'));

// --- Revocation ends a live session ----------------------------------------

await json(`${REMOTE}/api/v1/remote/machines/${machineId}/grants`, {
  method: 'PUT',
  headers: ownerAuth,
  body: JSON.stringify({ userId: viewer.user.id, permissions: [] }),
});
const ended = await waitFor(controller, 'session.ended');
ok('revoking ends the running session', ended.reason === 'revoked');

const afterRevoke = await json(`${REMOTE}/api/v1/remote/machines`, { headers: viewerAuth });
ok('machine leaves the list', !afterRevoke.some((machine) => machine.id === machineId));

agent.close();
console.log('\nremote-gateway smoke passed');
process.exit(0);
