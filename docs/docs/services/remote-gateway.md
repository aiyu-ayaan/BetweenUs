---
sidebar_position: 8
---

# remote-gateway

Session handshake, input/clipboard relay, permission enforcement and audit
for remote desktop. Never carries the screen — see
[Remote Desktop](/architecture/remote-desktop).

## `/ws/remote`

Session state, input events (mouse/keyboard), clipboard events, and the
offer/answer/ICE exchange for the screen's WebRTC connection.

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
| DELETE | `/sessions/:sessionId` | End a session |

A machine somebody has no access to answers 404 rather than 403, so machine
ids aren't probeable. See [Remote Desktop](/architecture/remote-desktop) for
the permission model and session-freezing rule.
