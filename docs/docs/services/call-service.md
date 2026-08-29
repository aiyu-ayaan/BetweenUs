---
sidebar_position: 7
---

# call-service

The switchboard for peer-to-peer calls — never touches media. See
[Peer-to-Peer Media](/architecture/media).

## `/ws/call`

Roster join/leave, and relay of SDP offers/answers and ICE candidates
between two peers in the same channel's call.

## Listen Together

The same socket carries a shared listening session: a queue, a cursor into it,
and a position stamped against the gateway's own clock. No audio goes near it —
every client plays the track itself, from YouTube, over its own connection — so
this is signalling exactly like an SDP is, and costs no uplink at all.

`listen.add / remove / play / pause / seek / skip / stop / ended / meta` come in;
`listen.state` with the whole session goes out to everybody, and `pong` carries
`serverMs` so a client can measure its clock against this one. `listen.add` supports
an atomic `playNow` flag so pressing a video thumbnail jumps and plays immediately
within a single revision without queue race conditions.

There is no host: anybody in the call may press anything, and `call-service` is the ordering,
which is the same job it does for the screen share and for the same reason.

Held in process beside the roster, and it dies with the call. Full design:
[Listen Together](/architecture/listen-together).

## Play Together

The same socket carries one board game per call, and here `call-service` is the
referee rather than only the ordering: a client sends `game.move` with a number
— a square, a column, a line — and the gateway applies the rules, works out
what the board became, and broadcasts it. For carrom the move is a shot rather
than a square: three numbers in `params`, which the gateway bounds and then
feeds to the same physics simulation every client replays to animate it. For
ludo the gateway also rolls the die, with `randomInt`. A client never sends a board, because
a board a client can set is a board a client can set to won.

`game.open / sit / move / rematch / close` come in; `game.state` with the whole
session goes out to everybody, the joiner included. The rules themselves live
in `@betweenus/shared-types` and are imported by both ends, so what the referee
decides and what every client draws cannot drift apart.

Anybody in the call may open a game or take an empty chair; only the person in
a seat may move it, only on their turn, and only once every chair is full. A
leaver's chair is freed on the same terms their peer seat is — after the rejoin
grace — and the board is left standing.

Held in process beside the roster, and it dies with the call. Full design:
[Play Together](/architecture/play-together).

## `/api/v1/calls`

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/ice` | Mint ICE server configuration (STUN always; short-lived TURN credentials when a TURN provider is configured) |
| POST | `/ring` | Ring one person into a call in a channel both can see. Rate-limited per pair |
| GET | `/history` | This account's own call log, newest first (last 50). Takes no user id |
| GET | `/analytics?days=30` | The same rows added up: a point per day, busiest channels, most time with, direct/relay split |

## Losing the socket is not losing the call

Media never passes through `/ws/call`, so a client whose signalling socket
drops keeps every peer connection it had. `call-service` holds that peer's
seat for a grace window — a peer id is issued per *device*, not per socket, so
a client that reconnects inside the window resumes the seat it had and nobody
else in the call is told anything happened: no `peer.left`, no `peer.joined`,
no renegotiation.

Clients reconnect with backoff for up to 45 seconds and only then treat the
call as over. On a rejoin, the roster in `joined` is also the correction —
anyone whose `peer.left` arrived while the socket was down is dropped then,
so a departed peer cannot linger as a tile that never comes back.

## One call per account

`call-service` evicts an account's other connections when it joins a call in
any channel, so joining on a second device moves the call rather than
putting the same person in the room twice. The evicted device receives
`superseded` before being dropped, so it can say the call moved rather than
reporting a lost connection — and its socket stays open, so joining again
simply moves the call back.

## The call log

`call_sessions` is one row per person per stay in a call, opened and closed by
`/ws/call` — the only thing holding the sockets, and therefore the only thing
that knows when somebody really arrived and left. The channel and server names
are **copied into the row** rather than joined at read time: the entry somebody
most wants back is the channel that has since been deleted.

### Data usage is the client's figure, and can only be

Media is peer to peer, so no service is in the path to count a byte. Each client
measures its own peer connections and reports on the way out, per link:

| Field | Meaning |
| --- | --- |
| `bytesSent` / `bytesReceived` | This client's totals for the whole call |
| `links[]` | One entry per peer connection: who it was with, its bytes, round trip, loss |
| `links[].transport` | `direct`, `relay`, or `null` — whether ICE settled on a direct path or on TURN |

Nothing here is checkable, so it is **clamped rather than trusted**, on the way
in and again on the way out (`usage.ts`): the worst a broken or hostile client
can do is write a wrong number into its own row. A client killed mid-call
reports nothing at all, and the entry says so rather than saying zero.

The reading of a link is taken **before** its connection is closed — a closed
`RTCPeerConnection` answers `getStats` with nothing, which is why a call that
lost four people one at a time used to report only the last one's traffic.
