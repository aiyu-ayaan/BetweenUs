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
| PUT | `/:messageId/pin` | Pin (`MANAGE_MESSAGE` in a server channel, free in a DM) |
| DELETE | `/:messageId/pin` | Unpin |
| POST | `/:messageId/reactions` | React |

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
