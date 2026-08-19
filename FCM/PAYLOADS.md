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
