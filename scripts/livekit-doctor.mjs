/**
 * Answers one question on a running deployment: does the SFU accept a token
 * signed with the LIVEKIT_API_SECRET in `.env`?
 *
 * "could not establish signal connection: invalid token: ..., error: token
 * signature is invalid" always means the SFU holds a different secret from the
 * service that minted the token. It never says which side is stale, and the
 * usual cause - a container still running with the environment it was created
 * with - is invisible from the client. This asks both sides and prints
 * fingerprints, never secrets.
 *
 * Usage (from the repo root, on the host running the stack):
 *   pnpm livekit:doctor            # checks http://127.0.0.1:7880
 *   pnpm livekit:doctor http://livekit:7880
 *
 * No dependencies on purpose: it has to run on a box where only the compose
 * stack is installed.
 */
import { createHmac, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_PATH = resolve(process.cwd(), '.env');
const COMPOSE_FILE = 'infrastructure/docker/docker-compose.yml';
const target = (process.argv[2] ?? 'http://127.0.0.1:7880').replace(/\/+$/, '');

/** Minimal `.env` reader: `KEY=value`, optional surrounding quotes, `#` comments. */
function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[match[1]] = value;
  }
  return out;
}

/** Enough to tell two secrets apart without printing either. */
function fingerprint(secret) {
  return createHash('sha256').update(secret).digest('hex').slice(0, 12);
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

/** A LiveKit join token, signed the same way livekit-server-sdk signs one. */
function mintToken(apiKey, apiSecret) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: apiKey,
      sub: 'livekit-doctor',
      nbf: now,
      exp: now + 60,
      video: { room: 'livekit-doctor', roomJoin: true },
    }),
  );
  const signature = createHmac('sha256', apiSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/** What the *running* SFU container was started with, if docker is reachable. */
function containerKeys() {
  try {
    return execFileSync(
      'docker',
      ['compose', '--env-file', '.env', '-f', COMPOSE_FILE, 'exec', '-T', 'livekit', 'printenv', 'LIVEKIT_KEYS'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return null;
  }
}

async function main() {
  const env = { ...readEnvFile(ENV_PATH), ...process.env };
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    console.error(`No LIVEKIT_API_KEY / LIVEKIT_API_SECRET in ${ENV_PATH} or the environment.`);
    process.exit(2);
  }

  console.log(`SFU            ${target}`);
  console.log(`key name       ${apiKey}`);
  console.log(`secret (.env)  ${fingerprint(apiSecret)}  (sha256 prefix, not the secret)`);

  // The container's own view. A mismatch here is the whole diagnosis: the SFU
  // keeps the environment it was created with, so editing .env and restarting
  // changes nothing until it is recreated.
  const keys = containerKeys();
  if (keys) {
    const match = /^\s*([^:]+)\s*:\s*(.*?)\s*$/.exec(keys);
    const containerSecret = match ? match[2].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1') : '';
    const containerKey = match ? match[1].trim() : '';
    console.log(`key name (SFU) ${containerKey}`);
    console.log(`secret (SFU)   ${containerSecret ? fingerprint(containerSecret) : '<unparsable>'}`);
    if (containerSecret && containerSecret !== apiSecret) {
      console.log('');
      console.log('The running SFU holds a different secret from .env.');
      console.log('Fix: docker compose --env-file .env -f ' + COMPOSE_FILE);
      console.log('       up -d --force-recreate livekit call-service remote-gateway');
    }
  }

  let response;
  try {
    response = await fetch(`${target}/rtc/validate?access_token=${mintToken(apiKey, apiSecret)}`, {
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    console.log('');
    console.log(`Could not reach the SFU: ${error.message}`);
    console.log('That is a networking problem, not a key problem. Is the container up, and is');
    console.log('7880 published on this host? Pass the address explicitly if it is elsewhere.');
    process.exit(2);
  }

  const body = (await response.text()).trim();
  console.log('');
  if (response.ok) {
    console.log('OK: the SFU accepts tokens signed with this secret.');
    console.log('If joins still fail, the failure is after signalling - ICE/UDP, use_external_ip,');
    console.log('or the /livekit proxy - not the key. See DEPLOYMENT.md §4.');
    return;
  }

  console.log(`REJECTED (HTTP ${response.status}): ${body.slice(0, 200)}`);
  console.log('');
  console.log('The SFU and .env disagree. Recreate both sides so they read the same value:');
  console.log(`  docker compose --env-file .env -f ${COMPOSE_FILE} \\`);
  console.log('    up -d --force-recreate livekit call-service remote-gateway');
  process.exit(1);
}

await main();
