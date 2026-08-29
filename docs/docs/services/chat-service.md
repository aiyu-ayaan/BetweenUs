---
sidebar_position: 4
---

# chat-service

Messages, direct messages, friends, E2EE key exchange, and uploads. The
biggest service, and the only one with a WebSocket for message delivery.

## `/ws/chat`

Socket.IO-style JSON messages, not `@nestjs/websockets` decorators — one
gateway class handling frames itself.

| Frame `type` | Direction | What it does |
| --- | --- | --- |
| `ping` | client → server | Keepalive |
| `channel.subscribe` | client → server | Join `channel:<id>` room (access re-checked) |
| `channel.unsubscribe` | client → server | Leave the room |
| `server.subscribe` | client → server | Join `server:<id>` room (membership re-checked) |
| `server.unsubscribe` | client → server | Leave the room |
| `message.created` / `message.updated` | server → client | New message, or an edit/delete/pin/reaction on an existing one |
| `friends.changed` | server → client | Re-fetch the friends list |
| `server.members.changed` | server → client | Re-fetch a server's member list |
| `user.updated` | server → client | A changed profile, carried: `{ id, username, displayName, avatarUrl }` |
| `server.updated` | server → client | A renamed server or a new icon, carried |
| `channel.read` | server → client | Somebody's read marker moved |

`user.updated` is fanned out to everyone entitled to see the account — the
members of every server it is in, everyone it is friends with, and its own other
devices. Friendships stand in for direct messages, because a DM already requires
one. `server.updated` goes to the `server:<id>` room.

See [Events](/system-design/events) for why edits, deletes, pins and
reactions all arrive as one `message.updated` shape.

## `/api/v1/messages`

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/` | Page a channel's history |
| GET | `/unfurl` | Link preview metadata |
| GET | `/pins` | A channel's pinned messages |
| POST | `/` | Send a message |
| PATCH | `/:messageId` | Edit (author only) |
| DELETE | `/:messageId` | Delete (author, or `DELETE_MESSAGE`) |
| POST | `/:messageId/burn` | Report a one-time message opened — destroys it |
| PUT | `/:messageId/pin` | Pin (`MANAGE_MESSAGE` in a server channel, free in a DM) |
| DELETE | `/:messageId/pin` | Unpin |
| POST | `/:messageId/reactions` | React |
| POST | `/clear` | Hide **this account's own** history: one channel, or all |

`/clear` is a filter and never a delete. With a `channelId` it stamps
`ChannelRead.clearedAt`; without one it stamps `User.chatsClearedAt`. History,
pins and the unread count apply whichever marker is **later** as a floor. The
rows stay in the table and the other participant's view does not move.

Two markers rather than one because they answer different questions and neither
subsumes the other: "clear everything" is one write on the account instead of a
fan-out over every channel, and "clear this conversation" is one write on the
row that already exists per `(user, channel)`.

The cut is published as `chats.cleared` — carrying the instant and the
`channelId` it applies to, null for all — to that account's own sockets, because
every device holds a cache of decrypted messages that no refetch would clear. A
scoped clear drops only that channel's cache; dropping the lot would turn one
clear into a spinner on the next several conversations opened.

### How a message stops existing

Four mechanisms, and the difference that matters is **who loses it**. A
*deletion* removes the row for everybody; a *filter* hides it from one account
and leaves every other participant's copy exactly as it was.

| Mechanism | Scope | Tombstone? | Set by |
| --- | --- | --- | --- |
| `DELETE /:messageId` | Everybody | Yes | Author, or `DELETE_MESSAGE` |
| `POST /:messageId/burn` | Everybody | No — row destroyed | Sender, per message |
| `Server.messageTtlSeconds` | Everybody | No — row destroyed | `MANAGE_SERVER` |
| `User.messageTtlSeconds` | One account | Nothing is deleted | The account itself |

A server's window outranks an account's, and that is not a rule anyone
enforces — it falls out of what they are. A deleted row cannot be un-hidden, so
a member may choose to see *less* than the server keeps and never more. What a
client shows is `min(server, personal)`, with "off" meaning no limit.

`Message.expiresAt` is stamped when the message is created, from the server's
window as it stood at that moment. Changing the window governs what is sent
next and never reaches back through a channel.

Deleting, burning and expiring all purge the attachment blobs immediately,
before publishing their event. `AttachmentSweeper` still runs every six hours
as the backstop for what the immediate purge could not reach — it used to be
the only path, and "I deleted that photo" meaning "some time today" is why it
is not any more.

An expiry and a burn leave nothing to draw, so they reach clients as
`message.gone` (a `messageId` and a `channelId`) rather than as a tombstone to
render. A permanent "something was here" marker would tell exactly the story
those two features exist to avoid telling.

### One-time messages

`viewOnce` travels **outside** the encrypted envelope, on the send request.
Burning is a row update and a blob delete, both of which are the server's work,
and a server that cannot read the body cannot be told by the body. What leaks
is that *some* message was one-time — a fact both clients already draw on
screen. It is a documented E2EE exception alongside reaction emoji.

The first non-author viewer wins, settled by a conditional update on
`viewedAt`, so two devices opening at the same instant produce one burn. The
author is not a viewer: re-reading your own message spends nobody's one look.

Clients display it with every copy path they control removed — no download, no
context menu, nothing draggable or selectable, and no thumbnail in the message
list. Android additionally sets `FLAG_SECURE` on the viewer, so the platform
fails the screenshot gesture, records black, and keeps the window out of the
recents thumbnail. **None of that stops a second camera pointed at the screen,
and no software on a device somebody holds can.** The guarantee is that the
file stops existing everywhere the moment it has been seen once, and both
viewers say so rather than implying more.

## `/api/v1/users` and `/api/v1/friends` and `/api/v1/dm`

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/users/search` | Find a user by name (also used to add server members) |
| GET | `/friends` | List friendships |
| POST | `/friends` | Send a friend request |
| POST | `/friends/:userId/accept` | Accept |
| DELETE | `/friends/:userId` | Remove / decline |
| GET | `/dm` | List DM channels |
| POST | `/dm` | Open a DM (friends only) |
| GET | `/blocks` | List accounts this user has blocked |
| POST | `/blocks` | Block an account |
| DELETE | `/blocks/:userId` | Unblock |

### Blocking

`UserBlock` rows are directional — "A blocked B" and "B blocked A" are separate
facts — and the check reads **both** directions. It lives in
`resolveChannelAccess`, so everything downstream of a channel id closes through
one function: history, pins, reactions, calls, typing and read markers.

Blocking ends the friendship in the same transaction but never deletes the
channel: it holds two people's history, and unblocking brings the conversation
back intact. Search, the friend-request endpoint and the DM list all answer
`USER_NOT_FOUND` whichever way the block runs, so neither the block nor its
direction is something the far side can test for.

## `/api/v1/e2ee`

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/devices` | Register this machine's device key |
| GET | `/devices/mine` | List my own devices |
| DELETE | `/devices/:deviceId` | Revoke a device |
| GET | `/backup` | Fetch the sealed identity backup |
| PUT | `/backup` | Store/replace it |
| GET | `/devices` | List another user's devices (for wrapping a new channel key) |
| GET | `/keys/:channelId` | Fetch wrapped channel keys addressed to me |
| POST | `/keys` | Publish newly-wrapped channel keys |

## `/api/v1/uploads`

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/picture` | Avatar / server icon (unencrypted, strict image allowlist) |
| POST | `/` | Single-request attachment upload |
| POST | `/multipart` | Open a multipart session (sealed ticket, no server-side state) |
| POST | `/multipart/part` | Upload one part |
| POST | `/multipart/complete` | Finish and assemble |
| DELETE | `/multipart` | Abort a session |
| GET | `/:key(*)` | Download (always `application/octet-stream`, session-checked) |

Attachments are encrypted client-side before upload and served only as
opaque downloads — see [`E2EE.md`](/security/e2ee).

## Message Markup & Formatting

Messages support full client-side markdown parsing:
- **Lists**: Bulleted (`*`, `-`) and numbered (`1.`) lists. The composer automatically continues lists on `Enter` and terminates on a double `Enter`.
- **Inline marks**: Bold (`**`), italic (`*`), strikethrough (`~~`), inline code (`` ` ``).
- **Blocks**: Fenced code blocks with language highlighting and block quotes (`> `).
- **Composer behavior**: Auto-growing height up to a max cap, text wrapping without horizontal scrolls, and live markup previews.
