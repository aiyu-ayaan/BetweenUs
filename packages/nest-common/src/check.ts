/** Self-check: `pnpm --filter @nexora/nest-common check`. Trust boundaries. */
import assert from 'node:assert/strict';
import { clientAddress, corsOptions, rateLimitBuckets } from './index';

function request(headers: Record<string, string | string[] | undefined>, ip = '10.0.0.9') {
  return { headers, ip, socket: { remoteAddress: '10.0.0.9' } };
}

function main(): void {
  // The gateway's own header wins, because it is the one the caller cannot set.
  assert.equal(clientAddress(request({ 'x-real-ip': '203.0.113.7' })), '203.0.113.7');

  // The attack this exists to stop: a caller who sends their own
  // `x-forwarded-for` gets it *prepended* to the real one by the gateway, and
  // reading the first entry would hand them a rate-limit bucket per request.
  assert.equal(
    clientAddress(request({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' })),
    '203.0.113.7',
  );
  assert.equal(
    clientAddress(request({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' })),
    '203.0.113.7',
  );

  // No proxy in front at all: the socket is the only thing left to believe.
  assert.equal(clientAddress(request({})), '10.0.0.9');

  // Credentials are never allowed alongside a wildcard origin.
  assert.deepEqual(corsOptions('*'), { origin: '*', credentials: false });
  assert.deepEqual(corsOptions(''), { origin: '*', credentials: false });
  assert.deepEqual(corsOptions('https://a.example, https://b.example'), {
    origin: ['https://a.example', 'https://b.example'],
    credentials: true,
  });

  // One login attempt is counted twice: against the address, and against the
  // account being guessed at.
  const buckets = rateLimitBuckets(
    { limit: 20, windowSeconds: 60, name: 'auth', subject: (body) => String(body.email), subjectLimit: 10 },
    { path: '/auth/login', address: '203.0.113.7', body: { email: ' Alice@Example.com ' } },
    5,
  );
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0]?.limit, 20);
  // Normalised, or a bucket per spelling is no bucket at all.
  assert.equal(buckets[1]?.key, 'ratelimit:auth:subject:alice@example.com:5');
  assert.equal(buckets[1]?.limit, 10);

  console.log('nest-common check ok');
}

main();
