# End-to-end encryption

How Nexora keeps message text and voice/video media out of the server's reach, what
that buys, and — just as important — what it does not.

## Threat model

Protected against: a reader of the database, of a backup, of Redis, of the
Nginx logs, or of the LiveKit SFU's memory. None of them holds a key that opens
a message or a media frame.

Not protected against: a compromised client (the keys live there), and
metadata. The server still knows who wrote to which channel and when, how big
each message was, and who is in a voice channel. Encrypting metadata is a different
project; see "Not covered" below.

## Pieces

| Piece | Where it lives | Who can read it |
| --- | --- | --- |
| Device identity key (ECDH P-256) | private half on the device, sealed by the OS keychain | that device |
| Device public key | `device_keys` table | everyone in the server |
| Channel key (AES-256-GCM) | in memory on member devices | channel members |
| Wrapped channel key | `channel_keys` table | only the recipient it was sealed for |
| Message body | `messages.content` | channel members |
| Attachment bytes | object storage | channel members |
| Voice/video media | LiveKit frames | people in the voice channel |
| Avatars and server icons | object storage | **anyone with the URL** |

## Flow

```
sign-in
   |
   +-- load identity key from the OS keychain (generate one on first run)
   +-- publish the public half            POST /api/v1/e2ee/devices
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
   +-- unwrap -> channel key in memory

send a message                     read a message
   AES-GCM encrypt                    AES-GCM decrypt with the epoch's key
   POST ciphertext envelope            no key for that epoch -> placeholder text

join a voice channel
   channel key -> LiveKit ExternalE2EEKeyProvider
   the SFU forwards frames it cannot decode
```

### Key wrapping

`ECDH(sender private, recipient public)` → `HKDF-SHA256` → AES-256-GCM key,
used to seal the channel key with a fresh random IV. HKDF matters: the raw ECDH
output is a curve point, not uniform key material.

The salt is fixed and the `info` string domain-separates this use of the pair's
shared secret (`nexora/e2ee/v1/channel-key-wrap`). That is safe here because the
pair is static and every wrap uses its own IV.

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
\u0000nexora-body:1
{ "text": "look at this", "attachments": [ { "key": "...", "iv": "...", "epoch": 1,
  "name": "holiday.webp", "contentType": "image/webp", "size": 812345 } ] }
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
an oversized photo is redrawn to 1920px webp and text-shaped files are gzipped,
both in the client. A file too large for one request goes up in parts; the
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

## Voice channels

A voice channel reuses its channel's key, so joining needs no second exchange: whoever
can read the channel can join its voice room. LiveKit encrypts frames in a worker via
`ExternalE2EEKeyProvider`, and the join is aborted rather than downgraded if the
runtime cannot do insertable streams.

## Known limits

1. **One device per user.** A second device generates a new identity and cannot
   read history sealed for the first. Multi-device needs a per-device key list
   and wrapping per device.
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

## Not covered

Metadata privacy, sealed sender, forward secrecy (no ratchet: one key per epoch
opens every message in that epoch), and post-compromise security. Getting those
means a Double Ratchet per conversation, which is a project of its own rather
than a tweak to this one.
