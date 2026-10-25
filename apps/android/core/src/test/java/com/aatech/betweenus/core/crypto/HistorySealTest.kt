package com.aatech.betweenus.core.crypto

import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The sealed-body rules, against a plain AES key: the Keystore is not there on
 * a JVM, and what is worth pinning is the binding, not where the key lives.
 */
class HistorySealTest {

    private fun newKey(): SecretKey =
        KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    private val key = newKey()
    private val envelope = """{"v":1,"epoch":1,"iv":"abc","ct":"def"}"""

    @Test
    fun `a sealed body opens for the same message and envelope`() {
        val sealed = HistorySeal.seal(key, "m1", envelope, """{"text":"hello"}""")
        assertEquals("""{"text":"hello"}""", HistorySeal.open(key, "m1", envelope, sealed))
    }

    @Test
    fun `the words are not in the stored bytes`() {
        val sealed = HistorySeal.seal(key, "m1", envelope, "a very particular sentence")
        assertFalse(String(sealed.ciphertext, Charsets.ISO_8859_1).contains("particular"))
    }

    @Test
    fun `an edited message no longer opens its old body`() {
        val sealed = HistorySeal.seal(key, "m1", envelope, "before the edit")
        assertNull(HistorySeal.open(key, "m1", envelope.replace("def", "xyz"), sealed))
    }

    @Test
    fun `a body moved to another message does not open`() {
        val sealed = HistorySeal.seal(key, "m1", envelope, "mine")
        assertNull(HistorySeal.open(key, "m2", envelope, sealed))
    }

    @Test
    fun `another device key or a changed byte does not open`() {
        val sealed = HistorySeal.seal(key, "m1", envelope, "mine")
        assertNull(HistorySeal.open(newKey(), "m1", envelope, sealed))
        val flipped = sealed.ciphertext.copyOf().also { it[0] = (it[0].toInt() xor 1).toByte() }
        assertNull(HistorySeal.open(key, "m1", envelope, HistorySeal.Sealed(sealed.iv, flipped)))
    }

    @Test
    fun `two seals of the same body differ`() {
        val a = HistorySeal.seal(key, "m1", envelope, "same")
        val b = HistorySeal.seal(key, "m1", envelope, "same")
        assertNotNull(HistorySeal.open(key, "m1", envelope, b))
        assertFalse(a.iv.contentEquals(b.iv))
    }
}
