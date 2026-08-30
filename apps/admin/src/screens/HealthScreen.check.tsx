/**
 * The health screen, rendered against a typed fixture.
 *
 * The endpoint this screen reads is built separately, so until it lands there
 * is no live snapshot to look at - and the shapes worth looking at are the ones
 * a healthy deployment never produces anyway: an S3 driver that cannot report a
 * disk size, a component that is down and carrying an error sentence, a window
 * with no traffic in it. A fixture reaches all three in a second and a running
 * deployment reaches none of them on demand.
 *
 * What it actually guards: **that a null never renders as a zero.** Every other
 * assertion here is a section being present; that one is the bug this screen
 * could ship. "0 B" of media on an S3 deployment is a panel inventing a
 * measurement, and an operator has no way to tell it apart from a real one.
 *
 * The fixtures live in this file rather than beside the screen so nothing in
 * the production bundle can import them by accident.
 *
 * Run with: pnpm --filter @betweenus/admin check
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AdminServerHealth } from '@betweenus/shared-types';
import { HealthView } from './HealthScreen';

/** A local-disk deployment in good order, with one dependency degraded. */
const local: AdminServerHealth = {
  at: '2026-08-31T09:15:00.000Z',
  overall: 'degraded',
  components: [
    {
      id: 'postgres',
      label: 'PostgreSQL',
      state: 'up',
      latencyMs: 3,
      url: 'postgresql://betweenus@db:5432/betweenus',
      error: null,
      detail: { version: '16.3', schema: 'public' },
    },
    {
      id: 'redis',
      label: 'Redis',
      state: 'degraded',
      latencyMs: 412,
      url: 'redis://redis:6379',
      error: 'Latency above the 250 ms probe budget.',
      detail: { role: 'master' },
    },
    {
      id: 'remote-gateway',
      label: 'Remote gateway',
      state: 'down',
      latencyMs: null,
      url: 'http://remote-gateway:3008/health',
      error: 'connect ECONNREFUSED 172.19.0.9:3008',
    },
  ],
  runtime: {
    uptimeSeconds: 86400 * 6 + 3600 * 4,
    memoryRssBytes: 268435456,
    memoryHeapUsedBytes: 94371840,
    memoryHeapTotalBytes: 134217728,
    loadAverage: [0.42, 0.51, 0.6],
    cpuCount: 8,
    nodeVersion: 'v20.14.0',
    platform: 'linux',
    appVersion: '0.0.1-alpha.18',
  },
  database: {
    totalBytes: 1024 ** 3 * 2.5,
    tables: [
      { table: 'messages', rowEstimate: 1284310, totalBytes: 1024 ** 3, indexBytes: 1024 ** 2 * 260 },
      { table: 'attachments', rowEstimate: 41200, totalBytes: 1024 ** 2 * 512, indexBytes: 1024 ** 2 * 48 },
      { table: 'admin_audit', rowEstimate: 912, totalBytes: 1024 * 640, indexBytes: 1024 * 96 },
    ],
    connections: 78,
    maxConnections: 100,
    version: '16.3',
  },
  media: {
    driver: 'local',
    recordedBytes: 1024 ** 3 * 12,
    diskBytes: 1024 ** 3 * 12.4,
    diskFreeBytes: 1024 ** 3 * 220,
    attachmentCount: 41200,
    byKind: [
      { kind: 'image', count: 30100, bytes: 1024 ** 3 * 7 },
      { kind: 'video', count: 900, bytes: 1024 ** 3 * 4 },
      { kind: 'audio', count: 10200, bytes: 1024 ** 3 * 1 },
    ],
    location: '/var/lib/betweenus/storage-data',
  },
  bandwidth: {
    windowDays: 30,
    callBytes: 1024 ** 3 * 48,
    callBytesSent: 1024 ** 3 * 25,
    callBytesReceived: 1024 ** 3 * 23,
    callSessions: 1840,
    attachmentBytes: 1024 ** 3 * 6,
    attachmentCount: 9120,
    daily: Array.from({ length: 30 }, (_, index) => ({
      date: `2026-08-${String((index % 30) + 1).padStart(2, '0')}`,
      callBytes: 1024 ** 3 * (1 + (index % 5)),
      attachmentBytes: 1024 ** 2 * 200 * ((index % 3) + 1),
    })),
  },
  live: {
    onlineUsers: 42,
    totalSockets: 61,
    activeCalls: 3,
    activeCallParticipants: 7,
    activeRemoteSessions: 1,
    endpoints: [
      { id: 'chat', label: 'Chat', url: 'wss://betweenus.example/ws/chat', connections: 61, state: 'up' },
      { id: 'call', label: 'Call', url: 'wss://betweenus.example/ws/call', connections: 7, state: 'up' },
      {
        id: 'remote',
        label: 'Remote',
        url: 'wss://betweenus.example/ws/remote',
        connections: 0,
        state: 'down',
      },
    ],
  },
};

/**
 * The awkward one: object storage, so both disk figures are unknowable, and a
 * brand new deployment, so every collection is empty.
 */
const s3: AdminServerHealth = {
  ...local,
  overall: 'up',
  components: [],
  media: {
    driver: 's3',
    recordedBytes: 1024 ** 3 * 3,
    diskBytes: null,
    diskFreeBytes: null,
    attachmentCount: 5100,
    byKind: [],
    location: 'betweenus-uploads',
  },
  database: { ...local.database, tables: [], connections: 4, maxConnections: 0, version: null },
  bandwidth: { ...local.bandwidth, daily: [] },
  live: { ...local.live, endpoints: [] },
  runtime: { ...local.runtime, loadAverage: [0, 0, 0], appVersion: null },
};

const first = renderToStaticMarkup(<HealthView health={local} />);

// Every section is on screen, and each is identified by something only it says.
for (const section of [
  'Components',
  'Runtime',
  'Database storage',
  'Media storage',
  'Bandwidth',
  'Live connections',
]) {
  assert.ok(first.includes(section), `the ${section} section must render`);
}

// Sizes are human, in binary units - not raw byte counts.
assert.ok(first.includes('2.50 GB'), 'the database total is formatted');
assert.ok(first.includes('6d 4h'), 'uptime is a duration, not a second count');
assert.ok(first.includes('78') && first.includes('100'), 'connections read as used / max');
assert.ok(first.includes('Local disk'), 'the driver badge names the driver');
assert.ok(first.includes('16.3'), 'the server version is shown');

// A down component keeps its failure sentence, and never claims a latency it
// never measured.
assert.ok(first.includes('connect ECONNREFUSED'), 'a failing component shows its error');
assert.ok(first.includes('No response'), 'null latency is not rendered as 0 ms');

// Colour is never the only signal: each state ships a glyph and its word.
for (const token of ['Up', 'Degraded', 'Down', '●', '◐', '■']) {
  assert.ok(first.includes(token), `state marker ${token} must be drawn`);
}

// The chart draws one column group per day plus the endpoint date labels.
assert.equal((first.match(/<rect/g) ?? []).length >= 30, true, 'a mark per day is drawn');
assert.ok(first.includes('2026-08-01'), 'the first day is labelled');

const second = renderToStaticMarkup(<HealthView health={s3} />);

// The whole point. Null disk figures say so; they never become "0 B".
assert.ok(second.includes('S3 object storage'), 'the S3 driver badge renders');
assert.equal(
  (second.match(/Not measurable here/g) ?? []).length,
  2,
  'both null disk figures say they are unknown rather than zero',
);
assert.ok(
  second.includes('walking the bucket is not free'),
  'and the reason travels with the refusal',
);
assert.ok(!second.includes('>0 B<'), 'no null was flattened into a zero size');

// Empty collections get a sentence rather than an empty frame, and nothing in
// the empty case divides by zero into a NaN-wide bar.
assert.ok(second.includes('No dependencies were probed.'));
assert.ok(second.includes('No table sizes were reported.'));
assert.ok(second.includes('Nothing has been uploaded yet.'));
assert.ok(second.includes('No traffic recorded in this window.'));
assert.ok(second.includes('No realtime endpoints were reported.'));
assert.ok(!second.includes('NaN'), 'no division by a zero denominator reached the markup');
assert.ok(
  second.includes('Not reported on this platform'),
  'three zero load averages are "not reported", not "idle"',
);

console.log('HealthScreen.check.tsx: ok');
