package com.aatech.betweenus.core.crypto

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * A decrypted message body sealed for the disk, under a key only this device
 * can use.
 *
 * `Cache` keeps messages as the server sent them, still sealed to the channel
 * key, so a cold start has to open each one again - and opening needs the
 * channel key, which needs the vault, which needs the network. A body sealed
 * here is what lets a conversation read yesterday open with no signal at all.
 * The desktop's `history-at-rest.ts` is the same idea.
 *
 * The additional data is the message id and a hash of the stored envelope. That
 * is the whole of the invalidation rule: edit a message and its envelope
 * changes, so the old sealed body no longer opens and the new one is sealed
 * from scratch; move a row to another message id and it does not open either.
 *
 * No user authentication on the key and no prompt of any kind - a message list
 * cannot ask for a fingerprint per bubble, and the vault key is already held
 * for the person. See [SecureStore], which makes the same trade.
 */
object HistorySeal {
    private const val GCM_TAG_BITS = 128
    private const val IV_BYTES = 12
    private const val FORMAT = 1
    private val random = SecureRandom()

    class Sealed(val iv: ByteArray, val ciphertext: ByteArray)

    /** What binds a sealed body to the one message and the one envelope it came from. */
    fun aad(messageId: String, envelope: String): ByteArray {
        val digest = MessageDigest.getInstance("SHA-256").digest(envelope.toByteArray())
        val hex = digest.joinToString("") { "%02x".format(it) }
        return "betweenus/history/v$FORMAT/$messageId/$hex".toByteArray()
    }

    fun seal(key: SecretKey, messageId: String, envelope: String, plaintext: String): Sealed {
        val iv = ByteArray(IV_BYTES).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        cipher.updateAAD(aad(messageId, envelope))
        return Sealed(iv, cipher.doFinal(plaintext.toByteArray()))
    }

    /** Null for anything that does not open: another envelope, another id, another key, a changed byte. */
    fun open(key: SecretKey, messageId: String, envelope: String, sealed: Sealed): String? =
        runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, sealed.iv))
            cipher.updateAAD(aad(messageId, envelope))
            String(cipher.doFinal(sealed.ciphertext))
        }.getOrNull()
}

/**
 * The device key for [HistorySeal], generated inside the Android Keystore: it
 * can be used by this app on this device and cannot be read out.
 *
 * [get] is null where there is no Keystore to ask - a JVM unit test, a device
 * whose keystore is broken - and every caller treats that as "keep nothing
 * sealed", which is how the history stays memory-only there.
 *
 * [forget] is half of signing out: with the key gone, any sealed body that
 * survived is noise.
 */
object HistoryKey {
    private const val KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "betweenus.history.seal"

    fun get(): SecretKey? = runCatching {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey
            ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).apply {
                init(
                    KeyGenParameterSpec.Builder(
                        ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                    )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .build(),
                )
            }.generateKey()
    }.getOrNull()

    fun forget() {
        runCatching {
            KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(ALIAS)
        }
    }
}
