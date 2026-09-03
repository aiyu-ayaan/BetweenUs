---
sidebar_position: 1
---

# Database Schema

Source of truth: [`packages/database/prisma/schema.prisma`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/packages/database/prisma/schema.prisma).
One Prisma schema for the MVP, shared by auth-, server- and chat-service —
each service touches only the models it owns; splitting per service later is
a migration, not a rewrite, because every model is already accessed only by
its owning service's code paths.

## Entity relationship diagram

One diagram for all 22 models reads as a wall of boxes — every field zooms
to unreadable no matter how far you pan out. Split by domain instead, each
diagram placed next to the section it belongs to.

## Identity & auth

```mermaid
erDiagram
    User ||--o{ RefreshToken : has
    User ||--o{ DeviceKey : "has (E2EE identity)"
    User ||--o{ DeviceToken : "has (push)"
    User ||--o{ IdentityBackup : "backs up identity to (one per secret kind)"
    User ||--o{ UserIdentity : "links OAuth"
    User ||--o{ Friendship : "is party to"
    User ||--o{ UserBlock : "blocks / is blocked by"
    User ||--o{ PasswordReset : "may recover with"
```

### `User`
The account. `passwordHash` is `'oauth-only'` for a provider-created account
that has never set a password — no hash can match that sentinel, which is
what makes a provider-only account correctly refuse password login rather
than silently accepting one. `role` (`GlobalRole`: `USER` / `ADMIN`) is
separate from any `ServerRole` — it grants the admin panel, not membership
rights inside any particular server. `disabledAt` keeps a disabled account's
data but blocks login and refresh.

`username` is normalised to lower case on every write, which is what makes the
unique index agree with the username login path — signing in already lower-cased
what was typed, so a mixed-case row was one nobody could sign in to by name.

Two markers about the account's own state: `passwordResetUntil` is an
administrator-granted recovery window (see `PasswordReset`), and `chatsClearedAt`
is a floor under everything **this** account can see, in every channel, on every
one of its devices — the per-conversation half of the same idea being
`ChannelRead.clearedAt`.

`messageTtlSeconds` is the same family again: this account's own disappearing
window, one-sided and enforced as a **filter**. History older than the window
is not returned to this account on any of its devices, and every other
participant's copy is untouched. `Server.messageTtlSeconds` outranks it,
because that one deletes the row rather than hiding it.

`coverUrl` is the wide band behind the name at the top of a profile, stored
beside `avatarUrl` rather than derived from it. They are not the same picture:
an avatar is a square read at 32px in a member list, a cover is a 4:1 band read
at several hundred, and scaling one into the other gives a blurred crop of
somebody's face as a backdrop. Nullable, and null means every client draws the
flat accent band it drew before the column existed — so an account older than
this looks chosen rather than broken. `COVER_ASPECT` (4) and `COVER_MAX_WIDTH`
(1600) are shared constants, because three clients crop to them and a profile
whose band is 4:1 on a laptop and 3:1 on a phone is a picture composed for
neither.

Two fields describe the account to other people rather than to itself. `about`
is the line under the name on a profile card — stored in the clear beside
`displayName` and `avatarUrl`, because it is a caption on a name and not a
secret, and defaulted to `Hey, I'm on Between Us.` so that a card nobody has
edited still reads as a card. `NOT NULL` with that default, so an account older
than the column reads as one that never changed it. The DTO caps it at
`ABOUT_MAX_LENGTH` (140).

`lastSeenAt` is nullable and is a **flush target, not the live value**: while
somebody is connected the answer is in `presence:lastseen` in Redis, and
presence-service writes here when their last window closes. Reads take the
later of the two. It is never written while the account is invisible.

`lastSeenVisibility` (`LastSeenVisibility`: `EVERYONE` / `FRIENDS` / `NOBODY`)
decides who may read it. `EVERYONE` is a ceiling rather than the whole world —
presence is already scoped to people who share a server or a friendship — and
`NOBODY` is **reciprocal**: an account that hides its own does not get to read
anybody else's. That rule lives in presence-service and not here, because it is
a decision about a request and there is no request in a column. See
[presence-service](../services/presence-service.md).

### `RefreshToken`
`id` **is** the JWT `jti` — revoking a token is a delete by primary key.
`tokenHash` is stored, never the raw token. `revokedAt` marks reuse-detected
revocation.

### `UserIdentity`
One row per linked OAuth login (`provider` + `providerAccountId` unique
together) — the provider's own user id is what re-identifies the person on
the next login, since their email can change on the provider's side.

### `PasswordReset`
A single-use permission to set a password without knowing the old one. Only
`SHA-256(token)` is stored, for the same reason `RefreshToken` stores a hash: a
leaked dump must not be a pile of live reset links. `source` is `email` (a link
the SMTP server sent) or `admin` (an administrator opened a window on the
account). Spending one marks `usedAt`, clears `User.passwordResetUntil`, and
revokes every session the account had.

### `SmtpSetting`
One row, `id = 'smtp'`. The deployment's outgoing mail server, entered in the
admin panel rather than in the environment, with `password` sealed under
`SETTINGS_SECRET` exactly as an OAuth client secret is. No row — or a row with
`enabled` false — is a deployment that cannot send mail at all, which is a fully
supported deployment: every client then says "ask your administrator".

### `OAuthProvider`
Operator-configured provider credentials (Google/GitHub), one row per
provider name, `clientSecret` sealed with AES-256-GCM.

### `DeviceKey`
One row per **machine**, not per account — an ECDH P-256 public key (JWK).
The private half never leaves that machine. A device can be revoked
independently of the account's identity; a revoked row is kept (not
deleted) so the trust history stays auditable, but nothing new is ever
wrapped for it.

### `IdentityBackup`
The identity private key, sealed client-side (PBKDF2 over a password or
passphrase the server never sees) so signing in on a second machine or
reinstalling doesn't mean losing history. Unique on `(userId, kind)` — one per
secret kind, not one per user, so setting a recovery passphrase no longer
overwrites the password-sealed blob that a fresh sign-in is the only thing
holding the secret for. The server stores opaque ciphertext it cannot open.

### `ChannelKey`
A channel's symmetric content key, wrapped once per `(recipient user,
recipient device)` pair using ECDH between the sender's device key and the
recipient's. The server stores only ciphertext (`wrappedKey`) it cannot
open. `epoch` increments when the channel's membership/key needs to rotate.

## Servers, roles, channels

```mermaid
erDiagram
    User ||--o{ Server : owns
    User ||--o{ ServerMember : "has memberships"
    Server ||--o{ ServerMember : has
    Server ||--o{ Channel : has
    Server ||--o{ ServerInvite : has
    Server ||--o{ ServerCustomRole : has
    Server ||--o{ ServerEmoji : has
    ServerMember }o--o{ ServerCustomRole : "holds (via ServerMemberRole)"
    Channel ||--o{ ChannelMember : "restricts to (if private)"
    Channel ||--o{ ChannelRead : "has read markers"
    Channel ||--o{ ChannelKey : "has wrapped keys"
```

### `Server`
A community — `slug` is the public, permanent join handle (superseded by
`ServerInvite` for anything revocable).

`messageTtlSeconds` is the server's disappearing window: how long a message
sent in its channels lives, or null for for ever. Unlike the account-level
window it is a real **deletion** — the sweeper destroys the row and its blobs
when it closes, for everybody — and that is precisely why it outranks a
member's own setting. A member may choose to see less than the server keeps,
never more. Set with `MANAGE_SERVER`, and only to one of the published windows.

### `ServerMember`
One row per `(server, user)`. `role` is the fixed 5-rung hierarchy
(`OWNER`/`ADMIN`/`MODERATOR`/`MEMBER`/`GUEST`). `grantedPermissions` /
`deniedPermissions` are per-member overrides on top of the role — see
[Auth & Permissions](/system-design/auth-and-permissions) for the resolver.
`historyShared` records that this member was let in *with* what was said
before they arrived; it is `false` unless somebody asked for it, and it is a
note the clients act on rather than a grant the server can make — see
[E2EE](/security/e2ee).

### `ServerCustomRole` / `ServerMemberRole`
Named, coloured, ranked roles a server invents for itself, additive on top
of the fixed role hierarchy. A member can hold any number.

### `ServerInvite`
A revocable, expirable, use-capped code — deliberately not the server's
permanent `slug`, so a leaked invite can be shut off without renaming the
whole server.

### `Channel`
`serverId` is nullable — a `null` server id **is** a direct message.
`type` is `TEXT` / `VOICE` / `DM`. `isPrivate` + `ChannelMember` rows form an
allowlist; server membership grants nothing to a private channel, not even
to an administrator.

### `ChannelMember`
Rows are meaningful only when the channel is private — a public channel
ignores them, so making a channel private later needs no backfill.

### `ChannelRead`
One row per `(user, channel)`, `lastReadAt`. Unread counts are **derived**
from this on every read, never stored as a counter — a counter drifts the
first time some path forgets to decrement it; a marker can't drift.

`clearedAt` is the per-conversation half of `User.chatsClearedAt`: messages
older than it aren't returned to *this* user in *this* channel. It lives here
rather than in a table of its own because this row is already the one thing
keyed on exactly `(user, channel)` — a second table would be the same key, the
same cascade and the same lookup, twice. The two markers are read together and
the later one wins.

### `Friendship`
One row per relationship, not one per direction — `userAId < userBId`
enforced by convention, `requesterId` says who sent it, `status` is
`PENDING`/`ACCEPTED`. Catches two people requesting each other at once via
the unique constraint on the ordered pair.

### `UserBlock`
One account refusing another. **Directional**, unlike `Friendship` — "A blocked
B" and "B blocked A" are two different facts, and either alone has to close the
conversation, so the gate reads both directions. Unique on
`(blockerId, blockedId)`; the extra index on `blockedId` answers "who has blocked
me", which is the question that shuts a channel for the other side.

Blocking deletes the `Friendship` row but never the `Channel`: it holds two
people's history, and unblocking brings the conversation back intact.

### `ServerEmoji`
A server's custom emoji. The picture is served unauthenticated (an `<img>`
tag can't carry a header) — deliberately the one thing this deployment
serves in the clear, because an emoji is drawn a hundred times a screen and
has nothing secret about it.

## Messages & attachments

```mermaid
erDiagram
    Channel ||--o{ Message : has
    User ||--o{ Message : authors
    Message ||--o{ MessageReaction : has
    Message ||--o{ Attachment : claims
    User ||--o{ Attachment : uploads
```

### `Message`
`kind` says what the row is. `USER` — the default, and what every row written
before the column existed is — is a message somebody wrote. `MEMBER_JOIN` is
the conversation noting that somebody joined the server: written by the
server, carrying an empty `content`, drawn by each client from the kind and
the author alone. The server cannot write a `USER` row, because it holds no
key; separating the two by a column rather than by a marker inside the body is
what makes that boundary readable.

`WEBHOOK` is the third kind and the one that carries a body the server *can*
read. `webhookId` points at the [`Webhook`](#webhook) that posted it, and
`content` is **plaintext** — the poster holds no channel key and cannot be given
one. Clients read the kind to draw the "not encrypted" badge, which is what
makes the exception visible rather than silent. Note that `kind` alone no longer
answers "does this row have a body": that question is asked against an
allowlist (`USER`, `WEBHOOK`), so a client that has never heard of a future kind
still draws nothing for it. Testing `kind != USER` is the bug that allowlist
exists to prevent, and both clients had it.

`content` is opaque to the server — a serialized `EncryptedEnvelope`
ciphertext, or plain text before E2EE existed. `deletedAt` + emptied
`content` is a soft-delete tombstone (the row stays so paging cursors that
point at it don't break); `deletedById` distinguishes "author took it back"
from "moderator removed it." `pinnedAt`/`pinnedById` are set independently.

`expiresAt` is when the message stops existing, stamped from the server's
disappearing window **as the message is sent** rather than evaluated on read —
so changing that window governs what is sent next and never reaches back
through a channel. The disappearing sweeper deletes these rows outright rather
than tombstoning them: a conversation that fills with "this message was
deleted" for everything that aged out is not a disappearing conversation, it is
a very detailed index of one.

`viewOnce` marks a one-time message; `viewedAt` records when the **first**
recipient opened it, which is what the backstop expiry is measured from. Who
has looked lives in `MessageView`, one row per person — see below.
The flag lives here, outside the encrypted body, because burning is a row
update and a blob delete — the server's work — and a server that cannot read
the body cannot be told by the body. What it learns is that some message was
one-time, which both clients already draw on screen.

### `MessageReaction`
`emoji` is stored **in the clear** — the one deliberate plaintext leak in
the whole schema, documented in [`E2EE.md`](/security/e2ee), because the
server has to group and count reactions for recipients who don't currently
hold the channel key.

### `MessageView`
One person's one look at a one-time message, unique per `(messageId, userId)`.

A table rather than a single `viewedAt` on the message, because a one-time
message holds as many looks as there are people who can see it. The single
stamp meant the first person to open one in a channel destroyed it for
everybody else, who were then shown "Opened" for something they had never been
given — one look between them, and a race to it.

The message is destroyed once these rows cover the channel's audience minus the
author, who is not a viewer: re-reading what you sent spends nobody's look.

### `Webhook`
A URL an outside system POSTs to in order to say something in a channel;
Discord's shape, so an integration already pointed at Discord works by changing
only the URL. See [Webhooks](../services/webhooks.md) for the full guide.

`tokenHash` is a SHA-256 of the token half of the URL, unique so a delivery is
one indexed lookup rather than a scan. The token itself is shown once, at
creation, and is otherwise rotated rather than re-read — the same rule
`RemoteMachine.agentTokenHash` and `PasswordReset.tokenHash` already follow.
Discord keeps its webhook URLs re-readable; a token a database can be asked for
is a token a database dump hands over.

`createdById` exists because `Message.authorId` is not nullable: a webhook
message is attributed in the database to whoever opened the door, and no client
draws that — they all draw the webhook's own `name` over the top. `lastUsedAt`
is null until something has actually posted, which is the first thing anybody
asks about a webhook that "isn't working".

`Message.webhookId` is `ON DELETE SET NULL`, not `CASCADE`: deleting a webhook
must not delete what it already said. Those rows stay and fall back to the name
frozen onto them. Deleting a webhook closes a door; it does not retract what
came through it.

### `Attachment`
Links a stored blob (`key`, the storage key) to the message that claims it.
Neither foreign key cascades on delete — both go `null` instead, and a
background sweeper collects blobs no message claims any more. This is the
one piece of metadata the server does learn about an attachment: how many
blobs, what size, belong to which message. The file's name, real type and
contents stay sealed inside the encrypted manifest.

Deleting, burning or expiring a message purges its blobs **immediately**, in
the same request. The sweeper stays behind that as the backstop for what the
immediate purge could not reach — storage that was down, a process that died
mid-delete, a row orphaned by somebody else's cascade. It used to be the only
path, and "I deleted that photo" meaning "some time in the next six hours" is
why it is not any more.

## Moments (statuses)

The clients call these **Moments**; the tables, routes and identifiers say
`status`, because renaming them would be a migration for a word.

```mermaid
erDiagram
    User ||--o{ Status : posts
    Status ||--o{ StatusView : "was opened by"
    Status ||--o{ StatusKey : "is sealed for"
    User ||--o{ StatusView : opens
```

### `Status`
A post that expires after 24 hours, read by the author's accepted friends.
`kind` is `PHOTO`, `VIDEO` or `TEXT`; `mediaKey` is the storage key of the
sealed photo or video (rooted at `status/<authorId>/`, null for `TEXT`),
`mediaIv` is the IV it was sealed with, and `mediaType` says what the bytes are
once opened. `caption` is an `EncryptedEnvelope` as JSON — never the words —
while `background` and `durationMs` are metadata the clients draw it with.

Deliberately **not** a [`Message`](#message): it has no channel, no
conversation to belong to, and an audience that is a set rather than a room.
Modelling it as a message in a hidden channel would have meant a channel per
account, a membership row per friend kept in step with the friend list, and a
message table where half the rows are not messages.

`expiresAt` is `createdAt + 24h`, stamped at write time — the same trick
`Message.expiresAt` uses. The read path filters on it, so a post is invisible
the moment it is due whether or not the sweep has run; the sweep only recovers
disk.

**A moment is end-to-end encrypted, and its audience is frozen when it is
posted.** The author mints one key for the post, seals the caption and the file
under it, and wraps that key once per *device* of every friend the post has at
that moment. Sealing something with no channel means choosing between
re-wrapping a key for every new friendship and freezing the audience; freezing
is the choice, and it is also the behaviour wanted — a friend added tomorrow
does not see today's post. See [E2EE](../security/e2ee.md).

### `StatusKey`
One wrap of one post's key, for one device: `recipientUserId`,
`recipientDeviceId`, `senderPublicKey`, `wrappedKey` and `iv`, unique on
`(statusId, recipientDeviceId)` and cascading with the post.

This table **is** the audience. No row means no key, and no key means the post
cannot be read however the friend list looks afterwards. There is no `epoch`,
unlike [`ChannelKey`](#channelkey): a moment is written once and gone in a day,
so there is nothing to rotate.

The server still checks the friend list on every read, because it answers a
different question — unfriending or blocking does not delete a wrap that was
already written, and a post from somebody you have since blocked must leave the
tray.

### `StatusView`
One person's look at one status, unique on `(statusId, viewerId)`. "Seen" is a
fact, not a counter: re-opening a story writes no second row and does not move
the time on the first, so what the author is shown is when somebody first
looked. The author reads these as the viewer list; every other account can only
ever read its own.

## Notifications & devices

```mermaid
erDiagram
    User ||--o| NotificationSetting : configures
    User ||--o{ DeviceToken : "registers (FCM/WebPush)"
```

### `NotificationSetting`
One row per user, written on first change. `mutedChannelIds` /
`mentionOnlyChannelIds` / `mutedUserIds` are plain string arrays — small,
read whole, not worth a join table until a mute needs its own settings.
`quietStartMinute`/`quietEndMinute` are minutes-from-midnight on the
*client's* clock; the server never learns a timezone.

### `DeviceToken`
One row per `(user, deviceId)` for FCM push. `token` is separately unique,
because the same physical device can change accounts (sign out, sign in as
someone else) and must not keep pushing to the old owner.

## Remote desktop

```mermaid
erDiagram
    User ||--o{ RemoteMachine : owns
    User ||--o{ RemoteGrant : "granted access to"
    User ||--o{ RemoteSession : opens
    RemoteMachine ||--o{ RemoteGrant : has
    RemoteMachine ||--o{ RemoteSession : has
    RemoteMachine ||--o{ RemoteAudit : has
    RemoteSession ||--o{ RemoteAudit : has
```

### `RemoteMachine`
`agentTokenHash` is the enrolled agent's credential, hashed like a
password, shown once at enrollment. Rotated by re-enrolling.

### `RemoteGrant`
What one user may do to one machine — `permissions` is a subset of the six
`REMOTE_*` permissions, `expiresAt` nullable for open-ended access. Absence
of a row means **no access at all**; remote permissions are never implied by
a server role.

### `RemoteSession`
`permissions` is **copied** from the grant at session start and never
re-read — the session's authority is frozen, so revoking a grant mid-session
is a decision the gateway makes deliberately (ending the session) rather
than a race against event ordering.

### `RemoteAudit`
Append-only. Nothing in the application updates or deletes a row. Records
enrollment, renames, permission changes, session start/end, and refused
attempts.

### `CallSession`
One row per person per stay in a call, written by `call-service`'s gateway.
`channelName` / `serverName` are snapshots, not joins — a call log is history,
and the entry worth reading back is often the channel that has since been
deleted; a foreign key would remove exactly those rows. The only key is to the
account, so deleting an account takes its log with it.

`bytes`, `bytesSent`, `bytesReceived` and `links` (JSON, one entry per peer
connection) are the **client's own measurements**: media is peer to peer, so
nothing server-side is in the path to count. They are clamped before they are
written. `endedAt` is `null` for a call still running and for a row whose
process died mid-call.

### `AdminAudit`
Same append-only shape, for the admin panel: role changes, disable/enable,
deletion, OAuth provider and SMTP config changes, and password-reset windows
being opened or cancelled. `targetId` goes `null` when the
target account is deleted; `targetLabel` keeps what it was called at the
time, so the log still reads back after the account is gone.
