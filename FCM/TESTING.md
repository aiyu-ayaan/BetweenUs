# Testing push

Nothing here has been in front of a human yet. This is the order to try it in,
and what each step proves.

---

## 1. The service starts with credentials

```bash
pnpm --filter @betweenus/notification-service dev
```

Look for the absence of:

```text
Push disabled: no Firebase credentials in the environment
```

That line at boot means the environment is empty or the private key did not
survive it. The most common cause is `FIREBASE_PRIVATE_KEY` losing its `\n`
escapes — re-run `pnpm firebase:env ./serviceAccountKey.json` and compare.

## 2. The app gets a token

Install a debug build with `apps/android/app/google-services.json` in place, sign
in, and look for the row in the database:

```sql
SELECT "deviceId", platform, label, "lastSeenAt" FROM device_tokens;
```

No row means one of: no `google-services.json` at build time (check
`BuildConfig.HAS_FIREBASE`), Play services missing on the device or emulator
(use an image **with** Google APIs), or the registration call failing — it is
swallowed on purpose, so watch the service log for the `POST`.

## 3. A message wakes a closed app

Two accounts, two devices — or one device and any other client. Swipe the app
away on the receiving phone, send a message from the other side, and the shade
should show the conversation with the words in it.

If the notification appears but says `New message` where the text should be,
the push arrived and the device has no channel key yet — open the channel once
while signed in and try again.

## 4. The WhatsApp rule

With the conversation **open and in front of you**, send a message to it. There
must be no notification and no sound.

Then, with the same conversation open, lock the screen and send another. There
must be one — this is the half that a naive "is the chat screen composed" check
gets wrong, and the reason `AppForeground` exists.

Then open a *different* channel and send to the first. There must be one.

## 5. Reply from the shade

Reply from the notification without opening the app. The message must appear in
the conversation on both clients, encrypted like any other (check the row in
`messages`: the body starts `{"v":1,"epoch":`), the reply must appear back in
the notification thread, and the channel must go unread-free.

## 6. Rotation and sign-out

- Clear the app's data and sign in again: there must still be exactly one row
  for that device id, with a different token.
- Sign out: the row must be gone **before** the session ends. Sending a message
  afterwards must not push to that phone.
- Sign in as a different account on the same phone: one row, owned by the new
  account.

---

## Sending one by hand

Useful when the whole stack is not running. Any data-only message with the
fields from `PAYLOADS.md` will do — but note that a hand-made push cannot carry
a real sealed body, so the notification will read `New message`. That is the
correct behaviour, not a failure.

```bash
# An OAuth token for the service account, then one message.
# `gcloud auth print-access-token` with the service account activated, or the
# same thing from any Firebase Admin SDK.
curl -X POST "https://fcm.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/messages:send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "message": {
          "token": "<registration token>",
          "data": {
            "type": "message.created",
            "messageId": "test",
            "channelId": "<a channel id this account can read>",
            "authorId": "<some other user id>",
            "authorName": "Test",
            "content": "hello",
            "createdAt": "2026-08-19T18:00:00.000Z"
          },
          "android": { "priority": "high" }
        }
      }'
```

The Firebase console's "Send test message" is **not** a substitute: it sends a
`notification` push, which this app deliberately does not handle. It proves the
token is alive and nothing else.

---

## Things that look like bugs and are not

| Symptom | Why |
| --- | --- |
| No notification while the conversation is open | The rule. See step 4 |
| `New message` instead of the words | No channel key on this device yet |
| Nothing on an emulator | The image has no Google APIs, so there is no FCM |
| Notification is late by minutes | The device is in Doze and the push was not high priority — check the `android.priority` in the send |
| Picture missing from the expanded view | The system UI was not granted the file URI, or the attachment took longer than the eight-second budget |
| Nothing at all after a day away | The token expired; the next successful registration fixes it |
