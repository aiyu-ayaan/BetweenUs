---
sidebar_position: 6
---

# notification-service

Raises no notifications itself. Owns the preferences and state that outlive
any single client: mutes, quiet hours, unread markers, and registered push
devices. Full design and the client/server decision split:
[Notifications](/architecture/notifications).

## `/api/v1/notifications`

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/preferences` | Read `NotificationSetting` |
| PATCH | `/preferences` | Update mutes / quiet hours |
| GET | `/unread` | Per-channel unread counts, derived from `ChannelRead` |
| POST | `/read` | Mark a channel read (moves `lastReadAt`) |

## `/api/v1/notifications/devices`

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/` | Register a device's FCM token |
| DELETE | `/:deviceId` | Unregister |

## Why the client decides

The server answers what it can see: notifications off, a muted channel, a
muted person. The device answers the rest: is this my own message, is the
channel already on screen, are we inside quiet hours on this clock, does the
message mention me — all of which require either window state or the
channel key the server doesn't have. See [`FCM/README.md`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/FCM/README.md)
for the push payload shape.
