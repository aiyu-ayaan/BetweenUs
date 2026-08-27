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
| `listen.add` | `{provider, ref, playNow?}` — a YouTube id. Gateway mints the entry id; `playNow: true` queues and jumps in a single atomic revision |
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

## The panel, and the two bugs its shape came from

Listen Together takes the voice stage, the way a shared screen does, with two
tabs and a transport bar under them. It was a popover on the call controls, and
that was wrong twice.

**It drew itself twice.** `VoiceControls` is rendered in two places — the
sidebar and the channel view — and it drew the panel from a flag in the store.
One flag, two render sites, two live panels side by side, each with its own seek
bar. The rule the fix encodes: *shared state may only be drawn once.* The button
sets the flag and nothing else; `VoiceChannelView` is the single render site,
and pressing the button from the sidebar navigates there first.

**The video filled the screen.** It was `aspect-video w-full`, which on a 1750px
stage is a 984px-tall box, and nothing above it was `min-h-0` — so flexbox let
it push past the bottom of the window. It is now `flex-1 min-h-0` against the
stage and capped at `max-w-5xl`, with **no aspect ratio of its own**: a 16:9 box
cannot be bounded on both axes by `aspect-ratio` alone, because whichever axis
is definite wins and the other one breaks the shape. The player letterboxes
inside whatever box it is given, exactly as it does on youtube.com, so the black
surround is free and correct.

The two tabs are tabs, and not two panes, for a reason beyond space: a native
browser view and an embedded player must never be on screen together. See the
native-surface note below.

```text
┌─ Listen together ──── [Browse] [Playing] ───────────────────── ✕ ┐
│                                              │  Queue            │
│   youtube.com, or the shared video           │  ▸ track one      │
│   (bounded: flex-1 min-h-0, max-w-5xl)       │    track two      │
│                                              │  [paste a link] + │
├──────────────────────────────────────────────┴───────────────────┤
│ ⏮ ⏸ ⏭   Title · added by   3:07 ──●────── 6:12   🔊──   Stop     │
└──────────────────────────────────────────────────────────────────┘
```

Closing it leaves a one-line bar above the tiles with the same transport on it.
The picture parks and the music carries on, which is what closing a panel should
cost.

## Getting a track in: browse, don't paste

Pasting links was the first version and it was the wrong shape. Nobody keeps a
list of video ids. People search for a half-remembered chorus, open a playlist
they made, or look at what their subscriptions posted this morning — and two of
those need a signed-in account.

So on **desktop**, the panel opens youtube.com itself inside the call:

- **Clicking a thumbnail is the control:** Pressing any video on YouTube directly plays it for the entire call (`listen.add` with `playNow: true`) and flips the view to the Playing tab. No extra copy/paste or button clicking is needed.
- **Add to queue stays on Browse:** An "Add to queue" button remains available on the browser bar so listeners can line up subsequent tracks while continuing to search.
- **Atomic jump (`playNow`):** Queuing and playing happen in one server revision. Sending `listen.add` followed by `listen.play` would be two revisions, where a concurrent queue modification could shift track indices and cause the wrong song to play.

### The browser is not a second player

Opening a YouTube watch page naturally starts autoplaying. Left alone, the in-app browser would decode and play its own copy out of sync with the call's shared player.

To prevent this:
1. The `WebContentsView` is permanently muted.
2. The main process intercepts `media-started-playing` events and immediately pauses the internal view. This prevents wasted background CPU/decoding and ensures only the shared stage player plays audio.

### Seek scrubbing without snapback

Dragging and releasing the seek slider commits the new timestamp to the server. To avoid an ugly "snapback" where the UI slider jumps back to the old timestamp while waiting for the network round-trip, the client optimistically holds the scrubbed position until a newer gateway revision arrives (with a 2-second timeout fallback).

### Autoplay-blocked window UX

If an operating system or browser policy refuses background autoplay for a particular client window, the transport marks the local state as blocked with an amber prompt ("press play here"). Clicking it starts audio playback locally with a user gesture, without sending an erroneous global pause command to everyone else in the call.

### Why the site itself is desktop-only, and why that cannot be fixed

youtube.com sends `X-Frame-Options` and a `frame-ancestors` policy. It refuses
to be framed, full stop — only `/embed/<id>` is frameable, and that is the
player and nothing else. No browser tab can show the site inside another page,
however it is asked, so the web client is never shown a frame that will never
load.

### What the web client gets instead: search

The gesture is the same on both clients — look for something, press it, the
whole call watches it — so both live on the same **Browse** tab. What differs is
what Browse *is*:

| | Desktop | Web |
| --- | --- | --- |
| Browse tab shows | youtube.com itself, signed in as you | search results in a grid |
| Search, playlists, subscriptions | the user's own YouTube session | search only |
| Pressing a result | plays it for the call | plays it for the call |
| Needs a credential | no | `VITE_YOUTUBE_API_KEY` |

The search is a `fetch` to the YouTube Data API **from the person's own
browser** (`apps/desktop/src/services/youtube-search.ts`). Nothing about it
touches a BetweenUs service, which is the same rule `listen.meta` follows: no
backend of ours ever talks to YouTube, because a backend that did would need an
API key, an egress rule and an opinion about who is looking for what.

That makes the key a **browser** key, visible to anybody using the site. That is
what Google's HTTP-referrer restriction on a key is for: enable YouTube Data API
v3, restrict the key to the deployment's own hostname. Leave
`VITE_YOUTUBE_API_KEY` unset and the tab says which setting turns it on — the
paste box beside it needs no key and keeps working. The desktop app never reads
it.

Two details that are not decoration:

- **Results are filtered to `videoEmbeddable=true`.** The web client plays
  through the embed, so a video that refuses to be embedded is a black frame for
  everybody in the call, not just for whoever picked it.
- **A pasted link in the search box is recognised, not searched for.** Somebody
  holding the URL already knows which video they mean, and a search costs 100
  units of a 10,000-unit daily quota. Results are also cached per query for the
  life of the tab, so retyping a word is not a second search.

### Why it is not `webviewTag`

Turning on `webviewTag` would let the renderer mount arbitrary web content
anywhere, which is precisely the permission the hardening in `electron/main.ts`
exists to withhold. Instead the **main process** owns a `WebContentsView`
(`electron/youtube-view.ts`), and the renderer may only ask for it to be put
over a rectangle and told which way to go. It never gets a handle on the view.

Three things fence it in:

| | |
| --- | --- |
| **Its own session** | `persist:youtube`. A signed-in Google account survives a restart and is entirely apart from the app's own cookies — nothing here can read a BetweenUs session, and nothing in the app is reachable from a page loaded here |
| **No preload, no Node** | An ordinary browser context with no bridge into this application |
| **It cannot wander** | Navigation is confined to Google's own hosts, which is what a sign-in flow needs and a great deal less than "the internet". Anything else opens in the user's real browser. New windows are refused |

### One native-surface consequence

A `WebContentsView` paints above every pixel of the renderer's DOM, whatever any
`z-index` says. Nothing in the renderer can be drawn on top of it, so anything
that has to be visible at the same time must instead make it **go away**.

That is why Browse and Playing are tabs. Showing the site and the embedded
player side by side would mean the player is underneath a native surface and
invisible, with nothing to explain it. Leaving the browse tab hides the view and
the player claims its rectangle; entering it releases the player, which parks
and keeps playing.

Hiding costs nothing — the sign-in, the scroll position and the search all
survive it. Only ending the call destroys the view.

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

So the directive that changed is `frame-src`, which permits `youtube.com` and
`youtube-nocookie.com`. The embed uses `https://www.youtube.com/embed/<id>` with
`referrerpolicy="strict-origin-when-cross-origin"` and `widget_referrer` parameters
so that Content ID licensed music (e.g. record label videos) plays cleanly without
"Video unavailable" (error 150/101) restrictions. YouTube's code runs in YouTube's
own origin, and the entire surface between them is a message channel that checks
`event.origin` and `event.source` on the way in.

### The `sandbox` attribute that made it silent

The frame carried `sandbox="allow-scripts allow-presentation"` and **nothing
ever played.** Worth writing down, because it fails in the most expensive
possible way — no error, no console message, a player that is visibly present
and simply mute.

A `sandbox` without `allow-same-origin` gives the frame an **opaque** origin, so
every message it posts arrives with `event.origin === "null"`. The origin check
then refuses all of it, correctly and permanently: the handshake never
completes, the queued `playVideo` is never flushed, and the player sits there.

It also bought nothing. A cross-origin frame is already isolated from the
embedding document by the same-origin policy, exactly as hard as the sandbox was
pretending to be. There is no `sandbox` attribute now, and that is deliberate
rather than an omission.

### Cross-Origin Iframe Parking on the Web

In web browsers, cross-origin iframes that are rendered with `1px x 1px` dimensions
or `opacity: 0` are flagged as invisible/background frames. Modern browser engines
aggressively throttle timers and block autoplay/postMessage handshakes on invisible
cross-origin frames. To prevent the audio stream and handshake from freezing when
navigating away from the active video stage, the player host element is parked
off-screen (`top: -9999px; left: -9999px; width: 320px; height: 180px;`) with valid
video dimensions and standard opacity.

Two neighbours of the same bug, fixed at the same time: `origin=file://` is
refused by YouTube outright, so a **packaged build would have failed where the
dev server worked** — the parameter is now sent only for real web origins (with
`127.0.0.1` mapped to `localhost` to satisfy YouTube domain origin security) — and
the embed was never asked to autoplay in its URL, only commanded to over the
channel that was broken.

When a video owner restricts third-party embedding entirely or YouTube returns
`onError` (codes 101, 150, 2, 5), the store records the error state and displays
an actionable notification banner allowing users to skip the track or open it directly
on YouTube.

Anything a client pastes is parsed to a bare eleven-character video id before it
is sent, and checked again at the gateway against the provider's own alphabet.
Whatever comes out of that ends up in an iframe `src` in **everybody else's**
window, so it is a trust boundary and it is tested as one.

## What it deliberately does not do

- **No youtube.com in the web client.** The site refuses to be framed, so the
  web client searches instead of browsing — see above. Playlists and
  subscriptions stay desktop-only, because those need the user's own session and
  the only place that session can be shown is the real site.
- **No YouTube Data API on any server.** The optional search key is read by the
  browser and used by the browser. No service of ours holds it, sends it or
  learns what anybody searched for.
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

## Where it is, in the client

Behind the **Apps** button in the call controls, next to
[Play Together](/architecture/play-together) — one screen in, rather than its
own icon in a row that otherwise belongs to the call. Apps is a screen on the
voice stage rather than a popover, so the chooser, the queue and the player are
all drawn in the same rectangle, and the back arrow on this panel returns to
the chooser rather than to the call.

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
| The queue popover | `apps/desktop/src/features/voice/ListenTogether.tsx` |
| The picture, and the transport | `apps/desktop/src/features/voice/ListenStage.tsx` |
| The in-app YouTube browser (UI) | `apps/desktop/src/features/voice/ListenBrowser.tsx` |
| The web client's search (UI) | `apps/desktop/src/features/voice/ListenSearch.tsx` |
| The web client's search (API call) | `apps/desktop/src/services/youtube-search.ts` |
| The in-app YouTube browser (main) | `apps/desktop/electron/youtube-view.ts` |

## The rule both surfaces follow

**The thing that plays must outlive the component that shows it.**

An iframe removed from the document stops playing and loses its place. A
`WebContentsView` that is destroyed loses the sign-in, the scroll position and
the search. And a rebuilt one is not a recovery — it is a fresh player, back at
zero, refused autoplay, and out of step with everybody else in the call.

So neither ever moves. A React component offers an **empty rectangle**, and the
frame or the view is positioned on top of it, tracked on a frame loop (the box
moves for reasons no `ResizeObserver` reports: a sidebar opening, a banner
appearing above it, the window crossing to another monitor). When the component
unmounts, the picture parks in a one-pixel corner and the music carries on.

Parked is one pixel rather than `display: none` on purpose — a hidden iframe is
one Chromium is entitled to stop, and stopping it is the difference between
music that survives switching to a text channel and music that does not.

## A single replica, for now

The session is held in process, exactly like the call roster. Two
`call-service` replicas would each hold half a session and never introduce the
two halves. The upgrade path is the one `presence-service` already uses — the
roster in Redis, this state beside it — and it is the same change, made once,
for both.
