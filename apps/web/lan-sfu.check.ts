/**
 * Self-check for the ICE candidate rewriting behind `pnpm dev:web:lan`.
 *
 * Run with `pnpm --filter @nexora/web check`. Only the parsing is exercised:
 * the rest of lan-ice.ts is two prototype patches, and lan-sfu.ts is a socket
 * pipe.
 */
import assert from 'node:assert/strict';
import { rewriteCandidate, rewriteSdp } from './lan-ice';

const HOST = '192.168.1.105';
const RELAY = 7882;

// The SFU's ICE-TCP candidate is the one the relay stands in for: address and
// port both move, everything from `typ` onwards must not.
assert.equal(
  rewriteCandidate('candidate:1 1 tcp 2105458943 127.0.0.1 7881 typ host tcptype passive', HOST, RELAY),
  `candidate:1 1 tcp 2105458943 ${HOST} ${RELAY} typ host tcptype passive`,
);
assert.equal(
  rewriteCandidate('candidate:9 1 TCP 2105458943 ::1 7881 typ host tcptype passive', HOST, RELAY),
  `candidate:9 1 TCP 2105458943 ${HOST} ${RELAY} typ host tcptype passive`,
);

// UDP is not relayed, so its candidates are left exactly as they are: from
// another machine they lose the ICE race, and from this one they still win it.
const udp = 'candidate:2 1 udp 2130706431 127.0.0.1 50004 typ host';
assert.equal(rewriteCandidate(udp, HOST, RELAY), udp);

// Anything already routable is the SFU's answer, not ours - including the
// browser's own candidates, which pass through the same patch.
const remote = 'candidate:4 1 tcp 1686052607 203.0.113.9 54321 typ srflx raddr 10.0.0.2 rport 54321';
assert.equal(rewriteCandidate(remote, HOST, RELAY), remote);
// The related address in an srflx candidate is not the candidate's address.
const srflx = 'candidate:5 1 tcp 1686052607 198.51.100.4 9 typ srflx raddr 127.0.0.1 rport 9';
assert.equal(rewriteCandidate(srflx, HOST, RELAY), srflx);
// An end-of-candidates signal, and anything else that is not a candidate line.
assert.equal(rewriteCandidate('', HOST, RELAY), '');
assert.equal(rewriteCandidate('a=end-of-candidates', HOST, RELAY), 'a=end-of-candidates');

// In an SDP the same lines carry an `a=` prefix, and nothing else in the
// description may be touched - `c=` and `o=` name addresses too.
const sdp = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  'c=IN IP4 127.0.0.1',
  'a=candidate:1 1 tcp 2105458943 127.0.0.1 7881 typ host tcptype passive',
  'a=candidate:2 1 udp 2130706431 127.0.0.1 50004 typ host',
  'a=mid:0',
  '',
].join('\r\n');
const rewritten = rewriteSdp(sdp, HOST, RELAY);
assert.equal(rewritten.includes('o=- 4611731400430051336 2 IN IP4 127.0.0.1'), true);
assert.equal(rewritten.includes('c=IN IP4 127.0.0.1'), true);
assert.equal(
  rewritten.includes(`a=candidate:1 1 tcp 2105458943 ${HOST} ${RELAY} typ host tcptype passive`),
  true,
);
assert.equal(rewritten.includes(`a=${udp}`), true);
// Line endings are part of the SDP, not incidental.
assert.equal(rewritten.split('\r\n').length, sdp.split('\r\n').length);
assert.equal(rewritten.includes('\n\n'), false);
// The same, for a description that arrived with bare newlines.
assert.equal(
  rewriteSdp('a=candidate:1 1 tcp 1 127.0.0.1 7881 typ host\na=mid:0\n', HOST, RELAY),
  `a=candidate:1 1 tcp 1 ${HOST} ${RELAY} typ host\na=mid:0\n`,
);

console.log('lan-ice self-check passed');
