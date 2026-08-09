/**
 * `pnpm dev:duo` - two signed-in desktop windows for testing chat and calls.
 *
 * It seeds two accounts that share one server, starts the Vite dev server
 * once, then launches two Electron processes with separate profiles so each
 * window has its own session, its own localStorage and - importantly for E2EE -
 * its own device key.
 *
 * Backend services must already be running (`pnpm dev`).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopDir = path.join(repoRoot, 'apps', 'desktop');

const AUTH = process.env.AUTH_SERVICE_URL ?? 'http://127.0.0.1:3001';
const SERVER = process.env.SERVER_SERVICE_URL ?? 'http://127.0.0.1:3003';
const CHAT = process.env.CHAT_SERVICE_URL ?? 'http://127.0.0.1:3004';
const CALL = process.env.CALL_SERVICE_URL ?? 'http://127.0.0.1:3007';
const PRESENCE = process.env.PRESENCE_SERVICE_URL ?? 'http://127.0.0.1:3005';
const NOTIFICATION = process.env.NOTIFICATION_SERVICE_URL ?? 'http://127.0.0.1:3006';
const REMOTE = process.env.REMOTE_GATEWAY_URL ?? 'http://127.0.0.1:3008';
const RENDERER = 'http://localhost:5173';

// Must satisfy the password policy in @nexora/auth: 8+ chars, a letter, a digit.
const PASSWORD = 'nexora-dev-1';
const USERS = [
  { label: 'Alice', email: 'alice@nexora.local', username: 'alice', profile: 'duo-a', x: 40, y: 60 },
  { label: 'Bob', email: 'bob@nexora.local', username: 'bob', profile: 'duo-b', x: 760, y: 60 },
];
const SERVER_NAME = 'Duo Test';

async function json(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`${options.method ?? 'GET'} ${url} -> ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function healthy(name, base) {
  try {
    const body = await json(`${base}/health`);
    return body?.status === 'ok';
  } catch {
    console.error(`  x ${name} is not answering on ${base}`);
    return false;
  }
}

/** Registers the account, or signs in when it already exists. */
async function ensureUser(user) {
  try {
    return await json(`${AUTH}/api/v1/auth/register`, {
      method: 'POST',
      body: JSON.stringify({ email: user.email, username: user.username, password: PASSWORD }),
    });
  } catch (error) {
    if (error.status !== 409) throw error;
    return json(`${AUTH}/api/v1/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email: user.email, password: PASSWORD }),
    });
  }
}

async function seed() {
  const [alice, bob] = await Promise.all(USERS.map(ensureUser));
  const asAlice = { Authorization: `Bearer ${alice.accessToken}` };
  const asBob = { Authorization: `Bearer ${bob.accessToken}` };

  const owned = await json(`${SERVER}/api/v1/servers`, { headers: asAlice });
  const server =
    owned.find((item) => item.name === SERVER_NAME) ??
    (await json(`${SERVER}/api/v1/servers`, {
      method: 'POST',
      headers: asAlice,
      body: JSON.stringify({ name: SERVER_NAME }),
    }));

  // Joining is an upsert, so running this repeatedly is harmless.
  await json(`${SERVER}/api/v1/servers/join`, {
    method: 'POST',
    headers: asBob,
    body: JSON.stringify({ slug: server.slug }),
  });

  const channels = await json(
    `${SERVER}/api/v1/channels?serverId=${server.id}`,
    { headers: asAlice },
  );

  // A voice channel to click on, alongside the default #general text channel.
  let voice = channels.find((channel) => channel.type === 'VOICE');
  if (!voice) {
    voice = await json(`${SERVER}/api/v1/channels`, {
      method: 'POST',
      headers: asAlice,
      body: JSON.stringify({ serverId: server.id, name: 'lounge', type: 'VOICE' }),
    });
  }

  // A private channel Bob is deliberately not on, so the rule can be seen
  // rather than taken on trust: it is absent from Bob's sidebar entirely.
  let secret = channels.find((channel) => channel.name === 'owners-only');
  if (!secret) {
    secret = await json(`${SERVER}/api/v1/channels`, {
      method: 'POST',
      headers: asAlice,
      body: JSON.stringify({
        serverId: server.id,
        name: 'owners-only',
        type: 'TEXT',
        isPrivate: true,
        memberIds: [],
      }),
    });
  }

  const friendship = await seedFriendship(alice, bob, asAlice, asBob);

  return { server, channel: channels[0], voice, secret, friendship };
}

/**
 * Alice and Bob start as friends with a conversation open, because a direct
 * message needs two consenting accounts and typing the request by hand every
 * time is exactly the friction `dev:duo` exists to remove.
 */
async function seedFriendship(alice, bob, asAlice, asBob) {
  const existing = await json(`${CHAT}/api/v1/friends`, { headers: asAlice });
  const already = existing.find((friend) => friend.user.id === bob.user.id);

  if (!already) {
    await json(`${CHAT}/api/v1/friends`, {
      method: 'POST',
      headers: asAlice,
      body: JSON.stringify({ username: bob.user.username }),
    });
  }

  if (already?.status !== 'ACCEPTED') {
    await json(`${CHAT}/api/v1/friends/${alice.user.id}/accept`, {
      method: 'POST',
      headers: asBob,
    });
  }

  return json(`${CHAT}/api/v1/dm`, {
    method: 'POST',
    headers: asAlice,
    body: JSON.stringify({ userId: bob.user.id }),
  });
}

const mainBundle = path.join(desktopDir, 'dist-electron', 'main.js');

/**
 * Removes the previous main-process bundle so the wait below cannot pass on a
 * stale one - launching Electron against yesterday's main.js silently drops
 * whatever IPC handlers were added since.
 */
function clearMainBundle() {
  rmSync(mainBundle, { force: true });
}

function waitForRenderer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (Date.now() > deadline) {
        reject(new Error('Vite dev server did not come up within 60s'));
        return;
      }
      try {
        const response = await fetch(RENDERER, { method: 'GET' });
        if (response.ok && existsSync(mainBundle)) {
          resolve();
          return;
        }
      } catch {
        // Not listening yet.
      }
      setTimeout(poll, 400);
    };
    void poll();
  });
}

function startVite() {
  const isWin = process.platform === 'win32';
  const command = isWin ? 'cmd.exe' : 'pnpm';
  const args = isWin
    ? ['/c', 'pnpm', '--filter', '@nexora/desktop', 'dev']
    : ['--filter', '@nexora/desktop', 'dev'];

  return spawn(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    // The plugin still builds main/preload; it just does not launch Electron.
    env: { ...process.env, NEXORA_NO_ELECTRON: '1' },
  });
}

function startWindow(user) {
  const require = createRequire(path.join(desktopDir, 'package.json'));
  const electronBinary = require('electron');

  return spawn(electronBinary, ['.'], {
    cwd: desktopDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: RENDERER,
      NEXORA_PROFILE: user.profile,
      NEXORA_WINDOW_LABEL: user.label,
      NEXORA_WINDOW_X: String(user.x),
      NEXORA_WINDOW_Y: String(user.y),
      NEXORA_DEV_EMAIL: user.email,
      NEXORA_DEV_PASSWORD: PASSWORD,
    },
  });
}

async function main() {
  console.log('Checking services...');
  const checks = await Promise.all([
    healthy('auth-service', AUTH),
    healthy('server-service', SERVER),
    healthy('chat-service', CHAT),
  ]);
  if (checks.some((ok) => !ok)) {
    console.error('\nStart the backend first:  pnpm dev:infra && pnpm dev');
    process.exit(1);
  }
  if (!(await healthy('call-service', CALL))) {
    console.warn('  ! call-service is down - chat will work, voice will not');
  }
  if (!(await healthy('presence-service', PRESENCE))) {
    console.warn('  ! presence-service is down - no online status or typing indicators');
  }
  if (!(await healthy('notification-service', NOTIFICATION))) {
    console.warn('  ! notification-service is down - unread marks and mutes will not persist');
  }

  if (!(await healthy('remote-gateway', REMOTE))) {
    console.warn('  ! remote-gateway is down - remote machines will not appear');
  }

  const { server, channel, voice, secret, friendship } = await seed();
  console.log(
    `Server "${server.name}" ready: #${channel?.name ?? 'general'}, voice "${voice.name}", ` +
      `private #${secret.name} (Alice only)`,
  );
  console.log(
    `Alice and Bob are friends, with a direct message open to ${friendship.participant.username}`,
  );
  console.log('Sign-in is automatic:');
  for (const user of USERS) console.log(`  - ${user.label} <${user.email}>`);

  clearMainBundle();
  const vite = startVite();
  await waitForRenderer();

  const windows = USERS.map(startWindow);
  console.log('\nTwo windows are open. Close both to stop, or press Ctrl+C.\n');

  let alive = windows.length;
  const killProcess = (child) => {
    if (!child || child.killed || !child.pid) return;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
    } else {
      child.kill();
    }
  };

  const shutdown = () => {
    for (const child of [...windows, vite]) killProcess(child);
  };

  for (const child of windows) {
    child.on('exit', () => {
      alive -= 1;
      if (alive === 0) {
        killProcess(vite);
        process.exit(0);
      }
    });
  }

  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error.body ? `${error.message}\n${JSON.stringify(error.body)}` : error);
  // Setting the code rather than calling process.exit lets the already-spawned
  // children close their pipes; a hard exit here trips a libuv assertion.
  process.exitCode = 1;
});
