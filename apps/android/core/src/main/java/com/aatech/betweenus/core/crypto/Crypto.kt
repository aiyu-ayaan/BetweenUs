package com.aatech.betweenus.core.crypto

import org.json.JSONObject
import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import okio.ByteString.Companion.decodeBase64
import okio.ByteString.Companion.toByteString

/**
 * End-to-end encryption primitives, matching
 * `apps/desktop/src/services/e2ee-crypto.ts` byte for byte. Anything that
 * disagrees here produces ciphertext the other two clients cannot open, which
 * is a failure that looks exactly like a bug in the message list.
 *
 * The scheme, from development/E2EE.md:
 *   - identity: ECDH P-256 key pair per device, private half never leaves it
 *   - channel key: random AES-256-GCM key per channel, per epoch
 *   - distribution: ECDH(sender, recipient) -> HKDF-SHA256 -> AES-GCM wrap
 *   - messages and attachments: AES-256-GCM under the channel key
 *
 * Keys cross the wire as JWK, because that is what WebCrypto exports and the
 * directory stores. Java speaks X.509/PKCS#8 instead, so the conversion is done
 * by hand below - a P-256 JWK is just the curve point's two coordinates, and
 * the private one adds the scalar.
 */
object Crypto {
    private const val CURVE = "secp256r1"
    private const val WRAP_INFO = "betweenus/e2ee/v1/channel-key-wrap"
    private const val IV_BYTES = 12
    private const val GCM_TAG_BITS = 128
    private const val CHANNEL_KEY_BYTES = 32
    private const val BACKUP_SALT_BYTES = 16

    /**
     * PBKDF2 rounds for the identity backup, and it has to be the number the
     * other clients use: the blob says which count sealed it, but a *new* blob
     * sealed here with fewer rounds would quietly weaken an account's backup.
     */
    const val BACKUP_ITERATIONS = 600_000

    private val random = SecureRandom()

    data class KeyPairJwk(val publicKey: String, val privateKey: String)

    data class Wrapped(val wrappedKey: String, val iv: String)

    data class Sealed(val iv: String, val ciphertext: ByteArray) {
        override fun equals(other: Any?): Boolean =
            other is Sealed && iv == other.iv && ciphertext.contentEquals(other.ciphertext)

        override fun hashCode(): Int = 31 * iv.hashCode() + ciphertext.contentHashCode()
    }

    // --- identity ---

    fun generateIdentity(): KeyPairJwk {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec(CURVE), random)
        val pair = generator.generateKeyPair()
        return KeyPairJwk(
            publicKey = publicToJwk(pair.public as ECPublicKey),
            privateKey = privateToJwk(pair.private as ECPrivateKey, pair.public as ECPublicKey),
        )
    }

    /**
     * Seals the identity key pair so the server can hold it without being able
     * to open it. This is what makes an account portable: the same identity
     * comes back on any device that can supply the secret, so channel keys
     * already sealed for it keep opening.
     */
    fun sealIdentity(pair: KeyPairJwk, secret: String, iterations: Int = BACKUP_ITERATIONS): Triple<String, String, String> {
        val salt = randomBytes(BACKUP_SALT_BYTES)
        val key = deriveBackupKey(secret, salt, iterations)
        val iv = randomBytes(IV_BYTES)
        val plaintext = JSONObject()
            .put("publicKey", pair.publicKey)
            .put("privateKey", pair.privateKey)
            .toString()
        val sealed = aes(Cipher.ENCRYPT_MODE, key, iv, plaintext.toByteArray())
        return Triple(base64(salt), base64(iv), base64(sealed))
    }

    /** Throws if the secret is wrong - AES-GCM's tag is the only check needed. */
    fun openIdentity(
        salt: String,
        iv: String,
        ciphertext: String,
        secret: String,
        iterations: Int,
    ): KeyPairJwk {
        val key = deriveBackupKey(secret, unbase64(salt), iterations)
        val opened = aes(Cipher.DECRYPT_MODE, key, unbase64(iv), unbase64(ciphertext))
        val json = JSONObject(String(opened))
        val public = json.optString("publicKey")
        val private = json.optString("privateKey")
        require(public.isNotEmpty() && private.isNotEmpty()) {
            "Backup did not contain an identity key pair"
        }
        return KeyPairJwk(public, private)
    }

    private fun deriveBackupKey(secret: String, salt: ByteArray, iterations: Int): ByteArray {
        val spec = PBEKeySpec(secret.toCharArray(), salt, iterations, 256)
        return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
    }

    // --- channel keys ---

    fun generateChannelKey(): String = base64(randomBytes(CHANNEL_KEY_BYTES))

    fun wrapChannelKey(channelKey: String, privateJwk: String, peerPublicJwk: String): Wrapped {
        val key = deriveWrappingKey(privateJwk, peerPublicJwk)
        val iv = randomBytes(IV_BYTES)
        val sealed = aes(Cipher.ENCRYPT_MODE, key, iv, unbase64(channelKey))
        return Wrapped(base64(sealed), base64(iv))
    }

    fun unwrapChannelKey(wrapped: Wrapped, privateJwk: String, peerPublicJwk: String): String {
        val key = deriveWrappingKey(privateJwk, peerPublicJwk)
        return base64(aes(Cipher.DECRYPT_MODE, key, unbase64(wrapped.iv), unbase64(wrapped.wrappedKey)))
    }

    /**
     * The raw ECDH output is a curve point, not a uniform key, so it goes
     * through HKDF before it is used as an AES key. The salt is 32 zero bytes
     * and the info string domain-separates this use of the secret - both have
     * to match the other clients exactly.
     */
    private fun deriveWrappingKey(privateJwk: String, peerPublicJwk: String): ByteArray {
        val agreement = KeyAgreement.getInstance("ECDH")
        agreement.init(privateFromJwk(privateJwk))
        agreement.doPhase(publicFromJwk(peerPublicJwk), true)
        val shared = agreement.generateSecret()
        return hkdfSha256(shared, ByteArray(32), WRAP_INFO.toByteArray(), 32)
    }

    /** RFC 5869, extract then expand. One block is enough for a 256-bit key. */
    fun hkdfSha256(input: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        val extract = Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(salt, "HmacSHA256"))
            doFinal(input)
        }
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(extract, "HmacSHA256"))

        val output = ByteArray(length)
        var block = ByteArray(0)
        var written = 0
        var counter = 1
        while (written < length) {
            mac.reset()
            mac.update(block)
            mac.update(info)
            mac.update(counter.toByte())
            block = mac.doFinal()
            val take = minOf(block.size, length - written)
            System.arraycopy(block, 0, output, written, take)
            written += take
            counter += 1
        }
        return output
    }

    /**
     * `HMAC-SHA256(channel key, fingerprint)`, base64 - what signs a DTLS
     * fingerprint so the signalling relay cannot substitute one of its own.
     *
     * The key is the UTF-8 bytes of the base64 *string*, not the 32 bytes it
     * decodes to. That is what `signFingerprint` in the desktop's mesh.ts does,
     * and matching it is the whole requirement: a signature computed over
     * different key bytes verifies nowhere and every call fails to connect.
     */
    fun signFingerprint(channelKey: String, fingerprint: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(channelKey.toByteArray(), "HmacSHA256"))
        return base64(mac.doFinal(fingerprint.toByteArray()))
    }

    // --- content ---

    fun encrypt(plaintext: String, channelKey: String): Sealed {
        val iv = randomBytes(IV_BYTES)
        return Sealed(base64(iv), aes(Cipher.ENCRYPT_MODE, unbase64(channelKey), iv, plaintext.toByteArray()))
    }

    fun decrypt(ciphertext: String, iv: String, channelKey: String): String =
        String(aes(Cipher.DECRYPT_MODE, unbase64(channelKey), unbase64(iv), unbase64(ciphertext)))

    fun encryptBytes(plaintext: ByteArray, channelKey: String): Sealed {
        val iv = randomBytes(IV_BYTES)
        return Sealed(base64(iv), aes(Cipher.ENCRYPT_MODE, unbase64(channelKey), iv, plaintext))
    }

    fun decryptBytes(ciphertext: ByteArray, iv: String, channelKey: String): ByteArray =
        aes(Cipher.DECRYPT_MODE, unbase64(channelKey), unbase64(iv), ciphertext)

    private fun aes(mode: Int, key: ByteArray, iv: ByteArray, input: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(GCM_TAG_BITS, iv))
        return cipher.doFinal(input)
    }

    private fun randomBytes(length: Int) = ByteArray(length).also { random.nextBytes(it) }

    // --- JWK <-> Java keys ---
    //
    // WebCrypto exports P-256 keys as JWK: `x` and `y` are the public point's
    // coordinates and `d` is the private scalar, each 32 big-endian bytes in
    // base64url. Java wants ECPublicKeySpec/ECPrivateKeySpec, so the conversion
    // is arithmetic rather than parsing.

    private fun curveSpec(): ECParameterSpec {
        val parameters = AlgorithmParameters.getInstance("EC")
        parameters.init(ECGenParameterSpec(CURVE))
        return parameters.getParameterSpec(ECParameterSpec::class.java)
    }

    fun publicFromJwk(jwk: String): PublicKey {
        val json = JSONObject(jwk)
        val point = ECPoint(coordinate(json.getString("x")), coordinate(json.getString("y")))
        return KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(point, curveSpec()))
    }

    fun privateFromJwk(jwk: String): PrivateKey {
        val json = JSONObject(jwk)
        val scalar = coordinate(json.getString("d"))
        return KeyFactory.getInstance("EC").generatePrivate(ECPrivateKeySpec(scalar, curveSpec()))
    }

    private fun publicToJwk(key: ECPublicKey): String = JSONObject()
        .put("kty", "EC")
        .put("crv", "P-256")
        .put("x", coordinateBase64Url(key.w.affineX))
        .put("y", coordinateBase64Url(key.w.affineY))
        .put("ext", true)
        .toString()

    private fun privateToJwk(key: ECPrivateKey, public: ECPublicKey): String = JSONObject()
        .put("kty", "EC")
        .put("crv", "P-256")
        .put("x", coordinateBase64Url(public.w.affineX))
        .put("y", coordinateBase64Url(public.w.affineY))
        .put("d", coordinateBase64Url(key.s))
        .put("ext", true)
        .put("key_ops", org.json.JSONArray().put("deriveBits"))
        .toString()

    /** Always 32 bytes, left-padded: a short coordinate is still a coordinate. */
    private fun coordinateBase64Url(value: BigInteger): String {
        val raw = value.toByteArray()
        val fixed = ByteArray(32)
        when {
            raw.size == 32 -> System.arraycopy(raw, 0, fixed, 0, 32)
            // BigInteger prepends a sign byte when the top bit is set.
            raw.size > 32 -> System.arraycopy(raw, raw.size - 32, fixed, 0, 32)
            else -> System.arraycopy(raw, 0, fixed, 32 - raw.size, raw.size)
        }
        return base64Url(fixed)
    }

    private fun coordinate(base64Url: String) = BigInteger(1, unbase64Url(base64Url))

    // --- base64 ---
    //
    // Standard alphabet for everything the wire calls base64 (btoa on the other
    // clients), URL-safe and unpadded inside a JWK, which is what RFC 7515 says.

    fun base64(bytes: ByteArray): String = bytes.toByteString().base64()

    fun unbase64(value: String): ByteArray =
        (value.decodeBase64() ?: throw IllegalArgumentException("Not base64")).toByteArray()

    /** JWK members are base64url and unpadded, which is what RFC 7515 says. */
    private fun base64Url(bytes: ByteArray): String = bytes.toByteString().base64Url().trimEnd('=')

    private fun unbase64Url(value: String): ByteArray =
        (value.decodeBase64() ?: throw IllegalArgumentException("Not base64")).toByteArray()
}
