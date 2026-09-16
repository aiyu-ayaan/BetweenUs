---
sidebar_position: 8
---

# remote-gateway

Session handshake, input/clipboard relay, file-transfer permission, and audit
for remote desktop. Never carries the screen, the machine's sound, or a byte of
a file — see [Remote Desktop](/architecture/remote-desktop).

## `/ws/remote`

Session state, input events (mouse/keyboard), clipboard events, file offers,
and the offer/answer/ICE exchange for the session's WebRTC connection.

| Event | Direction | Permission |
| --- | --- | --- |
| `input.mouse`, `input.key` | controller → agent | `REMOTE_CONTROL` |
| `clipboard.set` | controller → agent | `REMOTE_CLIPBOARD` |
| `clipboard.text` | agent → controller | `REMOTE_CLIPBOARD` |
| `file.offer` | controller → agent | `REMOTE_FILE_TRANSFER`, audited as `file.offered` |
| `file.cancel` | controller → agent | none — giving up is always allowed |
| `file.accepted`, `file.refused` | agent → controller | the machine's answer |
| `file.done` | agent → controller | audited as `file.received` |
| `control.request`, `control.release` | controller → agent | none; the machine answers |
| `screen.select` | controller → agent | none — a view-only session may look at the other monitor |
| `rtc.signal` | both | none; relayed unread |

`file.offer` is the only message a transfer sends through here. The bytes go
down the session's data channel, directly between the two machines. That split
is what makes the permission enforceable at all: the gateway checks the thing
that *asks*, and the bulk that follows is meaningless without it.

Every refusal is written to `RemoteAudit`, not only rejected — a client that
keeps asking for something it was not granted is worth being able to see
afterwards.

## `/api/v1/remote`

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/machines` | List machines the caller owns or has a grant on |
| POST | `/machines` | Enroll a machine, returns the one-time agent token |
| PATCH | `/machines/:machineId` | Rename / update a machine |
| DELETE | `/machines/:machineId` | Remove a machine |
| GET | `/machines/:machineId/grants` | List permission grants |
| PUT | `/machines/:machineId/grants` | Set a grant (permissions, optional expiry) |
| GET | `/machines/:machineId/audit` | Read `RemoteAudit` for a machine |
| POST | `/sessions` | Request a session (may raise a consent prompt on the target) |
| DELETE | `/sessions/:sessionId` | End a session; the body carries what the controller counted |
| GET | `/usage?days=` | This account's own remote sessions over a window, and what they moved |

`DELETE /sessions/:sessionId` takes an optional `RemoteSessionUsage`
(`bytesSent`, `bytesReceived`, `transport`). It is the client's own count and
nothing here can check it, so it is clamped rather than trusted, and only the
controller's figures are taken — an administrator ending somebody else's
session reports nothing. `GET /usage` is the remote half of the Calls & Data
page: a call and a remote session are the same shape of thing, and only one of
them used to be counted.

A machine somebody has no access to answers 404 rather than 403, so machine
ids aren't probeable. See [Remote Desktop](/architecture/remote-desktop) for
the permission model and session-freezing rule.
