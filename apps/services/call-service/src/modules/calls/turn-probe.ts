/**
 * Asking a TURN relay, in its own protocol, whether it actually works.
 *
 * "Is the relay up" cannot be answered by pinging it, by opening a TCP socket
 * to it, or by reading the configuration. A relay can be reachable and still
 * refuse every allocation because the credential is wrong; it can accept
 * allocations and still be useless because a firewall drops the relayed port
 * range. The only answer worth showing an operator is the one the client will
 * get: **ask for an allocation with the credential the deployment hands out,
 * and see whether a relayed address comes back.**
 *
 * That is what this does. It is STUN/TURN (RFC 5389, RFC 8656) over UDP, in
 * about two hundred lines, with `node:dgram` and `node:crypto` and no
 * dependency - the wire format is small and a library for it would be a
 * dependency carried for one diagnostic.
 *
 * The exchange is the standard long-term credential dance:
 *
 * 1. `Allocate` with no credential. The relay is *expected* to refuse with
 *    `401`, and that refusal is where its `REALM` and `NONCE` come from. A
 *    relay that answers anything else here is misconfigured, and saying so is
 *    more useful than retrying.
 * 2. `Allocate` again, signed: `MESSAGE-INTEGRITY` is HMAC-SHA1 over the
 *    message under a key of `MD5(username:realm:password)`.
 * 3. Success carries `XOR-RELAYED-ADDRESS` - the address the relay would
 *    forward this call's media through. That address existing is the proof.
 * 4. `Refresh` with `LIFETIME=0`, to give the allocation straight back.
 *
 * **Step 4 is not politeness, it is required.** A relay is configured with
 * `user-quota` and `total-quota` precisely so a leaked credential cannot cost
 * unbounded bandwidth, and every client shares one username here, so the quota
 * is deployment-wide. A health page that allocated on every refresh and walked
 * away would exhaust that quota by itself and take real calls down - the
 * monitoring causing the outage it is watching for.
 *
 * MD5 and HMAC-SHA1 are not choices made here. RFC 5389 §15.4 specifies both
 * for long-term credentials, and a relay will reject anything else.
 *
 * Only `turn:` over UDP is probed. `turns:` and `?transport=tcp` are reported
 * as configured but unprobed rather than guessed at: they need a TLS handshake
 * and a framed TCP transport, which is a second implementation of all of this
 * for a listener most deployments do not have. An honest "not checked" beats a
 * green tick that means nothing.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import type { RelayProbeResult } from '@betweenus/shared-types';

/** RFC 5389 §6. Present in every message, and how a reply is recognised. */
const MAGIC_COOKIE = 0x2112a442;

const METHOD_ALLOCATE = 0x0003;
const METHOD_REFRESH = 0x0004;
const CLASS_REQUEST = 0x0000;
const CLASS_SUCCESS = 0x0100;
const CLASS_ERROR = 0x0110;

const ATTR_USERNAME = 0x0006;
const ATTR_MESSAGE_INTEGRITY = 0x0008;
const ATTR_ERROR_CODE = 0x0009;
const ATTR_REALM = 0x0014;
const ATTR_NONCE = 0x0015;
const ATTR_XOR_RELAYED_ADDRESS = 0x0016;
const ATTR_REQUESTED_TRANSPORT = 0x0019;
const ATTR_XOR_MAPPED_ADDRESS = 0x0020;
const ATTR_LIFETIME = 0x000d;

/** RFC 8656: the transport the relayed traffic will use. 17 is UDP. */
const TRANSPORT_UDP = 17;

interface StunMessage {
  type: number;
  txid: Buffer;
  attributes: Map<number, Buffer>;
}

/** One attribute, padded to a four-byte boundary as the RFC requires. */
function encodeAttribute(type: number, value: Buffer): Buffer {
  const padding = (4 - (value.length % 4)) % 4;
  const out = Buffer.alloc(4 + value.length + padding);
  out.writeUInt16BE(type, 0);
  // The declared length excludes the padding, which is why it is not out.length.
  out.writeUInt16BE(value.length, 2);
  value.copy(out, 4);
  return out;
}

function encodeMessage(type: number, txid: Buffer, attributes: Buffer[]): Buffer {
  const body = Buffer.concat(attributes);
  const out = Buffer.alloc(20 + body.length);
  out.writeUInt16BE(type, 0);
  out.writeUInt16BE(body.length, 2);
  out.writeUInt32BE(MAGIC_COOKIE, 4);
  txid.copy(out, 8);
  body.copy(out, 20);
  return out;
}

/**
 * The same message, signed.
 *
 * The subtlety that makes every hand-rolled STUN client fail once: the HMAC is
 * computed over a header whose declared length **already counts the
 * MESSAGE-INTEGRITY attribute that is not appended yet** (RFC 5389 §15.4).
 * Signing the message as it stands and then appending produces a signature the
 * relay computes differently and rejects, with an error that says only "401".
 */
function encodeSigned(
  type: number,
  txid: Buffer,
  attributes: Buffer[],
  key: Buffer,
): Buffer {
  const unsigned = encodeMessage(type, txid, attributes);
  // 4 bytes of attribute header + 20 bytes of HMAC-SHA1.
  unsigned.writeUInt16BE(unsigned.length - 20 + 24, 2);
  const mac = createHmac('sha1', key).update(unsigned).digest();
  return Buffer.concat([unsigned, encodeAttribute(ATTR_MESSAGE_INTEGRITY, mac)]);
}

/** `MD5(username:realm:password)` - RFC 5389 §15.4, not a preference. */
function longTermKey(username: string, realm: string, password: string): Buffer {
  return createHash('md5').update(`${username}:${realm}:${password}`).digest();
}

export function parseMessage(buffer: Buffer): StunMessage | null {
  if (buffer.length < 20) return null;
  if (buffer.readUInt32BE(4) !== MAGIC_COOKIE) return null;

  const length = buffer.readUInt16BE(2);
  if (buffer.length < 20 + length) return null;

  const attributes = new Map<number, Buffer>();
  let offset = 20;
  const end = 20 + length;
  while (offset + 4 <= end) {
    const type = buffer.readUInt16BE(offset);
    const size = buffer.readUInt16BE(offset + 2);
    const from = offset + 4;
    if (from + size > end) break;
    // First wins: a duplicated attribute is malformed, and the first is the
    // one every other implementation reads.
    if (!attributes.has(type)) attributes.set(type, buffer.subarray(from, from + size));
    offset = from + size + ((4 - (size % 4)) % 4);
  }

  return { type: buffer.readUInt16BE(0), txid: buffer.subarray(8, 20), attributes };
}

/**
 * `XOR-MAPPED-ADDRESS` and friends, decoded.
 *
 * The XOR exists because middleboxes used to rewrite anything that looked like
 * an IP address in a packet body, including the one STUN was reporting back.
 */
export function decodeXorAddress(value: Buffer, txid: Buffer): string | null {
  if (value.length < 8) return null;
  const family = value.readUInt8(1);
  const port = value.readUInt16BE(2) ^ (MAGIC_COOKIE >>> 16);

  if (family === 0x01) {
    const raw = value.subarray(4, 8);
    const cookie = Buffer.alloc(4);
    cookie.writeUInt32BE(MAGIC_COOKIE, 0);
    const octets = Array.from(raw, (byte, index) => byte ^ (cookie[index] as number));
    return `${octets.join('.')}:${port}`;
  }

  if (family === 0x02) {
    if (value.length < 20) return null;
    const mask = Buffer.concat([Buffer.alloc(4), txid]);
    mask.writeUInt32BE(MAGIC_COOKIE, 0);
    const raw = value.subarray(4, 20);
    const parts: string[] = [];
    for (let index = 0; index < 16; index += 2) {
      const high = (raw[index] as number) ^ (mask[index] as number);
      const low = (raw[index + 1] as number) ^ (mask[index + 1] as number);
      parts.push(((high << 8) | low).toString(16));
    }
    return `[${parts.join(':')}]:${port}`;
  }

  return null;
}

export function decodeErrorCode(value: Buffer): { code: number; reason: string } {
  if (value.length < 4) return { code: 0, reason: '' };
  // Two zero bytes, then a class digit, then a number within the class.
  const code = (value.readUInt8(2) & 0x07) * 100 + value.readUInt8(3);
  return { code, reason: value.subarray(4).toString('utf8').slice(0, 120) };
}

/** What a `turn:`/`turns:` URL says, without the WHATWG parser, which refuses them. */
export function parseTurnUrl(
  url: string,
): { scheme: 'turn' | 'turns'; host: string; port: number; transport: 'udp' | 'tcp' } | null {
  const match = /^(turns?):(?:\/\/)?(\[[^\]]+\]|[^:?/]+)(?::(\d+))?(?:\?(.*))?$/i.exec(url.trim());
  if (!match) return null;

  const scheme = (match[1] as string).toLowerCase() as 'turn' | 'turns';
  const host = (match[2] as string).replace(/^\[|\]$/g, '');
  const query = match[4] ?? '';
  const named = /transport=(udp|tcp)/i.exec(query);

  // RFC 7065: turns: defaults to TCP, turn: to UDP, and either can say
  // otherwise. The default port differs too - 5349 for TLS.
  const transport = named
    ? ((named[1] as string).toLowerCase() as 'udp' | 'tcp')
    : scheme === 'turns'
      ? 'tcp'
      : 'udp';

  const port = match[3] ? Number(match[3]) : scheme === 'turns' ? 5349 : 3478;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  return { scheme, host, port, transport };
}

/** Sends one datagram and waits for the reply carrying the same transaction id. */
function exchange(
  socket: ReturnType<typeof createSocket>,
  message: Buffer,
  host: string,
  port: number,
  txid: Buffer,
  timeoutMs: number,
): Promise<StunMessage> {
  return new Promise<StunMessage>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`no answer within ${timeoutMs}ms`));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      socket.off('message', onMessage);
      socket.off('error', onError);
    }

    function onMessage(data: Buffer): void {
      const parsed = parseMessage(data);
      // Anything else on this socket belongs to a different exchange or is not
      // STUN at all; ignoring it rather than failing keeps a stray packet from
      // being reported as a broken relay.
      if (!parsed || !parsed.txid.equals(txid)) return;
      cleanup();
      resolve(parsed);
    }

    function onError(error: Error): void {
      cleanup();
      reject(error);
    }

    socket.on('message', onMessage);
    socket.on('error', onError);
    socket.send(message, port, host, (error) => {
      if (error) {
        cleanup();
        reject(error);
      }
    });
  });
}

/**
 * Allocates on the relay, reads the address back, and hands the allocation in.
 *
 * Never throws: every failure becomes a sentence on a card. An operator opening
 * a health page wants to know *which* thing is broken, and an exception here
 * would tell them only that something was.
 */
export async function probeRelay(
  url: string,
  username: string,
  credential: string,
  timeoutMs: number,
): Promise<RelayProbeResult> {
  const target = parseTurnUrl(url);
  if (!target) {
    return { url, state: 'invalid', latencyMs: null, relayedAddress: null, mappedAddress: null, error: 'Not a turn: or turns: URL this can read' };
  }

  if (target.transport !== 'udp' || target.scheme === 'turns') {
    return {
      url,
      state: 'unprobed',
      latencyMs: null,
      relayedAddress: null,
      mappedAddress: null,
      error: 'TLS and TCP listeners are not probed from here - verify with Trickle ICE',
    };
  }

  const socket = createSocket(target.host.includes(':') ? 'udp6' : 'udp4');
  const started = Date.now();

  try {
    // Round one: unauthenticated, purely to be refused and learn the realm.
    const firstId = randomBytes(12);
    const transport = Buffer.alloc(4);
    transport.writeUInt8(TRANSPORT_UDP, 0);
    const requestedTransport = encodeAttribute(ATTR_REQUESTED_TRANSPORT, transport);

    const challenge = await exchange(
      socket,
      encodeMessage(METHOD_ALLOCATE | CLASS_REQUEST, firstId, [requestedTransport]),
      target.host,
      target.port,
      firstId,
      timeoutMs,
    );

    const realm = challenge.attributes.get(ATTR_REALM);
    const nonce = challenge.attributes.get(ATTR_NONCE);
    if (!realm || !nonce) {
      const problem = challenge.attributes.get(ATTR_ERROR_CODE);
      const detail = problem ? decodeErrorCode(problem) : null;
      return {
        url,
        state: 'down',
        latencyMs: Date.now() - started,
        relayedAddress: null,
        mappedAddress: null,
        error: detail
          ? `Relay answered ${detail.code} ${detail.reason} instead of asking for credentials`
          : 'Relay did not ask for credentials, so it is not a TURN server or is misconfigured',
      };
    }

    // Round two: signed with the credential clients are actually given.
    const realmText = realm.toString('utf8');
    const key = longTermKey(username, realmText, credential);
    const secondId = randomBytes(12);
    const signed = encodeSigned(
      METHOD_ALLOCATE | CLASS_REQUEST,
      secondId,
      [
        requestedTransport,
        encodeAttribute(ATTR_USERNAME, Buffer.from(username, 'utf8')),
        encodeAttribute(ATTR_REALM, realm),
        encodeAttribute(ATTR_NONCE, nonce),
      ],
      key,
    );

    const answer = await exchange(socket, signed, target.host, target.port, secondId, timeoutMs);
    const latencyMs = Date.now() - started;

    if ((answer.type & CLASS_ERROR) === CLASS_ERROR) {
      const problem = answer.attributes.get(ATTR_ERROR_CODE);
      const detail = problem ? decodeErrorCode(problem) : { code: 0, reason: '' };
      return {
        url,
        state: 'down',
        latencyMs,
        relayedAddress: null,
        mappedAddress: null,
        error:
          detail.code === 401 || detail.code === 403
            ? `Relay refused the credential (${detail.code} ${detail.reason}). TURN_USERNAME or TURN_CREDENTIAL does not match the relay's own user= line`
            : `Relay refused the allocation: ${detail.code} ${detail.reason}`,
      };
    }

    const relayed = answer.attributes.get(ATTR_XOR_RELAYED_ADDRESS);
    const mapped = answer.attributes.get(ATTR_XOR_MAPPED_ADDRESS);
    const relayedAddress = relayed ? decodeXorAddress(relayed, secondId) : null;

    // Hand it straight back. See the note on quotas at the top of this file.
    await releaseAllocation(socket, target, username, realm, nonce, key, timeoutMs).catch(
      () => undefined,
    );

    if (!relayedAddress) {
      return {
        url,
        state: 'down',
        latencyMs,
        relayedAddress: null,
        mappedAddress: mapped ? decodeXorAddress(mapped, secondId) : null,
        error: 'Relay accepted the credential but returned no relayed address',
      };
    }

    return {
      url,
      state: 'up',
      latencyMs,
      relayedAddress,
      mappedAddress: mapped ? decodeXorAddress(mapped, secondId) : null,
      error: null,
    };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return {
      url,
      state: 'down',
      latencyMs: null,
      relayedAddress: null,
      mappedAddress: null,
      error:
        text.includes('no answer')
          ? `${text} - the relay is unreachable from this service: firewall, security list, or coturn not running`
          : text.slice(0, 200),
    };
  } finally {
    socket.close();
  }
}

/** `Refresh` with a zero lifetime, which is TURN for "I am done with this". */
async function releaseAllocation(
  socket: ReturnType<typeof createSocket>,
  target: { host: string; port: number },
  username: string,
  realm: Buffer,
  nonce: Buffer,
  key: Buffer,
  timeoutMs: number,
): Promise<void> {
  const txid = randomBytes(12);
  const lifetime = Buffer.alloc(4);
  lifetime.writeUInt32BE(0, 0);

  await exchange(
    socket,
    encodeSigned(
      METHOD_REFRESH | CLASS_REQUEST,
      txid,
      [
        encodeAttribute(ATTR_LIFETIME, lifetime),
        encodeAttribute(ATTR_USERNAME, Buffer.from(username, 'utf8')),
        encodeAttribute(ATTR_REALM, realm),
        encodeAttribute(ATTR_NONCE, nonce),
      ],
      key,
    ),
    target.host,
    target.port,
    txid,
    timeoutMs,
  );
}

export { encodeAttribute, encodeMessage, encodeSigned, longTermKey, CLASS_SUCCESS };
