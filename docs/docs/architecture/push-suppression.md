---
sidebar_position: 7
---

# Push Suppression

A push exists to reach a person who is not looking. If the same account has the
conversation open in a focused window on a laptop, the message is on a screen in
front of them before the buzz arrives, and the phone in their pocket should stay
quiet.

BetweenUs already refused the pushes it could refuse locally: `PushGate` on
Android drops a push for the channel that phone is showing. What it cannot see
is the *other* devices — a client only knows its own screen. So the fact has to
reach a server, and the server has to apply it.

There are two halves to that, and this document covers both: **the push that is
never sent**, because the conversation is open somewhere else, and **the
notification already showing**, which goes away when the conversation is read
somewhere else.

---

## The rule, exactly

> A `message.created` push is not sent to **any** of an account's devices while
> **any** of that account's windows has that **exact channel** open and focused.

Every word of that is load-bearing:

- **Exact channel.** Reading `#general` on server A silences nothing on server
  B. That is what makes the rule bearable rather than a mute switch.
- **Any window silences all devices.** The rule is per account, not per device.
  A desktop open on the channel is why the phone stays quiet.
- **`message.created` only.** `message.deleted` exists to *remove* a
  notification that has become a lie, so suppressing it would leave the lie
  standing. `call.roster`, `call.ring`, `friend.*` and `server.member.added`
  are not channel-scoped news — and a ring least of all: somebody aimed it at a
  person, so having their channel open is not a reason to swallow it.
- **Mentions are not an exception.** You are looking at the message as it
  arrives. There is also no way to make them one: bodies are sealed with the
  channel key, so no service has ever seen the word `@you` — the server would
  have to wake the phone for every message in the channel and let the client
  decide, which is the whole saving given away.

---

## What counts as focused

Both halves, on every client:

| | Desktop / web | Android |
| --- | --- | --- |
| The channel is open | `chat.activeChannelId` | `Conversation.visibleChannelId` |
| The window has attention | `document.hasFocus() && !document.hidden` | `AppForeground.visible` |

A desktop left open on `#general` behind a browser is **not** somebody reading
`#general`. A phone locked mid-conversation is not either — its chat screen is
still composed behind the lock screen, which is precisely the case that would
otherwise go silent forever.

The strict reading is deliberate. The two failure modes are not symmetric: a
wrong "they are reading it" is a message nobody is ever told about, and a wrong
"they are not" is one redundant buzz.

---

## How it travels

```
 desktop / web / android              presence-service                notification-service
 ─────────────────────────            ────────────────                ────────────────────
 channel opened + window focused
        │  { type: "channel.focus",
        │    channelId }
        ├──────────── /ws/presence ────────►  ZADD presence:focus:<ch> <now> <user>
        │                                     PEXPIRE 90s
        │  every 60s, the same frame                │
        ├──────────── heartbeat ───────────►  score refreshed
        │
 window blurred / channel closed
        ├──── { type: "channel.blur" } ────►  ZREM
 socket dies                                  ZREM on disconnect
                                                   │
                                              GET internal/presence/focus
                                              ?channelId=X&userIds=a,b,c
                                                   ▲
                                                   │  { focused: ["b"] }
                                                   │
                                       message.created ──┴── audience − focused → FCM
```

### The wire

Two client frames on `/ws/presence`, typed in `packages/shared-types`:

```ts
{ type: 'channel.focus'; channelId: string }
{ type: 'channel.blur';  channelId: string }
```

`channel.focus` is permission-checked with the same `VIEW_CHANNEL` bar as
`typing.start`. Without that check, anybody could silence a channel they cannot
even see, for everybody who can.

There is no server frame in reply. Focus is not something other people are told
about — it is not presence, and publishing "Ana is reading #general" would be a
read receipt nobody asked for.

### The storage

`presence:focus:<channelId>` is a Redis sorted set of user ids scored by the
moment each was last asserted — the same shape, and the same reasoning, as
`presence:online`. Stale entries are dropped as a side effect of reading, and
the key carries a 90-second TTL of its own, so a channel nobody is reading
leaves nothing behind.

Three things clear an entry, in descending order of how much they are trusted:

1. **`channel.blur`.** The window moved on and said so.
2. **The socket closing.** The gateway remembers what each socket had focused
   and removes it — unless another live window of the same user is still on that
   channel, which would otherwise open a gap of up to one heartbeat in which the
   phone buzzes for a conversation that is open on a second screen right now.
3. **The score ageing past 90 seconds.** The backstop for a socket that died in
   a way the server never saw. This is why clients re-send `channel.focus` every
   60 seconds, and why they re-assert it on every reconnect: the server keeps
   nothing across connections.

### The lookup

`notification-service` calls `GET /internal/presence/focus` once per message,
with the audience it has already computed, and subtracts the answer from the
fan-out. Not a request per recipient: a fan-out is a batch.

It is asked *after* the preference filter — muted channels, muted people,
notifications off — so a conversation everybody has muted costs no request at
all.

The path is not routed by nginx. `/api/v1/internal` is not a path the gateway
forwards, so this is reachable on the internal Docker network and nowhere else,
which is also why it has no guard: there is no user here to authenticate, only
another service. `server-service` already reaches presence the same way for
online counts.

**Reading Redis directly from `notification-service` was the alternative and is
the wrong one.** The key belongs to presence-service; a second reader is a
second thing to change when the key changes, and CLAUDE.md §12 says services do
not read each other's data.

### Failing

`focusedAmong` answers "nobody" for every failure it can have — a timeout
(1.5s), a refused connection, a non-2xx, a body that is not JSON, a body with no
list. The push then goes.

That is the only defensible direction. A missed notification is a message
somebody never learns about; a redundant one is a buzz.

---

## The notification that is already there

Focus stops a push being *sent*. It does nothing about one that was sent an hour
ago and is still sitting in a pocket — and reading the message on a laptop
should take that away too, which is what every messenger does.

That is `channel.read`, and it rides on a marker every client already sets:

```
  desktop opens #general
        │
        ├── POST /api/v1/notifications/read ──►  notification-service
        │                                        upserts ChannelRead
        │                                        publishes channel.read
        │                                              │
        │                                        PushService.onChannelRead
        │                                              │
        └──────────────────────────────────── FCM ─────┴──► every device of
                                              (normal priority)   that account
```

On arrival Android cancels that conversation's notification outright and clears
its unread badge. Two details matter:

- **It cancels the whole thread**, where `message.deleted` removes one line.
  "Read up to now" means nothing in that conversation is still unseen.
- **The badge is cleared without posting a marker back.**
  `Workspace.noteReadElsewhere` is `markRead` minus the API call. With the call,
  every device would answer every other device's read with one of its own, for
  as long as they were all awake.

The reader's own device gets the push too and does nothing with it — it cleared
its notification when the channel opened. Excluding it would mean the server
knowing which device sent the marker, which it does not and has no reason to.

[`FCM/PAYLOADS.md`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/FCM/PAYLOADS.md) has the wire format.

---

## What is still decided on the client

`PushGate.shouldSuppress` on Android is unchanged and still runs. It is the same
rule applied a second time, locally, for the case no server can win: a push
already in flight when the chat is opened. Belt and braces, and the braces cost
nothing.

---

## Files

| | |
| --- | --- |
| `packages/shared-types/src/index.ts` | the two frames |
| `apps/services/presence-service/src/presence.store.ts` | `focus`, `blur`, `focusedAmong` |
| `apps/services/presence-service/src/presence.gateway.ts` | the handlers, the heartbeat refresh, the disconnect |
| `apps/services/presence-service/src/presence.controller.ts` | `GET internal/presence/focus` |
| `apps/services/notification-service/src/push/focus.ts` | the lookup, and its failure direction |
| `apps/services/notification-service/src/push/push.service.ts` | `onMessage` subtracts the readers; `onChannelRead` cancels what is already showing |
| `apps/services/notification-service/src/modules/notifications/notifications.service.ts` | `markRead` publishes `channel.read` |
| `apps/android/app/src/main/java/.../notifications/PushService.kt` | `handleRead` cancels the thread and the badge |
| `apps/desktop/src/services/channel-focus.ts` | desktop and web (one app, one module) |
| `apps/android/core/src/main/java/.../store/ChannelFocus.kt` | Android |

`focus.check.ts` covers the lookup's failure direction; `pnpm --filter @betweenus/notification-service check` runs it.

---

## Trying it

Two clients, one account.

1. Sign in on desktop and on a phone. Open `#general` on the desktop and leave
   the window focused.
2. From a second account, send to `#general`. The phone must not buzz. The
   desktop shows the message.
3. Click away from the desktop window — another application, not another
   channel — and send again. The phone buzzes.
4. Focus the desktop again, open a *different* channel, and send to `#general`.
   The phone buzzes: a different channel is a different key.
5. Kill the desktop process outright, and send within a minute and a half. The
   phone buzzes as soon as the entry ages out — this is the 90-second backstop,
   and it is the longest anything should ever stay silent for.
6. For the other half: with the desktop closed, send to `#general` and let the
   phone buzz. Now open `#general` on the desktop. The phone's notification
   should disappear on its own, and its unread badge with it.

`redis-cli zrange presence:focus:<channelId> 0 -1 withscores` shows exactly who
the server thinks is reading.
