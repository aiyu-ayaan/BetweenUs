package com.aatech.betweenus.core.crypto

import android.content.Context
import com.aatech.betweenus.core.data.ApiError
import com.aatech.betweenus.core.data.ChannelKeyEntry
import com.aatech.betweenus.core.data.ChannelKeys
import com.aatech.betweenus.core.data.AccountKeyRecipient
import com.aatech.betweenus.core.data.AccountVault
import com.aatech.betweenus.core.data.VaultFactor
import com.aatech.betweenus.core.data.VaultGrantRequest
import com.aatech.betweenus.core.data.StatusEntry
import com.aatech.betweenus.core.data.StatusKeyEntry
import com.aatech.betweenus.core.data.BetweenUsApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/** What opens the account vault. Held only for the moment a sign-in needs it. */
data class VaultSecret(val value: String, val kind: String) {
    companion object {
        fun password(value: String) = VaultSecret(value, "password")
        fun passphrase(value: String) = VaultSecret(value, "passphrase")
        fun recoveryCode(value: String) =
            VaultSecret(Crypto.normaliseRecoveryCode(value), "recovery-code")
    }
}

class MissingChannelKeyError : Exception("No channel key on this device yet")

/**
 * Thrown when this device cannot open the vault.
 *
 * Distinct from [MissingChannelKeyError] because the two need different
 * screens: one is a channel nobody has keyed yet, the other is this device not
 * being in the account yet, and conflating them is how the app came to tell
 * people to go and open it on another laptop.
 */
class VaultLockedError : Exception("This device has not been let into the account vault yet")

/** Why this device cannot open the vault, which decides what its screen leads with. */
enum class LockedReason { NoSecret, WrongSecret, AwaitingApproval }

/**
 * ## Why `Locked` exists, having been deliberately avoided before
 *
 * There used to be no such state on purpose: a device that could not open the
 * account backup minted a key of its own and signed in anyway, so there was
 * never a screen asking for a secret nobody could supply.
 *
 * What that bought was a working sign-in. What it cost was the account. Such a
 * device published a second identity, could read nothing already wrapped for
 * the first, and - holding no channel key - minted fresh epochs and dragged
 * conversations onto keys the rest of the account could not read either. The
 * message people actually saw was "open BetweenUs on the device you first
 * signed in with", which is a thing an app should never have to say.
 *
 * So the fork is gone and the honest state is back. A locked device is not a
 * broken one: it has three ways out - a recovery code, a passphrase, or
 * approval from a device already in - and none of them can lose anything,
 * because it has not written anything.
 */
sealed interface IdentityStatus {
    data object Absent : IdentityStatus

    /**
     * `recoverable` is whether a portable factor stands - a password, a
     * passphrase or a recovery code - which is the difference between an
     * account that survives losing every device and one that does not.
     */
    data class Ready(val recoverable: Boolean) : IdentityStatus

    /** The account has a vault and this device cannot open it yet. */
    data class Locked(
        val reason: LockedReason,
        val grantRequested: Boolean,
    ) : IdentityStatus

    /**
     * The owner revoked this machine from another one. Nothing new is wrapped
     * for it, so it reads what it already had and nothing since - saying so
     * beats a screen full of "no key on this device yet".
     */
    data object Revoked : IdentityStatus
}

/**
 * The end-to-end encryption service: the account vault, the channel keys it
 * opens, and sealing and opening content with them.
 *
 * The port of `apps/desktop/src/services/e2ee.ts`. Every decision here about
 * *when* to mint an epoch, when to re-wrap for a member, and what to do when a
 * key cannot be opened is that file's, because the three clients share one
 * channel and disagreeing about any of it locks somebody out of their history.
 *
 * ## The one thing to understand before changing anything here
 *
 * A channel key is wrapped for an **account**, not for a device. Every device
 * that can open the vault opens the same rows, which is why signing in on a
 * new phone brings the whole history with it and needs nothing from anybody
 * else.
 *
 * It used to wrap per device, and every conversation this project lost was
 * that decision playing out: a phone that did not exist when an epoch was
 * minted held nothing for it, only another device already holding that epoch
 * could seal one, and if none ever came online again those messages were
 * ciphertext forever.
 */
object E2ee {
    /**
     * The recipient id that means "the account itself" rather than one machine.
     *
     * Has to match `ACCOUNT_SCOPE` in `packages/shared-types` exactly: it is
     * the string the server files an account-scoped wrap under, and a client
     * that spelled it differently would write rows nothing else can find.
     */
    const val ACCOUNT_SCOPE = "@account"

    /**
     * Shown instead of a message this device holds no key for.
     *
     * Two words: it is drawn once per message, and a sentence repeated down a
     * whole screen is not eight times as informative as one. Why, and what to
     * do about it, is said once for the channel.
     */
    const val UNDECRYPTABLE = "🔒 Encrypted"

    private lateinit var store: SecureStore

    /** The open vault: the master key, and every identity generation it seals. */
    @Volatile
    private var vault: Crypto.OpenVault? = null

    /**
     * This device's own key pair. Not the account identity - it receives vault
     * grants and opens the pre-vault rows addressed to this installation, and
     * that second job is the whole of how history written before the vault is
     * rescued.
     */
    @Volatile
    private var deviceKeys: Crypto.KeyPairJwk? = null

    private var userId: String? = null

    /**
     * The secret this session signed in with, kept for the length of the session.
     *
     * It used to be an argument and nothing else, so a sign-in whose identity
     * setup failed once - the network dropped, the token was a moment late -
     * lost it. [currentVault] then retried with no secret, could not open the
     * account backup, and minted a device-local key instead, which was
     * permanent. A password typed into a login form is dropped when the session
     * ends, and that is the only thing keeping it here has to guarantee.
     */
    @Volatile
    private var signInSecret: VaultSecret? = null

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

    /** Channel-and-epoch pairs already promoted, so a re-open does not re-send. */
    private val promoted = ConcurrentHashMap.newKeySet<String>()

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

    // --- the account vault ---

    /**
     * Opens this account's vault and publishes this device's key. Called once
     * per sign-in, with the password when there is one to hand.
     *
     * It resolves in one of two states and never a third. Either the vault is
     * open - and then everything the account has ever been wrapped for opens,
     * including history from before this phone existed - or this device is
     * locked and says so.
     *
     * What it will not do, under any circumstance, is mint an identity of its
     * own. That is the change. It used to do exactly that whenever it could
     * not open a backup, because stopping to ask for a secret is a question a
     * provider sign-in cannot answer - and the cost was an account with
     * several identities, each reading a different slice of its own history,
     * permanently. A locked device has written nothing, so nothing about it is
     * one-way.
     */
    suspend fun initIdentity(userId: String, secret: VaultSecret? = null): Crypto.OpenVault =
        identityLock.withLock {
            vault?.let { if (this.userId == userId) return@withLock it }
            this.userId = userId
            // Held past this call on purpose: [currentVault] retries with no
            // secret of its own, and a retry that locks a device whose owner
            // typed the right password is its own small betrayal.
            if (secret != null) signInSecret = secret
            val opener = secret ?: signInSecret

            val device = deviceIdentity(userId)

            // A failed fetch must not be read as "there is no vault": creating
            // a second one over a standing one orphans every key wrapped for
            // the first, with no undo. It throws, and the sign-in retries.
            val stored = BetweenUsApi.vault()
                ?: return@withLock createVault(userId, device, opener)

            val opened = unlock(userId, stored, device, opener)
            if (opened != null) {
                adopt(userId, device, opened, stored.factors)
                return@withLock opened
            }

            // Locked. Ask to be let in from a device that already is, and say
            // so rather than quietly becoming a second account.
            requestGrant(device)
            _status.value = IdentityStatus.Locked(
                reason = if (opener != null) LockedReason.WrongSecret else LockedReason.NoSecret,
                grantRequested = true,
            )
            throw VaultLockedError()
        }

    /**
     * Tries every way this device might already be entitled to the master key:
     * the one it has already opened, a secret somebody typed, and a grant
     * somebody approved.
     *
     * Null is an ordinary outcome, not a failure - it is what a phone signing
     * in for the first time with no password looks like.
     */
    private suspend fun unlock(
        userId: String,
        stored: AccountVault,
        device: Crypto.KeyPairJwk,
        secret: VaultSecret?,
    ): Crypto.OpenVault? {
        // A relaunch must not ask for a password that a launch already took.
        store.get(masterKeyStore(userId))?.takeIf { it.isNotEmpty() }?.let { cached ->
            openWith(stored, cached)?.let { return it }
            // The cached key does not open the current keyring: the account
            // rotated, or this is stale. Drop it and try the routes below.
            store.put(masterKeyStore(userId), "")
        }

        if (secret != null) {
            for (factor in stored.factors.filter { it.kind == secret.kind }) {
                val masterKey = runCatching {
                    Crypto.openMasterKeyWithSecret(
                        factor.salt,
                        factor.iv,
                        factor.ct,
                        secret.value,
                        factor.iterations,
                    )
                }.getOrNull() ?: continue
                openWith(stored, masterKey)?.let {
                    store.put(masterKeyStore(userId), masterKey)
                    return it
                }
            }
        }

        val grant = stored.factors.firstOrNull {
            it.kind == "device" && it.deviceId == DeviceIdentity.id()
        }
        if (grant != null) {
            val masterKey = runCatching {
                Crypto.openMasterKeyFromGrant(
                    Crypto.Wrapped(grant.ct, grant.iv),
                    device.privateKey,
                    grant.senderPublicKey,
                )
            }.getOrNull()
            if (masterKey != null) {
                openWith(stored, masterKey)?.let {
                    store.put(masterKeyStore(userId), masterKey)
                    return it
                }
            }
        }

        return null
    }

    /** The keyring behind a master key, or null when that key is not the one. */
    private fun openWith(stored: AccountVault, masterKey: String): Crypto.OpenVault? =
        runCatching {
            Crypto.OpenVault(
                masterKey,
                Crypto.openKeyring(stored.keyringIv, stored.keyringCt, masterKey),
            )
        }.getOrNull()

    /**
     * An account with no vault: one that predates it, or a brand-new one.
     *
     * The two are handled the same way and deliberately so. The pre-vault
     * identity is not promoted into the keyring even when this device holds
     * it: generation 1 of an account identity and the private key of one phone
     * are different things, and conflating them would mean every later
     * rotation reasoning about a key a device also holds outside the vault.
     * What rescues the old history is promoting the wraps, not reusing the key.
     *
     * The recovery code is minted here, once, and handed to whoever is
     * listening. Offering it later in a settings screen is offering it to the
     * few people who go looking, and the whole value of the factor is that
     * everybody has one.
     */
    private suspend fun createVault(
        userId: String,
        device: Crypto.KeyPairJwk,
        secret: VaultSecret?,
    ): Crypto.OpenVault {
        val identity = Crypto.generateIdentity()
        val masterKey = Crypto.generateMasterKey()
        val keyring = listOf(Crypto.KeyringEntry(1, identity.publicKey, identity.privateKey))
        val (keyringIv, keyringCt) = Crypto.sealKeyring(keyring, masterKey)

        val code = Crypto.generateRecoveryCode()
        val factors = mutableListOf(secretFactor(masterKey, VaultSecret(code, "recovery-code")))
        // The password as well when there is one, because it is what makes
        // signing in on a new phone need nothing typed beyond the password.
        if (secret != null && secret.kind != "recovery-code") {
            factors += secretFactor(masterKey, secret)
        }

        val created = BetweenUsApi.createVault(identity.publicKey, keyringIv, keyringCt, factors)
            // Somebody else's device created it a moment ago - two sign-ins at
            // once, or a retry after a lost response. Read theirs rather than
            // insisting on ours: the server refuses the second create for
            // exactly this reason, and the alternative is two identities again.
            ?: BetweenUsApi.vault()
            ?: error("The vault could not be created or read")

        val opened = unlock(userId, created, device, secret)
            ?: run {
                requestGrant(device)
                _status.value =
                    IdentityStatus.Locked(LockedReason.NoSecret, grantRequested = true)
                throw VaultLockedError()
            }

        adopt(userId, device, opened, created.factors)
        // Shown once, by whoever is listening, or held until somebody is.
        // Nothing stores it: a recovery code this app can read back is one
        // that goes with the phone, which is the thing it exists not to do.
        announceRecoveryCode(code)
        return opened
    }

    /**
     * Publishes this device's key and marks the vault open.
     *
     * `holdsVault` is what stops the owner's own settings screen describing a
     * working device as one waiting for approval. It is an assertion rather
     * than a proof, and safe to be: the only thing it changes is how this
     * account's device list is drawn to this account.
     */
    private suspend fun adopt(
        userId: String,
        device: Crypto.KeyPairJwk,
        opened: Crypto.OpenVault,
        factors: List<VaultFactor>,
    ) {
        vault = opened
        deviceKeys = device
        try {
            // Idempotent: re-publishing keeps the directory correct if the row
            // was lost, and refreshes when this phone was last seen.
            BetweenUsApi.registerDeviceKey(
                DeviceIdentity.id(),
                device.publicKey,
                DeviceIdentity.label(),
                holdsVault = true,
            )
        } catch (error: ApiError) {
            // Revoked from another machine. Not a thing to retry, and not a
            // reason to mint a new id - minting one is how a revoked phone
            // would walk straight back into the directory.
            if (error.code == "DEVICE_REVOKED") _status.value = IdentityStatus.Revoked
            throw error
        }
        _status.value = IdentityStatus.Ready(recoverable = factors.any { it.portable })
    }

    /**
     * Asks to be let in from a device that already is.
     *
     * Sent even when nobody is likely to be watching: the request costs
     * nothing, and the alternative is a screen with a button somebody has to
     * find. Approving it is a deliberate act on another device, with a
     * fingerprint to compare first.
     */
    private suspend fun requestGrant(device: Crypto.KeyPairJwk) {
        runCatching {
            BetweenUsApi.requestVaultGrant(
                DeviceIdentity.id(),
                device.publicKey,
                DeviceIdentity.label(),
                Crypto.keyFingerprint(device.publicKey),
            )
        }
        // Offline, or the queue is full. The locked screen offers the two
        // routes that need nobody else, and this is asked again next time.
    }

    /**
     * Opens the vault with a secret typed on the locked screen: a second
     * attempt rather than a first, so the sign-in has already happened and
     * what is missing is one string.
     */
    suspend fun unlockWithSecret(secret: VaultSecret) {
        val id = userId ?: error("Nobody is signed in")
        signInSecret = secret
        identityLock.withLock { vault = null }
        // Every channel key held at rest is dropped on the way in. They are
        // still valid, but they are the subset a locked or pre-vault identity
        // could reach, and the cache would go on serving that subset while
        // the wraps the account key opens sat unread in the directory - which
        // is somebody unlocking their account and still seeing padlocks.
        forgetAllKeys()
        initIdentity(id, secret)
    }

    /**
     * Whether a device waiting for approval has been let in yet. Polled by the
     * locked screen, so a phone approved in the next room comes to life
     * without anybody restarting anything.
     */
    suspend fun checkForGrant(): Boolean {
        val id = userId ?: return false
        return runCatching {
            BetweenUsApi.vaultGrant(DeviceIdentity.id()) ?: return false
            identityLock.withLock { vault = null }
            initIdentity(id)
            true
        }.getOrDefault(false)
    }

    /** Devices of this account waiting to be let in, for the approval screen. */
    suspend fun pendingGrants(): List<VaultGrantRequest> = BetweenUsApi.vaultGrants()

    /**
     * Lets one device in.
     *
     * The fingerprint is recomputed here from the key that is about to be
     * sealed for, and compared against the one the request carried. That is
     * not belt-and-braces: the request's own field arrived over the wire
     * beside the key, so trusting it would be checking a claim against itself.
     */
    suspend fun approveGrant(request: VaultGrantRequest) {
        val open = currentVault()
        val identity = open.current
        require(Crypto.keyFingerprint(request.publicKey) == request.fingerprint) {
            "That device's fingerprint does not match the key it published"
        }

        val sealed = Crypto.sealMasterKeyForDevice(
            open.masterKey,
            identity.privateKey,
            request.publicKey,
        )
        BetweenUsApi.putVaultFactor(
            VaultFactor(
                kind = "device",
                deviceId = request.deviceId,
                kdf = "ECDH-HKDF-SHA256",
                iterations = 0,
                salt = "",
                iv = sealed.iv,
                ct = sealed.wrappedKey,
                senderPublicKey = identity.publicKey,
            ),
        )
    }

    /** Withdraws a request, for somebody who did not recognise the device. */
    suspend fun denyGrant(deviceId: String) = BetweenUsApi.denyVaultGrant(deviceId)

    /**
     * Adds or replaces a door into the vault.
     *
     * Replacing is the ordinary case: a changed password re-seals the same
     * master key under a new derivation, and nothing history depends on is
     * touched - which is the whole reason the master key is a layer of its own
     * rather than the identity being sealed four times.
     */
    suspend fun setVaultFactor(secret: VaultSecret) {
        BetweenUsApi.putVaultFactor(secretFactor(currentVault().masterKey, secret))
    }

    /** Takes a door away. The server refuses the last portable one. */
    suspend fun removeVaultFactor(kind: String) = BetweenUsApi.deleteVaultFactor(kind)

    /**
     * Mints a fresh recovery code and replaces the old one. Returned rather
     * than stored, for the same reason it is shown once and never again.
     */
    suspend fun regenerateRecoveryCode(): String {
        val code = Crypto.generateRecoveryCode()
        BetweenUsApi.putVaultFactor(
            secretFactor(currentVault().masterKey, VaultSecret(code, "recovery-code")),
        )
        return code
    }

    /**
     * Appends an identity generation, after a device was lost.
     *
     * Nothing is taken away by it, and that is what makes it usable: every
     * earlier private half stays in the ring, so every channel key ever
     * wrapped to an older public half still opens. This could not be done at
     * all before - rotating meant abandoning every row sealed for the old
     * identity, which is to say the history - so a lost phone was something an
     * account simply lived with.
     */
    suspend fun rotateAccountIdentity() {
        val open = currentVault()
        val next = open.current.generation + 1
        val identity = Crypto.generateIdentity()
        val keyring = open.keyring + Crypto.KeyringEntry(next, identity.publicKey, identity.privateKey)
        val (iv, ct) = Crypto.sealKeyring(keyring, open.masterKey)

        BetweenUsApi.rotateVault(identity.publicKey, next, iv, ct)
        identityLock.withLock { vault = Crypto.OpenVault(open.masterKey, keyring) }
        // The held keys are still openable - every generation stays in the
        // ring - but the cached *epoch* per channel is now behind whatever
        // members seal next, so the directory is re-read on the next open.
        forgetAllKeys()
    }

    /**
     * Whether the account password can still open the vault on a device that
     * has never seen it.
     *
     * The one thing a settings screen has to be able to say plainly: it is the
     * difference between "sign in anywhere" and "sign in anywhere and find the
     * piece of paper".
     */
    suspend fun passwordRecoveryEnabled(): Boolean =
        BetweenUsApi.vault()?.factors?.any { it.kind == "password" } == true

    /**
     * Turns the password path off, for somebody who set a recovery passphrase
     * *because* a live server sees the password at sign-in and they would
     * rather it could never open the vault.
     *
     * The server refuses this when it would leave no portable factor at all,
     * which is not a security setting - it is losing every message on the next
     * reinstall - and it is refused there rather than here so that it holds
     * for every client there will ever be.
     */
    suspend fun disablePasswordRecovery() = BetweenUsApi.deleteVaultFactor("password")

    /** Re-seals the password factor after a password change. */
    suspend fun rewrapBackupForPassword(newPassword: String) {
        if (!passwordRecoveryEnabled()) return
        setVaultFactor(VaultSecret.password(newPassword))
        // The secret this session holds is now the old one, and a retry using
        // it would fail to open the factor it has just re-sealed.
        signInSecret = VaultSecret.password(newPassword)
    }

    fun reset() {
        // Key material is per-user; a sign-out must not leak it into the next
        // session. What is on disk stays - it is sealed, and the same account
        // signing back in should not have to open its vault from scratch.
        vault = null
        deviceKeys = null
        userId = null
        signInSecret = null
        // A code minted for the account signing out must not be shown to
        // whoever signs in next.
        pendingRecoveryCode = null
        channels.clear()
        channelLocks.clear()
        rekeyed.clear()
        promoted.clear()
        missedEpochs.clear()
        _status.value = IdentityStatus.Absent
    }

    private fun secretFactor(masterKey: String, secret: VaultSecret): VaultFactor {
        val (salt, iv, ct) = Crypto.sealMasterKeyWithSecret(masterKey, secret.value)
        return VaultFactor(
            kind = secret.kind,
            deviceId = "",
            kdf = "PBKDF2-SHA256",
            iterations = Crypto.BACKUP_ITERATIONS,
            salt = salt,
            iv = iv,
            ct = ct,
            senderPublicKey = "",
        )
    }

    /**
     * This device's own key pair: for receiving a vault grant, and for opening
     * the pre-vault rows addressed to it.
     *
     * Stored where the old identity was, and reusing whatever is there. That
     * is deliberate and it is what makes promotion possible at all: the key in
     * that slot is the one `channel_keys` rows were sealed to before the vault
     * existed, and generating a fresh one here would throw away the only thing
     * in the world that can open them.
     */
    private fun deviceIdentity(userId: String): Crypto.KeyPairJwk {
        val slot = "identity:$userId"
        store.get(slot)?.let { stored ->
            runCatching {
                val json = JSONObject(stored)
                Crypto.KeyPairJwk(json.getString("publicKey"), json.getString("privateKey"))
            }.getOrNull()?.let { return it }
        }

        val pair = Crypto.generateIdentity()
        store.put(
            slot,
            JSONObject()
                .put("publicKey", pair.publicKey)
                .put("privateKey", pair.privateKey)
                .toString(),
        )
        return pair
    }

    /** Where this device keeps the master key once it has opened the vault. */
    private fun masterKeyStore(userId: String) = "vault:$userId"

    /** Who is listening for the one-time recovery code, at account creation. */
    private val recoveryCodeListeners = mutableSetOf<(String) -> Unit>()

    /**
     * A code minted before anything was listening.
     *
     * The vault is created inside a sign-in and the screen that shows the code
     * appears in response to that same sign-in, so on a fresh registration the
     * code is often produced before anything is subscribed. Firing into an
     * empty room there would lose the only copy of the only factor that
     * survives losing everything else, silently, on the accounts least
     * equipped to notice.
     */
    @Volatile
    private var pendingRecoveryCode: String? = null

    /** Subscribes to the recovery code minted when a vault is created. */
    @Synchronized
    fun onRecoveryCode(listener: (String) -> Unit): () -> Unit {
        recoveryCodeListeners += listener
        pendingRecoveryCode?.let { code ->
            // Cleared as it is handed over: this is the one delivery, and
            // holding it longer would show a later subscriber a code that has
            // already been written down and moved past.
            pendingRecoveryCode = null
            listener(code)
        }
        return { synchronized(this) { recoveryCodeListeners -= listener } }
    }

    @Synchronized
    private fun announceRecoveryCode(code: String) {
        if (recoveryCodeListeners.isEmpty()) {
            pendingRecoveryCode = code
            return
        }
        recoveryCodeListeners.toList().forEach { it(code) }
    }

    /** Waits for sign-in key setup instead of racing it, and retries a failed one. */
    private suspend fun currentVault(): Crypto.OpenVault =
        vault
            // With the session's secret, not without it. A retry that dropped
            // it opened no backup, minted a device-local key, and forked the
            // account for good.
            ?: userId?.let { initIdentity(it, signInSecret) }
            ?: throw VaultLockedError()

    /**
     * Every private half this device can try a wrap against, newest identity
     * first.
     *
     * Order matters only for speed - the newest generation opens almost
     * everything - but the device key going last is worth keeping: it is the
     * one that opens the rows this device has a duty to promote, and having it
     * fail first on every account-scoped row would be a wasted AES operation
     * per message on a busy channel.
     */
    private fun privateHalves(): List<String> {
        val halves = vault?.keyring.orEmpty()
            .sortedByDescending { it.generation }
            .map { it.privateKey }
            .toMutableList()
        deviceKeys?.let { halves += it.privateKey }
        return halves
    }

    // --- content ---

    /**
     * Seals a message, but not before every member can open the epoch it is
     * sealed under.
     *
     * The order is the fix. The re-wrap for uncovered members used to happen
     * in the background while the send went ahead, so a message could be -
     * and routinely was - written under an epoch somebody had no wrap for.
     * Nothing ever repaired that: the epoch was minted, the message stored,
     * and the member read a padlock until the channel happened to rotate.
     */
    suspend fun encryptForChannel(channelId: String, plaintext: String): String {
        val state = ensureChannelKey(channelId)
        val key = state.keys[state.epoch] ?: throw MissingChannelKeyError()
        coverEveryone(channelId, state.epoch, key)
        val sealed = Crypto.encrypt(plaintext, key)
        return JSONObject()
            .put("v", 1)
            .put("epoch", state.epoch)
            .put("iv", sealed.iv)
            .put("ct", Crypto.base64(sealed.ciphertext))
            .toString()
    }

    /**
     * Seals the current epoch for any member who has no wrap for it yet.
     *
     * Quiet about its own failure and deliberately so: the alternative is a
     * message somebody cannot send because a third party joined the channel a
     * second ago and the directory has not caught up. What it must not do is
     * *skip* the attempt, which is what running it in the background amounted
     * to.
     */
    private suspend fun coverEveryone(channelId: String, epoch: Int, key: String) {
        runCatching {
            val latest = BetweenUsApi.channelKeys(channelId)
            if (latest.epoch != epoch || latest.missingRecipients.isEmpty()) return
            shareKey(channelId, epoch, key, latest.missingRecipients)
        }
        // Offline, or somebody rotated underneath us. The send goes ahead: the
        // epoch is the one this device holds and the members who do have a
        // wrap read it. The next open asks again for the ones who do not.
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


    // --- statuses ---
    //
    // A status has no channel, so it has no epoch and nothing to rotate: one
    // key per post, wrapped once per device that may read it, and gone in a
    // day. None of the channel machinery above applies - there is no state to
    // load, no gap to fill and no rekey.
    //
    // The wrap list is the audience, built from the directory at the moment of
    // posting. A friendship made afterwards adds nothing to a post already
    // written, which is why a new friend does not see yesterday's moment.

    /** A post, sealed and ready to send. */
    class SealedStatus(
        val caption: String?,
        val media: Crypto.Sealed?,
        val keys: List<StatusKeyEntry>,
        val senderDeviceId: String,
    )

    /**
     * Seals one post for one audience.
     *
     * This phone may not be in the directory yet - one that signed in a moment
     * ago has not been listed - so we always wrap for ourselves. Posting
     * something we cannot open is the one failure with no way back.
     */
    suspend fun sealStatus(
        caption: String?,
        media: ByteArray?,
        audience: List<AccountKeyRecipient>,
    ): SealedStatus {
        val open = currentVault()
        val identity = open.current
        val key = Crypto.generateChannelKey()
        val mine = DeviceIdentity.id()
        val recipients = if (audience.any { it.userId == userId }) {
            audience
        } else {
            audience + AccountKeyRecipient(
                userId.orEmpty(),
                identity.publicKey,
                identity.generation,
            )
        }

        val keys = recipients.mapNotNull { who ->
            runCatching {
                val wrapped = Crypto.wrapChannelKey(key, identity.privateKey, who.publicKey)
                StatusKeyEntry(
                    recipientUserId = who.userId,
                    // Per account, so a friend who signs in on a new phone an
                    // hour from now still opens this post. Per device it was a
                    // day-long version of the bug that lost conversations.
                    recipientDeviceId = ACCOUNT_SCOPE,
                    senderPublicKey = identity.publicKey,
                    wrappedKey = wrapped.wrappedKey,
                    iv = wrapped.iv,
                )
            }.getOrNull()
            // A directory row with a malformed public key must not stop the
            // post being sealed for everybody else.
        }

        // Epoch 0 in the envelope: a status has no generations, and the field
        // is there because the shape is shared with messages.
        val sealedCaption = caption?.takeIf { it.isNotBlank() }?.let {
            val sealed = Crypto.encrypt(it, key)
            JSONObject()
                .put("v", 1)
                .put("epoch", 0)
                .put("iv", sealed.iv)
                .put("ct", Crypto.base64(sealed.ciphertext))
                .toString()
        }
        return SealedStatus(
            caption = sealedCaption,
            media = media?.let { Crypto.encryptBytes(it, key) },
            keys = keys,
            senderDeviceId = mine,
        )
    }

    /**
     * The key to one post, from whichever wrap this phone's private half opens.
     *
     * Null rather than a throw for the ordinary cases: a post written before
     * this device existed, or before the friendship did, carries no wrap for
     * us. Both happen, and neither is an error.
     */
    suspend fun statusKey(post: StatusEntry): String? {
        if (post.keys.isEmpty()) return null
        currentVault()
        for (wrap in post.keys) {
            for (privateKey in privateHalves()) {
                val opened = runCatching {
                    Crypto.unwrapChannelKey(
                        Crypto.Wrapped(wrap.wrappedKey, wrap.iv),
                        privateKey,
                        wrap.senderPublicKey,
                    )
                }.getOrNull()
                if (opened != null) return opened
            }
            // Not this half. An account-scoped wrap opens on a keyring
            // generation; one a pre-vault client wrote opens on this device's
            // own key; one addressed to another of our machines opens on
            // neither, which is ordinary.
        }
        return null
    }

    /** A post's caption in the clear, or the placeholder. Never throws. */
    suspend fun openStatusCaption(post: StatusEntry): String? {
        val caption = post.caption ?: return null
        // Written before statuses were sealed. It expires within the day.
        val envelope = parseEnvelope(caption) ?: return caption
        val key = statusKey(post) ?: return UNDECRYPTABLE
        return runCatching { Crypto.decrypt(envelope.ct, envelope.iv, key) }
            .getOrDefault(UNDECRYPTABLE)
    }

    /** A post's media in the clear. Null when this device holds no key for it. */
    suspend fun openStatusMedia(post: StatusEntry, ciphertext: ByteArray): ByteArray? {
        // No IV means it was stored in the clear, before this. Hand it back.
        val iv = post.mediaIv ?: return ciphertext
        val key = statusKey(post) ?: return null
        return runCatching { Crypto.decryptBytes(ciphertext, iv, key) }.getOrNull()
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

        promoteEpochs(channelId, state, latest.promotable)
        fillGaps(channelId, state, latest)
    }

    /**
     * Re-seals epochs this device holds only as pre-vault, per-device wraps,
     * addressing them to the account.
     *
     * This is the rescue, and this device is the only thing that can perform
     * it: those rows were sealed to *this installation's* key, so no server,
     * no other machine and no machine that does not exist yet can open them.
     * Re-addressing them to the account key costs one request and takes that
     * epoch permanently out of reach of losing this phone.
     *
     * It grants nothing to anybody: the wrap goes to the same account that
     * already held it, and the server checks exactly that.
     */
    private suspend fun promoteEpochs(
        channelId: String,
        state: ChannelKeyState,
        epochs: List<Int>,
    ) {
        val open = vault ?: return
        val id = userId ?: return
        val identity = open.current

        for (epoch in epochs) {
            val at = "$channelId#$epoch"
            if (!promoted.add(at)) continue
            // An epoch this device cannot open is not one it can promote -
            // which is the honest boundary of the rescue: a pre-vault epoch
            // whose only wrap went with a machine that no longer exists is not
            // recoverable by anybody, and this is where that becomes visible
            // rather than where it is fixed.
            val key = state.keys[epoch] ?: run { promoted.remove(at); continue }
            val done = runCatching {
                shareKey(
                    channelId,
                    epoch,
                    key,
                    listOf(AccountKeyRecipient(id, identity.publicKey, identity.generation)),
                )
            }.isSuccess
            if (!done) promoted.remove(at)
        }
    }

    /**
     * Promotes everything this device can, across every channel it can see.
     *
     * Run once per sign-in rather than waiting for somebody to open each
     * channel, because the window closes when this phone is wiped: a channel
     * nobody has opened in six months is exactly the one most likely to go
     * with it.
     */
    suspend fun promoteEverything() {
        runCatching {
            for (channelId in BetweenUsApi.channelsWithKeys()) {
                runCatching {
                    val state = ensureChannelKey(channelId)
                    promoteEpochs(channelId, state, BetweenUsApi.channelKeys(channelId).promotable)
                }
                // One channel's failure is not a reason to stop rescuing the
                // rest, and the next sign-in tries again.
            }
        }
    }

    /**
     * Hands epochs this device holds to members who are owed them.
     *
     * Far smaller than it was. It used to hand every epoch to every *other
     * machine of the same account*, one at a time, whenever this one happened
     * to open the channel - which is why history arrived late, partially, or
     * never. An account-scoped wrap needs no such repair, so what is left is
     * the current epoch for anybody uncovered, and the one deliberate
     * exception: a member let in *with* the history.
     *
     * Failures are per epoch and never fatal: a racing rotation or a member
     * removed between the read and the write fails one wrap, and neither is a
     * reason to stop opening the channel.
     */
    private suspend fun fillGaps(channelId: String, state: ChannelKeyState, latest: ChannelKeys) {
        state.keys[state.epoch]?.let { key ->
            if (latest.missingRecipients.isNotEmpty()) {
                runCatching { shareKey(channelId, state.epoch, key, latest.missingRecipients) }
            }
        }

        for (gap in latest.gaps) {
            // An epoch we cannot open is not ours to hand out, and the server
            // would refuse it anyway: only a holder may add to an existing one.
            val key = state.keys[gap.epoch] ?: continue
            if (gap.recipients.isEmpty()) continue
            runCatching { shareKey(channelId, gap.epoch, key, gap.recipients) }
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
     * Called when a machine that had forked takes the account identity back,
     * and when the account identity rotates. The keys are still valid, but
     * they are the *subset* the old identity could reach, and both caches
     * would go on serving that subset while the wraps the new identity can
     * open sat unread in the directory.
     */
    private fun forgetAllKeys() {
        channels.clear()
        rekeyed.clear()
        missedEpochs.clear()
        userId?.let { runCatching { store.removeByPrefix("channelkeys:$it:") } }
    }

    private suspend fun loadChannelKey(channelId: String): ChannelKeyState {
        currentVault()
        var response = BetweenUsApi.channelKeys(channelId)
        var keys = openKeys(response.keys)

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
            keys = openKeys(response.keys)
        }

        if (!keys.containsKey(response.epoch)) throw MissingChannelKeyError()

        // Members who joined after the key was minted cannot read anything
        // until a holder re-wraps it for them. We hold it, so we do it.
        if (response.missingRecipients.isNotEmpty()) {
            keys[response.epoch]?.let {
                runCatching { shareKey(channelId, response.epoch, it, response.missingRecipients) }
            }
        }

        val state = ChannelKeyState(response.epoch, keys)
        // And whatever this device alone can still rescue on this channel.
        runCatching { promoteEpochs(channelId, state, response.promotable) }
        return state
    }

    /**
     * Opens every entry sealed for us, keyed by epoch.
     *
     * Tried against every private half this device has, and the list is the
     * design rather than a shotgun: every generation in the keyring, so a
     * rotation leaves the history readable, and then this device's own key, so
     * pre-vault rows addressed to this installation still open - which is what
     * makes promoting them possible.
     */
    private fun openKeys(entries: List<ChannelKeyEntry>): MutableMap<Int, String> {
        val keys = mutableMapOf<Int, String>()
        val halves = privateHalves()
        for (entry in entries) {
            if (keys.containsKey(entry.epoch)) continue
            for (privateKey in halves) {
                val opened = runCatching {
                    Crypto.unwrapChannelKey(
                        Crypto.Wrapped(entry.wrappedKey, entry.iv),
                        privateKey,
                        entry.senderPublicKey,
                    )
                }.getOrNull()
                if (opened != null) {
                    keys[entry.epoch] = opened
                    break
                }
            }
            // A row addressed to another of our machines opens on none of
            // them, which is ordinary: skip it, keep the rest.
        }
        return keys
    }

    /**
     * Mints an epoch for a channel this device holds no key for - one nobody has
     * keyed, or one that was keyed before we were a member.
     */
    private suspend fun createChannelKey(channelId: String, epoch: Int) {
        val open = currentVault()
        val identity = open.current
        val key = Crypto.generateChannelKey()
        val members = BetweenUsApi.channelRecipients(channelId)

        // Our own entry may not be in the directory yet on an account whose
        // vault was created a moment ago. Minting a key we cannot open - or,
        // with an empty directory, publishing nothing at all - leaves the
        // channel unkeyed and the sender told there is no key, so always seal
        // one for ourselves.
        val recipients = if (members.any { it.userId == userId }) {
            members
        } else {
            members + AccountKeyRecipient(
                userId.orEmpty(),
                identity.publicKey,
                identity.generation,
            )
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

    /**
     * Seals one channel key for every account that should hold it.
     *
     * One wrap per person rather than per machine, which is the change this
     * whole file exists for: somebody signed in on a laptop and a phone gets
     * one entry, openable by both, and by the tablet they set up next month.
     */
    private suspend fun shareKey(
        channelId: String,
        epoch: Int,
        key: String,
        recipients: List<AccountKeyRecipient>,
    ) {
        if (recipients.isEmpty()) return
        val identity = currentVault().current
        val entries = recipients.mapNotNull { recipient ->
            runCatching {
                val wrapped = Crypto.wrapChannelKey(key, identity.privateKey, recipient.publicKey)
                ChannelKeyEntry(
                    recipientUserId = recipient.userId,
                    // Never a machine. The server refuses anything else, and a
                    // client that wrote one would rebuild the old failure
                    // channel by channel, invisibly, because it all reads
                    // correctly on the device that wrote it.
                    recipientDeviceId = ACCOUNT_SCOPE,
                    senderUserId = userId.orEmpty(),
                    senderDeviceId = DeviceIdentity.id(),
                    senderPublicKey = identity.publicKey,
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
