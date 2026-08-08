# End-to-end encryption

How Nexora keeps message text and call media out of the server's reach, what
that buys, and — just as important — what it does not.

## Threat model

Protected against: a reader of the database, of a backup, of Redis, of the
Nginx logs, or of the LiveKit SFU's memory. None of them holds a key that opens
a message or a media frame.

Not protected against: a compromised client (the keys live there), and
metadata. The server still knows who wrote to which channel and when, how big
each message was, and who is in a call. Encrypting metadata is a different
project; see "Not covered" below.

## Pieces

| Piece | Where it lives | Who can read it |
| --- | --- | --- |
| Device identity key (ECDH P-256) | private half on the device, sealed by the OS keychain | that device |
| Device public key | `device_keys` table | everyone in the workspace |
| Channel key (AES-256-GCM) | in memory on member devices | channel members |
| Wrapped channel key | `channel_keys` table | only the recipient it was sealed for |
| Message body | `messages.content` | channel members |
| Call media | LiveKit frames | call participants |

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

join a call
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

## What the server enforces

The server is a courier. It cannot read key material, so its only job is to
decide who may publish it:

- Only a channel member may read or publish keys for that channel.
- A new epoch must be exactly `current + 1` — no jumping ahead.
- Adding entries to an existing epoch requires already holding that epoch's key,
  so a member cannot overwrite a channel's key with one of their own.
- Existing entries are never overwritten.
- Recipients must be members of the channel's workspace.

## Calls

A call reuses its channel's key, so joining needs no second exchange: whoever
can read the channel can join its call. LiveKit encrypts frames in a worker via
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
   call participation.
6. **Attachments are not encrypted yet** — uploads still go to storage as they
   were sent.

## Not covered

Metadata privacy, sealed sender, forward secrecy (no ratchet: one key per epoch
opens every message in that epoch), and post-compromise security. Getting those
means a Double Ratchet per conversation, which is a project of its own rather
than a tweak to this one.
