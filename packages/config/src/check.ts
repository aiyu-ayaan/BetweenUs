/**
 * `unreachableFromCaller`, checked without a deployment.
 *
 * The bug it pins down: `LIVEKIT_URL` left at the host-development value
 * `ws://127.0.0.1:7880` in a container stack. Every client is told to dial
 * itself; a browser on the server does exactly that and connects, so the
 * deployment looks fine, and the first phone on the network gets
 * `ERR_CONNECTION_REFUSED` behind a client-side "could not establish signal
 * connection: Failed to fetch".
 *
 * Run with: pnpm --filter @nexora/config check
 */
import assert from 'node:assert/strict';
import { unreachableFromCaller } from './index';

const cases: Array<{ advertised: string; host: string | undefined; unreachable: boolean; why: string }> = [
  {
    advertised: 'ws://127.0.0.1:7880',
    host: '192.168.1.104:8080',
    unreachable: true,
    why: 'the reported failure: loopback SFU, caller on the LAN',
  },
  {
    advertised: 'ws://localhost:7880',
    host: 'nexora.example.com',
    unreachable: true,
    why: 'localhost is loopback by another name',
  },
  {
    advertised: 'ws://[::1]:7880',
    host: '10.0.0.5',
    unreachable: true,
    why: 'so is ::1',
  },
  {
    advertised: 'ws://127.0.0.1:7880',
    host: 'localhost:8080',
    unreachable: false,
    why: 'a client on the server itself can reach loopback, and that is the dev case',
  },
  {
    advertised: 'ws://127.0.0.1:7880',
    host: '127.0.0.1:5175',
    unreachable: false,
    why: 'the same, by address',
  },
  {
    advertised: 'ws://127.0.0.1:7880',
    host: undefined,
    unreachable: false,
    why: 'nothing to compare against is not grounds to refuse',
  },
  {
    advertised: '/livekit',
    host: '192.168.1.104:8080',
    unreachable: false,
    why: 'a path is resolved against the caller, so it is right everywhere',
  },
  {
    advertised: 'wss://sfu.example.com',
    host: '192.168.1.104:8080',
    unreachable: false,
    why: 'a real hostname is the operator business, not this check',
  },
  {
    advertised: '',
    host: '192.168.1.104:8080',
    unreachable: false,
    why: 'unset is caught elsewhere, as LIVEKIT_NOT_CONFIGURED',
  },
];

for (const { advertised, host, unreachable, why } of cases) {
  assert.equal(
    unreachableFromCaller(advertised, host),
    unreachable,
    `${advertised || '<unset>'} from ${host ?? '<no host header>'}: ${why}`,
  );
}

console.log('config check ok');
