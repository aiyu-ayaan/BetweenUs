# Firebase Cloud Messaging

Everything about push notifications in BetweenUs: what is configured, where the
configuration lives, and why the push carries no words.

| File | What is in it |
| --- | --- |
| `README.md` | This: the architecture, the setup, the environment variables |
| `PAYLOADS.md` | The wire format of a push, and the gates it passes through |
| `TESTING.md` | How to prove it works, on a device and from a terminal |

---

## Why a push exists at all

Every client already receives every message over `/ws/chat` while it is
running. A desktop app that is open has the tray, and a tab that is open has the
Notifications API. The one client that cannot be reached this way is a phone
with the app swiped away or the screen off long enough for Android to stop the
process — and that is the whole of what FCM is here for.

Nothing else changes. FCM is not a second delivery path for messages: the
message is in Postgres and comes down the socket the moment the app is running
again. The push is a knock on the door.

---

## The shape

```text
chat-service                     notification-service                 phone
     |                                   |                              |
     |  message.created (Redis Pub/Sub)  |                              |
     +---------------------------------->|                              |
     |                                   |  who may read this channel   |
     |                                   |  minus the author            |
     |                                   |  minus "notifications off"   |
     |                                   |  minus a muted channel       |
     |                                   |  minus a muted person        |
     |                                   |                              |
     |                                   |  data-only push, high prio   |
     |                                   +----- FCM ------------------->|
     |                                                                  |
     |                                              PushService decides:|
     |                                              - is it my own?     |
     |                                              - is this channel   |
     |                                                already on screen?|
     |                                              - quiet hours here? |
     |                                              - mentions-only?    |
     |                                              then decrypts and   |
     |                                              writes the shade    |
```

### The push carries no words

The payload is **data-only**. It never contains a `notification` block, so
Android never draws anything by itself.

That is not a style preference, it is forced twice over:

1. **The body is sealed.** A message is encrypted with the channel key before it
   leaves the sender. `notification-service` stores and forwards ciphertext; it
   could not write "Ada: see you at six" if it wanted to. The only machine that
   can is the one holding the key, which is the phone.
2. **The server does not know what is on screen.** Whether this conversation is
   open, in front of somebody, right now is a fact that exists only on the
   device. A push that Android draws on its own would fire while you are reading
   the very message it is announcing.

   The server does know one half of it, and only because clients tell it: which
   channel each *window* has focused. That is what stops a phone buzzing for a
   conversation being read on a laptop, and it is the one thing here no client
   can decide, because a client only ever sees its own screen. See
   `push-suppression.md`.

   That covers the message that has not been sent yet. The notification already
   sitting in a pocket is covered by `channel.read`, which every client raises
   by marking a channel read and which cancels that conversation's notification
   on all of the account's other devices.

So the push wakes the app, and the app writes the notification. This is exactly
how WhatsApp behaves and for the same reason.

### The split of decisions

| Decision | Where | Why there |
| --- | --- | --- |
| Notifications turned off | Server | On the account, and saves waking the phone |
| Muted channel | Server | On the envelope |
| Muted person | Server | The author is on the envelope |
| My own message | Client | Cheap, and the id is right there |
| Channel already on screen *here* | Client | Cheapest where the screen is |
| Channel on screen on *another* device | Server | Only the server sees the other devices — `push-suppression.md` |
| Quiet hours | Client | Minutes on *this* phone's clock, no timezone on the server |
| Mentions-only | Client | The mention is inside the ciphertext |

The rule of thumb: if answering it would need the plaintext, it is a client
decision and the push still goes out. If it needs to know about a device that is
not this one, only the server can answer it.

---

## Configuration

### Backend — environment only, never a file

`notification-service` reads the Firebase service account **from the
environment**. It never opens a path, and no key file belongs in this
repository: a JSON private key checked in once is a private key in the history
forever, and a container has an environment rather than a filesystem somebody
edits.

Turn a downloaded key into the three variables:

```bash
pnpm firebase:env ./serviceAccountKey.json          # print them
pnpm firebase:env ./serviceAccountKey.json --write  # append them to .env
```

then delete the file. It is not needed again.

| Variable | What it is |
| --- | --- |
| `FIREBASE_PROJECT_ID` | `project_id` from the key |
| `FIREBASE_CLIENT_EMAIL` | `client_email` from the key |
| `FIREBASE_PRIVATE_KEY` | `private_key`, with its newlines as literal `\n` |
| `FIREBASE_SERVICE_ACCOUNT` | The whole key as base64 or raw JSON, in one variable. Set it and the three above are ignored |

`serviceAccountKey.json`, `firebase-adminsdk*.json` and `google-services.json`
are all in `.gitignore`.

**With none of them set, push is simply off.** The service logs one line at boot
and every other part of it — preferences, unread counts, read markers — carries
on. A deployment without a Firebase project is not a broken deployment.

The private key survives an environment variable as `\n` rather than as a real
newline; that is what `.env` files, Docker Compose and every secrets UI do to
it, and OpenSSL then rejects the PEM. `push/firebase.ts` undoes it on the way
in, so both forms work.

#### Where to get the key

Firebase console → ⚙ Project settings → **Service accounts** → *Generate new
private key*. It is a Google service account with the
`cloudmessaging.messages.create` permission; nothing else about the project is
used.

### Android — `google-services.json`

`apps/android/app/google-services.json` is the client config: the project
number, the app id and the API key. It is not a secret in the way the service
account is — it identifies the app, it does not authorise sending — but it is
**git-ignored all the same**, because it names a particular Firebase project
and which project a build pushes from belongs to whoever ships it, not to this
repository.

So it is not in the tree. Put your own there.

The Gradle plugin is applied **only when the file is present**:

```kotlin
val hasFirebase = file("google-services.json").exists()
if (hasFirebase) apply(plugin = "com.google.gms.google-services")
```

A checkout without it still compiles, installs and runs. `BuildConfig.HAS_FIREBASE`
is false, `Push.enabled` is false, no token is ever fetched, and nothing is
registered. Push is the only thing missing.

To point the app at your own Firebase project: add an Android app with the
package name `com.aatech.betweenus`, download `google-services.json`, and drop it
at `apps/android/app/google-services.json`.

---

## The device registry — in both stores

One row per (account, installation), written to **Postgres and Firestore**.

| Store | What it is for |
| --- | --- |
| Postgres `device_tokens` | The registry the fan-out reads. One query joined against the accounts and preferences already there, transactional, and cascading off `users` — deleting an account cannot leave a phone being pushed to |
| Firestore `deviceTokens/{uid}_{deviceId}` | The same rows, carrying the uid and the token, beside the Firebase project that minted them. What makes the registry legible from the Firebase console, and what a Cloud Function or a second sender would read |

**Postgres is the authority.** Every Firestore write is best effort: it is
logged and never thrown, because a mirror that cannot be written is a mirror
that is behind, and failing a registration over it would trade the working store
for the copy. The two are reconciled by the next registration, which the client
makes on every sign-in and every rotation.

The Firestore document:

```jsonc
// deviceTokens/9b41…_3f2a…
{
  "uid": "9b41…",              // the BetweenUs user id
  "deviceId": "3f2a…",         // client-minted, stable per installation
  "token": "e7Q…",             // the FCM registration token
  "platform": "android",
  "label": "Google Pixel 8",
  "appVersion": "1.0",
  "updatedAt": "2026-08-19T18:00:00.000Z"
}
```

**Enable Firestore once**, in the Firebase console → Build → Firestore Database
→ *Create database*. There is nothing else to set up: Firestore has no schema
and no migration, so the collection appears the first time a phone registers.
Without it enabled, registration still works and the mirror logs a warning.

**Nothing but this service should reach that collection.** No BetweenUs client
authenticates to Firebase — the app only ever asks Firebase Messaging for a
token and posts it to the BetweenUs API — so the security rules should deny
everything. The Admin SDK bypasses rules, which is exactly the arrangement
wanted:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Written only by notification-service, through the Admin SDK, which
    // bypasses these rules. No client has any business here.
    match /{document=**} { allow read, write: if false; }
  }
}
```

The API is the same either way:

```http
POST   /api/v1/notifications/devices     { token, platform, deviceId, label?, appVersion? }
DELETE /api/v1/notifications/devices/:deviceId
```

Both need a bearer token; the row is bound to the account that made it.

**Keyed on the installation, not on the token.** A registration token rotates —
after a restore, a clear-data, or on Firebase's own schedule — and a table keyed
on the token grows a row per rotation and then pushes at every dead one.
`deviceId` is the client-minted installation id that already identifies the
machine to the end-to-end key directory, so one phone is one row.

The token is *also* unique on its own, because a phone can change accounts:
signing out and into another account carries the same token, and the previous
row is deleted rather than left delivering somebody else's messages.

Three rules the client keeps:

- Register on sign-in **and** on every session restore, so a token that rotated
  while the app was closed is put back under the right account.
- Register again on `onNewToken`.
- Unregister on sign-out **before** the tokens are discarded — it needs an
  access token to make the call. `Session.signOut` does this first, deliberately.

**A registration token is never logged.** Not on success, not in an error. See
section 23 of `CLAUDE.md`.

### Dead tokens

FCM answers `registration-token-not-registered` for an uninstall, a clear-data
or an expiry. Those rows are deleted the moment they are seen — kept, each one
is a wasted send per message forever.

---

## Where each piece lives

| Piece | Path |
| --- | --- |
| Credentials from the environment | `apps/services/notification-service/src/push/firebase.ts` |
| The Firestore handle and the document id | `apps/services/notification-service/src/push/firestore.ts` |
| Fan-out, all five kinds | `apps/services/notification-service/src/push/push.service.ts` |
| Whether a call roster is news, and how it reads | `apps/services/notification-service/src/push/roster.ts` (+ `roster.check.ts`) |
| Device registry | `apps/services/notification-service/src/modules/devices/` |
| Table (the authority) | `packages/database/prisma/schema.prisma` → `DeviceToken` |
| Collection (the mirror) | `deviceTokens/{uid}_{deviceId}` in Firestore |
| Wire types | `packages/shared-types` → `PushData` (five kinds), `RegisterDeviceRequest` |
| Key → env helper | `scripts/firebase-env.mjs` (`pnpm firebase:env`) |
| Token plumbing (transport-agnostic) | `apps/android/core/.../data/PushTokens.kt` |
| Firebase, the only file that knows | `apps/android/app/.../feature/notifications/Push.kt` |
| Where a push lands | `.../feature/notifications/PushService.kt` |
| The gates a push passes | `.../feature/notifications/PushGate.kt` |
| The message notification | `.../feature/notifications/MessageNotifications.kt` |
| Friend, server and call notifications | `.../feature/notifications/SocialNotifications.kt` |
| Reply / mark-read / dismiss | `.../feature/notifications/NotificationActionReceiver.kt` |

---

## The notification

`MessagingStyle`, which is the shape Android reserves for conversations: the
sender's picture, the thread of what was said, and a reply box in the shade.

- **One notification per channel**, not per message. Three messages is one
  notification with three lines.
- **Direct reply** from the shade. It is a broadcast, not an activity, so
  replying never opens the app — which is the entire point of replying from the
  shade. The reply is sealed with the channel key exactly as one typed in the
  app, appears back in the thread, and marks the channel read.
- **Mark as read**, which moves the server-side read marker and dismisses.
- **A picture** that arrived in the message is decrypted and shown in the
  expanded view. The system UI is another process, so the plaintext is written
  into the `FileProvider` cache directory and granted to it — a bitmap cannot be
  handed across.
- **Tap** opens the conversation through `betweenus://channel/<id>`, the same
  scheme an invite link uses.
- **Swipe away** forgets the thread, so the next message starts a fresh one
  rather than re-posting what was dismissed.
- **Opening the channel** dismisses it, and so does signing out — a notification
  holds plaintext, and it does not follow an account switch.

The message history behind the thread is held in memory only. It is plaintext
from a sealed body and has no business on disk beside the ciphertext; a process
death costs the older lines and nothing else.

---

## Not done yet

- **Remote access.** `remote.session.started` raises no push, unlike a call:
  `onCallRoster` in `push.service.ts` wakes a phone for a channel it can hear,
  but nothing does the same for a remote session somebody is trying to start.
  Tracked in `development/TODO.md` (phase 27).
- **Web Push.** The registry and the fan-out are transport-agnostic on purpose —
  the platform column and `MessagePushData` already allow for it — but no service
  worker exists.
- **iOS.** There is no iOS client.
