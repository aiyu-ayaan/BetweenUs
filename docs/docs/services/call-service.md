---
sidebar_position: 7
---

# call-service

The switchboard for peer-to-peer calls — never touches media. See
[Peer-to-Peer Media](/architecture/media).

## `/ws/call`

Roster join/leave, and relay of SDP offers/answers and ICE candidates
between two peers in the same channel's call.

## `/api/v1/calls`

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/ice` | Mint ICE server configuration (STUN always; short-lived TURN credentials when a TURN provider is configured) |

## One call per account

`call-service` evicts an account's other connections when it joins a call in
any channel, so joining on a second device moves the call rather than
putting the same person in the room twice. The evicted device receives
`superseded` before being dropped, so it can say the call moved rather than
reporting a lost connection — and its socket stays open, so joining again
simply moves the call back.
