---
sidebar_position: 9
---

# Scheduled Send and Reminders

Two features that both mean "do something later": send this message at a time
I choose, and remind me about that message. Both are **local to the device**.
Nothing about them is stored, queued or timed by a BetweenUs server.

## Why the server is not involved

Messages are sealed on the sender's device and the server holds only
ciphertext. A server-side "send later" would have to be one of two things:

1. **Plaintext held until the time.** Ruled out; the server never sees
   plaintext.
2. **Ciphertext sealed now and released later.** This would be a new server
   capability, a queue of messages nobody has sent yet, and it is a worse
   send: it is sealed under the epoch the channel is on *today*, for the
   members it has *today*. If the channel rotates its key or somebody leaves
   before the time, the message goes out under a stale epoch or to someone who
   should no longer read it.

So the client keeps the words and sends them at the time through the ordinary
send path. The message is sealed when it is sent, under whatever key the
channel has then, for whoever is in it then, and the server sees exactly what
it would have seen if the person had pressed Send at that moment. No service,
route, table or Prisma model changed.

## The trade-off, stated plainly

**The device has to be running at the due time.**

| Client | What "running" means |
| :--- | :--- |
| Desktop | The app is open, or minimised to the tray (closing the window hides it, so the process keeps running). |
| Web | A tab is open. Browsers throttle background timers, so the scheduler wakes at least once a minute and compares against the clock rather than trusting one long timer. |
| Android | WorkManager wakes the app. It survives process death and reboots. There is one unique pending work item, always pointed at the soonest due item. |

**If the device was off, asleep or offline at the due time**, the item is sent
(or the reminder is shown) on the device's next chance: the next launch,
window focus, network return or WorkManager run. It is flagged as **late**
when that is more than five minutes after the due time. A late send raises a
"Sent late to #channel" notification, and a late reminder's title says the
device was away. Inside five minutes nothing extra is said; a slow timer is not
news.

This was a choice between three answers: drop it, ask, or send late. Dropping
a message somebody meant to send is the worst of them. Asking gets a
notification nobody sees until later. So it sends, and says so.

A message that cannot go for a reason the server gave (the channel was
deleted, the account left it) is **not** retried; it stays in the list as
failed, with the reason, for "Try again" or "Cancel". A network failure retries
with backoff (30 s doubling to 15 min, at most eight attempts) and then stops
the same way.

## What can be scheduled

Text only. Files would have to be sealed and uploaded now, which puts the
message's ciphertext on the server before it is sent, the thing this design
refuses. The composer says so rather than silently dropping the files. Text
over the 2 000-character overflow limit (which normally becomes a file) is
refused for the same reason.

## Where the state lives

| Client | Store | At rest |
| :--- | :--- | :--- |
| Desktop / web | IndexedDB database `betweenus-scheduled`, beside the ciphertext cache but separate from it: the cache may be dropped whenever its schema changes, and a message somebody wrote may not. | Each row is sealed with AES-GCM under a key held through `secureSet`, which is the OS keychain (`safeStorage`) in the desktop app. |
| Android | One list sealed with `SecureStore`, the Keystore-wrapped store the identity keys use. | Keystore-backed AES-GCM. |

Rows are bound to an account: another account's rows are dropped when someone
else signs in, and **signing out clears the lot** (unsent words are never sent
as somebody else). Two tabs of the web client share one database, so each item
is fired under a Web Lock and re-read from disk under it, which is why a
message is not sent twice.

## Time

Every rule takes `now` as an argument, and the app passes the **server's**
clock (`serverNow()` / `ServerClock.nowMs()`), not the device's. A laptop whose
clock is an hour out would otherwise send "in 30 minutes" half an hour early.
Wall-clock presets ("tomorrow morning", "Monday morning" = 09:00) are resolved
in the device's own time zone with calendar arithmetic, not by adding 24 hours,
so a daylight-saving change between now and then still lands on 09:00. The
custom picker is the platform's own `datetime-local` / date-and-time dialogs.

## Where the code is

- `apps/desktop/src/services/schedule.ts`: presets, due checks, lateness,
  retry and the on-disk codec. No clock, no storage. Checked by
  `schedule.check.ts`, which also runs under several `TZ` values.
- `apps/desktop/src/services/scheduled-store.ts`: the sealed IndexedDB store.
- `apps/desktop/src/stores/scheduled.ts`: the clock; sends through
  `useChatStore.sendTextTo`.
- `apps/android/core/.../store/Scheduling.kt`: the same rules; `SchedulingTest`
  mirrors the desktop check.
- `apps/android/app/.../feature/schedule/`: the WorkManager worker, the
  notification channel and the sheets.

On Android a scheduled send goes out through `Conversation.send` in the worker
with its own per-item failure state, rather than through the chat `Outbox`: the
`Outbox` is a fire-and-forget queue whose failures are shown per channel, while
a scheduled message needs its own row to show "trying again" or "not sent" in
the list.

## Reminders

"Remind me" is on a message's menu (right-click on desktop and web, the actions
sheet on Android) with presets. It stores the message id, the author's name and
a short excerpt **on the device only**. At the time it raises a local
notification, described on the [notifications page](./notifications.md#reminders-and-scheduled-sends).
The list is the same "Scheduled" panel as scheduled messages, from which any
of them can be rescheduled, sent now or cancelled.
