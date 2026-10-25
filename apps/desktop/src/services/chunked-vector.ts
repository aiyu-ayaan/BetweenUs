/**
 * The chunked-attachment vector. Desktop checks it in `chunked.check.ts`;
 * Android checks the same bytes in `ChunkedCryptoTest`. If either side's
 * format drifts, one of the two fails - which is the only way a phone and a
 * desktop stay able to open each other's large files.
 *
 * 40 plaintext bytes, 16-byte frames: two full frames and a final one of 8.
 */
export const CHUNKED_VECTOR = {
  /** Base64 channel key: bytes 0x00..0x1f. */
  key: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
  /** Base64 of the 8-byte nonce prefix 0xa0..0xa7. */
  iv: 'oKGio6Slpqc=',
  chunk: 16,
  /** Plaintext byte i is (3 * i + 1). */
  plainHex:
    '0104070a0d101316191c1f2225282b2e3134373a3d404346494c4f5255585b5e6164676a6d707376',
  ciphertextHex:
    'ff5de9a25c226133ce63c5bba95e1e8457a4d79aa58bba4010900d875d3fd9d602b7601e49102b978afcfe6b3fd555fc0d5946cd2372ed16cd4d36b6db477682b7f4c2ebcb1472f42001c9836a3d9849b7b894c8ee93213d',
} as const;
