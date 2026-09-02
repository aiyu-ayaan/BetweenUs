// Health smoke: the admin health page, pointed at a deployment that is
// genuinely sick.
//
//   node smoke.mjs <adminUsername> <password> [newPassword]
//
// Everything else about the page is a number read out of a healthy stack, which
// is the easy half and the half that was already exercised. The condition it
// exists for is the awkward one: **Postgres is up and slow**. A card that says
// `down` is a database that refused the connection, and anyone would find that
// without a health page. `degraded` is the one nobody had ever seen, so nobody
// knew whether the threshold, the timeout and the header badge agreed with each
// other.
//
// The three states, in order, against a running deployment:
//
//   healthy    everything answers inside SLOW_MS
//   degraded   Postgres answers, and takes longer than SLOW_MS to do it
//   down       Postgres does not answer inside PROBE_TIMEOUT_MS
//
// "Slow" is an egress delay on the database container - `tc netem`, applied
// from a throwaway container sharing its network namespace. That is not a
// simulation of the condition, it is the condition: the server is up, it is
// answering, and every answer takes longer to arrive than the page's threshold
// allows. It is what a saturated pool, a lock queue or a host that has started
// swapping looks like from a client, which is never a refused connection and
// always an answer that takes too long.
//
// The first attempt at this was `docker pause`, and it is worth saying why that
// does not work, because it is the obvious thing to reach for. A freeze is
// absorbed by whatever touches the database first, which on every admin route is
// `AdminGuard` reading the caller's role - so by the time the probes run, the
// database has been let go again and the card comes back green having measured
// nothing. Delay is different: it applies to each query separately, the guard's
// and the probe's alike, which is what makes this repeatable rather than a race.
//
// WHY THERE IS NO `down` CASE FOR THE POSTGRES CARD
//
// There cannot be one, and finding that out is half the point of this file. The
// guard's lookup and the health probe share a 2500ms deadline and the guard runs
// first, so a database slow enough to fail the probe has already failed the
// guard, and the answer is a 503 rather than a page with a red card on it. That
// is the correct behaviour and it is the last case below: the page cannot be
// drawn, so the request says why, quickly. Before the guard had a deadline it
// said nothing at all and waited - which meant the one screen whose purpose is
// to report an unresponsive database was the screen that could not be opened
// while it was.
//
// NEEDS a running auth-service, its dependencies, an admin account, and docker
// reachable from wherever this runs. On a machine where the daemon is inside
// WSL rather than on the host:
//
//   HEALTH_SMOKE_DOCKER="wsl.exe -d Ubuntu -u root -- docker" node smoke.mjs ...
//
// The container is `betweenus-dev-postgres` by default - `pnpm dev:infra` - and
// HEALTH_SMOKE_CONTAINER points it at the compose stack's `betweenus-postgres-1`
// instead. The delay needs an image carrying `tc`, run with NET_ADMIN on the
// database's network namespace; HEALTH_SMOKE_NETEM_IMAGE names it.
import { execFileSync } from 'node:child_process';

const AUTH = process.env.HEALTH_SMOKE_AUTH ?? 'http://127.0.0.1:3001';
const CONTAINER = process.env.HEALTH_SMOKE_CONTAINER ?? 'betweenus-dev-postgres';
const DOCKER = (process.env.HEALTH_SMOKE_DOCKER ?? 'docker').split(' ').filter(Boolean);
const NETEM_IMAGE = process.env.HEALTH_SMOKE_NETEM_IMAGE ?? 'nicolaka/netshoot:latest';

/**
 * Chosen against both deadlines at once, which is narrower than it looks.
 *
 * A query costs about twice this - measured, not assumed: 800ms of egress delay
 * puts the postgres card at around 1750ms, comfortably past SLOW_MS (750) and
 * comfortably inside PROBE_TIMEOUT_MS (2500). The ceiling is the guard rather
 * than the probe: `AdminGuard` spends several round trips of its own before the
 * handler runs, and at 1200ms it exceeds its 2500ms deadline and the request
 * comes back 503 with no page at all. Anything from roughly 500 to 1000 works;
 * 800 sits in the middle of that.
 */
const SLOW_DELAY_MS = 800;

const [, , username, password, newPassword] = process.argv;
if (!username || !password) {
  console.error('usage: node smoke.mjs <adminUsername> <password> [newPassword]');
  process.exit(2);
}

const docker = (...args) => {
  const [command, ...prefix] = DOCKER;
  return execFileSync(command, [...prefix, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
};

const json = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${url} -> ${response.status} ${JSON.stringify(body)}`);
  return body;
};

const session = await json(`${AUTH}/api/v1/auth/login`, {
  method: 'POST',
  body: JSON.stringify({ email: username, password }),
});
let token = session.accessToken;

// The bootstrap account `pnpm admin:create` makes is created with
// change-on-login armed, so every admin route answers 403 until it is spent.
if (newPassword) {
  const changed = await json(`${AUTH}/api/v1/auth/account/password`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword: password, newPassword }),
  });
  token = changed.accessToken ?? token;
}
const auth = { Authorization: `Bearer ${token}` };

const snapshot = () => json(`${AUTH}/api/v1/admin/health`, { headers: auth });

const report = (label, health) => {
  const postgres = health.components.find((component) => component.id === 'postgres');
  console.log(
    `${label.padEnd(10)} overall=${health.overall.padEnd(9)}` +
      `postgres=${postgres.state.padEnd(9)}` +
      `latency=${String(postgres.latencyMs ?? '-').padStart(5)}ms  ${postgres.error ?? ''}`,
  );
  return { overall: health.overall, postgres: postgres.state };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `tc` inside the database's network namespace.
 *
 * A separate container rather than the postgres image, because that image has
 * neither `tc` nor NET_ADMIN - and adding either to the thing under test would
 * mean the deployment being measured is not the deployment that ships.
 */
const tc = (...args) =>
  docker(
    'run',
    '--rm',
    '--network',
    `container:${CONTAINER}`,
    '--cap-add',
    'NET_ADMIN',
    NETEM_IMAGE,
    'tc',
    ...args,
  );

const addDelay = (ms) => tc('qdisc', 'add', 'dev', 'eth0', 'root', 'netem', 'delay', `${ms}ms`);
const clearDelay = () => {
  try {
    tc('qdisc', 'del', 'dev', 'eth0', 'root');
  } catch {
    // Already gone, which is the state this is trying to reach.
  }
};

/**
 * Freezes the database, and thaws it whether or not anything goes wrong.
 *
 * The unpause is scheduled here rather than by a background shell on the docker
 * side: a `sleep && unpause` detached inside the invocation is killed when the
 * invocation returns, which leaves the database frozen and everything after it
 * hanging. A paused database left behind by a failed assertion is a bad half
 * hour for whoever runs this next.
 */
function freeze(ms) {
  docker('pause', CONTAINER);
  let thawed = false;
  const thaw = () => {
    if (thawed) return;
    thawed = true;
    try {
      docker('unpause', CONTAINER);
    } catch (error) {
      console.error(`could not unpause ${CONTAINER}: ${error.message}`);
    }
  };
  const timer = setTimeout(thaw, ms);
  return () => {
    clearTimeout(timer);
    thaw();
  };
}

/** A snapshot taken while every answer from the database is `ms` late. */
async function snapshotWhileSlow(ms, label) {
  addDelay(ms);
  try {
    return report(label, await snapshot());
  } finally {
    clearDelay();
    await sleep(500);
  }
}

// Warm the route once, so the first measured request is not also paying for a
// cold connection pool and a first-time query plan. The clear is for a delay
// left behind by a run that died between applying one and removing it.
clearDelay();
await snapshot();

const healthy = report('healthy', await snapshot());
const slow = await snapshotWhileSlow(SLOW_DELAY_MS, 'degraded');
const recovered = report('recovered', await snapshot());

// The guard's own deadline. With the database already frozen, the health page
// cannot be authorised and therefore cannot be drawn - and the only useful thing
// left to do is say so quickly. Before the deadline existed this request waited
// for as long as the freeze lasted, which meant the one screen whose purpose is
// to report an unresponsive database was the screen you could not open while it
// was.
let guardCode = null;
let guardMs = null;
{
  const thaw = freeze(9000);
  const started = Date.now();
  try {
    await snapshot();
    guardCode = 'NO_ERROR';
  } catch (error) {
    guardCode = /DATABASE_UNAVAILABLE/.test(error.message) ? 'DATABASE_UNAVAILABLE' : error.message;
  } finally {
    guardMs = Date.now() - started;
    thaw();
    await sleep(2000);
  }
}
console.log(`guard      answered in ${String(guardMs).padStart(5)}ms with ${guardCode}`);

const expect = (label, actual, wanted) => {
  if (actual !== wanted) {
    console.error(`FAIL ${label}: expected ${wanted}, got ${actual}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${label} ok`);
};

console.log('');
expect('a healthy database reads up', healthy.postgres, 'up');
expect('and so does the deployment', healthy.overall, 'up');
// The two that are the point of the file.
expect('a slow database reads degraded', slow.postgres, 'degraded');
expect('and degrades the deployment with it', slow.overall, 'degraded');
// A page that goes red and stays red is no more use than one that never does.
expect('and it comes back on its own', recovered.postgres, 'up');
expect('as does the deployment', recovered.overall, 'up');
// And the guard says so rather than hanging.
expect('a frozen database is refused, not waited on', guardCode, 'DATABASE_UNAVAILABLE');
if (guardMs > 4000) {
  console.error(`FAIL the refusal took ${guardMs}ms; the deadline is 2500ms`);
  process.exitCode = 1;
} else {
  console.log('and it is refused inside the deadline ok');
}

if (!process.exitCode) console.log('\nhealth smoke passed');
