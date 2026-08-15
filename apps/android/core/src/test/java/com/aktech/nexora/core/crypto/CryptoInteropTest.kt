package com.aktech.nexora.core.crypto

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Interop with the other two clients.
 *
 * The constants below were produced by `apps/desktop/src/services/e2ee-crypto.ts`
 * running under Node, and are opened here by the Kotlin port. That is the only
 * check worth having: an implementation that is self-consistent but disagrees
 * with WebCrypto about the HKDF salt, the JWK coordinate padding or the GCM tag
 * length passes every round trip of its own and still cannot read a single
 * message anybody else sent.
 */
class CryptoInteropTest {

    private val alicePublic = """{"key_ops":[],"ext":true,"kty":"EC","x":"GhoGdz3ZlCS1kzWmWqChzPy5ZeUJFYP4v5hhNCHslq4","y":"cRuXtu41UymTZ8RJyp3SqiFJoKrK0Hk_-X-RZWOA1BM","crv":"P-256"}"""
    private val alicePrivate = """{"key_ops":["deriveBits"],"ext":true,"kty":"EC","x":"GhoGdz3ZlCS1kzWmWqChzPy5ZeUJFYP4v5hhNCHslq4","y":"cRuXtu41UymTZ8RJyp3SqiFJoKrK0Hk_-X-RZWOA1BM","crv":"P-256","d":"EL3svFYNqog8jWC3k7M_zPsmxhOWPufAu8YcucsJnqs"}"""
    private val bobPublic = """{"key_ops":[],"ext":true,"kty":"EC","x":"oR0iqVZXu7fnps6FvfKK2auXEX-LppwAiklWZizSqck","y":"f_m3aR0bCNk7W3F1OUwBE_LJ-faqSo_rHkZgUy8Pqdk","crv":"P-256"}"""
    private val bobPrivate = """{"key_ops":["deriveBits"],"ext":true,"kty":"EC","x":"oR0iqVZXu7fnps6FvfKK2auXEX-LppwAiklWZizSqck","y":"f_m3aR0bCNk7W3F1OUwBE_LJ-faqSo_rHkZgUy8Pqdk","crv":"P-256","d":"-6nNC4nY25ox_WjnQ9BE_8PTwkVqm6Bm6O-mrSJCSFM"}"""

    private val channelKey = "5s1CyOUmHg45joTlUG0O4oshw7YdMXUg5vaVxiX6HwE="

    @Test
    fun `unwraps a channel key the desktop sealed`() {
        val opened = Crypto.unwrapChannelKey(
            Crypto.Wrapped("avTyhCsUKhG45YSuwe2hHgM2EAeCcnEEzyGQa8tp1Cgd7IMd32p3R+fR65sAVoTO", "gWFBW6gs7AkFGp1m"),
            bobPrivate,
            alicePublic,
        )
        assertEquals(channelKey, opened)
    }

    @Test
    fun `decrypts a message the desktop encrypted`() {
        val text = Crypto.decrypt("QWYtiov88E51eiFj5uQlrj0gJ1qHC6TKOp17tREQnKPwjXbs194=", "FApZx/bMpvhoVSuf", channelKey)
        assertEquals("the desktop wrote this", text)
    }

    @Test
    fun `opens an identity backup the desktop sealed`() {
        val pair = Crypto.openIdentity(
            salt = "Nh3JF1S1JEZFKQ6JbgMtkg==",
            iv = "/MtrnCK3nyHrZ0aE",
            ciphertext = "Coctc6bZAIxCn7pBLb+5zV2ZBAqrNmy1CXv/82LZV+aZiQPkJrWFCacO3H/mkpRQfYn0lMZ1ts4hlFrqVYaPGT35ytNExJN0VhbC8cnlH63T9bYfVl5laUgLIPhiO81lZfOx5Rk85rQj2DIF86Ure+QEWxoyRl5aVkCIafH4L7xd2/xT9eiFkuUpwO3OOxkTA0D1C/pkqnMyMw584om0bihbjS/iIOWSmyleDOLh/Phov4feV9P+sG5nMdYTiORN2f7auYOUHMp9aTleAvHm1cyZiMFngcuAc2pZUgMxrRZy96wSTLNx1DmRj1Ql6lkA3dolm1SRFnnyl6Ch1TOId3vVRDRmq77W2IM205JHVCf2AE00cg5EFIJ64AY/tlHc5sMO4oY0VkT6WrzkS7f91B47R/tuquK7T9ed4Rvyiai/nyugwu/oxkQgxCpuNNTMt29Pv5sUOzbG/zh9UDBiv0SjoAvcmWV/wWE/t5E7KGXj7+9lUe70geW1ye+zMesmnOEcdBjpy7oDD0kISBu0FJumouIP+/WjkwaqyS6S1MCf2C+O7YukZ9Clvi953sM/D2nelDcQxUXJ6Tx9ZE2xT1P5OyPOapAR",
            secret = "correct horse battery staple",
            iterations = 600000,
        )
        assertEquals(alicePublic, pair.publicKey)
        assertEquals(alicePrivate, pair.privateKey)
    }

    /**
     * The other direction. ECDH is symmetric, so wrapping from Bob's side and
     * opening from Alice's proves the two derivations agreed rather than that
     * one implementation is consistent with itself.
     */
    @Test
    fun `seals a channel key the desktop keys can open`() {
        val wrapped = Crypto.wrapChannelKey(channelKey, bobPrivate, alicePublic)
        assertEquals(channelKey, Crypto.unwrapChannelKey(wrapped, alicePrivate, bobPublic))
    }

    @Test
    fun `a freshly generated identity round-trips through JWK`() {
        val pair = Crypto.generateIdentity()
        val key = Crypto.generateChannelKey()
        val wrapped = Crypto.wrapChannelKey(key, pair.privateKey, alicePublic)
        assertEquals(key, Crypto.unwrapChannelKey(wrapped, alicePrivate, pair.publicKey))
    }

    @Test
    fun `content sealed here opens here`() {
        val sealed = Crypto.encrypt("hello from the phone", channelKey)
        assertEquals(
            "hello from the phone",
            Crypto.decrypt(Crypto.base64(sealed.ciphertext), sealed.iv, channelKey),
        )
    }
}
