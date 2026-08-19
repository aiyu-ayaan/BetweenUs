# End-to-end encryption

How BetweenUs keeps message text and voice/video media out of the server's reach, what
that buys, and — just as important — what it does not.

## Threat model

Protected against: a reader of the database, of a backup, of Redis, or of the
Nginx logs. None of them holds a key that opens a message, and none of them is
in the media path at all - call media goes directly between the two clients, so
there is no server copy of it to read.

Not protected against: a compromised client (the keys live there), and
metadata. The server still knows who wrote to which channel and when, how big
each message was, and who is in a voice channel. Encrypting metadata is a different
project; see "Not covered" below.

One boundary moved when identity backup arrived, and it is worth stating plainly
rather than burying in "Recovery": the backup is sealed with a key derived from
the account password, and the account password is something a *live* server sees
at sign-in — it is what the login endpoint checks. So a **stolen database still
opens nothing** (passwords are stored as bcrypt hashes, and the backup is
ciphertext), but a **malicious or compromised running server** could capture a
password as it is used and open that user's backup from then on. Anyone whose
threat model includes the running deployment should set a recovery passphrase in
settings instead; it is never sent anywhere in any form.

## One key per machine, not one per account

The directory used to hold one key per account, restored onto every machine
that signed in. Two things followed and both were bad. A machine could not be
revoked - there was nothing to revoke but the identity every other machine was
also using - and a channel key was wrapped for an *identity*, so "who can open
this" was a question the directory could not answer.

It is a list now: one row per installation, with a client-minted device id, a
label, and a revocation stamp. A channel key is wrapped once per device.

A machine that arrives later is wrapped for later. `GET /api/v1/e2ee/keys/:channelId`
answers two questions rather than one: who is missing the *current* epoch, and
who is missing *any* epoch their owner already holds on another machine. The
first keeps the next message readable. The second is what lets a phone signed in
today read what was said before it existed - without it, a second device holds
one epoch, cannot repair itself because it holds none of the others, and nobody
is looking on its behalf, so it mints a fresh epoch and the whole conversation
before that moment is a padlock for good.

"their owner already holds it" is the boundary and it is load-bearing. Without
it the same mechanism would hand a year of history to somebody who joined
yesterday, which is the opposite of the rule everything else here keeps. With
it, the only thing repaired is one person's access on their own second machine -
messages they can already read on the laptop in the next room. It also needs no
new permission: the server already lets a holder add entries to an existing
epoch, so the gap list is somebody noticing rather than somebody being trusted.

What it does need is a machine that holds those keys to open the channel once.
Any member's device will do - the wraps are addressed per device, so whoever
holds the epoch can seal it for the machine that is missing it - but until one
of them does, the padlocks stay.

**Revoking** deletes the wraps addressed to that device and stops it being
sealed for again; the row stays, because when a machine stopped being trusted is
the only thing anybody can audit afterwards. Every channel it could read then
re-keys, and that staleness is derived rather than recorded: an epoch is stale
when a device of a current member was revoked *after* the epoch was minted. It
cannot be derived from the wraps, because revoking deletes them - which is most
of what revoking is.

Registering a revoked device id again is refused rather than quietly clearing
the flag. A machine that can un-revoke itself makes revocation a suggestion, and
the machine in question is running this same code.

**What revocation does not do.** It does not reach what that machine already
decrypted - nothing server-side can - and it does not stop a machine that still
holds a valid session from starting again as a *new* device: it would have to be
reinstalled, and nothing here can tell that apart from a genuinely new laptop.
Ending the session is what answers that. Revoking a key and revoking a session
are two different actions and both are needed.

## Pieces

| Piece | Where it lives | Who can read it |
| --- | --- | --- |
| Device identity key (ECDH P-256) | private half on each signed-in machine, sealed by the OS keychain | that machine |
| Device public keys, one row per machine | `device_keys` table | everyone in the server |
| Sealed identity backup | `identity_backups` table | whoever knows the account password or recovery passphrase |
| Channel key (AES-256-GCM) | in memory on member devices | channel members |
| Wrapped channel key | `channel_keys` table | only the recipient it was sealed for |
| Message body | `messages.content` | channel members |
| Attachment bytes | object storage | channel members (the bytes need a session to fetch and the channel key to read) |
| Voice/video media | DTLS-SRTP, directly between the two peers | the two people on that connection |
| DTLS fingerprint signature | in the offer/answer, HMAC'd with the channel key | verifiable by channel members only |
| Avatars and server icons | object storage | **anyone with the URL** - they are served without authentication on purpose, because an `<img>` tag cannot carry one |

## Flow

```
sign-in
   |
   +-- identity key in this machine's keychain?
   |      yes -> use it
   |      no  -> GET /api/v1/e2ee/backup
   |               backup exists, secret to hand -> open it, keep it
   |               backup exists, no secret      -> ask (never mint a new one)
   |               no backup                     -> generate, PUT /api/v1/e2ee/backup
   |
   +-- publish this machine's public half POST /api/v1/e2ee/devices
   |      (device id minted by the client, stable per installation)
   |
open a channel
   |
   +-- fetch wrapped keys                 GET  /api/v1/e2ee/keys/:channelId
   |
   +-- channel has no key yet?
   |      generate AES-256 key, epoch 1
   |      fetch member public keys        GET  /api/v1/e2ee/devices?channelId=
   |      seal it once per member         POST /api/v1/e2ee/keys
   |
   +-- members missing this epoch?
   |      seal the key for them too       POST /api/v1/e2ee/keys
   |
   +-- another machine of a member missing an *older* epoch we hold?
   |      seal that one for it too        POST /api/v1/e2ee/keys
   |      (never for somebody who does not already hold that epoch)
   |
   +-- unwrap -> channel key in memory

send a message                     read a message
   AES-GCM encrypt                    AES-GCM decrypt with the epoch's key
   POST ciphertext envelope            epoch not held? re-read the directory once
                                       still not held -> placeholder text

join a voice channel
   channel key -> HMAC over this peer's DTLS fingerprint
   the far peer verifies it, then media flows directly
   no server is in the media path to forward anything
```

### Key wrapping

`ECDH(sender private, recipient public)` → `HKDF-SHA256` → AES-256-GCM key,
used to seal the channel key with a fresh random IV. HKDF matters: the raw ECDH
output is a curve point, not uniform key material.

The salt is fixed and the `info` string domain-separates this use of the pair's
shared secret (`betweenus/e2ee/v1/channel-key-wrap`). That is safe here because the
pair is static and every wrap uses its own IV.

### Identity backup

The identity key used to exist in exactly one place: the keychain of the machine
that generated it. That made "clear the app data" and "lose every message you
have ever been sent" the same action, and a second machine a second identity
that no existing `channel_keys` row was sealed for.

So the key is sealed once and stored where the account can reach it:

```
PBKDF2-SHA256(secret, salt, 600 000)  ->  AES-256-GCM key
AES-256-GCM(key, iv, JSON of the ECDH key pair)  ->  identity_backups.ciphertext
```

The `secret` is the account password — so signing in anywhere restores the key
with no extra step, because the password is already in hand at that moment — or
a recovery passphrase the user sets in settings, which is the only option for an
account that signs in with a provider and has no password at all. Which one a
backup expects is in `identity_backups.kind`, so a client knows what to ask for
before asking.

Rules the client follows, each of them one-way-destructive if broken:

- **A failed fetch never becomes a new identity.** Only a definite "this account
  has no backup" starts a fresh key. Treating a network error as "no backup"
  would replace the published public key, and every channel key already sealed
  for the old one would stop opening — permanently, because nothing re-seals
  history.
- **No secret means ask, not guess.** A launch from a stored refresh token has
  no password to hand, so the app prompts (and takes "not now" for an answer)
  rather than minting a key that reads as working until every message shows the
  lock placeholder.
- **A password change re-seals the backup.** Otherwise the next machine gets a
  blob keyed to a password nobody has any more.

What this does not do is give one account two *different* identities: every
machine ends up holding the same key pair. That keeps the wrapping model
untouched — one public key per user, one wrap per member — at the cost of the
property real multi-device designs have, where losing one device does not mean
handing over the whole account. See "Known limits".

### Wire format

`messages.content` holds a JSON envelope, opaque to every service:

```json
{ "v": 1, "epoch": 1, "iv": "<base64 12 bytes>", "ct": "<base64 ciphertext+tag>" }
```

Anything that is not a valid envelope renders as-is, so rows written before
E2EE still display.

The *plaintext* inside that envelope is the message text on its own, unless the
message carries files. Then it is a JSON document behind a marker beginning
with a NUL — a character a textarea cannot produce, so no typed message can
impersonate one:

```
\u0000betweenus-body:1
{ "text": "look at this", "attachments": [ { "key": "...", "iv": "...", "epoch": 1,
  "name": "holiday.jpg", "contentType": "image/jpeg", "size": 812345 } ] }
```

Because the manifest is inside the ciphertext, the server does not learn a
file's name, its type, or its plaintext size — only that some bytes were
uploaded and some ciphertext was stored.

## Attachments

A file is sealed under the channel key before it is uploaded, with its own
nonce and the same epoch bookkeeping a message has. What reaches the server is
a blob it cannot type, which is exactly why a channel can carry any file at
all: there is nothing left to allowlist, and nothing that could be served in a
way a browser would execute. Attachments are always served as
`application/octet-stream` with `Content-Disposition: attachment`, and the
client fetches, decrypts and renders them itself.

Compression happens before encryption, because ciphertext does not compress:
an oversized photo is redrawn to 1920px JPEG, a video picked on Android is
re-encoded to 720p H.264, and text-shaped files are gzipped - all in the client.
(Desktop and web do not re-encode video: there is no way to do it in a browser
that is not shipping a codec into the bundle, so a clip sent from there is
whatever was picked.) HEIC — what a phone camera writes by default — is decoded
in the client by libheif compiled to WebAssembly and converted whatever its
size, because no browser engine can draw one. Both ends run through that
conversion: a HEIC picked on this machine becomes a JPEG before it is sent, and
one already sent from a phone becomes a JPEG after it is decrypted. A file too large for one request goes up in parts; the
parts are slices of the same single ciphertext, so a part on its own is not
separately decryptable.

**Avatars and server icons are not encrypted.** They cannot be: a member list
has to render them for people who hold no channel key, and a direct-message
list has to render them for someone who was never in a channel with you at all.
So they are stored in the clear, checked against a raster-image allowlist on
the way in, and served inline — the only objects in the system that are. Do not
put anything private in a profile picture.

## What the server enforces

The server is a courier. It cannot read key material, so its only job is to
decide who may publish it:

- Only a channel member may read or publish keys for that channel.
- A new epoch must be exactly `current + 1` — no jumping ahead.
- Adding entries to an existing epoch requires already holding that epoch's key,
  so a member cannot overwrite a channel's key with one of their own.
- Existing entries are never overwritten.
- Recipients must be members of the channel's server.
- An identity backup is readable and writable only by its owner, and only in
  the shape the DTO allows — including a PBKDF2 iteration floor, the one number
  in the blob that decides what stealing the table is worth.

One rule is the client's rather than the server's, and it belongs next to these
because leaving it out breaks the same thing they protect: **a client that meets
an epoch it holds no key for re-reads the directory once before giving up.**

A member who joins after a channel was keyed mints the next epoch rather than
waiting to be re-wrapped for. Without the re-read, every client already in the
channel stays cached an epoch behind: it draws the newcomer's messages as a
padlock, and keeps *sending* under the old epoch, so the newcomer cannot read
the reply either and the conversation quietly splits in two. The re-read finds
the key the newcomer sealed for them and moves them onto the newer epoch, which
is what makes the next message work in both directions.

## Voice channels

Call media goes directly from one participant to another over DTLS-SRTP. There
is no server in the path, so "end to end" is not a layer added on top of the
transport - it *is* the transport, and nothing between the two machines ever
holds a decodable frame.

What that alone would not stop is the signalling server. `call-service` relays
the offers and answers, and an offer contains the DTLS fingerprint the far side
will trust; a malicious one could substitute its own fingerprint for each side
and sit in the middle of a connection both ends believe is direct.

So the channel key is still used, for one small thing: each peer sends
`HMAC-SHA256(channel key, its own DTLS fingerprint)` alongside the offer or
answer, and the receiver recomputes it before accepting. `call-service` has
never held a channel key, so it cannot forge the signature for a fingerprint of
its own, and a substituted one is rejected before any media flows.

This replaces the insertable-streams encryption the SFU design needed. The
guarantee is the same one; there is simply no longer a hop to keep frames from.

## Known limits

1. **One identity per user, copied to each machine.** Signing in elsewhere
   restores the same key pair rather than enrolling a second device, so the
   directory stays one public key per user and a sender wraps once per member.
   The costs are the ones that model has: there is no per-device revocation (a
   machine that had the account had the account key), the account password is
   as strong as the backup is, and a device cannot be un-enrolled without
   rotating the identity and re-sealing every channel key — which nothing does
   yet. Per-device identities with a wrap per device is the upgrade, and it is
   a bigger one than it looks: every `channel_keys` row becomes per device.
2. **No key rotation on member removal.** The epoch mechanism exists and the
   server enforces its ordering, but nothing mints epoch 2 yet, so a removed
   member who kept the key can still read future messages they can fetch.
   Rotation on removal is the next step.
3. **No identity verification.** Nobody compares safety numbers, so a server
   that lies about a public key could read new messages. Fingerprint display
   and verification is not built.
4. **Packaged builds load over `file://`**, which is not a secure context, so
   insertable streams may be unavailable there. Development (`http://localhost`)
   is a secure context and works.
5. **Metadata is plaintext**: author, channel, timestamps, message sizes,
   voice-channel membership.
6. **Avatars and server icons are plaintext**, by necessity — see
   "Attachments" above.
7. **An attachment is sealed in one operation**, so the client holds the whole
   file in memory while it encrypts, which is why it refuses files over
   `MAX_ATTACHMENT_BYTES`. Chunked AEAD — one sealed frame per upload part —
   is the upgrade if larger files are wanted.
8. **Nothing deletes an attachment's blob.** Deleting a message drops the
   manifest that names it; the ciphertext stays in storage until something
   sweeps it.
9. **Reactions are plaintext.** The emoji, and who chose it, are ordinary
   columns the server reads. Encrypting them would mean sealing a thumbs-up for
   every recipient - a key exchange per reaction - and the server would still
   have to count them for a client that has not fetched the channel key yet. So
   this is a deliberate leak, and a narrow one: a reaction says how somebody
   felt about a message whose text the server still cannot read. Anyone who
   would rather not publish that should not use a reaction.
10. **An edit destroys what it replaces.** The new envelope overwrites the old
    one, so there is no edit history and no way to recover the previous text -
    which is what most people expect from "edit", and what the alternative
    (keeping every version server-side) would quietly break.
11. **Search happens in the client**, over the history that window has already
    decrypted. The server cannot search ciphertext, and giving it the means to
    would be the end of the design; the panel says how far its search reached
    rather than pretending to cover the whole channel.

12. **A remote-desktop session is encrypted end to end, but its fingerprints are
    unverified.** The screen goes directly from the agent to the controller over
    DTLS-SRTP, so no server holds a decodable frame - that much is the same
    guarantee a call has, and it is better than the SFU design, where the
    operator's own container could decrypt the screen.

    What a remote session does *not* have is the fingerprint signature a call
    has. A call binds its fingerprints with the channel key, which the server
    has never seen; the two machines in a remote session share no such secret,
    so `remote-gateway` relays their fingerprints unverified and a malicious
    gateway could substitute its own. Closing that means a key agreed between
    agent and controller without the gateway learning it - a short-authentication
    -string comparison, or enrolment pinning the agent's key - and it is a phase
    of its own. Until then: a remote session trusts the deployment's gateway not
    to actively attack it, which is worth knowing before pointing one at a
    machine you care about.

13. **A second machine recovers history only once a machine that already holds
    it comes online.** The wraps are addressed per device, so nothing but a
    holder can seal an epoch for the machine missing it - and the server cannot,
    having never held one. Any member's device does the repair, the next time
    one of them opens the channel; until then the padlocks stay. There is no
    offline path here and there cannot be one.

## Porting this to a web or Android client

Nothing here is Electron-shaped. Every algorithm is one a browser's WebCrypto
and Android's `javax.crypto` / Tink both have, and every blob crosses the wire
as base64 in JSON, so a second client is an implementation of this page rather
than a change to the server.

| Step | Primitive | Parameters |
| --- | --- | --- |
| Identity | ECDH P-256, exported as JWK JSON | `{ publicKey, privateKey }`, both JWK strings |
| Backup key | PBKDF2-HMAC-SHA256 | 600 000 iterations, 16-byte random salt, 256-bit output |
| Backup seal | AES-256-GCM | 12-byte random IV, plaintext is the JSON above |
| Channel-key wrap | ECDH → HKDF-SHA256 → AES-256-GCM | 32 zero bytes of salt, `info` = `betweenus/e2ee/v1/channel-key-wrap` |
| Message / file seal | AES-256-GCM | 12-byte random IV, key is the channel key for that epoch |

The server contract is six routes, all of them couriers:

```
POST /api/v1/e2ee/devices        publish this account's public key
GET  /api/v1/e2ee/devices?channelId=   member public keys for a channel
GET  /api/v1/e2ee/keys/:channelId      wrapped keys addressed to the caller
POST /api/v1/e2ee/keys                 publish wrapped keys for others
GET  /api/v1/e2ee/backup               the caller's sealed identity, or null
PUT  /api/v1/e2ee/backup               replace it
```

Two things a new client must get right, because the server cannot check either:
the sign-in rules under "Identity backup" above (a failed fetch is not "no
backup"), and the NUL-prefixed `betweenus-body:1` marker for messages that carry
attachments. Everything else is shape the DTOs already enforce.

One of those shapes is worth naming here rather than leaving to a 400, because
of how it fails. `POST /api/v1/e2ee/keys` requires `senderDeviceId` on the
*bundle*, beside `channelId` and `epoch`, as well as the per-entry recipient
fields. A client that omits it can still read a channel key somebody else
minted and cannot mint one itself - so it works perfectly until it is the first
client into a new channel, and then a brand-new account cannot send its first
message. The Android client shipped with exactly that.

Private-key storage is the one platform-specific part: the Electron client
seals it with `safeStorage` (the OS keychain). The equivalents are the Android
Keystore, and — for a web client, which has no keychain — IndexedDB holding a
non-extractable `CryptoKey`, with the understanding that anything with script
access to the origin has the key. A web client that would rather not persist it
at all can hold the identity in memory and re-open the backup on each load,
which is exactly what the backup makes possible.

A client that caches messages locally has a second thing to store: the channel
keys. The Android client does, because a cached envelope with no key on hand is
a conversation that opens instantly and then says it cannot be read. They go
wherever the identity goes — the Keystore-sealed store on Android — and never
into the message cache itself, which is what keeps that cache worth exactly
what the server's own rows are worth. Keys held across restarts are also keys
that can be an epoch behind, so a client that persists them has to re-read the
directory when it opens a channel and take the newer epoch when there is one.

## Not covered

Metadata privacy, sealed sender, forward secrecy (no ratchet: one key per epoch
opens every message in that epoch), and post-compromise security. Getting those
means a Double Ratchet per conversation, which is a project of its own rather
than a tweak to this one.
