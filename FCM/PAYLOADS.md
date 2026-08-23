# Push payloads

The wire format, and the order of the gates a push passes through. See
`README.md` for why it is shaped this way.

---

## `message.created`

Sent by `notification-service` on the Redis `message.created` event, to every
device of every recipient that survived the server-side filter.

```jsonc
{
  "data": {
    "type": "message.created",
    "messageId": "3f2a…",
    "channelId": "9b41…",
    "authorId": "77c0…",
    "authorName": "Ada",
    "authorAvatarUrl": "https://…/avatars/77c0.jpg",  // omitted when unset
    "content": "{\"v\":1,\"epoch\":3,\"iv\":\"…\",\"ct\":\"…\"}",
    "createdAt": "2026-08-19T18:04:11.522Z",
    "mentionsOnly": "1"                                // omitted unless set
  },
  "android": { "priority": "high", "ttl": 86400000 }
}
```

Notes on each awkward part:

- **Every value is a string.** FCM's data map has no other type, which is why
  `mentionsOnly` is `"1"` and not `true`.
- **No `notification` block, ever.** Adding one would make Android draw a
  notification before the app has decided whether it should — including for the
  conversation already on screen. It would also have nothing readable to draw.
- **`content` is the sealed envelope**, byte for byte what is in the database.
  A client without the channel key gets `New message`; a client with it gets the
  words. Nothing in the backend has ever seen them.
- **`priority: high`.** The point of the push is a phone that is asleep, and a
  normal-priority data message is exactly what Doze holds back.
- **`ttl` is a day.** Past that the badge on next launch says it better than a
  late buzz.
- **No `serverId`.** The client resolves it from the workspace it already holds;
  sending it would be a second source of truth for something the phone knows.

### What is deliberately absent

| Not sent | Why |
| --- | --- |
| The plaintext | Sealed with the channel key; the server cannot read it |
| An unread count | Derived from the read marker, which the client syncs anyway |
| The channel name | The client has the workspace, and a renamed channel would go stale in flight |
| A collapse key | One notification per channel is the client's job, not FCM's |

---

## The gates, in order

Cheap and local first, so a push that will be dropped costs nothing.

**Server** (`push.service.ts`), before the phone is woken at all:

1. Who may read this channel — `channelAudience`.
2. Minus the author.
3. Minus accounts with notifications off.
4. Minus accounts that muted this channel.
5. Minus accounts that muted this author.
6. Mentions-only channels are marked, not dropped: the mention is in the
   ciphertext, so only the phone can answer it.

**Client** (`PushService.handle`), in this order:

1. `type` is `message.created`, or return.
2. The author is me — my own message from another machine. Return.
3. `AppForeground.visible && Conversation.visibleChannelId == channelId` — the
   conversation is open in front of somebody. Return. **This is the WhatsApp
   rule and the reason the push is data-only.** Both halves are needed: a locked
   phone still has the chat screen composed behind the lock screen, so the
   visible-channel check alone would silence a channel forever.
4. Restore the session if this is a cold process — without an access token there
   is no channel key to fetch and no way to answer a reply.
5. Preferences: off, muted, or inside quiet hours (on *this* phone's clock, which
   is why the server sent it and left the decision here). Return.
6. Decrypt. An unreadable body is still a notification — this device has not
   been given the key yet, and saying "New message" beats saying nothing.
7. `mentionsOnly` and the body does not mention me. Return. An unreadable body
   in a mentions-only channel stays silent: guessing loudly is the worse mistake.
8. Decode the picture, if there is one.
9. Post, and bump the unread badge.

---

## `message.deleted`

Sent on the Redis `message.deleted` event. The only push that exists to take
something *off* a screen.

```jsonc
{
  "data": {
    "type": "message.deleted",
    "messageId": "3f2a…",
    "channelId": "9b41…"
  },
  "android": { "priority": "normal", "ttl": 86400000 }
}
```

- **The whole audience, unfiltered** — no author check, no mute, no quiet hours,
  no foreground rule. Every one of those gates is a way to leave a notification
  standing for a message that no longer exists, and a recipient who was never
  sent one has nothing to remove. The author is included too: they may have
  deleted it from another machine.
- **`priority: normal`.** Tidying a screen is worth doing and is not worth
  pulling a sleeping phone out of Doze. It lands the moment the phone is next
  awake, which is the moment anybody would look.
- The client rebuilds the conversation's notification without that line rather
  than cancelling it, because a conversation usually has more than one line and
  taking the whole thing away would hide messages that still exist. A thread
  with nothing left is the one case where the notification itself goes.
- Silently nothing when this device never drew that message. That is the normal
  case, not an error.

---

## `channel.read`

Sent on the Redis `channel.read` event, which `notification-service` publishes
whenever any client marks a channel read. The second of the two pushes that
exist to take something *off* a screen.

```jsonc
{
  "data": {
    "type": "channel.read",
    "channelId": "9b41…",
    "at": "2026-08-22T09:14:03.221Z"
  },
  "android": { "priority": "normal", "ttl": 86400000 }
}
```

- **One recipient: the account that did the reading.** No audience, no
  preferences, nobody else's phone. A read marker is this account talking to
  itself — "I have dealt with that conversation, on the machine I am sitting
  at" — and the phone in the pocket is who needs telling.
- **Every device of that account, the reader included.** The reader has already
  cleared its own notification and does nothing with this; excluding it would
  mean the server knowing which device sent the marker, which it does not and
  has no reason to.
- **Cancels the whole thread**, unlike `message.deleted`, which takes one line
  out. "Read up to now" is what a read marker means, so nothing in that
  conversation is still unseen.
- The unread badge goes with it. On Android that is
  `Workspace.noteReadElsewhere`, which does what `markRead` does *except* post
  the marker back — otherwise every device would answer every other device's
  read with one of its own for as long as they were all awake.
- **`priority: normal`**, for the same reason as `message.deleted`.
- No words, no message id, and nothing sealed: a timestamp and a channel id are
  the whole payload.

---

## `friend.request` and `friend.accepted`

Sent on the Redis `friend.changed` event, to the side that did not act. Nothing
here is sealed — a friend request has no body, and a name and a picture are
already public — but the client still writes the notification, because it is
still the only side that knows what is on screen.

```jsonc
{
  "data": {
    "type": "friend.request",            // or "friend.accepted"
    "actorId": "77c0…",
    "actorName": "Ada",
    "actorAvatarUrl": "https://…"        // omitted when unset
  },
  "android": { "priority": "high", "ttl": 86400000 }
}
```

Declining, cancelling and unfriending all reach the bus as `kind: "removed"` and
send nothing. "Somebody you do not know decided not to know you" is not worth a
buzz.

---

## `server.member.added`

Sent on the Redis `server.member.added` event, minus the owner — nobody needs
telling they have joined the server they just made.

```jsonc
{
  "data": {
    "type": "server.member.added",
    "serverId": "5c11…",
    "serverName": "Acme",
    "serverIconUrl": "https://…"         // omitted when unset
  },
  "android": { "priority": "high", "ttl": 86400000 }
}
```

The client refreshes the workspace before it navigates: the push and the server
appearing in the sidebar are a race, and a tap that wins it must mean "a moment
later", not "nothing happened".

---

## `call.roster`

Sent on the Redis `call.roster` event — which `call-service` publishes on every
join and every departure — to everyone who can hear the channel and is not in
the call. This is the `call.started` fan-out the Android notes waited on, in the
shape that turned out to be right.

```jsonc
{
  "data": {
    "type": "call.roster",
    "channelId": "9b41…",
    "channelName": "general",
    "participants": "Ada and Ben",
    "count": "2"
  },
  "android": { "priority": "high", "ttl": 86400000 }
}
```

- **The roster, not the arrival.** Three people joining one after another is one
  notification that keeps up, rather than three that pile up.
- **`count: "0"` cancels it.** An empty roster is the call ending, and it is the
  only way a phone that was told about a call ever finds out it is over. It runs
  before every client-side gate, because a notification for a call that finished
  an hour ago is worse than never having been told.
- **`priority: normal` on that one.** A call is worth the Doze exemption; a call
  that has already ended is not.
- **`participants` is already a sentence.** Three names is where a notification
  stops being one and starts being a list, so the fourth onwards are counted:
  `"Ada, Ben and 2 others"`.
- Muting the channel mutes its calls. Turning notifications off mutes
  everything.

---

## `call.ring`

Sent on the Redis `call.ring` event, which `call-service` publishes when one
person rings another into a call. It goes to **that one account** and to nobody
else.

```jsonc
{
  "data": {
    "type": "call.ring",
    "channelId": "9b41…",
    "channelName": "general",
    "callerId": "88a1…",
    "callerName": "Ada Lovelace",
    "callerAvatarUrl": "https://…"      // omitted when unset
  },
  "android": { "priority": "high", "ttl": 86400000 }
}
```

- **Aimed, where `call.roster` is broadcast.** That is the whole difference, and
  it is what earns the full-screen answer screen for a server's voice channel
  too: a person pressed a button with this account's name under it, where a
  roster is a fact about a room everybody in it is told.
- **Always urgent.** A ring that lands when the phone next wakes is not a ring,
  it is a missed-call notice, and `call.roster` already says that better.
- **A muted channel does not silence it.** Muting a room says you do not want to
  hear about the room, not that a colleague may never call you from it. A muted
  *person* does silence it, and so does turning notifications off entirely -
  both are decided on the server. Quiet hours are decided on the phone, as
  always.
- **It rings for 45 seconds and then stops.** What normally takes the
  notification away is the roster going empty, and somebody who rings without
  joining produces no roster at all.
- **The server refuses a repeat inside 30 seconds.** A ring is the one push
  allowed past a quiet setting, so something other than the recipient's
  preferences has to stop the button being pressed forty times.

---

## `remote.session`

Sent on the Redis `remote.session` event, which `remote-gateway` publishes when
a session starts and again when it ends. It goes to the **owner of the machine**
and to nobody else.

```jsonc
{
  "data": {
    "type": "remote.session",
    "sessionId": "4c7e…",
    "machineId": "1f20…",
    "machineName": "Studio PC",
    "actorId": "88a1…",
    "actorName": "Ada Lovelace",
    "state": "started"
  },
  "android": { "priority": "high", "ttl": 86400000 }
}
```

- **It ignores every preference except "notifications off entirely".** Every
  other push here can be muted, because a mute is somebody choosing not to be
  told about a conversation. This one is somebody being told their machine is
  being driven while they are not at it, and a notification a mute could switch
  off is a notification an attacker could arrange to be switched off.
- **Only the owner is told.** The person driving already knows what they did,
  and a session on somebody else's machine is not news anyone else is entitled
  to. An owner reaching their own machine is told nothing at all.
- **`state: "ended"` cancels it.** A standing notification saying somebody is on
  your machine when nobody is would be the same alarm, permanently, for nothing.
  `priority: normal` on that one - taking a notification away is not worth
  pulling a sleeping phone out of Doze for.
- **It is ongoing while it stands**, and tapping it opens the machine list
  rather than the session. A session that has already started is somebody
  else's; what the notification is telling you is that you may want to end it.
- `remote_audit` records every session either way. This is what makes it
  something anybody finds out about at the time rather than afterwards.

---

## Registering a device

```http
POST /api/v1/notifications/devices
Authorization: Bearer <access token>

{
  "token": "<FCM registration token>",
  "platform": "android",
  "deviceId": "<client-minted installation id>",
  "label": "Google Pixel 8",
  "appVersion": "1.0"
}
```

Answers with the row, and deliberately never with the token:

```json
{ "deviceId": "…", "platform": "android", "label": "Google Pixel 8", "lastSeenAt": "2026-08-19T18:00:00.000Z" }
```

Idempotent: registering again with a new token updates the same row, which is
what makes rotation a no-op for the client.

```http
DELETE /api/v1/notifications/devices/<deviceId>
```

Scoped to the caller, so one account cannot unregister another's phone by
guessing an id.
