package com.aktech.nexora.core.crypto

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import android.util.Base64

/**
 * Where private key material is kept at rest.
 *
 * The desktop client hands identity keys to its main process, which seals them
 * with the OS keychain. This is the same idea with the parts Android has: an
 * AES key generated *inside* the hardware-backed keystore - it cannot be
 * exported, only used - wrapping the value that then sits in ordinary
 * preferences. A rooted device can read the preferences file and get
 * ciphertext; opening it means asking the keystore, which means being this app
 * on this device.
 *
 * Deliberately no user authentication requirement on the key: a channel key has
 * to be openable to render a message list, and prompting for a fingerprint per
 * message is not a product. Locking the identity behind biometrics is a setting
 * worth having later, not a default that would make the app unusable.
 */
class SecureStore(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("nexora.secure", Context.MODE_PRIVATE)

    private val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    fun get(name: String): String? {
        val stored = prefs.getString(name, null) ?: return null
        val separator = stored.indexOf(':')
        if (separator <= 0) return null
        return runCatching {
            val iv = Base64.decode(stored.substring(0, separator), Base64.NO_WRAP)
            val ciphertext = Base64.decode(stored.substring(separator + 1), Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(ciphertext))
        }.getOrNull()
        // A null here means the wrapping key is gone - the app was reinstalled,
        // or the user reset their screen lock on an older device. The identity
        // is then recovered from the account backup, which is what it is for.
    }

    fun put(name: String, value: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val ciphertext = cipher.doFinal(value.toByteArray())
        val encoded = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(ciphertext, Base64.NO_WRAP)
        prefs.edit().putString(name, encoded).apply()
    }

    fun remove(name: String) {
        prefs.edit().remove(name).apply()
    }

    private fun secretKey(): SecretKey {
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "nexora.identity.wrap"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
