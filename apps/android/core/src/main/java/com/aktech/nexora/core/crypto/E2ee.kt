package com.aktech.nexora.core.crypto

import android.content.Context
import com.aktech.nexora.core.data.ApiError
import com.aktech.nexora.core.data.ChannelKeyEntry
import com.aktech.nexora.core.data.DeviceKey
import com.aktech.nexora.core.data.IdentityBackup
import com.aktech.nexora.core.data.NexoraApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/** What opens an identity backup. Held only for the moment a sign-in needs it. */
data class BackupSecret(val value: String, val kind: String) {
    companion object {
        fun password(value: String) = BackupSecret(value, "password")
        fun passphrase(value: String) = BackupSecret(value, "passphrase")
    }
}

/** The account has a backup and nothing here can open it without being asked. */
class IdentityLockedError(val kind: String) :
    Exception("This device needs your ${if (kind == "password") "password" else "recovery passphrase"} to unlock your messages")

class MissingChannelKeyError : Exception("No channel key on this device yet")

sealed interface IdentityStatus {
    data object Absent : IdentityStatus
    data class Locked(val kind: String) : IdentityStatus
    data class Ready(val backedUp: Boolean) : IdentityStatus

    /**
     * The owner revoked this machine from another one. Nothing new is wrapped
     * for it, so it reads what it already had and nothing since - saying so
     * beats a screen full of "no key on this device yet".
     */
    data object Revoked : IdentityStatus
}

/**
 * The end-to-end encryption service: this device's identity, the channel keys
 * it can open, and sealing and opening content with them.
 *
 * The port of `apps/desktop/src/services/e2ee.ts`. Every decision here about
 * *when* to mint an epoch, when to re-wrap for a member, and what to do when a
 * key cannot be opened is that file's, because the three clients share one
 * channel and disagreeing about any of it locks somebody out of their history.
 */
object E2ee {
    const val UNDECRYPTABLE = "🔒 Encrypted - no key on this device yet"

    private lateinit var store: SecureStore

    private var identity: Crypto.KeyPairJwk? = null
    private var userId: String? = null

    private val identityLock = Mutex()
    private val channelLocks = ConcurrentHashMap<String, Mutex>()

    /** Every epoch this device can open, per channel, so old history stays readable. */
    private class ChannelKeyState(val epoch: Int, val keys: Map<Int, String>)

    private val channels = ConcurrentHashMap<String, ChannelKeyState>()

    /**
     * Channels this session has already tried to re-key for itself. Without it,
     * a device that cannot open its own wrapped keys would mint a fresh epoch
     * every time the channel is opened and drag the whole channel along with it.
     */
    private val rekeyed = ConcurrentHashMap.newKeySet<String>()

    /**
     * Epochs this client has already gone back to the directory for and still
     * not found. Without it, a channel holding one genuinely unreadable message
     * would re-read the key directory every time that message is drawn.
     */
    private val missedEpochs = ConcurrentHashMap.newKeySet<String>()

    private val _status = MutableStateFlow<IdentityStatus>(IdentityStatus.Absent)
    val status: StateFlow<IdentityStatus> = _status.asStateFlow()

    fun init(context: Context) {
        store = SecureStore(context)
    }

    // --- identity ---

    /**
     * Loads this device's identity key and publishes the public half. Called
     * once per sign-in, with the password when there is one to hand.
     *
     * Three ways it can go: the key is already on this device; it is not, but
     * the account has a backup and [secret] opens it; or the account has no
     * backup yet and one is minted. The fourth case - backup present, no secret
     * - is a question for the user, and comes back as [IdentityLockedError].
     */
    suspend fun initIdentity(userId: String, secret: BackupSecret? = null): Crypto.KeyPairJwk =
        identityLock.withLock {
            identity?.let { if (this.userId == userId) return@withLock it }
            this.userId = userId

            val storageKey = "identity:$userId"
            store.get(storageKey)?.let { stored ->
                val pair = runCatching { readPair(stored) }.getOrNull()
                if (pair != null) {
                    adopt(pair)
                    // A device that already worked may still have no backup.
                    // Fix it quietly when a secret is at hand rather than
                    // waiting for the next reinstall to notice.
                    ensureBackup(pair, secret)
                    return@withLock pair
                }
            }

            // A failed fetch must not fall through to "mint a new identity":
            // that would replace the account's published key and every channel
            // key sealed for the old one would stop opening for good. Only a
            // definite "no backup exists" may start a new identity.
            val backup = NexoraApi.identityBackup()

            if (backup != null) {
                if (secret == null || secret.kind != backup.kind) {
                    _status.value = IdentityStatus.Locked(backup.kind)
                    throw IdentityLockedError(backup.kind)
                }
                val pair = openBackup(backup, secret)
                store.put(storageKey, writePair(pair))
                adopt(pair, backedUp = true)
                return@withLock pair
            }

            val pair = Crypto.generateIdentity()
            store.put(storageKey, writePair(pair))
            adopt(pair)
            ensureBackup(pair, secret)
            pair
        }

    /** Restores from the account backup with a secret the user has just typed. */
    suspend fun unlock(secret: BackupSecret) {
        val id = userId ?: throw IllegalStateException("Nobody is signed in")
        identity = null
        initIdentity(id, secret)
    }

    /** Seals the current identity under a secret the user chose. */
    suspend fun backupIdentity(secret: BackupSecret) {
        val pair = currentIdentity()
        NexoraApi.putIdentityBackup(seal(pair, secret))
        _status.value = IdentityStatus.Ready(backedUp = true)
    }

    /**
     * Re-seals the backup after a password change. Skipped silently when the
     * backup is keyed to a passphrase, which a password change does not touch.
     */
    suspend fun rewrapBackupForPassword(newPassword: String) {
        val backup = NexoraApi.identityBackup() ?: return
        if (backup.kind != "password") return
        backupIdentity(BackupSecret.password(newPassword))
    }

    fun reset() {
        // Key material is per-user; a sign-out must not leak it into the next
        // session. What is on disk stays - it is sealed, and the same account
        // signing back in should not have to fetch its backup again.
        identity = null
        userId = null
        channels.clear()
        channelLocks.clear()
        rekeyed.clear()
        missedEpochs.clear()
        _status.value = IdentityStatus.Absent
    }

    private suspend fun adopt(pair: Crypto.KeyPairJwk, backedUp: Boolean = false) {
        identity = pair
        try {
            // Idempotent: re-publishing keeps the directory correct if the row
            // was lost, and refreshes when this phone was last seen.
            NexoraApi.registerDeviceKey(DeviceIdentity.id(), pair.publicKey, DeviceIdentity.label())
        } catch (error: ApiError) {
            // Revoked from another machine. Not a thing to retry, and not a
            // reason to mint a new id - minting one is how a revoked phone
            // would walk straight back into the directory.
            if (error.code == "DEVICE_REVOKED") {
                _status.value = IdentityStatus.Revoked
            }
            throw error
        }
        _status.value = IdentityStatus.Ready(backedUp)
    }

    /**
     * Uploads a backup when the account has none for this identity and a secret
     * is available to seal it with. Never throws into a sign-in: an account
     * without a backup still works, it is only unrecoverable, and settings says so.
     */
    private suspend fun ensureBackup(pair: Crypto.KeyPairJwk, secret: BackupSecret?) {
        runCatching {
            val backup = NexoraApi.identityBackup()
            if (backup?.publicKey == pair.publicKey) {
                _status.value = IdentityStatus.Ready(backedUp = true)
                return
            }
            if (secret == null) {
                _status.value = IdentityStatus.Ready(backedUp = false)
                return
            }
            NexoraApi.putIdentityBackup(seal(pair, secret))
            _status.value = IdentityStatus.Ready(backedUp = true)
        }
        // Offline, or a server older than this client. Nothing is lost that was
        // not already missing.
    }

    private fun seal(pair: Crypto.KeyPairJwk, secret: BackupSecret): IdentityBackup {
        val (salt, iv, ct) = Crypto.sealIdentity(pair, secret.value)
        return IdentityBackup(
            kind = secret.kind,
            iterations = Crypto.BACKUP_ITERATIONS,
            salt = salt,
            iv = iv,
            ct = ct,
            publicKey = pair.publicKey,
        )
    }

    /** Wrong secret is the expected failure, and deserves to say so. */
    private fun openBackup(backup: IdentityBackup, secret: BackupSecret): Crypto.KeyPairJwk =
        runCatching {
            Crypto.openIdentity(backup.salt, backup.iv, backup.ct, secret.value, backup.iterations)
        }.getOrElse {
            _status.value = IdentityStatus.Locked(backup.kind)
            throw IdentityLockedError(backup.kind)
        }

    private fun writePair(pair: Crypto.KeyPairJwk) = JSONObject()
        .put("publicKey", pair.publicKey)
        .put("privateKey", pair.privateKey)
        .toString()

    private fun readPair(stored: String): Crypto.KeyPairJwk {
        val json = JSONObject(stored)
        return Crypto.KeyPairJwk(json.getString("publicKey"), json.getString("privateKey"))
    }

    private suspend fun currentIdentity(): Crypto.KeyPairJwk =
        identity ?: userId?.let { initIdentity(it) } ?: throw MissingChannelKeyError()

    // --- content ---

    suspend fun encryptForChannel(channelId: String, plaintext: String): String {
        val state = ensureChannelKey(channelId)
        val key = state.keys[state.epoch] ?: throw MissingChannelKeyError()
        val sealed = Crypto.encrypt(plaintext, key)
        return JSONObject()
            .put("v", 1)
            .put("epoch", state.epoch)
            .put("iv", sealed.iv)
            .put("ct", Crypto.base64(sealed.ciphertext))
            .toString()
    }

    /**
     * Reads a stored message body. Anything that is not an envelope is returned
     * as it stands, so plaintext rows written before E2EE still render.
     */
    suspend fun decryptForChannel(channelId: String, content: String): String {
        val envelope = parseEnvelope(content) ?: return content
        val key = keyForEpoch(channelId, envelope.epoch) ?: return UNDECRYPTABLE
        return runCatching { Crypto.decrypt(envelope.ct, envelope.iv, key) }
            .getOrDefault(UNDECRYPTABLE)
    }

    suspend fun encryptFileForChannel(channelId: String, plaintext: ByteArray): Pair<Crypto.Sealed, Int> {
        val state = ensureChannelKey(channelId)
        val key = state.keys[state.epoch] ?: throw MissingChannelKeyError()
        return Crypto.encryptBytes(plaintext, key) to state.epoch
    }

    suspend fun decryptFileForChannel(
        channelId: String,
        ciphertext: ByteArray,
        iv: String,
        epoch: Int,
    ): ByteArray {
        val key = keyForEpoch(channelId, epoch) ?: throw MissingChannelKeyError()
        return Crypto.decryptBytes(ciphertext, iv, key)
    }

    /**
     * The key a call's DTLS fingerprint is signed with. It is the channel key,
     * which the server has never held - which is exactly why a signature made
     * with it proves the relay did not substitute a fingerprint of its own.
     */
    suspend fun callKeyForChannel(channelId: String): String {
        val state = ensureChannelKey(channelId)
        return state.keys[state.epoch] ?: throw MissingChannelKeyError()
    }

    private class Envelope(val epoch: Int, val iv: String, val ct: String)

    private fun parseEnvelope(content: String): Envelope? {
        if (!content.startsWith("{")) return null
        return runCatching {
            val json = JSONObject(content)
            if (json.optInt("v") != 1) return null
            val iv = json.optString("iv")
            val ct = json.optString("ct")
            if (iv.isEmpty() || ct.isEmpty() || !json.has("epoch")) return null
            Envelope(json.getInt("epoch"), iv, ct)
        }.getOrNull()
    }

    // --- channel keys ---

    /**
     * Re-wraps the current key for members who have none. Called when a channel
     * is opened, so somebody who joined after the key was minted becomes able to
     * read without anyone restarting the app.
     */
    suspend fun syncChannelKeys(channelId: String) {
        val state = runCatching { ensureChannelKey(channelId) }.getOrNull() ?: return
        val latest = NexoraApi.channelKeys(channelId)

        // Held state now survives a restart, so it can be days rather than
        // minutes behind. A different epoch means somebody re-keyed the channel
        // while this device was closed: ours is stale and theirs is the one
        // that counts. Without this the client would go on sealing under a dead
        // epoch until something else happened to invalidate it.
        if (latest.epoch != state.epoch) {
            forgetKeys(channelId)
            runCatching { ensureChannelKey(channelId) }
            return
        }

        val key = state.keys[state.epoch] ?: return
        if (latest.missingRecipients.isEmpty()) return
        shareKey(channelId, state.epoch, key, latest.missingRecipients)
    }

    /** Keys a channel that was just created, so whoever opens it first can read. */
    suspend fun keyChannel(channelId: String) {
        runCatching { ensureChannelKey(channelId) }
    }

    private suspend fun keyForEpoch(channelId: String, epoch: Int): String? {
        channels[channelId]?.keys?.get(epoch)?.let { return it }
        runCatching { ensureChannelKey(channelId) }.getOrNull()?.keys?.get(epoch)?.let { return it }

        // An epoch we hold nothing for, on a channel we have already loaded.
        // Somebody re-keyed it while we were holding the old one - which is
        // exactly what a member who joined after the key was minted does, since
        // waiting for a re-wrap is not a fix - and our cached state is behind.
        //
        // Without re-reading here, the two clients sit on different epochs
        // until one of them is restarted: each renders the other's messages as
        // "no key on this device", and each keeps *sending* under its own stale
        // epoch so the reply is unreadable too. Reloading also moves this
        // client onto the newer epoch, which is what makes the conversation
        // work in both directions again.
        if (!missedEpochs.add("$channelId#$epoch")) return null
        forgetKeys(channelId)

        val fresh = runCatching { ensureChannelKey(channelId) }.getOrNull()?.keys?.get(epoch)
        // It was there after all, so anything else given up on for this channel
        // deserves another go.
        if (fresh != null) missedEpochs.removeAll { it.startsWith("$channelId#") }
        return fresh
    }

    /**
     * Resolves the channel's key, creating and distributing one if the channel
     * has never been keyed. Concurrent callers share one round trip.
     */
    private suspend fun ensureChannelKey(channelId: String): ChannelKeyState {
        channels[channelId]?.let { return it }
        val lock = channelLocks.getOrPut(channelId) { Mutex() }
        return lock.withLock {
            channels[channelId]
                ?: recallKeys(channelId)?.also { channels[channelId] = it }
                ?: loadChannelKey(channelId).also {
                    channels[channelId] = it
                    rememberKeys(channelId, it)
                }
        }
    }

    // --- channel keys at rest ---
    //
    // Without these, the message cache is useless: every cached row is an
    // envelope, and opening one meant a round trip to the key directory first.
    // A conversation would come back off disk instantly and then sit there
    // saying it had no key until the network answered - and say it for good
    // when there was no network to answer.
    //
    // They go in the same Keystore-sealed store the identity does, and not in
    // the cache database, which is deliberately worth nothing on its own.

    private fun keyStorageKey(channelId: String): String? =
        userId?.let { "channelkeys:$it:$channelId" }

    private fun rememberKeys(channelId: String, state: ChannelKeyState) {
        val name = keyStorageKey(channelId) ?: return
        runCatching {
            val keys = JSONObject()
            state.keys.forEach { (epoch, key) -> keys.put(epoch.toString(), key) }
            store.put(name, JSONObject().put("epoch", state.epoch).put("keys", keys).toString())
        }
    }

    private fun recallKeys(channelId: String): ChannelKeyState? {
        val name = keyStorageKey(channelId) ?: return null
        return runCatching {
            val json = JSONObject(store.get(name) ?: return null)
            val keys = json.getJSONObject("keys")
            ChannelKeyState(
                epoch = json.getInt("epoch"),
                keys = keys.keys().asSequence().associate { it.toInt() to keys.getString(it) },
            )
        }.getOrNull()
    }

    /** Drops a channel's keys from memory and from disk, so the next read refetches. */
    private fun forgetKeys(channelId: String) {
        channels.remove(channelId)
        keyStorageKey(channelId)?.let { runCatching { store.remove(it) } }
    }

    private suspend fun loadChannelKey(channelId: String): ChannelKeyState {
        val self = currentIdentity()
        var response = NexoraApi.channelKeys(channelId)
        var keys = openKeys(response.keys, self)

        // We hold nothing for the current epoch. Either nobody has keyed the
        // channel yet, or it was keyed before we joined and every holder who
        // could re-wrap it for us is offline. Waiting on them is not a fix, so
        // mint the next epoch and wrap it for everybody - which is exactly what
        // the server lets any member who may send a message do. Earlier epochs
        // are untouched, so history from before we were a member stays closed.
        if (!keys.containsKey(response.epoch) && rekeyed.add(channelId)) {
            createChannelKey(channelId, response.epoch + 1)
            // Re-read rather than trusting our own write: another member may
            // have won the race, and then theirs is the epoch that counts.
            response = NexoraApi.channelKeys(channelId)
            keys = openKeys(response.keys, self)
        }

        if (!keys.containsKey(response.epoch)) throw MissingChannelKeyError()

        // Members who joined after the key was minted cannot read anything
        // until a holder re-wraps it for them. We hold it, so we do it.
        if (response.missingRecipients.isNotEmpty()) {
            keys[response.epoch]?.let {
                runCatching { shareKey(channelId, response.epoch, it, response.missingRecipients) }
            }
        }

        return ChannelKeyState(response.epoch, keys)
    }

    /** Opens every entry sealed for us, keyed by epoch. */
    private fun openKeys(
        entries: List<ChannelKeyEntry>,
        self: Crypto.KeyPairJwk,
    ): MutableMap<Int, String> {
        val keys = mutableMapOf<Int, String>()
        for (entry in entries) {
            runCatching {
                keys[entry.epoch] = Crypto.unwrapChannelKey(
                    Crypto.Wrapped(entry.wrappedKey, entry.iv),
                    self.privateKey,
                    entry.senderPublicKey,
                )
            }
            // A key sealed for another of our machines, or for an identity we
            // have since replaced. Both are rows this private half cannot open.
        }
        return keys
    }

    /**
     * Mints an epoch for a channel this device holds no key for - one nobody has
     * keyed, or one that was keyed before we were a member.
     */
    private suspend fun createChannelKey(channelId: String, epoch: Int) {
        val self = currentIdentity()
        val key = Crypto.generateChannelKey()
        val devices = NexoraApi.channelDevices(channelId)

        // Our own row may not be in the directory yet on a device that signed in
        // a moment ago. Minting a key we cannot open - or, with an empty
        // directory, publishing nothing at all - leaves the channel unkeyed and
        // the sender told there is no key, so always seal one for ourselves.
        // Being listed under our user id is no longer enough: the directory is a
        // row per machine, and that row may be the other laptop.
        val mine = DeviceIdentity.id()
        val recipients = if (devices.any { it.userId == userId && it.deviceId == mine }) {
            devices
        } else {
            devices + DeviceKey(userId.orEmpty(), mine, self.publicKey)
        }

        try {
            shareKey(channelId, epoch, key, recipients)
        } catch (error: ApiError) {
            // Another member keyed it first: harmless, the caller re-reads and
            // finds theirs. Which code comes back depends on whether they landed
            // on the epoch we wanted or ran past it. Anything else is a real
            // failure and must not be mistaken for "this device has no key".
            val raced = error.code == "EPOCH_OUT_OF_ORDER" || error.code == "EPOCH_NOT_HELD"
            if (!raced) throw error
        }
    }

    private suspend fun shareKey(
        channelId: String,
        epoch: Int,
        key: String,
        recipients: List<DeviceKey>,
    ) {
        if (recipients.isEmpty()) return
        val self = currentIdentity()
        val entries = recipients.mapNotNull { recipient ->
            runCatching {
                val wrapped = Crypto.wrapChannelKey(key, self.privateKey, recipient.publicKey)
                ChannelKeyEntry(
                    recipientUserId = recipient.userId,
                    recipientDeviceId = recipient.deviceId,
                    senderUserId = userId.orEmpty(),
                    senderDeviceId = DeviceIdentity.id(),
                    senderPublicKey = self.publicKey,
                    wrappedKey = wrapped.wrappedKey,
                    iv = wrapped.iv,
                    epoch = epoch,
                )
            }.getOrNull()
            // A directory row with a malformed public key must not stop the
            // channel being keyed for everybody else.
        }
        if (entries.isEmpty()) return
        NexoraApi.publishChannelKeys(channelId, epoch, DeviceIdentity.id(), entries)
    }
}
