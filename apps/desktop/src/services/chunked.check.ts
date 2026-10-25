/** Self-check: `pnpm --filter @betweenus/desktop check`. The chunked file format. */
import assert from 'node:assert/strict';
import {
  chunkedCiphertextSize,
  createChunkOpener,
  createChunkSealer,
  fromBase64,
  generateChannelKey,
  openChunked,
  openChunkedStream,
  sealChunked,
} from './e2ee-crypto';
import { CHUNKED_VECTOR } from './chunked-vector';

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const fromHex = (value: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.from(value, 'hex')) as Uint8Array<ArrayBuffer>;

function bytesOf(length: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length }, (_, index) => (index * 7 + 3) & 0xff);
}

async function* piecesOf(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let at = 0; at < bytes.length; at += size) yield bytes.slice(at, at + size);
}

async function openAll(
  ciphertext: Uint8Array,
  iv: string,
  key: string,
  chunk: number,
  pieceSize: number,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  await openChunkedStream(
    piecesOf(ciphertext, pieceSize),
    await createChunkOpener(key, iv),
    (plain) => {
      parts.push(plain);
    },
    chunk,
  );
  return new Uint8Array(Buffer.concat(parts));
}

async function main(): Promise<void> {
  // The vector Android is checked against: same inputs, same bytes out.
  const plain = fromHex(CHUNKED_VECTOR.plainHex);
  const sealed = await sealChunked(plain, CHUNKED_VECTOR.key, CHUNKED_VECTOR.chunk, fromBase64(CHUNKED_VECTOR.iv));
  assert.equal(hex(sealed.ciphertext), CHUNKED_VECTOR.ciphertextHex);
  assert.equal(
    hex(await openChunked(fromHex(CHUNKED_VECTOR.ciphertextHex), CHUNKED_VECTOR.iv, CHUNKED_VECTOR.key, CHUNKED_VECTOR.chunk)),
    CHUNKED_VECTOR.plainHex,
  );

  const key = generateChannelKey();

  // Lengths either side of every boundary, including none and exactly full.
  for (const length of [0, 1, 15, 16, 17, 31, 32, 33, 48, 100]) {
    const input = bytesOf(length);
    const { iv, ciphertext } = await sealChunked(input, key, 16);
    assert.equal(ciphertext.length, chunkedCiphertextSize(length, 16), `size for ${length}`);
    // Delivered whole, in odd pieces, and a byte at a time: the split points
    // are the network's business, not the format's.
    for (const piece of [ciphertext.length || 1, 7, 1]) {
      assert.deepEqual(await openAll(ciphertext, iv, key, 16, piece), input, `${length} bytes in ${piece}s`);
    }
  }

  const input = bytesOf(100);
  const { iv, ciphertext } = await sealChunked(input, key, 16);
  const frame = 16 + 16;

  // Cut at a frame boundary: every tag is genuine, but the last frame is not
  // the one sealed as final.
  await assert.rejects(() => openChunked(ciphertext.slice(0, frame * 3), iv, key, 16));
  // Cut mid-frame.
  await assert.rejects(() => openChunked(ciphertext.slice(0, ciphertext.length - 1), iv, key, 16));
  await assert.rejects(() => openChunked(ciphertext.slice(0, 10), iv, key, 16));
  await assert.rejects(() => openChunked(new Uint8Array(0), iv, key, 16));

  // Extra frame after the end.
  const longer = new Uint8Array(ciphertext.length + frame);
  longer.set(ciphertext);
  longer.set(ciphertext.slice(0, frame), ciphertext.length);
  await assert.rejects(() => openChunked(longer, iv, key, 16));

  // Two frames swapped.
  const swapped = ciphertext.slice();
  swapped.set(ciphertext.slice(frame, frame * 2), 0);
  swapped.set(ciphertext.slice(0, frame), frame);
  await assert.rejects(() => openChunked(swapped, iv, key, 16));

  // A flipped bit anywhere, the wrong key, the wrong prefix.
  const flipped = ciphertext.slice();
  flipped[40] = flipped[40]! ^ 1;
  await assert.rejects(() => openChunked(flipped, iv, key, 16));
  await assert.rejects(() => openChunked(ciphertext, iv, generateChannelKey(), 16));
  const other = await sealChunked(input, key, 16);
  await assert.rejects(() => openChunked(ciphertext, other.iv, key, 16));

  // The sealer will not seal past the end, and two files never share a prefix.
  const sealer = await createChunkSealer(key);
  await sealer.seal(bytesOf(4), true);
  await assert.rejects(() => sealer.seal(bytesOf(4), false));
  assert.notEqual((await createChunkSealer(key)).iv, (await createChunkSealer(key)).iv);

  // A real-sized file in real-sized frames: 2.5 MiB is three frames.
  const big = bytesOf(2.5 * 1024 * 1024);
  const bigSealed = await sealChunked(big, key);
  assert.equal(bigSealed.ciphertext.length, big.length + 3 * 16);
  assert.deepEqual(await openAll(bigSealed.ciphertext, bigSealed.iv, key, 1024 * 1024, 64 * 1024), big);

  console.log('desktop chunked check ok');
}

void main();
