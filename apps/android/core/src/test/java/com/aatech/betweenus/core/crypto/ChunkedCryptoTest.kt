package com.aatech.betweenus.core.crypto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * The chunked file format, against the vector the desktop holds in
 * `apps/desktop/src/services/chunked-vector.ts`. The constants below were
 * produced there; if either side's format changes, one of the two tests fails.
 */
class ChunkedCryptoTest {

    private val key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
    private val iv = "oKGio6Slpqc="
    private val chunk = 16
    private val plainHex = "0104070a0d101316191c1f2225282b2e3134373a3d404346494c4f5255585b5e6164676a6d707376"
    private val ciphertextHex =
        "ff5de9a25c226133ce63c5bba95e1e8457a4d79aa58bba4010900d875d3fd9d602b7601e49102b978afcfe6b3fd555fc0d5946cd2372ed16cd4d36b6db477682b7f4c2ebcb1472f42001c9836a3d9849b7b894c8ee93213d"

    private fun hex(value: String) = ByteArray(value.length / 2) { value.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    @Test
    fun `opens the file the desktop sealed`() {
        assertEquals(plainHex, hex(Crypto.openChunked(hex(ciphertextHex), iv, key, chunk)))
    }

    @Test
    fun `seals the same bytes the desktop does`() {
        val (outIv, sealed) = Crypto.sealChunked(hex(plainHex), key, chunk, Crypto.unbase64(iv))
        assertEquals(iv, outIv)
        assertEquals(ciphertextHex, hex(sealed))
    }

    @Test
    fun `round trips lengths either side of every frame boundary`() {
        for (length in listOf(0, 1, 15, 16, 17, 31, 32, 33, 48, 100)) {
            val input = ByteArray(length) { (it * 7 + 3).toByte() }
            val (outIv, sealed) = Crypto.sealChunked(input, key, chunk)
            assertEquals(Crypto.chunkedCiphertextSize(length.toLong(), chunk), sealed.size.toLong())
            assertArrayEquals("$length bytes", input, Crypto.openChunked(sealed, outIv, key, chunk))
        }
    }

    @Test
    fun `refuses a stream cut at a frame boundary`() {
        val sealed = hex(ciphertextHex)
        // Two whole frames of three: every tag is genuine, but the second was not sealed as the last.
        assertThrows(Exception::class.java) { Crypto.openChunked(sealed.copyOf(64), iv, key, chunk) }
    }

    @Test
    fun `refuses a truncated, extended, swapped or altered stream`() {
        val sealed = hex(ciphertextHex)
        assertThrows(Exception::class.java) { Crypto.openChunked(sealed.copyOf(sealed.size - 1), iv, key, chunk) }
        assertThrows(Exception::class.java) { Crypto.openChunked(ByteArray(0), iv, key, chunk) }
        assertThrows(Exception::class.java) { Crypto.openChunked(sealed + sealed.copyOf(32), iv, key, chunk) }

        val swapped = sealed.copyOf()
        sealed.copyOfRange(32, 64).copyInto(swapped, 0)
        sealed.copyOfRange(0, 32).copyInto(swapped, 32)
        assertThrows(Exception::class.java) { Crypto.openChunked(swapped, iv, key, chunk) }

        val flipped = sealed.copyOf().also { it[40] = (it[40].toInt() xor 1).toByte() }
        assertThrows(Exception::class.java) { Crypto.openChunked(flipped, iv, key, chunk) }
    }
}
