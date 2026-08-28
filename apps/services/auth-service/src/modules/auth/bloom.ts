/**
 * A Bloom filter, and nothing more than one.
 *
 * It answers one question - "have I definitely never seen this?" - and it
 * answers it without touching the database. A `false` from `mightHave` is
 * final: the filter has no false negatives, so a username it has never been
 * given is a username nobody has registered. A `true` is a maybe, and the
 * caller settles it with the query it was trying to avoid.
 *
 * That asymmetry is the whole point of using one here. Somebody typing a name
 * into the registration form generates a lookup per keystroke, and almost every
 * one of those is for a name nobody has - so almost every one is answered from
 * a bit array in memory, and the database only sees the handful of near-misses.
 *
 * Written out rather than taken from a package: it is two hash functions and a
 * `Uint8Array`, and a dependency in the sign-up path is a bigger thing to own
 * than thirty lines.
 */

/** Bits per entry and hash count for a target false-positive rate. */
export function sizing(expectedItems: number, falsePositiveRate: number): {
  bits: number;
  hashes: number;
} {
  const items = Math.max(1, Math.trunc(expectedItems));
  const rate = Math.min(Math.max(falsePositiveRate, 1e-6), 0.5);
  // The standard optimum: m = -n ln p / (ln 2)^2, k = (m/n) ln 2. Rounded up,
  // so the real rate is at or under the one asked for rather than near it.
  const bits = Math.ceil((-items * Math.log(rate)) / (Math.LN2 * Math.LN2));
  const hashes = Math.max(1, Math.round((bits / items) * Math.LN2));
  return { bits, hashes };
}

/** FNV-1a, 32-bit, seeded. Not a cryptographic hash and does not need to be. */
function fnv1a(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    // The FNV prime, 16777619, by shifts - `Math.imul` keeps it 32-bit.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export class BloomFilter {
  private readonly bits: Uint8Array;
  private readonly bitCount: number;
  private readonly hashes: number;
  /** How many values have been added; only ever read for diagnostics. */
  private items = 0;

  constructor(expectedItems: number, falsePositiveRate = 0.001) {
    const { bits, hashes } = sizing(expectedItems, falsePositiveRate);
    this.bitCount = bits;
    this.hashes = hashes;
    this.bits = new Uint8Array(Math.ceil(bits / 8));
  }

  get size(): number {
    return this.items;
  }

  add(value: string): void {
    for (const bit of this.positions(value)) {
      this.bits[bit >>> 3]! |= 1 << (bit & 7);
    }
    this.items += 1;
  }

  /** False is certain; true means "ask the database". */
  mightHave(value: string): boolean {
    for (const bit of this.positions(value)) {
      if ((this.bits[bit >>> 3]! & (1 << (bit & 7))) === 0) return false;
    }
    return true;
  }

  /**
   * Kirsch-Mitzenmacher double hashing: k indices from two hashes rather than
   * k independent ones, which costs two passes over the string instead of k
   * and is indistinguishable in false-positive rate.
   *
   * `h2` is forced odd so it is coprime with nothing in particular but never
   * zero - a zero step would put every index on the same bit.
   */
  private *positions(value: string): Generator<number> {
    const h1 = fnv1a(value, 0x811c9dc5);
    const h2 = fnv1a(value, 0x9e3779b9) | 1;
    for (let index = 0; index < this.hashes; index += 1) {
      // >>> 0 after the multiply-add, so the sum stays a 32-bit unsigned value
      // rather than drifting into the float range and losing its low bits.
      yield ((h1 + Math.imul(index, h2)) >>> 0) % this.bitCount;
    }
  }
}
