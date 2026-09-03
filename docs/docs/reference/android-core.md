---
sidebar_position: 6
title: Android Core Architecture & Crypto
description: Android native Kotlin core reference — E2EE cryptographic engine, Android KeyStore, Room persistence, and WebRTC audio pipeline.
---

# Android Core Architecture & Crypto

Source directory: [`apps/android/core/`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/apps/android/core).

The BetweenUs Android client is a native Kotlin multi-module architecture (`:app`, `:core`, `:ui-common`) targeting Android 15 (API 35) with minSdk 26.

---

## 1. Cryptographic Engine & Key Management (`com.aatech.betweenus.core.crypto.E2ee`)

```kotlin
package com.aatech.betweenus.core.crypto

/** What opens an identity backup. Held only for the moment a sign-in needs it. */
data class BackupSecret(val value: String, val kind: String) {
    companion object {
        fun password(value: String) = BackupSecret(value, "password")
        fun passphrase(value: String) = BackupSecret(value, "passphrase")
    }
}

class MissingChannelKeyError : Exception("No channel key on this device yet")

/**
 * There is no `Locked`. A device that cannot open the account backup mints a
 * key of its own and signs in anyway - see [E2ee.initIdentity] - so there is no
 * state in which the app is signed in and waiting to be told a secret. That
 * fork used to be permanent; it is provisional now, and every later sign-in
 * with a secret that opens the backup undoes it.
 */
sealed interface IdentityStatus {
    data object Absent : IdentityStatus

    /**
     * `backedUp` is whether *this device's* key is the one in the backup.
     *
     * `provisional` is this device having minted its own because it could not
     * open the account's - so it reads what arrives from now on, and history is
     * still sealed to an identity it does not hold.
     */
    data class Ready(val backedUp: Boolean, val provisional: Boolean = false) : IdentityStatus

    /**
     * The owner revoked this machine from another one. Nothing new is wrapped
     * for it, so it reads what it already had and nothing since - saying so
     * beats a screen full of "no key on this device yet".
     */
    data object Revoked : IdentityStatus
}
```

---

## 2. Hardware Security: Android KeyStore (`SecureStore.kt`)

Device session tokens and private ECDH identity keys are generated and stored directly inside the hardware-backed **Android KeyStore** (StrongBox / TEE):

```kotlin
package com.aatech.betweenus.core.crypto

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * Android KeyStore wrapper providing hardware-backed AES-256-GCM encryption.
 * Keys never leave the secure hardware boundary.
 */
class SecureStore(private val context: Context) {
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    /**
     * Encrypts plaintext bytes using hardware-isolated Master Key.
     */
    fun encrypt(alias: String, plaintext: ByteArray): EncryptedData {
        val secretKey = getOrCreateKey(alias)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext)
        return EncryptedData(iv, ciphertext)
    }

    /**
     * Decrypts ciphertext bytes inside the secure hardware environment.
     */
    fun decrypt(alias: String, encryptedData: EncryptedData): ByteArray {
        val secretKey = keyStore.getKey(alias, null) as SecretKey
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val spec = GCMParameterSpec(128, encryptedData.iv)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)
        return cipher.doFinal(encryptedData.ciphertext)
    }
}
```

---

## 3. Local Offline Cache & Room Database (`BetweenUsDatabase.kt`)

Room entities preserve decrypted channels, message snippets, and member directories so the mobile client opens instantly without network spinners:

```kotlin
package com.aatech.betweenus.core.store

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase

@Entity(tableName = "cached_messages")
data class CachedMessage(
    @PrimaryKey val id: String,
    val channelId: String,
    val authorId: String,
    val authorName: String,
    val authorAvatar: String?,
    val plaintext: String?,
    val timestamp: Long,
    val isEncrypted: Boolean
)

@Dao
interface CacheDao {
    @Query("SELECT * FROM cached_messages WHERE channelId = :channelId ORDER BY timestamp DESC LIMIT :limit")
    suspend fun getMessages(channelId: String, limit: Int): List<CachedMessage>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessages(messages: List<CachedMessage>)

    @Query("DELETE FROM cached_messages WHERE channelId = :channelId")
    suspend fun clearChannel(channelId: String)
}

@Database(entities = [CachedMessage::class], version = 1, exportSchema = false)
abstract class BetweenUsDatabase : RoomDatabase() {
    abstract fun cacheDao(): CacheDao
}
```

---

## 4. WebRTC Audio & Media Pipeline (`WebRtcSession.kt`)

Manages Google WebRTC `PeerConnectionFactory`, audio track hardware routing, acoustic echo cancellation (AEC), noise suppression (NS), and foreground call continuity:

```kotlin
package com.aatech.betweenus.core.webrtc

import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory

/**
 * Native Android WebRTC Session controller.
 * Configures hardware audio effects and manages peer connection lifecycles.
 */
class WebRtcSession(private val context: Context) {
    private val factory: PeerConnectionFactory

    init {
        val options = PeerConnectionFactory.InitializationOptions.builder(context)
            .setEnableInternalTracer(false)
            .createInitializationOptions()
        PeerConnectionFactory.initialize(options)

        factory = PeerConnectionFactory.builder()
            .setOptions(PeerConnectionFactory.Options())
            .createPeerConnectionFactory()
    }

    /**
     * Initializes audio source with hardware echo cancellation and noise gate.
     */
    fun createAudioTrack(audioConstraints: MediaConstraints): AudioTrack {
        val audioSource: AudioSource = factory.createAudioSource(audioConstraints)
        return factory.createAudioTrack("ARDAMSa0", audioSource)
    }
}
```
