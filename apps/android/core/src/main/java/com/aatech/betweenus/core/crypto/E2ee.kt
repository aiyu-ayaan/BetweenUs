package com.aatech.betweenus.core.crypto

import android.content.Context
import com.aatech.betweenus.core.data.ApiError
import com.aatech.betweenus.core.data.ChannelKeyEntry
import com.aatech.betweenus.core.data.ChannelKeys
import com.aatech.betweenus.core.data.DeviceKey
import com.aatech.betweenus.core.data.IdentityBackup
import com.aatech.betweenus.core.data.BetweenUsApi
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
    /**
     * Shown instead of a message this device holds no key for.
     *
     * Two words: it is drawn once per message, and a sentence repeated down a
     * whole screen is not eight times as informative as one. Why, and what to
     * do about it, is said once for the channel.
     */
    const val UNDECRYPTABLE = "🔒 Encrypted"

    private lateinit var store: SecureStore

    private var identity: Crypto.KeyPairJwk? = null
    private var userId: String? = null

    /**
     * The secret this session signed in with, kept for the length of the session.
     *
     * It used to be an argument and nothing else, so a sign-in whose identity
     * setup failed once - the network dropped, the token was a moment late -
     * lost it. [currentIdentity] then retried with no secret, could not open the
     * account backup, and minted a device-local key instead, which was
     * permanent. A password typed into a login form is dropped when the session
     * ends, and that is the only thing keeping it here has to guarantee.
     */
    @Volatile
    private var signInSecret: BackupSecret? = null

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
     * It never fails for want of a secret, and it never asks for one.
     */
    suspend fun initIdentity(userId: String, secret: BackupSecret? = null): Crypto.KeyPairJwk =
        identityLock.withLock {
            identity?.let { if (this.userId == userId) return@withLock it }
            this.userId = userId
            // Held past this call on purpose: [currentIdentity] retries with no
            // secret of its own, and a retry without one forks permanently.
            if (secret != null) signInSecret = secret
            val opener = secret ?: signInSecret

            val storageKey = "identity:$userId"
            store.get(storageKey)?.let { stored ->
                val saved = runCatching { readStored(stored) }.getOrNull()
                if (saved != null) {
                    // A device that forked gets another go, every time a secret
                    // is at hand. This is the whole of "sign in on a new phone
                    // and your messages are there": the fork below is silent and
                    // one-way, so the only thing that makes it recoverable is
                    // trying the backup again on the next sign-in rather than
                    // short-circuiting on the key the fork left behind.
                    if (saved.provisional && opener != null) {
                        restoreFromBackup(storageKey, opener)?.let { return@withLock it }
                    }
                    adopt(saved.pair, provisional = saved.provisional)
                    // A device that already worked may still have no backup.
                    // Fix it quietly when a secret is at hand rather than
                    // waiting for the next reinstall to notice.
                    ensureBackup(saved.pair, opener)
                    return@withLock saved.pair
                }
            }

            // A failed fetch must not be read as "there is no backup": that
            // would seal a fresh key over one that exists. It throws, and the
            // sign-in retries.
            val backups = BetweenUsApi.identityBackups()

            // The account's own key, when the secret that opens it is at hand.
            // The good path and the only instant one: every epoch already
            // sealed for that identity opens the moment it lands.
            if (opener != null) {
                restoreFromBackup(storageKey, opener, backups)?.let { return@withLock it }
            }

            // Otherwise this device gets a key of its own and the sign-in
            // carries on. It used to stop and ask - and asking is not something
            // every sign-in can answer: a provider sign-in has no account
            // password to offer, and an account that has only ever used one has
            // no password at all.
            //
            // Minting is safe because a channel key is wrapped per *device*:
            // this device publishes its own public key under its own device id
            // and takes nothing from the devices already in the directory.
            // History arrives from them - `fillGaps` hands every epoch a device
            // holds to the owner's devices missing it - so the account
            // converges without anyone typing anything. What it costs is that
            // history is not instant; it appears as the other devices open
            // those channels. See apps/desktop/src/services/e2ee.ts.
            //
            // The fork is marked when the account *had* a backup this device
            // could not open, and that mark is what lets the next sign-in undo
            // it. Unmarked means there was nothing to restore from, so this key
            // is the account's own.
            val provisional = backups.isNotEmpty()
            val pair = Crypto.generateIdentity()
            store.put(storageKey, writePair(pair, provisional))
            adopt(pair, provisional = provisional)
            ensureBackup(pair, opener)
            pair
        }

    /**
     * Opens whichever backup [secret] fits and makes it this device's identity.
     *
     * Null means "not this secret" - a wrong password, or a passphrase-only
     * account signing in with a password - which is an ordinary outcome here,
     * not a failure.
     *
     * Every channel key held on this device is dropped on the way out. They are
     * still valid, but they are the *subset* a forked identity could reach, and
     * the caches in front of them - memory and the sealed store both - would
     * keep serving that subset while the wraps this identity can now open sat
     * unread in the directory. Dropping them costs one re-read of a directory
     * we have just been talking to.
     */
    private suspend fun restoreFromBackup(
        storageKey: String,
        secret: BackupSecret,
        known: List<IdentityBackup>? = null,
    ): Crypto.KeyPairJwk? {
        val backups = known ?: runCatching { BetweenUsApi.identityBackups() }.getOrNull() ?: return null
        val sealed = backups.firstOrNull { it.kind == secret.kind } ?: return null
        val pair = openBackup(sealed, secret) ?: return null

        store.put(storageKey, writePair(pair))
        forgetAllKeys()
        adopt(pair, backedUp = true)
        return pair
    }

    /** Seals the current identity under a secret the user chose. */
    suspend fun backupIdentity(secret: BackupSecret) {
        val pair = currentIdentity()
        BetweenUsApi.putIdentityBackup(seal(pair, secret))
        _status.value = IdentityStatus.Ready(backedUp = true)
    }

    /**
     * Re-seals the backup after a password change. Skipped silently when the
     * backup is keyed to a passphrase, which a password change does not touch.
     */
    suspend fun rewrapBackupForPassword(newPassword: String) {
        if (BetweenUsApi.identityBackups().none { it.kind == "password" }) return
        backupIdentity(BackupSecret.password(newPassword))
        // The secret this session holds is now the old one, and a retry using it
        // would fail to open the blob it has just re-sealed.
        signInSecret = BackupSecret.password(newPassword)
    }

    /**
     * Whether the account password can still recover this identity on a device
     * that has never seen it.
     *
     * The one thing a settings screen has to be able to say plainly: it is the
     * difference between "sign in anywhere" and "sign in anywhere and type a
     * passphrase you wrote down once".
     */
    suspend fun passwordRecoveryEnabled(): Boolean =
        BetweenUsApi.identityBackups().any { it.kind == "password" }

    /**
     * Turns the password path off, for somebody who set a recovery passphrase
     * *because* a live server sees the password at sign-in and they would rather
     * it could never open the backup.
     *
     * Refuses when it would leave the account with no backup at all. That is not
     * a security setting, it is losing every message on the next reinstall.
     */
    suspend fun disablePasswordRecovery() {
        if (BetweenUsApi.identityBackups().none { it.kind == "passphrase" }) {
            error("Set a recovery passphrase first, or this account has no way back at all")
        }
        BetweenUsApi.deleteIdentityBackup("password")
    }

    fun reset() {
        // Key material is per-user; a sign-out must not leak it into the next
        // session. What is on disk stays - it is sealed, and the same account
        // signing back in should not have to fetch its backup again.
        identity = null
        userId = null
        signInSecret = null
        channels.clear()
        channelLocks.clear()
        rekeyed.clear()
        missedEpochs.clear()
        _status.value = IdentityStatus.Absent
    }

    private suspend fun adopt(
        pair: Crypto.KeyPairJwk,
        backedUp: Boolean = false,
        provisional: Boolean = false,
    ) {
        identity = pair
        try {
            // Idempotent: re-publishing keeps the directory correct if the row
            // was lost, and refreshes when this phone was last seen.
            BetweenUsApi.registerDeviceKey(DeviceIdentity.id(), pair.publicKey, DeviceIdentity.label())
        } catch (error: ApiError) {
            // Revoked from another machine. Not a thing to retry, and not a
            // reason to mint a new id - minting one is how a revoked phone
            // would walk straight back into the directory.
            if (error.code == "DEVICE_REVOKED") {
                _status.value = IdentityStatus.Revoked
            }
            throw error
        }
        _status.value = IdentityStatus.Ready(backedUp, provisional)
    }

    /**
     * Uploads a backup when the account has none for this identity and a secret
     * is available to seal it with. Never throws into a sign-in: an account
     * without a backup still works, it is only unrecoverable, and settings says so.
     */
    private suspend fun ensureBackup(pair: Crypto.KeyPairJwk, secret: BackupSecret?) {
        runCatching {
            val backups = BetweenUsApi.identityBackups()
            val backedUp = backups.any { it.publicKey == pair.publicKey }

            // A backup that already stands is not this device's to replace
            // unless it is this device's key in it. Since a device that could
            // not open one mints its own, sealing over it here would take the
            // account's recoverable identity away from every device still
            // restoring from it. Deliberate re-sealing is [backupIdentity]'s.
            //
            // Scoped to the *kind* now. An account holding a passphrase backup
            // and no password one is exactly the account that cannot recover on
            // a fresh sign-in, so filling that gap when the password is at hand
            // is the point rather than an overreach - and it only ever seals the
            // key this device already holds, which is the identity the other
            // devices restore from whenever `backedUp` says so.
            if (secret == null || backups.any { it.kind == secret.kind } || !backedUp) {
                _status.value = IdentityStatus.Ready(
                    backedUp = backedUp,
                    provisional = backups.isNotEmpty() && !backedUp,
                )
                return
            }
            BetweenUsApi.putIdentityBackup(seal(pair, secret))
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

    /** The wrong secret is an ordinary outcome here, not an error: null, and on. */
    private fun openBackup(backup: IdentityBackup, secret: BackupSecret): Crypto.KeyPairJwk? =
        runCatching {
            Crypto.openIdentity(backup.salt, backup.iv, backup.ct, secret.value, backup.iterations)
        }.getOrNull()

    /**
     * What the sealed store holds. `provisional` marks a key this device minted
     * for itself *while the account had a backup it could not open* - the fork
     * described in [initIdentity]. It is the flag that makes the fork
     * recoverable: without it the stored key short-circuits every later launch
     * and the backup is never tried again, on any sign-in, ever.
     */
    private class StoredIdentity(val pair: Crypto.KeyPairJwk, val provisional: Boolean)

    private fun writePair(pair: Crypto.KeyPairJwk, provisional: Boolean = false) = JSONObject()
        .put("publicKey", pair.publicKey)
        .put("privateKey", pair.privateKey)
        .put("provisional", provisional)
        .toString()

    private fun readStored(stored: String): StoredIdentity {
        val json = JSONObject(stored)
        return StoredIdentity(
            pair = Crypto.KeyPairJwk(json.getString("publicKey"), json.getString("privateKey")),
            // Absent on a blob written before the fork was recoverable. False is
            // the safe reading: it was minted under rules that had no mark, and
            // a sign-in that opens the backup replaces it either way.
            provisional = json.optBoolean("provisional", false),
        )
    }

    private suspend fun currentIdentity(): Crypto.KeyPairJwk =
        identity
            // With the session's secret, not without it. A retry that dropped it
            // opened no backup, minted a device-local key, and forked for good.
            ?: userId?.let { initIdentity(it, signInSecret) }
            ?: throw MissingChannelKeyError()

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
    suspend fun callKeyForChannel(channelId: String, refresh: Boolean = false): String {
        // `refresh` is what a call asks for when somebody new arrives. Joining a
        // channel you hold no key for mints the next epoch - that is the only
        // way a new member gets one - so the newcomer's key is a generation
        // ahead of the one everybody already in the call read when they joined,
        // and without the re-read the two sides sign fingerprints with
        // different keys and refuse each other for good.
        if (refresh) forgetKeys(channelId)
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
        val latest = BetweenUsApi.channelKeys(channelId)

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

        fillGaps(channelId, state, latest)
    }

    /**
     * Hands every epoch this phone holds to the machines that are missing it.
     *
     * This is what lets a second machine read *history* rather than only what
     * is written after it arrives. Re-wrapping the current epoch and nothing
     * else left a machine that signed in today missing every epoch before
     * today - it holds none of them so it cannot repair itself, and with nobody
     * looking on its behalf it minted a fresh epoch and the whole conversation
     * before that moment stayed a padlock for good.
     *
     * The server only ever lists a machine whose *owner* already holds that
     * epoch, so this repairs one person's own second machine and hands nothing
     * to somebody who joined last week.
     *
     * Failures are per epoch and never fatal: a racing rotation or a device
     * revoked between the read and the write fails one wrap, and neither is a
     * reason to stop opening the channel.
     */
    private suspend fun fillGaps(channelId: String, state: ChannelKeyState, latest: ChannelKeys) {
        // Belt and braces for a server older than `gaps`, where this is the
        // only re-wrap that happens.
        state.keys[state.epoch]?.let { key ->
            if (latest.missingRecipients.isNotEmpty()) {
                runCatching { shareKey(channelId, state.epoch, key, latest.missingRecipients) }
            }
        }

        for (gap in latest.gaps) {
            // An epoch we cannot open is not ours to hand out, and the server
            // would refuse it anyway: only a holder may add to an existing one.
            val key = state.keys[gap.epoch] ?: continue
            if (gap.devices.isEmpty()) continue
            runCatching { shareKey(channelId, gap.epoch, key, gap.devices) }
        }
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

    /**
     * Drops every channel key this device holds, in memory and at rest.
     *
     * Called when the identity changes under it - [restoreFromBackup]. The keys
     * are still valid, but they are the *subset* the old identity could reach,
     * and both caches would go on serving that subset while the wraps the new
     * identity can open sat unread in the directory.
     */
    private fun forgetAllKeys() {
        channels.clear()
        rekeyed.clear()
        missedEpochs.clear()
        userId?.let { runCatching { store.removeByPrefix("channelkeys:$it:") } }
    }

    private suspend fun loadChannelKey(channelId: String): ChannelKeyState {
        val self = currentIdentity()
        var response = BetweenUsApi.channelKeys(channelId)
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
            response = BetweenUsApi.channelKeys(channelId)
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
        val devices = BetweenUsApi.channelDevices(channelId)

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
        BetweenUsApi.publishChannelKeys(channelId, epoch, DeviceIdentity.id(), entries)
    }
}
