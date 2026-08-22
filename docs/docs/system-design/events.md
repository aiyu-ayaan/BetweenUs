---
sidebar_position: 2
---

# Events & Realtime Communication

## REST + WebSocket surface

```text
REST:
  /api/v1/auth
  /api/v1/users
  /api/v1/servers
  /api/v1/channels
  /api/v1/messages
  /api/v1/roles
  /api/v1/permissions
  /api/v1/calls
  /api/v1/remote

WebSocket:
  /ws/chat        text channels, DMs, message events
  /ws/presence    online status, typing indicators
  /ws/call        call signalling: offer/answer/ICE, roster
  /ws/remote      remote-desktop signalling: session, input, offer/answer/ICE
```

`/ws/call` and `/ws/remote` carry **signalling only** — offers, answers, ICE
candidates, and roster/session state. Media never rides a WebSocket; it
negotiates its own WebRTC path directly between peers (see
[Peer-to-Peer Media](/architecture/media)).

## Two kinds of event: carried vs. announced

- **Carried in full** — a chat message is delivered as the whole `Message`
  DTO, because the client has to render it without a round trip.
- **Announced, then re-fetched** — `friends.changed`, `server.members.changed`
  tell a client "something changed, re-read the list." A `Friend` DTO is
  written from the reader's own side (who requested, which direction), so
  one payload can't serve both parties of the same friendship without being
  composed twice — a refetch is cheaper and harder to get subtly wrong.

## Rooms

Three kinds of Socket.IO room:

- `channel:<id>` — a text/voice channel or DM.
- `user:<id>` — every connected socket for one account, for events addressed
  at a person (friend requests).
- `server:<id>` — every socket for someone who's a member, for community-wide
  events (membership changes). A client subscribes to every server it's in,
  not just the one on screen, so being removed from a server reaches the
  client wherever it's currently looking.

Membership is re-checked by the gateway on every subscribe, the same way for
channels and servers, so a stale subscription can't leak events after access
is revoked.

## One envelope per kind of change

An edit, a deletion (tombstone), a pin, and a reaction all arrive as a single
`message.updated` event carrying the whole message; the client replaces its
copy. The alternative — one event per verb, each patching a different field
— is several chances for two clients to disagree about what a message
currently is.

## Redis Pub/Sub today, NATS later

Redis Pub/Sub is what fans a chat message out to every gateway instance
today (`chat.message.created` → every instance re-broadcasts to its local
sockets), which makes chat-service horizontally scalable from day one. NATS
is the documented upgrade path for larger-scale, cross-service event
communication — not built yet, and not needed until Redis Pub/Sub's
at-most-once delivery becomes the limiting factor.

## Domain events (target vocabulary)

```text
user.created            user.updated            user.online / user.offline
server.created           server.member.added       server.member.removed
channel.created           channel.deleted
message.created             message.updated             message.deleted
call.started                  call.ended                    call.participant.joined / left
remote.machine.registered      remote.machine.offline
remote.session.started          remote.session.ended
remote.permission.changed
```
