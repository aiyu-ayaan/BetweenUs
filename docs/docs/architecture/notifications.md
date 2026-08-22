---
sidebar_position: 6
---

# Notifications

`notification-service` raises **no** notifications itself. A running client
already receives every message over `/ws/chat` and is the only thing that
knows what's on screen; the service owns the state that has to outlive the
client — mutes, quiet hours, read markers — and, for a backgrounded phone,
a data-only push that wakes the app rather than announcing anything.

## Why a push exists at all

Every client already gets messages over its socket while it's running: a
desktop app has the tray, a browser tab has the Notifications API. The one
client that can't be reached this way is a phone with the app swiped away
or the process stopped by the OS — that's the entire reason FCM is here.
It's not a second delivery path for messages; the message already sits in
Postgres and comes down the socket the instant the app runs again. The push
is a knock on the door.

```mermaid
sequenceDiagram
    participant Chat as chat-service
    participant Notif as notification-service
    participant FCM as Firebase (FCM)
    participant Phone as Android (PushService)

    Chat->>Notif: message.created (Redis Pub/Sub)
    Notif->>Notif: who may read this channel,<br/>minus author, minus muted,<br/>minus notifications-off
    Notif->>FCM: data-only push, high priority
    FCM->>Phone: wake the app
    Phone->>Phone: is it mine? channel on screen?<br/>quiet hours? mentions-only?<br/>then decrypt and write the shade
```

## The push carries no words

The payload is **data-only** — no `notification` block, so Android never
draws anything by itself. That's forced, not a style choice:

1. **The body is sealed.** A message is encrypted with the channel key
   before it leaves the sender. `notification-service` stores and forwards
   ciphertext; it couldn't write "Ada: see you at six" even if it wanted to.
2. **The server doesn't know what's on screen.** Whether a conversation is
   open right now is a fact that exists only on the device. A push Android
   draws on its own would fire while someone is reading the very message it
   announces.

So the push wakes the app, and the app writes the notification — the same
shape WhatsApp uses, for the same reason.

## The split of decisions

| Decision | Where | Why there |
| --- | --- | --- |
| Notifications turned off | Server | On the account; saves waking the phone at all |
| Muted channel / muted person | Server | Both are on the envelope the server can see |
| My own message | Client | Cheap, and the id is right there |
| Channel already on screen *here* | Client | Cheapest where the screen actually is |
| Channel on screen on *another* device | Server | Only the server sees every device — see below |
| Quiet hours | Client | Minutes on *this* device's clock; the server never learns a timezone |
| Mentions-only | Client | The mention is inside the ciphertext |

Rule of thumb: if answering it needs the plaintext, it's a client decision
and the push still goes out. If it needs to know about a device that isn't
this one, only the server can answer it.

## Not waking a phone for a message already being read

> A `message.created` push is not sent to **any** of an account's devices
> while **any** of that account's windows has that exact channel open and
> focused.

- **Exact channel** — reading `#general` on server A silences nothing on
  server B.
- **Any window silences all devices** — the rule is per account, not per
  device; a laptop open on the channel is why the phone stays quiet.
- **`message.created` only** — `message.deleted` removes a notification
  that's become a lie, so suppressing *that* would leave the lie standing.
- **Mentions are not an exception** — no service has ever seen the word
  `@you`; deciding server-side would mean waking the phone for every
  message and letting the client decide anyway, which throws away the
  whole saving.

"Focused" is `document.hasFocus() && !document.hidden` plus the active
channel id on desktop/web, and `AppForeground.visible` plus
`Conversation.visibleChannelId` on Android. A phone locked mid-conversation
still counts as reading it — its chat screen is composed behind the lock
screen, which is exactly the case that would otherwise go silent forever.
Full design: [`push-suppression.md`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/push-suppression.md).

## Unread counts are derived, not stored

One `ChannelRead` row per `(user, channel)` holding `lastReadAt`; the
unread count is messages after it that someone else wrote, computed on
read rather than incremented on write. A stored counter drifts the first
time some path forgets to decrement it — a marker can't drift, and it
naturally answers "unread since when" for an account that's been offline a
week. See [Database Schema](/database/schema#notifications--devices).

## What each client does with a wake-up

- **Desktop (Electron)**: the main process raises the OS notification and
  flashes the taskbar; the renderer is what decides *whether* to, since
  only it knows if the window is focused on that channel. Closing the
  window hides it rather than quitting — the tray keeps the socket alive,
  which is what makes a closed-but-not-quit app still reachable at all.
- **Web**: the Notifications API, permission requested at the first
  notification worth raising rather than at sign-in (a prompt on the way
  in is the one people refuse). Unread count goes in the tab title — the
  only badge a tab owns. Covers an open tab only; a closed one needs a
  service worker and Web Push, not built.
- **Android**: `PushService` receives the data-only FCM message,
  `PushGate` applies the client-side half of the suppression rule, then
  `MessageNotifications` decrypts and posts. A direct call rings even with
  the app fully killed via a `CallStyle` notification with a full-screen
  intent (`SocialNotifications`) — see [Android Client](/architecture/android-client).

## Configuration

`notification-service` reads Firebase's service-account credentials from
the **environment only** — never a file, since a JSON private key checked
into the repo once is a private key in the history forever.
`pnpm firebase:env ./serviceAccountKey.json --write` turns a downloaded key
into the three env vars and the file can be deleted. Full setup and the
wire format of a push: [`FCM/README.md`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/FCM/README.md)
and [`FCM/PAYLOADS.md`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/FCM/PAYLOADS.md).

See also [notification-service](/services/notification-service) for its
REST surface.
