# Nexora Development Planning

Living document. `CLAUDE.md` is the target architecture; this file records how
we get there in stages and what each stage delivers.

## Phase map

| Phase | Name | Delivers | Status |
| --- | --- | --- | --- |
| 0 | Scaffold | Monorepo, workspaces, empty service folders | Done |
| 1 | Dev infrastructure | Postgres + Redis via Docker Compose, env template | Done |
| 2 | Shared packages | shared-types, config, logger, auth, permissions, events, database (Prisma) | Done |
| 3 | Auth service | Register, login, refresh rotation, `/me`, `/health` | Done |
| 4 | Server service | Servers, members, channels | Done |
| 5 | Chat service | Message REST + WebSocket gateway + Redis fanout | Done |
| 6 | Gateway | Nginx REST/WebSocket routing, rate limits, prod compose | Done |
| 7 | Desktop client | Electron + React + Tailwind + Zustand, end-to-end chat | Done |
| 8 | Encrypted chat + voice | E2EE messages, LiveKit voice channels, two-window dev harness | Done |
| 9 | Presence | presence-service, online status, typing indicators, voice rosters | Done |
| 10 | Hardening | Tests, CI, error contract polish, request IDs everywhere | In progress |
| 11 | Admin panel, OAuth, notifications | Admin web app, Google/GitHub sign-in, desktop notifications | Done |
| 12 | Servers, permissions, DMs | Workspace renamed to server, per-member permissions, private channels, friends and direct messages, Discord-parity client | In progress |
| 13 | Media | Encrypted attachments of any type, client-side compression, multipart upload, avatars and server icons | In progress |
| 14 | Notifications | notification-service, system tray, start with the system, mutes and quiet hours | Done |
| 15 | Social graph and realtime | Message deletion, adding people to a server, friend and membership events over `/ws/chat` | In progress |
| 15b | Message actions | Tombstones, editing, pins, reactions, emoji, in-client search, right-click menu | In progress |
| 16 | One address, any server | A single URL for a whole deployment, resolved at runtime, changeable from the login screen | In progress |
| 17 | Remote desktop | remote-gateway, the agent inside the desktop app, per-machine permissions, audit log | In progress |
| 18 | Production ingress | Cloudflare Tunnel (host or container), gateway healthcheck, image pipeline | In progress |
| 23 | Web client | `apps/web`: the same UI in a browser at the root of the gateway, without the remote-desktop section | In progress |
| 24 | Peer-to-peer media | LiveKit removed; `/ws/call` signalling, a WebRTC mesh for calls, a direct peer connection for remote desktop | In progress |
| 25 | The call follows the account | Call survives navigating anywhere in the client, one call per account across devices, a browser prompt before a tab with a live call closes | In progress |
| 26 | The workbench | The client stops being a copy of Discord: own palette, floating panels on a ground, a command bar with Ctrl+K, one entrance for everything that opens | In progress |

Hardening moved to phase 10: encryption changes the message format and presence
adds a service, so both were cheaper to land before tests were written against
the older shape.

## Architecture decisions made so far

### The API's trust boundaries, audited (phase 27)

A pass over every route, guard and gateway, asking one question of each: what
does this believe, and who gets to tell it. Seven things were believing the
wrong party, and the write-up now lives in `SECURITY.md` alongside the gaps that
are still open on purpose.

The two that were reachable from outside with nothing but a request:

**A caller could choose which rate-limit bucket counted them.** The
service-level limiter read the first entry of `x-forwarded-for`, and Nginx
*appends* to that header rather than replacing it — so a request carrying
`X-Forwarded-For: 1.2.3.4` arrived as `1.2.3.4, <real address>` and the first
entry was whatever the caller wrote. A credential-stuffing run could pick a
fresh one per request and never touch its budget. `x-real-ip` is set with
`proxy_set_header`, which replaces what arrived, so it cannot be chosen; it is
read first, and the *last* hop of `x-forwarded-for` is the fallback.

**The OAuth redirect allow list was a `startsWith`.** An entry of
`https://nexora.example` also matched `https://nexora.example.attacker.test/`,
and that URL is where the one-time code that becomes a session travels. Origins
are parsed and compared as origins now, with a path prefix allowed only once the
origin already matches.

The rest, in the order they matter:

- **A token said how it should be checked.** `jwt.verify` without `algorithms`
  accepts whatever the token's header asks for. Both verifiers pin HS256.
- **Nothing checked that a signing secret existed in any meaningful sense.**
  `.env.example` ships `JWT_SECRET="replace-me"` — a value in this repository —
  and a deployment that never generated one would sign real sessions with it.
  The placeholders are refused, the two secrets must differ, and production
  requires 32 characters.
- **An unverified provider email could find an account.** Google will hand out
  an address it has not verified; `email_verified` says which kind it is and was
  being ignored, so typing a victim's address into a fresh Google account was a
  way into their Nexora account.
- **A session was treated as an entitlement to every attachment.** The download
  route asked only whether the caller was signed in, so any account that came by
  a key could fetch the bytes behind it, private channels and direct messages
  included. The attachment row and `resolveChannelAccess` answer it properly
  now.
- **Every socket took the `ws` default of a 100 MB frame**, buffered in the
  service's heap before a line of gateway code ran. Capped at what the traffic
  actually is: 64 KB for chat and presence, 256 KB for call and remote.
- **`credentials: true` sat next to `origin: '*'`**, a pair no browser honours,
  on an API whose clients attach a bearer token themselves. Credentials are
  allowed only when `CORS_ORIGIN` names the sites they may come from.

Each of the six with something checkable behind it got a runnable check rather
than a note — `@nexora/nest-common` gained its first, `auth` and `auth-service`
extended theirs — because a trust boundary nobody can run is a trust boundary
that comes back.

### The workbench (phase 26)

The client was Discord's, and not by resemblance: the palette was Discord's hex
values (`#313338`, `#5865f2`), the font stack asked for `gg sans` first, the
rail drew Discord's blob pill, and the layout was Discord's four flush columns.
That was a reasonable way to get a working client quickly and a bad thing to
keep, because it left Nexora with no way to look like anything.

What replaces it is closer to how an editor lays itself out than to how a chat
app does:

- **Panels on a ground, not columns in a wall.** Every region - rail, sidebar,
  main surface, right-hand panel - is a rounded card with a hairline edge, and
  the gutter between two of them is the window's ground showing through.
  `.panel` in `index.css` is the single definition of that shape, so a new
  region cannot end up drawn slightly differently.

  The layout consequence is the reason it is worth doing: a panel can be hidden
  without leaving a seam, because there was never a seam. The sidebar and the
  right-hand panel toggle from the top bar, and the right-hand toggle is only
  rendered where a right-hand panel exists at all.

- **One bar across the top, with the command field in the middle of it.** A
  chat app usually hangs search and navigation off whichever column had room.
  A single bar gives the panels below one frame to sit in and puts the command
  field where somebody looks for it. Idle, the field says where you are, which
  is the other question a column header used to answer.

- **Ctrl+K goes anywhere.** Servers, the open server's channels, and every
  conversation, in one filtered list. Pointing at a sidebar is fine with four
  channels and useless with forty, and this is the same move an editor makes
  with its file switcher. It is deliberately the app's only global shortcut:
  everything else is reachable from it.

- **One palette, one entrance.** A cool near-black ink ramp with an iris accent
  at `#7c5cff`, defined once in `tailwind.theme.mjs` and positional by name, so
  a component never has to know which grey it is standing on. Everything that
  opens on top of the workbench - dialogs, menus, pickers - shares
  `animate-pop`: a 140ms rise from four pixels below at 98% scale. Focus rings
  around text fields are gone; a field says it has focus with its own edge, and
  the caret was always the real indicator.

  `prefers-reduced-motion` already collapses every duration in the client to
  0.01ms, so all of it degrades to appearing instantly.

Both clients get this at once: `apps/web` imports the same theme and mounts the
same components, which is what "the two clients are meant to look identical"
has meant since phase 23.

### The call follows the account (phase 25)

Phase 24 made a call a set of peer connections owned by a store. Phase 25 makes
the rest of the client behave as though that were true.

- **A call is a connection, not a screen.** The audio sinks used to live inside
  the sidebar's voice panel, and the home screen swaps the whole sidebar out -
  so opening a direct message or switching servers unmounted every `<audio>`
  element and the call went silent while still connected by every other
  measure. They now live in `CallAudio`, mounted once at the root of the
  workbench and never unmounted. Nothing below the root may own a piece of the
  call.

- **The call remembers where it is; the channel list does not.** `chat.channels`
  holds the *current* server's channels, which is exactly the thing a call
  outlives, so the voice store records the channel's name and server at join.
  That is what lets the panel say where you are from another server, and what
  makes the name a button that loads the server back and reopens the call.

- **One call per account, across devices.** A peer id stays per socket - two
  windows really are two ends of two different peer connections, and collapsing
  them is what the phase-24 design deliberately avoided. What is limited is the
  *person*: `call-service` evicts an account's other connections when it joins
  a call, in that channel or any other, so joining on the laptop takes the call
  off the desktop instead of putting one person in the room twice with two
  microphones. The evicted device gets `superseded` before it is dropped, so it
  can say the call moved rather than reporting a lost connection, and its socket
  stays open so joining again simply moves the call back.

  Enforcing this in the gateway rather than the client is the point: the client
  that has to be told to leave is the one that has already stopped being
  trusted to.

- **The web client asks before the tab closes.** Closing or reloading a tab
  takes every peer connection with it and there is no undo, so a `beforeunload`
  handler is registered for exactly as long as a call is up. Desktop is excluded
  - a window that closes has a tray and a main process behind it - which is the
  same runtime split `services/platform.ts` draws everywhere else.

### Peer-to-peer media (phase 24)

Phase 8 put voice on LiveKit, and phases 16-18 spent most of their length
fighting the consequence: an SFU is a server that carries UDP, and the public
ingress for this project is a Cloudflare Tunnel, which carries HTTP and
WebSocket and nothing else. Every fix was a way of smuggling media past the
tunnel - `LIVEKIT_NODE_IP` so the SFU advertised a routable address, a second
public port, then TURN so the media could be relayed after all. The last four
commits before this phase are all that one problem.

Phase 24 removes the SFU instead. Media goes directly between the two clients,
which is the one arrangement that never needed the tunnel in the first place.

- **The tunnel carries signalling, and signalling is a WebSocket.** That is the
  thing Cloudflare Tunnel is actually good at, and it is the same shape as
  `/ws/chat` and `/ws/presence`, which have worked through the tunnel from the
  day it was set up. There is no longer any traffic in this system that the
  tunnel is a bad fit for.

- **No service advertises an address.** The whole `LIVEKIT_URL` /
  `LIVEKIT_NODE_IP` family is gone, along with the class of bug where the
  advertised address is right for a client on the server and wrong for every
  other client - which the operator cannot reproduce, because their own test
  always passes. Peers exchange ICE candidates and settle it themselves.

- **`call-service` becomes a switchboard.** It authenticates, checks
  `START_CALL`, keeps the roster of who is in a channel's call, and relays
  offers, answers and ICE candidates between two peers. It has no media path,
  no room state worth persisting, and nothing to recreate a container for.

- **Full mesh, with an honest ceiling.** Each participant holds one
  `RTCPeerConnection` per other participant and uploads one copy of its media
  per peer. That is comfortable to about five on video and about eight on voice
  alone, and it is not a bug: it is the trade for having no server in the path.
  Anything larger wants an SFU back, and that will be a decision made on
  purpose rather than by drift.

- **End-to-end encryption gets simpler, not weaker.** LiveKit needed insertable
  streams and a worker to encrypt frames, because the SFU was a hop that must
  not be able to read them. With no hop, DTLS-SRTP between the two peers *is*
  end to end. What that alone would not stop is the signalling server swapping
  a DTLS fingerprint to put itself in the middle, so each peer signs its
  fingerprint with the channel key - which `call-service` has never held - and
  the other side refuses a connection whose fingerprint is not signed. The
  guarantee is the one E2EE.md already claimed; the machinery behind it is a
  few lines instead of a worker.

- **STUN is required; TURN is optional and off.** STUN is not a relay and needs
  no open port - a peer asks a public server what its own public address looks
  like. TURN is a relay and stays unconfigured by default, so a deployment
  relays nothing unless its operator decides to. The cost of leaving it off is
  that peers behind symmetric or carrier-grade NAT cannot connect at all; the
  Cloudflare TURN minting from phase 18 is kept for whoever wants to pay it.

- **Remote desktop rides the socket it already has.** `/ws/remote` already
  relays session state and input between the controller and the agent, so the
  offer/answer/ICE exchange is three more event types on a wire that exists,
  not a second signalling service. The screen then goes directly between the
  two machines, and `remote-gateway` stops minting tokens for a media server
  that is no longer there.

### The web client (phase 23)

- **One UI, two runtimes — not two codebases.** `apps/web` is a Vite bundle
  whose entry point mounts `apps/desktop/src/App`. There is no copy of the chat
  view, the voice panel or the settings screens: a change lands in the Electron
  app and in the browser at the same commit, which is the only arrangement that
  stays true after six months. The desktop tree keeps the shared UI because it
  was there first; moving it to `packages/ui` would be a rename with no other
  effect, and is worth doing only if a third client appears.
- **What a browser does not get is decided at runtime, not by a build flag.**
  The app asks whether the Electron preload bridge is there
  (`services/platform.ts`). That is the honest question: every part the web
  client omits is omitted *because* it needs the bridge — screen capture by
  source, synthetic mouse and keyboard input, the OS keychain. A `VITE_IS_WEB`
  flag would encode the same fact one step further from the reason, and would
  be wrong the first time somebody built the web bundle for Electron.
- **The remote-desktop section is absent from the web client.** No machine
  list, no agent, no Remote Access settings. A browser tab cannot be enrolled
  as a machine — nothing in it can move the host's mouse — so offering the
  section would be offering a door that opens onto nothing.
- **Asking for control of a screen share inside a call still works in the
  browser.** It is the opposite direction: the controller only publishes input
  events over the LiveKit data channel, and the machine being driven is the one
  that needs the bridge to apply them. A web client can therefore drive a
  desktop machine's shared screen, and a web client sharing its own screen
  refuses control with "control is not supported on that machine", which was
  already the answer for macOS and Linux.
- **Served at the root of the gateway, as its own container.** `/` is the app,
  `/admin` is the panel, `/api` and `/ws` are the services. Nginx matches the
  longest prefix, so the new root location cannot shadow any of them. The image
  is another target in the shared Dockerfile and another service in compose:
  built, deployed and rolled back on its own, like everything else here.
- **Provider sign-in redirects the page; it does not open a loopback server.**
  The desktop client starts a temporary server on `127.0.0.1` because a
  packaged renderer has no origin a provider can return to. A tab has one, and
  the auth service already accepted a `redirect` parameter checked against
  `OAUTH_ALLOWED_REDIRECTS` - the admin panel's flow. So the browser leaves for
  the provider and comes back with the same one-time code the desktop client
  gets, which `restore` trades for a session before anything renders. A
  deployment has to list its own origin in `OAUTH_ALLOWED_REDIRECTS`;
  `localhost` is allowed already, so development needs nothing.
- **Notifications in a tab use the Notifications API.** Permission is asked at
  the first notification worth raising rather than at sign-in, because a prompt
  on the way in is the one people refuse; the unread count goes in the title,
  which is the only badge a tab owns. This covers an open tab only - a closed
  one needs a service worker and Web Push, which is in the backlog.
- **The bundle talks to the origin it was served from.** A page delivered over
  http(s) was delivered *by* a gateway, so that is the deployment — for the dev
  server's proxy as much as for the real Nginx. `VITE_API_URL` is now only what
  a packaged renderer falls back to, because `file://` has no origin to read.

### Remote desktop (phase 17)

The most dangerous thing this platform can do, so it is the most separated: its
own service, its own permission vocabulary that no role grants, its own network
in the compose file, and an audit trail nothing in the application updates or
deletes.

**The agent is the desktop app.** `apps/services/remote-agent` stays a scaffold
for a headless server. On a machine somebody uses, the app is already there and
already has everything an agent needs - `desktopCapturer`, a LiveKit publisher,
and `safeStorage` to keep a credential in. Writing a second process to do what
the first one already does would have been scaffolding for its own sake.

**The machine dials out.** It enrols under the account signed in on it, gets a
token back once, stores it hashed on the server and sealed in the OS keychain
on the machine, and connects to `/ws/remote`. Nothing ever connects *towards* a
machine; there is no inbound port and no 3389 anywhere in the stack. A stolen
token is revoked by enrolling again, which rotates it.

**Permissions are per machine and expire.** `resolveRemoteAccess` is the single
answer, the way `resolveChannelAccess` is for channels: owning the machine, or
an unexpired grant, and null for everything else - so a machine somebody has no
access to answers 404 and machine ids are not probeable. An expired grant keeps
its row rather than being swept, because "access lapsed" is something an owner
should be able to see. Granting control implies view: a session that can type
into a screen nobody is watching is not worth being able to grant.

**A session freezes what it was granted.** The permissions are copied onto the
session row when it opens, and the relay checks every event against that copy.
That makes a mid-session change a decision instead of a race: revoking a grant
*ends* the session rather than quietly narrowing it. Refused events are audited
as well as rejected - a client that keeps asking for something it never had is
worth being able to see afterwards.

**Media is the voice path.** The agent publishes its screen into a LiveKit room
of its own and the controller subscribes; the gateway mints both tokens, the
agent's as publish-only and the controller's as subscribe-only. No second media
stack, and no pixels through NestJS. Unlike a voice channel this is *not* end
to end encrypted - there is no channel key to reuse and no key exchange between
two machines that have never spoken - so the SFU, which the operator runs, can
see the frames. `E2EE.md` records it as a limit rather than leaving it implied.

**Consent depends on who is asking.** The owner reaching their own desktop from
another device is the case remote access exists for, and making them walk over
and click yes would defeat it, so that starts immediately. Anyone else raises a
prompt on the machine that refuses itself if nobody answers: a grant is
permission to ask, not permission to start.

**Input injection is a PowerShell process, not a native module.** Electron's
`sendInputEvent` reaches the app's own window, which is the one place a remote
session does not care about. The alternatives were a native addon (node-gyp, a
rebuild per Electron version, a prebuilt binary per platform) or spawning
something per event (far too slow to drag a window with). Instead one
long-lived PowerShell process P/Invokes `user32` and is fed one short line per
event. Windows only; macOS and Linux report unsupported and a session there is
view-only, with the backend interface already the seam a CGEventPost or XTEST
implementation would slot into.

### Public ingress, on a server that already has a tunnel (phase 18)

The original plan assumed `cloudflared` would be Nexora's own container. On a
box already running one tunnel for everything, that is the wrong shape: a
second tunnel, a second token, a second thing to keep alive.

Both now work and the difference is one line. The gateway publishes on the host
as `GATEWAY_PORT`, so an existing tunnel adds one ingress entry pointing at
`http://localhost:8080`. The `--profile public` container is unchanged for
anyone who wants Nexora to bring its own, and now waits on a gateway
healthcheck rather than on the container merely existing. What a tunnel cannot
carry is stated rather than implied: WebRTC media negotiates its own UDP path
to the SFU, and needs those ports or a TURN server.

### One address, any server (phase 16)

Nexora is meant to be self-hosted, and until this phase the client could not act
like it. Two build-time variables (`VITE_API_URL`, `VITE_WS_URL`) fixed the
deployment at compile time, the renderer's CSP named every host it was allowed
to reach, and voice was told an absolute LiveKit URL - so "run your own Nexora"
meant rebuilding the app.

**One base address, read at runtime.** Everything now goes through
`apps/desktop/src/services/endpoint.ts`, which holds one URL and derives the
rest of it: the WebSocket base is the same host with a `ws` scheme, and the
`/api/v1/uploads/...` URLs the server hands back for avatars and server icons
are resolved against it (they resolved against `file://` in a packaged window
before, which is a bug this fixes on the way past). Nothing else in the client
knows a host. The address is read per request rather than captured at import.

**`VITE_API_URL` is the only variable left, and it is only a default.** Unset
means "the Vite dev server proxies for me", which is what `pnpm dev` does; Vite
now reads the repo-root `.env`, so that variable sits next to the ports it has
to agree with. `VITE_WS_URL` is gone - it was always the first URL with a
different scheme.

**The login screen can point the window anywhere.** "Connect to a self-hosted
instance", the same affordance AFFiNE offers, opens a dialog that normalises
what was typed (a bare hostname means `https`, a trailing slash goes, a path is
kept for a deployment behind someone's existing proxy) and probes it against
the public provider route before storing it. A typo is a line under the field,
not an app that will not start. The same dialog is on My Account, so the server
is changeable at any time and not only before the first sign-in. Connecting
elsewhere signs the window out first - tokens, device keys and the ids inside
them belong to the deployment that issued them - and then reloads, which is the
honest way to make every store, socket and cache let go at once.

**LiveKit signalling moved behind the gateway.** Nginx proxies `/livekit` to
the SFU, and `LIVEKIT_URL` may now be that path instead of a host; the client
resolves a path form against the address it is already talking to. That is what
makes the promise true for voice as well: one hostname, one certificate, one
Cloudflare Tunnel. Media is unchanged and still does not pass through Nginx -
WebRTC negotiates its own UDP path to the SFU on 7881 and the 50000+ range, and
no reverse proxy can stand in for that.

**The CSP stopped naming hosts.** `script-src` stays `'self'` - nothing the
window fetches can become code, which is the part that matters in Electron -
but `connect-src` and `img-src` are open to `http:`/`https:`/`ws:`/`wss:`. An
allowlist compiled into the app cannot know an operator's hostname, and one
that has to be right for every future deployment is one that will be wrong.

### What you can do to a message (phase 15b)

- **A deleted message leaves a tombstone, and it says who did it.** The first
  cut simply removed the row from the view, which reads as if the conversation
  never had it - and it hides the difference between an author taking their own
  words back and a moderator taking somebody's words down. Those are different
  events and a thread read afterwards should not make them look the same, so
  `deletedById` is stored when it was not the author, and the client draws
  either *Message deleted* or *Message deleted by NAME*. The body is still
  emptied: the tombstone is a fact about the conversation, not a copy of what
  was said.
- **One client event for every after-the-fact change.** An edit, a deletion, a
  pin and a reaction all reach the client as `message.updated` carrying the
  whole message, and the client replaces its copy. The alternative - an event
  per verb, each patching a different field - is four chances to disagree about
  what a message currently is. `message.deleted` as a distinct client event is
  gone; a tombstone arriving with `deletedAt` set says the same thing and
  needs no second code path.
- **Editing is the author's alone.** A moderator may remove a message but never
  rewrite it: putting different words in somebody's mouth is not moderation. The
  new envelope replaces the old one, so there is no edit history - documented in
  `E2EE.md` rather than quietly true.
- **The hover bin became a right-click menu.** A control that only appears on
  hover has to be discovered by accident and covers the message it belongs to,
  and there is no room in a corner for react / edit / pin / copy / delete. A
  context menu is where people already look for "do something to this", and it
  keeps the two-click arming for the destructive item.
- **Pinning is `MANAGE_MESSAGE` in a server channel and free in a direct
  message.** A pin is a claim on everyone's channel header, so it is a moderator
  act - but a DM has no roles to hold, and inventing one so two people can
  bookmark a message would be silly. The permission is new because reusing
  `DELETE_MESSAGE` would have made the settings screen lie about what the
  toggle does.
- **A reaction is stored in the clear, and that is written down.** It is the
  one part of a message the server can read. Encrypting it means sealing a
  thumbs-up per recipient - a key exchange per reaction - and the server would
  still have to count them for clients that have not fetched the channel key.
  The leak is narrow (how somebody felt about text the server cannot read) and
  `E2EE.md` says so plainly.
- **Reactions travel as user ids, not as a count and a "mine" flag.** The same
  object is broadcast to everybody, so a flag computed for whoever caused the
  change is wrong for every other recipient. The client counts the list and
  looks for itself in it.
- **Search runs in the client.** `messages.content` is ciphertext; a server-side
  search would mean handing the server the channel key, which is the whole thing
  the design refuses. So the panel searches the history this window has already
  decrypted and says how many messages that was, rather than implying it covered
  the channel.
- **Pins and search share the member list's column.** They are the same kind of
  thing - a list about this channel - and opening two at once would leave
  nothing to read. Clicking a pin or a result scrolls the conversation to that
  message and flashes it; a pin is a bookmark into the channel, not a copy of it.
- **The emoji set is a file, not a dependency.** Every emoji library ships a
  sprite sheet and a search index; this needs a picker and six quick reactions,
  and the system font already draws the characters. A dependency becomes the
  right answer when somebody wants the full set with skin tones and shortcode
  search - not before.
- **A badge is cleared by reading, not only by arriving.** The count was cleared
  when a channel was opened, which quietly assumed the only way to become
  unread was to be somewhere else. A message landing in the channel already on
  screen while the window sat in the background counted, and then nothing ever
  cleared it - the user was already in that channel, so there was no "open" left
  to perform. Regaining focus now marks the open channel read, and a message
  arriving in a focused, open channel moves the account's marker as well (at
  most once a second, because the marker only has to be roughly current).
- **The unread line is placed once, from the marker as it stood on entry, and
  clears itself five seconds after the messages under it are read.** The read
  marker moves the instant a channel is opened, so the divider is computed from
  its previous value and then left alone while it is being read - a line that
  re-placed itself as messages arrived would always sit at the bottom, which is
  exactly where it is no use. Discord leaves it until the channel is opened
  again; here it clears once its messages have been read, because a line that
  only goes away by leaving and coming back is a chore rather than a marker. The
  five seconds are so it can still be seen on the way in. It is the first
  message somebody else wrote after the marker; a channel that has never been
  read gets no line rather than one across its whole history.
- **A permission grant has to reach the person it was granted to.** A client
  reads what it may do from the server list it fetched when it signed in, so
  granting somebody `MANAGE_MESSAGE` changed the database and the granting
  administrator's screen, and nothing else: the member kept the permissions they
  had at sign-in until they restarted, and their Pin item stayed disabled while
  the server would have accepted the pin. `server.member.updated` now joins the
  added and removed events, all three landing as `server.members.changed` at the
  server's watchers and at the member the change is about, and the client
  re-reads its server list from it.
- **A refused action says so.** Pinning, deleting and reacting were fired and
  forgotten from the context menu, so a message the server refused to pin looked
  like a menu item that did nothing. Every menu action now reports its failure
  in the conversation, and Pin is shown disabled with the permission it wants
  rather than being absent - an item that is missing looks like a feature that
  does not exist, and an administrator cannot act on that.
- **The focus ring stopped shouting.** A heavy accent-coloured ring with an
  offset drew a blue box around the composer while typing and around a server
  pill after a click, which reads as an error state. It is now a thin neutral
  ring for keyboard users, and text fields opt out entirely - a caret is already
  an unmistakable focus indicator. Chromium's own blue outline had to be turned
  off explicitly as well (`:focus { outline: none }`): it survived on a server
  pill, where nothing of ours was drawing anything. The rail pills opt out of
  rings altogether - a ring around a circle reads as a stray blue square, and
  the pill already marks itself with the bar on its left edge.

### The social graph in realtime (phase 15)

- **A message is deleted softly, and its body is emptied in the same write.**
  The row stays because a client may still be holding a page cursor that points
  at it, and because history paging is ordered by `createdAt` - removing the row
  would make a cursor that was valid a second ago point at nothing. What does
  not stay is the ciphertext: `content` is set to an empty string, so the
  deletion is a deletion and not a hidden row somebody can still read out of the
  database. Attachment blobs are a separate, unsolved sweep (`TODO.md`).
- **Deleting is the author's right, or the moderator's permission.** The author
  never needs a permission for their own message; anyone else needs
  `DELETE_MESSAGE` in that channel, which the role table already gives a
  moderator. A direct message has no server and therefore no moderator, which
  falls out of the model rather than needing a rule of its own.
- **Two kinds of server event: one carries, one announces.** A message is
  carried in full, because the client has to render it without a round trip. A
  friendship, a member list or a conversation is announced - `friends.changed`,
  `server.members.changed` - and the client re-reads the list. The reason is not
  laziness about payloads: the `Friend` DTO is written from the reader's side
  (who asked, which direction), so one payload cannot serve both ends of the
  same friendship without the server composing it twice and addressing each copy
  separately. The lists are small and change rarely, so a refetch is the cheaper
  and less breakable half of that trade.
- **Rooms now come in three kinds: channel, user and server.** A channel room
  was enough while every event was about a message. A friend request is
  addressed at a person, so each socket joins `user:<id>` when it connects; a
  membership change is about a community, so a client subscribes to
  `server:<id>` for each server it is in, and the gateway re-checks membership
  on every subscribe the same way it does for channels. A socket that is in both
  rooms for one event is delivered to once.
- **A client watches every server it is in, not the one on screen.** Same rule
  the channel subscriptions already follow, for the same reason: being added to
  or removed from a server has to reach the client wherever it happens to be
  looking. Being removed from the server currently open closes it rather than
  leaving a sidebar full of channels the account can no longer read.
- **Adding a member is by username, and the added person joins as a MEMBER.**
  The slug is a decent invite when someone can be told it out of band, and a
  poor one when an administrator is already standing in the members screen
  looking at the person's name. Adding needs `MANAGE_MEMBER`; giving them a role
  is a separate `MANAGE_ROLE` decision on the next screen, so neither permission
  becomes a way to acquire the other. Adding someone already in the server
  returns them unchanged - the outcome the caller asked for is already true.
- **The member search is the friend search.** "Find a person by name" is one
  question, so the members screen calls `/api/v1/users/search` rather than
  growing a per-server directory endpoint. It filters out people already in the
  server client-side, because offering to add them again is a no-op dressed as
  an action.

### Notifications, the tray and starting with the system (phase 14)

- **notification-service raises no notifications.** It sounds like a
  contradiction and is the whole design: the desktop client already receives
  every message over `/ws/chat`, and only the client knows what is on screen.
  Adding a second delivery path would mean either duplicate notifications or a
  server that has to model window focus. What the client cannot own is the part
  that has to outlive it - which channels are muted, when the quiet hours are,
  and how far each channel has been read - so that is what the service owns.
  When a web or Android client arrives it asks the same three questions and
  gets the same answers, which is what "one backend, many clients" has to mean
  for a preference.
- **Unread is derived from a read marker, not counted into a column.** One row
  per user per channel holding `lastReadAt`, and the count is messages after it
  that someone else wrote. A stored counter has to be decremented by every path
  that could mark something read, and drifts the first time one of them is
  missed; a marker cannot drift. It also answers "unread since when" for a
  client that has been offline for a week.
- **A channel with no marker counts from when the user could first see it** -
  their server join, their addition to a private channel, or the channel's
  creation. Counting from the start of history would greet anyone joining an
  established server with a thousand unread messages, which is not information.
- **Quiet hours are minutes from midnight on the client's clock.** The server
  stores two integers and never learns a timezone; a window that wraps midnight
  (start 1320, end 480) is a comparison the client makes, not a range the
  database has to understand. A traveller's quiet hours follow the machine they
  are on, which is the behaviour people expect from "do not disturb me at
  night".
- **Closing the window hides it; the tray keeps the app alive.** Notifications
  that only arrive while the app is on screen are not notifications. The tray
  icon is what makes closing safe - the socket stays connected, the tray
  tooltip carries the unread count, and Quit is on its menu. Both this and
  auto-start are switches in settings, defaulting on: an auto-start with no way
  to turn it off is malware behaviour, not a feature.
- **A development window never registers auto-start.** `pnpm dev:duo` would
  otherwise leave two temp-profile Electrons in the user's startup list,
  pointed at a Vite server that is not running. Same reason the single-instance
  lock is skipped when a profile is set: two windows there are the point.
- **Do Not Disturb is enforced in one place with everything else.** It was
  advertised in settings and enforced nowhere. There is now one predicate -
  account switch, channel mute, quiet hours, DND status - and every path that
  raises a notification goes through it, rather than each remembering the four
  rules for itself.

### Signing in from a phone

- **An account created through a provider had no way into the Android client at
  all.** OAuth registration stores `passwordHash: 'oauth-only'`, a value no
  password can match, and the phone offered nothing but a password field. That
  is a lockout, not a missing convenience, which is what moved it ahead of the
  other parity gaps.
- **The redirect had to be a private scheme, and that is the whole of the
  security problem.** The desktop comes back to a loopback port, which nothing
  else on the machine can steal because it is already listening. A phone has no
  such thing, and `nexora://` can be registered by any app that fancies it. So
  the flow is bound to a secret rather than to the redirect: the client sends a
  challenge when it starts and the verifier when it exchanges, and the scheme is
  refused outright without one. `SECURITY.md` has the shape of it.
- **The one-time code is consumed on any attempt, right or wrong.** It was
  already single-use; it is now spent even by an exchange that fails the
  challenge, so a code that leaked cannot be tried twice.

### Invites are previewed before they are accepted

- **A link no longer joins the server that sent it.** It used to: the window
  came up and the server was already in the rail. That is wrong in both
  directions - the person following the link had no idea whose server it was
  until they were in it, and the server gained a member who was never asked. A
  code is looked up first now (`GET /api/v1/servers/invites/:code`) and answered
  with a card: the icon, the name, the member count and how many of those
  members are online.
- **The preview is deliberately thin.** Anyone holding a code can ask for it, so
  it carries what the invite already promises and nothing else - no member list,
  no channels, no ids. A code that never existed, has expired, has been revoked
  or is spent all get the same 404 the join gets, for the same reason: telling
  the three apart tells somebody guessing codes that they are close.
- **The online count comes from `presence-service` over HTTP, not from Redis.**
  Presence belongs to that service, and a second reader of `presence:online` is
  a second thing to change the day that key does. The endpoint is internal -
  Nginx forwards the paths it names, and `/api/v1/internal` is not one of them.
  It is asked with a two-second timeout and answered with null on any failure,
  and the card then omits the line: an invite that hangs because presence is
  restarting is worse than an invite that cannot say who is awake.

### Media: attachments, pictures and uploads (phase 13)

- **25 MB was never the attachment limit, and a client that treated it as one
  was refusing files the deployment would have taken.** `MAX_UPLOAD_BYTES` is
  what one request may carry; `MAX_ATTACHMENT_BYTES` is what a file may be, and
  the gap between them is what multipart exists to cross. The Android client
  only knew how to send a file in one request, so it enforced the smaller
  number and called it the cap. It sends in parts now, like the desktop, and
  both clients are bounded by the deployment rather than by themselves.

- **An attachment is encrypted before it is uploaded, and that is what lets a
  channel carry anything.** The alternative was the MIME allowlist the upload
  route started with, which is a losing game: every type someone wants is one
  more entry, and every entry is one more thing that might be rendered in the
  app origin. Sealing the file under the channel key first turns the question
  off. The server receives bytes it cannot type, stores them as
  `application/octet-stream`, and always serves them as a download; the client
  is the only thing that ever sees a file's real type.
- **The manifest lives inside the encrypted body, not in columns.** A file's
  name, its real content type and its plaintext size are all things worth
  hiding, and an `attachments` table would have published every one of them.
  The message plaintext becomes a small JSON document instead, behind a marker
  starting with a NUL so no typed message can be mistaken for one. A message
  with no files is still stored as bare text, so nothing written before this
  changed shape.
- **Compression is the client's job, and it happens before encryption.**
  Ciphertext does not compress, so there is no server-side option at all.
  Oversized photos are redrawn to 1920px JPEG with a canvas, text-shaped files
  go through `CompressionStream`, and everything already compressed - video,
  archives, anything under a few kilobytes - is left alone. Video transcoding is
  deliberately not attempted: doing it properly means ffmpeg in the client, and
  doing it badly is worse than sending the file.
- **A photo is normalised to JPEG by whichever client sends it, and HEIC is the
  reason.** A phone camera writes HEIC by default; Android decodes it natively,
  so it looked fine on the client that sent it and arrived as a broken image on
  every client that did not. Chromium has never shipped a HEIF decoder, so
  there was nothing to fix on the receiving side alone. Both halves were fixed
  instead: the sender converts, and the receiver can still decode a HEIC that
  was sent before the sender learned to. On desktop and web that decode is
  libheif compiled to WebAssembly, imported the first time a HEIC turns up and
  never in a session that has none; on Android it is `BitmapFactory`, which the
  platform has decoded HEIC with since API 28. JPEG rather than WebP because it
  is the format nothing anywhere refuses, and a photo has no transparency to
  lose - a picture that does gets a white ground rather than a black one.
- **Large uploads are multipart, and the session is a sealed ticket rather than
  server state.** A session table or a Redis key would both work; a ticket the
  client holds needs neither, cannot be forged, and lets any replica accept the
  next part. It is sealed with the same `sealSecret` that protects OAuth client
  secrets, carries the account it was opened by and an expiry, and is checked
  against both on every part.
- **An over-long message is sent as a text file.** Discord's behaviour, and for
  the same reason: the alternative is either truncating what someone wrote or
  letting one message bury a channel. It arrives as `message.txt` with a
  preview, so it still reads as a message.
- **Avatars and server icons are the one thing stored in the clear.** They have
  to be: a member list renders them for people who hold no channel key. So they
  get the opposite treatment from attachments - a strict raster-image allowlist,
  a small size cap, a square crop and a rescale done in the client before
  upload, and they are the only objects ever served inline. `E2EE.md` says so
  plainly, because a profile picture that people believe is encrypted is worse
  than one they know is not.
- **A settable picture URL has to be one of ours.** An avatar renders in every
  client that can see the account, so an arbitrary URL there is a beacon that
  reports back who looked and when. Both the account and the server endpoints
  check the shape and the `pictures/` prefix rather than trusting the client.

### Servers, permissions and direct messages (phase 12)

- **"Workspace" is renamed to "server" everywhere, not just in the UI.** Discord
  calls the thing a server and so does everyone using this product; keeping a
  second word for it in the schema, the routes and the types would mean
  translating in every conversation and in every code review forever. The rename
  reaches the Prisma models (`Server`, `ServerMember`, `ServerRole`), the REST
  surface (`/api/v1/servers`), the service directory (`server-service`) and the
  client. It is a mechanical change, and it is cheapest now, while there is one
  schema and four callers.
- **Permissions are a role plus per-member overrides, not a role system.**
  Discord's model is custom roles with permission bitfields, colours and an
  ordering, and most of that machinery exists to serve servers with thousands of
  members. What was actually asked for is that an administrator can give one
  person one capability. So `ServerMember` keeps its role and gains two arrays -
  granted and denied - and the effective permission set is
  `roleDefaults ∪ granted \ denied`. Custom named roles were layered on later
  without changing any call site, exactly as this predicted, because every call
  site asks the same question: does this member hold this permission. The
  resolver became `roleDefaults ∪ customRoles ∪ granted \ denied`, and the
  denial is applied last so it still beats every source - a member can collect
  any number of roles and revoking one capability still works.
- **One effective-permission resolver, used by all four services.** Chat, call
  and presence each carried their own copy of "look up the channel, look up the
  membership, check the role", which is three places to forget about private
  channels and direct messages. The lookup moves into `@nexora/database` as
  `resolveChannelAccess`, and the three services call it. It is the same
  shortcut as the shared schema, and it splits the same way: when each service
  owns its data this becomes an RPC with an unchanged signature.
- **A private channel is an allowlist, not a permission.** Membership of a
  server no longer implies membership of every channel in it: a channel is
  either open to the server or restricted to the users named on it, chosen when
  it is created. Modelling it as a permission would have meant inventing a
  permission per channel; a `ChannelMember` row per person is the smaller idea
  and the one that answers "who can read this" directly - which is also the
  question the E2EE key wrapper has to answer, so private channels get
  encryption scoped to their allowlist for free.
- **A direct message is a channel with no server.** DMs need history, paging,
  realtime fanout, notifications, unread counts and end-to-end encryption -
  every one of which already exists for channels. A second message model would
  duplicate all of it. So `Channel.serverId` becomes nullable, `DM` joins the
  channel types, and the two participants are `ChannelMember` rows. Everything
  downstream of the channel id keeps working untouched.
- **Friendship is one row, ordered by user id.** A request and an acceptance are
  the same relationship in two states, so storing one row with a requester, an
  addressee and a status avoids the reconciliation that two rows would need. The
  pair is stored with the lower id first and a unique constraint on it, because
  the alternative is two people sending each other a request and both being
  right.
- **Only friends can open a direct message.** Anyone can search for a user by
  name, because that is how a request gets sent at all, but a channel is only
  created between accepted friends. Without that rule the search endpoint is a
  spam surface, and adding a block list later has one place to hook into.
- **Status is a claim by the client, presence keeps the truth.** Online, idle,
  do not disturb and invisible are what the user chose; connected or not is what
  the server knows. Redis holds both, and invisible is resolved server-side to
  `offline` before anyone else is told - a status that leaks in the payload is
  not invisible. The user's own client still sees its real status, so the
  picker can show what was picked.
- **Global settings are a full-screen overlay, and server settings are their
  own screen.** They are different jobs at different scopes and Discord splits
  them for that reason: one is about this account and this installation, the
  other about one community. Nothing about boosting or scheduled events exists
  in this product, so neither section exists in the settings it would sit in.
- **The E2EE badge is gone from the channel header.** Encryption is not a
  feature that needs advertising in the corner of every conversation; it is
  either on for everything or the join is aborted, which is already the rule for
  media. The padlock stays where a failure would be actionable - the voice
  panel - and `E2EE.md` still documents the design.

### Admin panel, OAuth and notifications (phase 11)

- **The admin panel is its own web app, not a screen in the desktop client.**
  Operating the platform and using it are different jobs; a browser reaches the
  panel from anywhere and needs no install. It is `apps/admin`, served under
  `/admin` by the same gateway, and it talks to the same API as everything else.
- **The panel has no sign-up; the first administrator comes from the CLI.**
  `pnpm admin:create` runs where the database already is, which is the only
  place that proves the operator owns the deployment. A page open to the
  internet that mints the first admin is a race anyone can win. When no
  administrator exists the panel says which command to run rather than offering
  a form, and the generated password is printed once and must be replaced on
  first login - it has been in a terminal, and terminals have scrollback.
- **Admin authorisation is a database lookup, not a token claim.** A 15-minute
  access token would carry a role that a demotion cannot take back. Admin
  traffic is rare, so the lookup costs nothing that matters.
- **OAuth credentials live in the database, entered in the panel.** Enabling
  Google or GitHub sign-in is an operator action, not a redeploy, and the
  clients discover which providers to offer by asking - nothing is hard-coded
  into a login screen. Client secrets are sealed with AES-256-GCM
  (`SETTINGS_SECRET`, falling back to `JWT_SECRET`) and never sent back out.
- **The OAuth exchange happens in auth-service, and the browser does the
  provider part.** The client secret must not reach a client, and Google
  refuses embedded webviews - so the desktop app opens the real browser,
  auth-service trades the code for a profile, and the finished session comes
  back to a loopback server as a one-time code the client redeems. The same
  shape serves a future web client, with an allowed origin instead of loopback.
  The redirect target is restricted to loopback plus `OAUTH_ALLOWED_REDIRECTS`,
  because an open redirect here hands sessions to whoever asks.
- **A provider login links before it creates.** Provider account id first, then
  verified email, and only then a new account - otherwise signing in with
  Google after registering with the same address silently forks the person into
  two accounts.
- **Notifications are decided in the renderer and delivered by the main
  process.** Only the renderer knows whether the channel is on screen and the
  window focused; only the main process can raise an OS notification, flash the
  taskbar and restore a hidden window. The rule is one line: notify unless the
  user can already see it.
- **The client subscribes to every text channel it can read, not just the open
  one.** Without that, a message in another channel never reaches the client and
  there is nothing to notify about. Unread counts fall out of the same change.

### Earlier decisions

- **One Prisma schema in `packages/database` for the MVP.** Per-service
  databases are the target, but three services against one schema keeps the MVP
  diff small. Splitting is a migration, not a rewrite: each service already
  accesses only the models it owns.
- **Redis Pub/Sub for chat fanout.** Chat WebSocket gateway publishes to
  `chat.message.created` and every instance re-broadcasts to its local sockets.
  This makes `chat-service` horizontally scalable from day one.
- **JWT verified locally in every service** using `@nexora/auth`, no auth
  round-trip per request. Access tokens are short-lived (15m), refresh tokens
  are stored hashed in Postgres and rotated on use.
- **Storage driver chosen by environment, local disk by default.** A developer
  should not need MinIO or an AWS account to upload a file, so an empty S3
  config means local disk under `LOCAL_STORAGE_PATH`. Production sets the S3
  variables and the same code path uses the bucket.
- **Nginx as internal gateway**, no business logic. Cloudflare Tunnel is a
  separate, later concern (phase 17).
- **Media never passes through NestJS.** `call-service` mints LiveKit access
  tokens and nothing else; the desktop client dials the SFU directly.
- **One channel key, shared by chat and voice.** A member who can read a channel
  can join its voice room, so a second key exchange for media would add code and
  no security. Design and limits: `E2EE.md`.
- **Voice is a channel type, not a button on a text channel.** Discord's model:
  `VOICE` channels are joined and show who is inside, so presence answers "who
  is in there" without anyone joining first. The earlier per-text-channel call
  button was removed.
- **A voice channel owns the main content area.** Selecting one swaps the chat
  view for `VoiceChannelView`, the way Discord does it: the first click joins
  and opens the screen, later clicks only reopen it. Cameras and shared screens
  are shown there, where there is room for them, and the sidebar panel is left
  as a compact status readout. The connection itself lives in the voice store,
  so navigating to a text channel does not end the call - only the tiles go
  away. When this client is not in the call the roster comes from presence,
  which has names but no media; once connected it comes from LiveKit.
- **A shared screen is its own stage, not a bigger tile.** Camera and screen are
  separate publications in LiveKit and separate things on screen: a share never
  takes over the sharer's tile. Everyone else gets a "NAME is sharing" banner
  with a way in, and choosing it opens the theatre layout - the screen large,
  the faces on a strip underneath - which is what a group watching something
  together wants. Nobody is dragged into a stream they did not open.
- **The grid pages instead of shrinking.** Nine tiles a page with pager arrows,
  and whoever spoke in the last minute is pulled to the front, so an active
  speaker is on page one without the grid reshuffling on every word. Teams'
  bargain. Speaking is marked in amber on the tile.
- **Chromium asks which screen to share too late to ask the user.** The
  `setDisplayMediaRequestHandler` callback fires during capture, with no way to
  put a chooser up and wait, so the order is inverted: the renderer lists the
  sources over IPC, shows its own picker, records the choice in the main
  process, and only then starts the capture the handler answers. The choice is
  consumed once, so a capture that skipped the picker falls back to the primary
  screen rather than silently re-sharing the last one.
- **Presence is its own service.** `presence-service` owns `/ws/presence`,
  keeps online/typing/voice state in Redis and fans changes out over Pub/Sub.
  Typing and voice rosters could have ridden the chat socket, but presence is a
  separate concern with a separate lifecycle, and the architecture already
  reserved the service.
- **LiveKit is dialled on `127.0.0.1`, not `localhost`.** Chromium resolves
  `localhost` to `::1` first and the container publishes IPv4 only, so the
  client silently failed to reach the SFU.
- **Ciphertext lives in `messages.content`.** Encryption needed no schema change
  for messages and no service change beyond the size limit, because the server
  already treated the body as an opaque string.
- **A leaked refresh token signs out the whole account.** Rotation alone lets a
  thief keep a stolen token alive: whoever refreshes first wins and the other
  party never finds out. Presenting a token that was already spent now revokes
  every live token for that account, because the server cannot tell victim from
  thief. The cost is a re-login after a genuine race (two windows refreshing at
  once), which the desktop client already avoids with single-flight refresh.
- **Rate limiting lives in Nginx and in the service.** The edge limit is the one
  that carries the load, but it only covers traffic that came through the edge.
  Credential endpoints keep a Redis-counted budget of their own so a container
  on the internal network, a port-forward or a future second gateway is limited
  too. Redis being down fails open: locking everyone out of login is the worse
  outage.
- **`AuthService` takes its Prisma slice through an injection token.** Every
  other service imports the `prisma` singleton directly, and that stays; auth is
  the one whose logic is worth testing without a database, so it is the one that
  gets the seam.
- **Request ids are assigned in `bootstrapService`, not per module.** One
  middleware, mounted before routing, means an id exists even for a request that
  reaches no controller, and no service can forget to wire it. It logs one line
  per completed request - id, user, method, path, status, duration - and skips
  `/health` so probes do not drown the log.
- **CI runs the smoke scripts rather than a second test suite.** The scripts
  already walk the real REST and WebSocket surface end to end, so the cheapest
  useful CI is to give them Postgres and Redis service containers and run them.
  They had to learn to exit non-zero first - a failed assertion used to print
  `ok false` and pass.
- **The E2EE key directory lives in `chat-service`.** Device public keys are
  user-level data and belong in `user-service` once it exists; putting them in
  chat-service kept this to one module, one Nginx route and one client service.
  Same class of shortcut as the shared Prisma schema.

## Running the stack

```bash
cp .env.example .env
pnpm dev:infra   # compose, with --env-file .env - see below
pnpm install
pnpm db:generate && pnpm db:migrate
pnpm dev:backend
```

Compose reads `.env` from the directory holding the compose file, which is
`infrastructure/docker/` - not the repo root. `pnpm dev:infra` passes
`--env-file .env` for that reason; running compose by hand without it leaves
every `${VAR}` empty. The LiveKit keys are declared required (`${VAR:?}`) so
that mistake fails the command instead of starting a SFU with a placeholder
secret, which is what "token signature is invalid" on every voice join means.
`pnpm livekit:doctor` says which side holds which secret.

`pnpm dev:backend` runs the services and nothing else. `pnpm dev` also starts
the desktop renderer on 5173, which then collides with `pnpm dev:duo` - that
starts its own Vite, because it drives two Electron profiles against it.

Desktop app: `pnpm --filter @nexora/desktop dev`.

Web client: `pnpm dev:web`, on <http://localhost:5175>. Its dev server proxies
the same routes the desktop one does, minus `/api/v1/remote` and `/ws/remote` -
the browser build has no remote-desktop section to call them from. In a
container deployment it is served at `/` by the gateway, so the whole
deployment is one address: the app at the root, the panel at `/admin`.

Two signed-in windows for testing chat, voice and presence: `pnpm dev:duo`
alongside `pnpm dev:backend` — see `TESTING.md`.

## Verification status (as of phase 10, in progress)

Run live on 2026-08-08, on top of everything verified in phase 9 below:

- `pnpm --filter @nexora/auth-service check` drives register, login, refresh
  rotation, reuse detection, logout and `/me` against an in-memory database.
- Rate limiting observed: 24 rapid logins against a running auth-service gave
  401 until the budget ran out, then 429.
- Both smoke scripts pass against the running stack:
  `apps/services/chat-service/smoke.mjs` and
  `apps/services/presence-service/smoke.mjs`.
- Request logging observed: one line per request carrying `requestId`, and
  `userId` on authenticated routes.
- **The container stack runs**: images build, the `migrate` service applies the
  schema, and register / login / server list / server create / the message
  and call routes answer through Nginx, with `x-request-id` passed through from
  the caller. Two bugs found doing it - no migration step, and no OpenSSL in the
  images - are fixed.

Still unverified: CI itself has not run yet (the workflow lands with this
phase), and the human-in-front-of-it items below.

### Phase 22 — microphone capture

The same shape of problem as phase 21, one layer over: the defaults were the
whole answer, and nobody could change any of them.
`apps/desktop/src/services/voice-quality.ts` holds the numbers,
`mic-gate.ts` the gate, `stores/audioSettings.ts` what this machine chose.

| Was | Is | Why |
| --- | --- | --- |
| 48 kbps mono, always | 64 kbps mono, or 128 stereo in high fidelity | 64 is Discord's voice channel and transparent for speech; music is four times the information |
| Browser default processing | Echo cancellation, suppression and gain control as switches, off wholesale for music | Every one of them is built for speech and destructive to anything else |
| `noiseSuppression` | Also `voiceIsolation` | Chromium's model-based suppressor - the nearest thing to Krisp that ships with the runtime. Ignored where absent |
| No gate | An AudioWorklet gate with a sensitivity slider | Suppression cleans a signal; it does not decide nobody is talking. This is what makes a call silent between sentences |
| System default device | Input and output pickers, per machine | The microphone that suits this room is not the one that suits another |

The gate runs on the audio thread for two reasons that are easy to get wrong:
a main-thread timer stops when Electron backgrounds the window, and a decision
made on a 100 ms poll clips the first consonant of every sentence. It is
assembled from `stepGate`'s own source, so the function the self-check exercises
is the function that runs there - which is why that function closes over
nothing.

What this is not is Krisp. The gate is level-based, so a slammed door opens it;
there is no push to talk, no per-person volume, and nothing reports what the
microphone actually achieved. `TODO.md` phase 22 lists that.

### Phase 21 — screen share encoding

The defaults were the problem, and they were the problem in five places at
once. `apps/desktop/src/services/share-quality.ts` is now the only file with an
opinion about any of it, and both the voice screen share and the remote-desktop
agent publish through it.

| Was | Is | Why |
| --- | --- | --- |
| 1080p15 | The display's real size, 30 or 60 fps | Fifteen frames is a slideshow; capture scaled after the fact is soft for no saving |
| ~3 Mbps fixed | 6 Mbps at 1080p detail, 14 motion, scaled by area | A ceiling costs nothing on a link that cannot reach it, and was the whole reason for the smear |
| Simulcast on | Off | It splits the budget three ways and lets the SFU pick the bottom layer |
| VP8 | H.264 | The only codec with a hardware encoder on every Windows machine, so 1080p60 does not melt a CPU |
| Browser jitter buffer | `setPlayoutDelay`, 0 driving / 0.08 watching | A third of a second of latency lives there |

The picker asks what is on the screen rather than offering a quality slider,
because a film and a document want opposite things from the encoder: one keeps
frames and gives up resolution, the other the reverse. There is no setting that
is better for both, so the honest control is "what is this", not "how good".

What this is not is Parsec. Parsec knows it is on a LAN and spends fifty
megabits accordingly; this only ever infers the link from congestion control,
has no manual override, and reports nothing about what it achieved. `TODO.md`
phase 21 lists that.

### Phase 20 — giving control in a call

Reaching a machine and helping somebody in a call are two different problems,
and the second was being made to use the machinery for the first. Enrolling a
machine and writing a grant down beforehand is right for "I administer that
box"; it is absurd for "you can see my screen, you drive it".

So a screen share in a voice channel now carries its own control, and it does
not touch remote-gateway at all:

```text
Watcher                         Sharer
   │  ask / input                  │
   ├──────── LiveKit data ────────►│  prompt, then window.nexora.remoteMouse
   │◄─────── grant / revoke ───────┤
```

The only authority is the person sharing clicking yes, which is the right one:
it is their machine, they are sitting at it, and they can see what is being
done with it. Every event is re-checked against the identity control was given
to - LiveKit's, from a token call-service signed - against the share still
being live, and against it being a whole display rather than a window.

It ends when the share does, the room does, that person leaves, either side
presses the button, or the driver presses Escape.

The other half is cursors. Several people watch a share and any of them may be
pointing at something, so each sends where their pointer is over the picture
and everyone draws everyone else's with a name on it. One driver, any number of
pointers. Both are fractions of the *picture* rather than of the element it is
drawn in, because a desktop is letterboxed and not cropped -
`stage-geometry.check.ts` is that arithmetic, in CI.

This is deliberately a second, weaker mechanism beside remote sessions rather
than a widening of the first. It has no server in the path, so it has no audit
trail; a remote session has one and keeps it. `TODO.md` phase 20 lists what
that costs.

### Phase 17 and 18 verification

Machine checks, on 2026-08-09:

- `pnpm typecheck` and `pnpm build` pass across the workspace, remote-gateway
  included.
- `apps/services/remote-gateway/smoke.mjs` is in CI beside the other three. It
  drives the negative cases: a stranger gets 404 rather than 403 on a machine
  they have no access to, a viewer cannot hand out access, an invented
  permission and an expiry in the past are both refused, granting control
  implies view, a session id cannot be borrowed by another account, an input
  event without `REMOTE_CONTROL` is refused *and* audited, and revoking a grant
  ends the session running under it.

A second pass on 2026-08-09, from a human driving two windows, found four
things and fixed them: the pointer vanished on taking control (`cursor-none` on
the video, assuming a cursor in the capture that is not reliably there), clicks
landed short on a scaled display (device-independent pixels handed to
`SetCursorPos`, which wants real ones), the picture was soft whatever the agent
published (`adaptiveStream` sizing the subscription to the window, on top of
LiveKit's 1080p default cap), and sharing system audio echoed the call back to
the room (Windows loopback captures the whole output mix, call included).
Resolution now follows the display and control can be asked for straight from a
screen share in a voice channel. `TODO.md` has the detail.

Needs a human in front of it, and none of it has been driven yet:

- Two machines: enrol one, connect from the other, watch the screen arrive.
- The consent prompt, which needs a second account rather than the owner - and
  the refusal that happens when nobody answers within thirty seconds.
- Mouse and keyboard actually landing on a Windows machine, including a drag, a
  right-click menu and a non-US keyboard layout.
- Revoking a grant while a session is live: the controller's window should say
  the session ended, and the machine should stop capturing.
- The whole stack behind a real Cloudflare Tunnel, both ways round - one
  already running on the host, and the `--profile public` container.

### Phase 16 verification

Machine checks, on 2026-08-09:

- `pnpm --filter @nexora/desktop typecheck` and `build` pass; the renderer no
  longer references `VITE_WS_URL` anywhere.
- `pnpm --filter @nexora/desktop check` gained `endpoint.check.ts`, which
  asserts the address parsing behind the picker: a bare hostname becomes
  `https`, trailing slashes and query strings go, a path is kept, `ftp://` and
  an empty string are refused, and `toWebSocketUrl` changes the scheme without
  touching a host that has "http" in its name.

Needs a human in front of it:

- Type a wrong address into the picker and read the message under the field;
  type a right one and watch the window come back on the other deployment.
- Sign in against a deployment reached through Nginx (not the Vite proxy) and
  join a voice channel, so `/livekit` is exercised rather than the absolute
  `ws://127.0.0.1:7880` development takes.
- A packaged build against a remote address: avatars and server icons, which
  were the things resolving against `file://` before this phase.

### Phase 15b verification

Run live against the development stack on 2026-08-09:

- `20260809170000_message_actions` applied to a running Postgres: `deletedById`,
  `pinnedAt`, `pinnedById` on `messages`, and the `message_reactions` table.
- `pnpm typecheck` and `pnpm build` pass across all 28 workspace tasks.
- `apps/services/chat-service/smoke.mjs` passes with the new section: an author
  edits their own message and `editedAt` is stamped, a second account is refused
  with 403, either participant of a direct message may pin and the pin list
  shows it, unpinning clears it, a reaction is added and the same call takes it
  back, a sentence is refused as an emoji, a deleted message comes back as a
  tombstone with an empty body, an author's own deletion is unattributed while a
  moderator's names them, and pinning in a server channel is refused without
  `MANAGE_MESSAGE`.
- The fanout is asserted on a live second socket: a deletion, an edit and a
  reaction each arrive as `message.updated` carrying the changed message.

Not yet exercised by a human: the whole client side - the right-click menu, the
inline editor, the emoji picker in the composer and on a message, the pinned and
search panels, and jumping from either to a message in the conversation.

### Phase 15 verification

Run live against the development stack on 2026-08-09:

- `pnpm typecheck`, `pnpm build` and `pnpm check` pass across every workspace
  task; no migration was needed, because deletion uses the `deletedAt` column
  the message model already had.
- `apps/services/chat-service/smoke.mjs` passes end to end with its new
  sections: an author deleting their own message, a stranger refused with 403
  until `DELETE_MESSAGE` is granted and then allowed, a deleted message gone
  from history and a second delete answering 404; a member added by username,
  the addition visible in that account's own server list, adding twice
  idempotent, adding without `MANAGE_MEMBER` refused and an unknown username
  404; removing a friend taking the right to reopen the conversation.
- The realtime fanout is asserted on a second live socket, not inferred:
  `message.deleted` arrives in the channel, `friends.changed` at the other side
  of the friendship, `server.members.changed` at a member watching the server,
  and a `server.subscribe` from an account that was just removed is refused with
  `SERVER_FORBIDDEN`.

Not yet exercised by a human: the client side of all of it - the hover bin and
its two-click arming, the add-member search on the members screen, and a rail
that grows or loses a server while somebody is looking at it. `TESTING.md` says
what to try.

### Phase 12 verification

Verified on 2026-08-09 by building and by the automated checks; the live
walkthrough below it is not done yet.

- `pnpm typecheck`, `pnpm build` and `pnpm check` pass across every workspace
  task, including the new `@nexora/permissions` self-check, which covers the
  override arithmetic: a grant adds, a deny beats both the role and an explicit
  grant, and an unknown permission name is ignored rather than trusted.
- The rename migration renames tables, columns, indexes and constraints in
  place rather than recreating them, so an existing database keeps its rows.

Not yet exercised: the migrations have not been applied to a running Postgres,
neither smoke script has been run against the new endpoints, and nobody has
driven the new client - the private-channel sidebar rule, the friends screen,
a direct message between two windows, the status picker, and the roles screen
all still need a human in front of them. `TESTING.md` says what to try.

### Phase 11 verification

Run live against the development stack on 2026-08-09:

- `pnpm admin:create` creates `nexoraadmin` and prints a generated password;
  the account is ADMIN with `mustChangePassword` set.
- Login by username works; the admin API answers `PASSWORD_CHANGE_REQUIRED`
  until the password is changed, then serves the directory.
- Promote, demote, disable, enable and delete all work; self-demotion is
  refused (`CANNOT_DEMOTE_SELF`), a non-admin gets 403 and an anonymous caller
  401.
- Enabling a provider without a secret is refused (`INCOMPLETE_PROVIDER`); with
  one, `GET /api/v1/auth/oauth/providers` starts listing it, and disabling it
  removes it again. The stored secret is never returned - only `hasSecret`.
- The panel itself was driven in a browser: bootstrap gate, login, users table
  with 19 accounts, provider page showing the callback URL to register, and the
  account page.

Not yet exercised: a real Google or GitHub client (the exchange has only been
tested against the panel's own stored credentials), and the panel behind the
gateway container rather than the dev server.

### Phase 9 verification

Run live against Docker (Postgres, Redis, LiveKit in WSL) on 2026-08-08:

- `pnpm build`, `pnpm typecheck` and `pnpm check` pass across every workspace
  task, including the desktop crypto self-check.
- `20260808150000_e2ee_keys` applied to a real Postgres; `device_keys` and
  `channel_keys` exist.
- `apps/services/chat-service/smoke.mjs` passes end to end, including the E2EE
  section: device directory, key publish/fetch, and epoch-ordering rejection.
- `pnpm dev:duo` opens two signed-in windows; both reach chat and presence.
- **Encrypted chat between two clients works**: Alice and Bob exchanged
  messages, and `channel_keys` holds one wrapped key per member (epoch 1,
  sealed by Alice) while `messages.content` holds ciphertext envelopes.
- Voice tokens: `call-service` mints a LiveKit token for a channel member,
  refuses a non-member with 404, and the LiveKit signal socket accepts that
  token over `ws://127.0.0.1:7880`.
- **Two clients in one voice channel**: both participants reach `participant
  active` in LiveKit over UDP and publish `audio/opus` with `encryption: 1`,
  which is the end-to-end encrypted path - the SFU forwards frames it cannot
  decode. One client sees the other's `trackPublished`.
- presence-service: both clients connect to `/ws/presence`, appear in the Redis
  online set, and the voice roster in Redis lists both members of the channel.
  A scripted client reproduces `presence.sync` and `voice.changed`.
- The member list showed "2 online" with green dots in the running app, and the
  voice roster under the channel named the connected member.
- Voice roster join/leave verified with a scripted presence client: listed after
  `voice.join`, gone after `voice.leave`.

Not yet exercised:

- Audio actually heard by a human on each end, camera, and screen share.
- Typing indicators observed in the UI (the events are wired and the server
  publishes them, but nobody has watched one land).

### Fixed: publishing failed against an outdated SFU

Joining reported *"the microphone did not start (negotiation timed out)"* while
the connection itself was up, and the mic, camera and screen-share buttons all
failed the same way afterwards. LiveKit's debug log named it:

```
Initial connection failed: v1 RTC path not found.
Consider upgrading your LiveKit server version - Retrying
negotiation due to track publish failed, retrying after reconnect
```

The root cause is a protocol gap, not ICE or a permission. `livekit-client`
tags every publisher offer with an incrementing `SessionDescription.id` and
resolves the publish only when an answer echoes an id past that checkpoint.
`livekit/livekit-server:v1.7` predates that field, so its answers came back
with id `0`, the client's `OfferAnswered` check never passed, and every publish
- microphone, camera, screen share - rejected on the 15s deadline even though
the SDP answer had been applied. Media was never the problem, which is why the
room still connected and the roster still populated.

Fixed by moving both compose files to `livekit/livekit-server:v1.13.5`. The
image tag must now be kept in step with the `livekit-client` version in
`apps/desktop`.

Two other causes were ruled out along the way and are fixed: a hot reload used
to leave an orphaned Room connected under the same identity, which LiveKit
answers by kicking the older session (`DUPLICATE_IDENTITY`), and clicking an
already-joined channel did the same thing.
- Redis Pub/Sub fanout across two instances of the same service.

## Running the whole stack in containers

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d --build
```

Reads `.env` for secrets and refuses to start without `JWT_SECRET`,
`JWT_REFRESH_SECRET` and the `LIVEKIT_*` values. The `migrate` service applies
the schema before anything serves traffic. Nginx listens on `8080`; public
ingress through `cloudflared` is opt-in with `--profile public`.

## Admin panel

```bash
pnpm admin:create        # once, prints a username and a generated password
pnpm dev:admin           # http://localhost:5174/admin/
```

In a container deployment the panel is served at `/admin` by the gateway. The
first login forces a password change; after that, Users manages accounts and
Sign-in providers configures Google and GitHub. Enabling a provider is what
makes its button appear on the desktop login screen - clients ask the server
which providers to offer and draw nothing that is not configured.

Google and GitHub need the callback URL the provider page prints, which is
built from `PUBLIC_API_URL`. Behind Cloudflare that is the public hostname, not
`localhost`.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on `master`:

| Job | Does |
| --- | --- |
| `verify` | install → lint → typecheck → build → `pnpm check` (package self-checks) |
| `integration` | Postgres + Redis service containers, migrations, five services started from their builds, then the smoke scripts |

### Phase 14 verification

Run live against the development stack on 2026-08-09:

- Migration applied to a running Postgres (`prisma migrate deploy`), all eight
  migrations green.
- `apps/services/notification-service/smoke.mjs` passes against auth-,
  server-, chat- and notification-service: preference round trip with the
  mute list deduplicated, a patch leaving untouched fields alone, a minute
  outside the day refused with 400, your own message never unread, someone
  else's counted, history from before joining not counted, the read marker
  clearing the count, an unreadable channel answering 404 rather than 403, and
  the routes refusing an anonymous caller.
- `pnpm typecheck` and `pnpm build` pass across all 28 workspace tasks.

Not yet exercised by a human: the tray itself - closing to it, the unread
tooltip, restoring from a click, quitting from the menu - and an auto-start
that survives a real reboot. Both need a packaged build on a machine someone
is sitting at; `TESTING.md` says what to try.

## Companion documents

- `MVP.md` — what the first runnable version covers
- `E2EE.md` — encryption design, threat model and its known limits
- `SECURITY.md` — who the API believes, what it allows, and what it still does not defend against
- `TESTING.md` — running two clients locally (`pnpm dev:duo`)
- `TODO.md` — ordered backlog

## Conventions

- TypeScript strict everywhere. No `any` in committed code.
- Controllers thin, services hold logic, Prisma access stays in services.
- Every service exposes `GET /health`.
- API errors use the shape in `CLAUDE.md` §24 (`code`, `message`, `requestId`).
- Commits: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
