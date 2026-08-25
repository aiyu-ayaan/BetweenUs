---
sidebar_position: 7
---

# Listen Together

Two people in a voice channel, working, with the same music playing in both
sets of headphones — in step, at full quality, and either of them able to
change what it is.

It is the one thing in BetweenUs that looks like media and deliberately is not.

## The idea, in one paragraph

**No audio crosses the wire.** Each client plays the track itself, from
YouTube, over its own connection. What `call-service` relays is a queue and a
position — a few hundred bytes when somebody presses a button, and nothing at
all in between. The result is signalling, so it goes down `/ws/call` beside the
SDP and through a Cloudflare Tunnel like everything else.

```text
   Client A                                            Client B
      │                                                    │
      │  /ws/call: "play track 3 from 1:04, as of now"      │
      └──────────────►  call-service  ◄────────────────────┘
                        (queue, position, ordering)
      │                                                    │
      ▼                                                    ▼
   youtube.com                                        youtube.com
   (A's own connection)                               (B's own connection)
```

## Why not just share a tab with the sound on

That was the obvious answer and it is worse in five separate ways:

| Sharing a tab | Listen Together |
| --- | --- |
| One video **upload per listener** from the sharer's machine | Zero uplink |
| Music re-encoded through a codec tuned for **speech** | Full quality, from the source |
| Everyone hears whatever survived the trip | Everyone hears the original |
| The sharer cannot alt-tab away from the tab | Nobody has to keep a window open |
| Only the sharer can change the track | Anybody in the call can |

The mesh already costs each participant one upload per other participant for
voice and video (see [Peer-to-Peer Media](/architecture/media)). Adding a music
stream to that is the most expensive possible way to solve a problem that a
timestamp solves for free.

## The state, and why it is shaped that way

A session never stores "the position". It stores a position **and the instant
it was true**:

```ts
interface ListenSession {
  rev: number;            // bumped by the gateway on every change
  queue: ListenTrack[];
  index: number;
  paused: boolean;
  positionMs: number;     // where the track was...
  atServerMs: number;     // ...at this moment on the gateway's clock
  byUserId: string | null;
}
```

A client reads the current position as `positionMs + (serverNow - atServerMs)`
while playing, and as `positionMs` while paused. So **one message stays correct
until somebody presses something** — there is no stream of position updates,
and a client that has been quiet for ten minutes is still in step.

The arithmetic lives in `@betweenus/shared-types` (`listenPositionAt`) rather
than in either the service or the client, because it *is* the meaning of those
two fields. A gateway that advanced the position differently from the clients
reading it would be a session where nobody is wrong and nobody agrees.

## The clock

Two machines disagree about what time it is by whatever their NTP daemons last
settled on — usually milliseconds, occasionally seconds, and on a laptop that
woke from sleep, whatever it feels like until the next sync. A session that
trusted `Date.now()` on both ends would be exactly as far out of step as the
clocks are, and neither person could tell why.

So `call-service` stamps its own clock onto every `pong`, and each client
measures its offset the way NTP does:

```text
offset = serverMs + roundTrip / 2 - receivedAt
```

Eight samples are kept and **the least-delayed one wins** — not the average. A
slow round trip is slow because something queued, and a queue is almost never
symmetric, so a delayed sample is *biased* rather than merely noisy; averaging
spreads that bias across the answer instead of discarding it.

## Drift, and why it is left alone

A player is not an oscillator. It buffers, it rebuffers, it decodes at whatever
rate the machine manages, and it drifts. Each client checks itself against the
shared position every five seconds and does nothing until the gap passes
**1.5 seconds**, then closes it in one seek.

Tightening that does not make the feature better — it makes it seek every few
minutes, and a seek is a hole in the music where being a second out is only
being a second out.

The textbook alternative, nudging `playbackRate` by a few percent to close small
gaps smoothly, does not work here: the YouTube embed quantises playback rate to
the values in its own menu, so a request for 1.04 is either refused or rounded
to 1.25 — a chipmunk rather than a correction.

## Ducking

While anybody in the call is speaking, the music drops to a quarter and fades
back nine hundred milliseconds after the last word.

This is the bit that makes it *working together* rather than *watching a film*.
Two people with music on and microphones open otherwise turn the volume down by
hand every time one of them starts a sentence, until they give up and mute. The
hold exists because speech is not continuous — a duck that recovers instantly
pumps the volume through every pause in a sentence, which is more distracting
than the music was.

It rides on the speaking detection the call already does, which is measured from
the audio rather than from whether a microphone is open — so a muted person in a
noisy room does not turn anybody's music down.

## There is no host

Anybody in the call may add, remove, skip, seek, pause or stop. A host is a
person who eventually leaves and takes the music with them; the queue is a thing
the room built and it belongs to the room.

What that needs is an ordering, and a mesh has none — the same problem the
screen share has, with the same answer. `call-service` holds the sockets, so it
is the only thing that can say which of two simultaneous presses happened
second. Every change bumps `rev`, and a client drops any state numbered at or
below one it has already applied, so its own echo cannot undo somebody else's
later change.

## The protocol

Client → server, on `/ws/call`:

| Event | Meaning |
| --- | --- |
| `listen.add` | `{provider, ref}` — a YouTube id. The gateway mints the queue-entry id |
| `listen.remove` | `{trackId}`. Emptying the queue ends the session |
| `listen.play` | Resume, or `{index}` to jump |
| `listen.pause` | `{positionMs}` — where this window's player actually stopped |
| `listen.seek` | `{positionMs}` |
| `listen.skip` | `{delta}`. Back within 3s means "previous"; later means "restart this" |
| `listen.stop` | Closes it for everybody |
| `listen.ended` | `{trackId}` — "my player finished this" |
| `listen.meta` | `{trackId, title?, durationMs?}` — "my player learned what this is" |

Server → client: `listen.state` with the whole session (or `null`), and `pong`
carrying `serverMs`.

Two of those deserve a note.

**`listen.ended` is sent by every client, and the gateway advances once.** The
track id is checked against the one playing, so the second and third arrivals
are about a track that is no longer current and do nothing — idempotent by
construction rather than by electing a reporter, because electing one means the
queue stops when that person's window closes.

**`listen.meta` exists because a pasted link has no title.** Only a player that
has loaded the video knows it, and nothing on the server may go and ask: an
outbound call from a backend service to fetch a title is a service that needs an
API key, an egress rule and an opinion about who is listening to what. The
clients have the player open anyway. First one to know fills it in; a later
client reporting a *different* title is ignored, since that is either a regional
cut or somebody relabelling a track in everybody else's queue after the fact.

## The player, and the CSP

The obvious way to embed YouTube is to load `iframe_api.js` and use the object
it hands back. That is **remote code running in the renderer**, and the client's
whole CSP argument is one line: `script-src` stays `'self'`, so nothing this
window fetches can become code.

It is not needed. `iframe_api.js` is a wrapper around a `postMessage` protocol
the embed speaks anyway, and that protocol is about a hundred lines
(`apps/desktop/src/services/youtube.ts`):

- post `{event: 'listening'}` and the frame starts reporting state;
- post `{event: 'command', func, args}` to drive it;
- it posts `{event: 'infoDelivery', info: {...}}` with position, player state,
  duration and title.

So the only directive that changed is `frame-src`, which now names
`youtube-nocookie.com` and nothing else. YouTube's code runs in YouTube's own
origin, in a `sandbox="allow-scripts allow-presentation"` frame with no
`allow-same-origin` — it cannot read this document and this document cannot read
it — and the entire surface between them is a message channel that checks
`event.origin` and `event.source` on the way in.

Anything a client pastes is parsed to a bare eleven-character video id before it
is sent, and checked again at the gateway against the provider's own alphabet.
Whatever comes out of that ends up in an iframe `src` in **everybody else's**
window, so it is a trust boundary and it is tested as one.

## What it deliberately does not do

- **No search.** Paste a link. In-app search needs a YouTube Data API key, which
  is a per-deployment credential and an egress rule for a convenience.
- **No video.** The player's frame lives in a one-pixel corner of the document
  and never moves — an iframe removed from the document stops playing, so
  putting it inside the panel silenced the music the moment the panel closed.
  Giving that element somewhere visible to live is what would draw the picture.
- **No Spotify, yet.** It is a second `ListenProvider` and a second class with
  the same four methods, but it needs an OAuth flow, a Premium account per
  listener, and the Web Playback SDK — which *is* remote code, and so needs the
  CSP conversation this design avoided. The seam is the discriminant on
  `ListenTrack`; nothing is modelled ahead of it.
- **No persistence.** The session lives in memory beside the roster and dies
  with the call. The queue three people built while they worked has no meaning
  tomorrow.
- **Android listens but does not drive** — and today does neither. See
  [Android client](/architecture/android-client).

## Where the code is

| Piece | File |
| --- | --- |
| Protocol and the position arithmetic | `packages/shared-types/src/index.ts` |
| The transport state machine (pure) | `apps/services/call-service/src/listen-session.ts` |
| Its self-check | `apps/services/call-service/src/listen-session.check.ts` |
| Gateway wiring | `apps/services/call-service/src/call.gateway.ts` |
| Clock and drift | `apps/desktop/src/services/listen-sync.ts` |
| The YouTube embed | `apps/desktop/src/services/youtube.ts` |
| Reconciler and ducking | `apps/desktop/src/stores/listen.ts` |
| The panel | `apps/desktop/src/features/voice/ListenTogether.tsx` |

## A single replica, for now

The session is held in process, exactly like the call roster. Two
`call-service` replicas would each hold half a session and never introduce the
two halves. The upgrade path is the one `presence-service` already uses — the
roster in Redis, this state beside it — and it is the same change, made once,
for both.
