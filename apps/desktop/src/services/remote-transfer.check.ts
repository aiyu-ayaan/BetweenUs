/**
 * Run with `tsx src/services/remote-transfer.check.ts`.
 *
 * Two things here have a bug in them and the rest is a loop: the byte counting,
 * where a file one byte short must never report itself whole, and the name
 * cleaning, which is the only part of a transfer that arrives as an instruction
 * rather than as data.
 */
import assert from 'node:assert/strict';
import { TransferSink, chunksOf, formatBytes, safeFileName } from './remote-transfer';

// --- Counting ---------------------------------------------------------------

// Exactly the right number of bytes, arriving in uneven chunks.
const exact = new TransferSink(100);
assert.equal(exact.accept(60), 'write');
assert.equal(exact.accept(40), 'done');
assert.equal(exact.complete, true);
assert.equal(exact.moved, 100);

// One byte short. This must never report done: a truncated file that claims to
// be whole is the failure nobody notices until they open it.
const short = new TransferSink(100);
assert.equal(short.accept(99), 'write');
assert.equal(short.complete, false);

// One byte too many, in one chunk and across two.
const over = new TransferSink(100);
assert.equal(over.accept(101), 'overflow');
assert.equal(over.moved, 0, 'a refused chunk is not counted');

const creeping = new TransferSink(100);
assert.equal(creeping.accept(100), 'done');
assert.equal(creeping.accept(1), 'overflow', 'nothing arrives after the last byte');

// A file of nothing is complete before a byte arrives, and must not sit waiting
// for one that is never sent.
assert.equal(new TransferSink(0).complete, true);

// --- Names ------------------------------------------------------------------

// Every one of these is a way of writing outside the folder that was chosen.
assert.equal(safeFileName('../../etc/passwd'), 'passwd');
assert.equal(safeFileName('C:\\Windows\\System32\\evil.dll'), 'evil.dll');
assert.equal(safeFileName('..'), 'file');
assert.equal(safeFileName(''), 'file');
assert.equal(safeFileName('   '), 'file');
assert.equal(safeFileName('  holiday.png  '), 'holiday.png');
assert.equal(safeFileName('re:port|1.txt'), 'report1.txt');
// Reserved on Windows with or without an extension; opening one writes to a
// device rather than to a disk.
assert.equal(safeFileName('CON.txt'), '_CON.txt');
assert.equal(safeFileName('nul'), '_nul');
// `console.log` is not a device name, and must survive untouched.
assert.equal(safeFileName('console.log'), 'console.log');
assert.equal(safeFileName('.bashrc'), 'bashrc');
assert.equal(safeFileName('a'.repeat(400)).length, 180);

// --- Chunking ---------------------------------------------------------------

const collect = async (blob: Blob, chunkBytes: number): Promise<number[]> => {
  const sizes: number[] = [];
  for await (const chunk of chunksOf(blob, chunkBytes)) sizes.push(chunk.byteLength);
  return sizes;
};

const body = new Blob([new Uint8Array(250)]);
// The last chunk is the remainder, not a padded one - a file is not a multiple
// of the chunk size and the far end counts every byte.
assert.deepEqual(await collect(body, 100), [100, 100, 50]);
// An exact multiple stops rather than yielding an empty chunk at the end.
assert.deepEqual(await collect(new Blob([new Uint8Array(200)]), 100), [100, 100]);
// An empty file yields nothing at all, which is what pairs with a sink that is
// already complete.
assert.deepEqual(await collect(new Blob([]), 100), []);

// --- Reading ----------------------------------------------------------------

assert.equal(formatBytes(512), '512 B');
assert.equal(formatBytes(1024), '1.0 KB');
assert.equal(formatBytes(1536 * 1024), '1.5 MB');
assert.equal(formatBytes(20 * 1024 * 1024), '20 MB');

console.log('remote-transfer: ok');
