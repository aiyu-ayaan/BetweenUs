# Testing chat and calls locally

Two users are needed to test anything real: a message has a receiver, a call has
a second participant, and end-to-end encryption only means something when the
key was exchanged between two separate devices.

## `pnpm dev:duo`

```bash
pnpm dev:infra          # Postgres and Redis
pnpm db:migrate         # first run only
pnpm dev:backend        # backend services only (leave running)
pnpm dev:duo            # in a second terminal
```

Use `pnpm dev:backend`, not `pnpm dev`: the second one also starts the desktop
renderer on 5173, and `dev:duo` starts its own Vite there for the two windows
to share. The symptom is `Port 5173 is already in use`.

Docker runs inside WSL on some machines; `pnpm dev:infra` then has to run from
the WSL shell, while `pnpm dev:backend` and `pnpm dev:duo` stay on Windows.

`dev:duo` opens **two Electron windows side by side, each already signed in**:

| Window | Account | Role |
| --- | --- | --- |
| Alice | `alice@betweenus.local` | server owner |
| Bob | `bob@betweenus.local` | member |

Password for both: `betweenus-dev-1`. They share the server **Duo Test**, its
`#general` text channel and its **lounge** voice channel. Alice also owns
`#owners-only`, a private channel Bob is deliberately not on, and the two of
them start as friends with a direct message already open.

What the script does:

1. Health-checks auth-, server- and chat-service, and refuses to start if
   any of them is down (it warns, but continues, when only call-service is).
2. Registers the two accounts, or signs in if they already exist, creates the
   server and joins Bob to it, creates the private channel, makes them friends
   and opens their conversation. Re-running is harmless.
3. Starts the Vite dev server **once**.
4. Launches two Electron processes with `BETWEENUS_PROFILE=duo-a` / `duo-b`, so
   each window gets its own user-data directory — its own session, its own
   `localStorage`, and its own copy of that account's E2EE key. Sharing a
   profile would defeat
   the point of the test.

Closing both windows stops the dev server. Ctrl+C does the same.

## What to try

**Chat**
- Type in Alice's window; it appears in Bob's within a moment. The row in
  Postgres is a ciphertext envelope — check with `pnpm db:studio`.
- There is no encryption badge in the header, by design: it is on for
  everything, so saying so in every channel says nothing. See `E2EE.md`.

**Attachments**
- Drag a photo onto the composer, or paste a screenshot. It uploads with a
  progress line, appears inline in both windows, and clicking it opens the
  full-size view. The object in `storage-data` is ciphertext — open it and it
  is not a PNG, which is the point.
- Send a file with no preview - a `.zip`, an `.exe`, anything. It arrives as a
  card with a download, and the response headers say `application/octet-stream`
  and `attachment`, whatever the file really is.
- Paste more than 2000 characters and send. It arrives as `message.txt` with
  the first lines shown and an expand, not as a truncated message.
- Something over 8 MB uploads in parts: the progress line moves in steps rather
  than jumping to 100.

**A channel of photos, and staying at the bottom**

Attachments are ciphertext until they have been fetched and decrypted, so every
row is laid out before it knows how tall it is going to be. That is what makes
this worth its own list: the message list has to stay where the reader put it
while everything under them changes size.

- Open a channel whose last few messages are pictures and videos, and watch it
  while they arrive. It must end at the newest message, not somewhere above it.
- Send a photo and stay at the bottom. When it decrypts and its row grows, the
  view follows it down.
- Attach a photo *without* sending it. The composer grows a preview, so the
  message list gets shorter — and the newest message must not disappear behind
  it. This one only shows on the desktop and the web, and it is the case the
  ResizeObserver used to miss, because it watched the messages and not the
  window they are in.
- Have the other window type. The typing indicator appears under the list, which
  is the same shrink by a smaller amount.
- Scroll up to read something while pictures are still arriving below. The view
  must stay exactly where it was left. Nothing growing underneath is allowed to
  move it, and nothing is allowed to drag the reader back down.
- Scroll back to the bottom by hand: following starts again, and the next
  message arrives without a click.
- Scroll a picture off the screen and back. It must come back as a picture. If
  it comes back as a spinner, something has stopped caching the decrypted bytes
  — on the phone that is `MediaCache`, on desktop and web the `Map` in
  `services/attachments.ts`.

**Portrait and landscape cameras**
- Join a call from a phone and from a desktop, cameras on both. The phone's tile
  on the desktop is portrait — taller than the desktop's tile beside it — and
  nobody's head is cut off. The desktop's tile on the phone is landscape inside
  the same grid.
- Turn the phone while the call is running. The tile changes shape to follow it,
  on every other client, without the picture ever being cropped or stretched.
- A tile with no camera on is 16:9 on the desktop and square on the phone, and
  becomes the shape of the picture when the camera is turned on.
- A shared screen is unchanged: it was already drawn whole.

**Signing in with a provider**
- On a deployment with Google or GitHub configured, the Android login screen
  shows a button per provider and nothing when none is configured. The button
  opens a Custom Tab, not a view inside the app.
- Finish the sign-in. The browser comes back to `betweenus://oauth` and the app is
  signed in. An account created this way has no password, so the identity
  unlock asks for the backup secret rather than a password — that is the E2EE
  flow working, not a failure.
- `adb shell am start -a android.intent.action.VIEW -d "betweenus://oauth?code=made-up"`
  must fail: the code was not one this app started. Same for a callback after
  the app's data has been cleared.
- `adb shell am start -a android.intent.action.VIEW -d "betweenus://invite/CODE"`
  opens the invite card. It joins nothing until accepted.

**HEIC photos**
- Send a photo straight from an iPhone or an Android camera that writes HEIC
  (`IMG….heic`). It must render as a picture in every client, not as a broken
  image or a file card, and it must arrive named `.jpg` — the sender converts.
- Drag a `.heic` file into the desktop or web composer. Same result: converted
  on the way out, so what is stored is a JPEG.
- Open a HEIC sent before this existed — one already in a channel's history.
  Desktop and web decode it on the way out of the cache and draw it; saving it
  lands a `.jpg`, because the bytes are JPEG bytes now.

**Invites**
- Open an invite link as somebody who is not a member. It must show a card —
  the server's icon and name, how many members it has and how many are online —
  and join nothing until *Accept invite* is pressed. Closing it joins nothing,
  and reloading does not bring the invite back: the code is spent from the
  address bar on the way in.
- Paste the same link, or the bare code, into *Join a server* on the rail. The
  same card, for the same decision.
- Open a link to a server you are already in. The card says *Open server* and
  no invite use is spent.
- Stop `presence-service` and open a link. The card still appears, with the
  online line missing rather than reading zero.
- On Android: the person icon beside the server's name in the drawer opens the
  invite section directly. Creating an invite puts a full link on the clipboard,
  and *send* shares the link, not the code. Pasting either into *Join a server*
  shows the same card the desktop does before anything is joined.

**Large attachments**
- Send a 40 MB file from the phone. It used to be refused as "larger than 25
  MB"; it now uploads in parts, with a percentage in the send preview, and
  arrives whole. The desktop, which has always done this, is the control.
- Kill the network mid-upload. The send fails and no half-finished object is
  left behind — the parts are aborted on the way out.

**Profile pictures**
- On Android: Settings → *Change avatar* picks one, and it appears in the header
  above without a restart. *Remove* puts the initial back. Server settings →
  *Change server icon* does the same for the rail tile. Both show up in the
  other clients' member lists after they next read it.
- User settings → My Account → *Upload avatar*. It shows up in Alice's own
  panel, and in the member list and message rows in Bob's window after his
  client next reads the member list. **Remove** puts the initial back.
- Server settings → Overview → *Upload server icon*. The rail pill becomes the
  picture in both windows.
- Unlike everything else, these are stored in the clear and served inline — the
  file in `storage-data/pictures` opens in an image viewer. That is deliberate
  and documented in `E2EE.md`.

**Private channels**
- Alice's sidebar lists `#owners-only` with a padlock. Bob's sidebar does not
  list it at all — not greyed out, absent — and that holds however senior he is
  made, because the allowlist is the whole rule.
- Create another one from the **+** beside TEXT CHANNELS: tick *Private
  channel*, pick Bob, and it appears in his sidebar within a reload. Untick him
  again in Server settings → Channels and it goes.

**Direct messages and friends**
- Click the BetweenUs button at the top of the rail in either window: the home
  screen opens, with **Friends** and the conversation with the other person.
- Send from Alice's DM; it lands in Bob's, notification and unread count
  included, because a DM is a channel and nothing about it is special.
- Friends → **Add friend** searches by username. Send a request from a third
  account and watch the **Pending** tab count it in the other window.
- Try to open a DM with somebody who is not a friend: the server refuses it
  (`NOT_FRIENDS`), which is the rule that keeps search from being a spam
  surface.
- A request, an acceptance and a removal all land in the other window without a
  reload: the server sends `friends.changed` to both sides and each client
  re-reads its list. Remove the friend in Alice's window and watch Bob's
  Friends screen empty itself.

**The message menu**
- Right-click any message: react with one of six emoji or open the full picker,
  edit (your own), pin, copy the text, delete. There is no hover bin any more.
- Delete takes two clicks — the first arms the item, the second does it.
- Delete your own message: both windows show *Message deleted* where it was.
  Delete somebody else's as a moderator and theirs reads *Message deleted by
  NAME*. The row survives in Postgres with `deletedAt` set and an empty
  `content`, so the tombstone costs no ciphertext.
- A plain MEMBER gets no Delete on somebody else's message; give yourself
  *Delete anyone's messages* in Server settings → Roles & Permissions and it
  appears.

**Editing**
- Edit one of your own: the message turns into a box, Enter saves, Escape
  cancels. It shows *(edited)* afterwards, in both windows.
- The other window cannot edit yours — there is no Edit item on somebody else's
  message, and the server refuses it anyway (`NOT_MESSAGE_AUTHOR`).

**Reactions and emoji**
- React from the menu, or from the smiley beside an existing chip. The chip
  counts up in both windows; clicking your own chip takes the reaction back.
- The smiley in the composer inserts an emoji where the caret is, not at the
  end.
- Reactions are the one thing the server can read — see limit 9 in `E2EE.md`,
  and the `message_reactions` rows in `pnpm db:studio`.

**Pins and search**
- Pin a message from the menu, then open the pin icon in the channel header: the
  right-hand column becomes the pinned list in place of the member list.
  Clicking a pin scrolls the conversation to it and flashes it.
- As a plain MEMBER the Pin item is greyed out and says which permission it
  wants; grant *Pin and unpin messages* in Server settings → Roles &
  Permissions and it becomes live in the other window within a moment - no
  restart, because the grant is announced and the client re-reads what it may
  do. In a direct message either person can pin —
  there are no roles in a DM.
- Anything the server refuses - a pin, a delete, a reaction - now says so in a
  red line at the top of the conversation instead of doing nothing.
- The magnifier in the header opens search over the messages that window has
  decrypted; the footer says how many that is. It has to work this way: the
  server holds ciphertext and cannot search it.

**Unread counts and the new-messages line**
- With `#general` open in Alice's window, click Bob's window so Alice's loses
  focus, and send. Alice's sidebar counts 1 and a red **New** line appears above
  the message. Click back into Alice's window: the badge clears at once and the
  line clears about five seconds later — long enough to see where you left off,
  and without having to leave the channel and come back.
- Switch Alice to `#owners-only` and back: no line, because everything has been
  read.
- Send while Alice's window is focused and `#general` is open: no badge, no
  line, and no badge after a restart either — the read marker moved with it.
- The badge that used to stick: a message arriving in the channel already on
  screen while the window was in the background counted and never cleared,
  because only opening a channel cleared a count.

**Focus**
- Click into the composer, or on a server pill: no blue box anywhere, including
  Chromium's own outline on the rail pill. Tab around with the keyboard and a
  thin neutral ring follows the focus - except on the rail, where the bar on the
  left edge of the pill is the marker.

**Adding people to a server**
- Server settings → Members → *Add a member*: type a username, and the same
  directory search the Friends screen uses offers matching people. Anyone
  already in the server is left out of the results.
- Add Bob from Alice's window and his rail grows the server without a restart:
  `server.members.changed` reaches whoever it was about as well as everyone
  watching the server.
- Kick him again and it vanishes from his rail. If he had that server open, it
  closes rather than leaving channels he can no longer read on screen.
- A MEMBER without *Manage members* gets `MISSING_PERMISSION`; the form is only
  drawn for someone who holds it, and the server checks anyway.

**Roles and permissions**
- Server settings → Roles & Permissions, pick Bob, set **Send messages** to
  *Deny*. His composer still draws, but the send is refused by chat-service —
  authorization is the server's, never the UI's.
- Set **Create and manage channels** to *Allow* while leaving him a MEMBER: the
  **+** appears beside his channel headings.
- Bob cannot promote himself: the member editor refuses a role at or above the
  editor's own, and refuses to grant a permission the editor does not hold.

**Status**
- Click your own avatar at the bottom of the sidebar and choose **Invisible**.
  Your own window keeps showing you as invisible; the other window shows you as
  offline, and `presence.changed` on the wire says `offline` too — check with
  the presence smoke script, which asserts exactly that.

**Voice channels**
- Click **lounge** under VOICE CHANNELS in one window, then in the other. The
  first click joins the call and opens the channel screen; clicking it again
  only reopens the screen, it does not rejoin.
- The channel screen shows a tile per participant - camera or shared screen when
  there is one, the initial otherwise, with a green ring while that person is
  speaking. Switch to `#general` and back: the call keeps running, because the
  connection lives in the store, not in the screen.
- Open a voice channel nobody is in and the screen reads *No one is currently in
  voice* with a **Join Voice** button.
- The sidebar panel says *Voice connected* with a padlock; without the padlock
  the join was aborted rather than downgraded to plaintext media.
- Toggle microphone and camera from either the sidebar panel or the bar under
  the channel screen - both drive the same store, so they always agree.
- With both windows connected, toggle one microphone: its muted icon updates in
  the other window's sidebar roster and participant tile as well. Join the
  second window after the first has muted to check the initial state arrives.
- A machine with no microphone still joins - the panel just shows the mic off.

**Screen share and watching together**
- The screen button opens a picker: **Screens** and **Applications** tabs with
  live thumbnails, and a *Share system audio* checkbox that is only enabled on
  Windows. Double-clicking a thumbnail shares it; Escape closes.
- Sharing does not replace your camera tile - both are live at once. Your own
  window shows the preview; the other window gets a banner reading *bob is
  sharing a screen* with **Join stream**, and stays in the grid until it is
  pressed.
- **Join stream** opens the theatre: the screen fills the stage, the faces move
  to a strip underneath. *Back to grid* leaves it without stopping the share;
  *Stop sharing* ends it for everyone.
- With system audio on Windows, sound from the shared window is heard in the
  other window - that is the movie-night path, and it rides the same encrypted
  session as the voice.
- Speaking is marked amber on the tile. With more than nine people the grid
  pages, and whoever spoke last minute is pulled onto page one.

**Notifications**
- Send from one window while the other is on a different channel, or not
  focused: the other raises a desktop notification and its taskbar entry
  flashes. Clicking the notification brings that window forward and opens the
  channel the message was in.
- A channel with unread messages shows a count in the sidebar; opening it
  clears the count.
- Join **lounge** from one window while the other is elsewhere: the other is
  notified that someone joined the voice channel. Nobody is notified about
  their own join, or about a channel they are already sitting in.
- No notification arrives for the channel that is open in a focused window -
  that is the rule, not a missing event.

**Presence and typing**
- The member list shows a green dot per online member; close one window and the
  other greys that member out within a moment.
- Type in one window and the other shows "… is typing" above its composer.

**Key exchange**
- The first window to open the channel mints the channel key and seals it for
  every member. The second unwraps it.
- Delete the profile directory (`%TEMP%\betweenus-duo-b`) and reopen: Bob's window
  has no key of its own, so it restores the account's sealed identity and the
  history opens again. Sign in with the password and it happens without a
  prompt; resume from a stored session and the "Unlock your messages" dialog
  asks for it (see `E2EE.md`, "Identity backup").
- Dismiss that dialog with **Not now** and old messages show the lock
  placeholder until it is answered — nothing mints a replacement key behind
  your back, because that would orphan the history for good.
- Set a recovery passphrase in Settings → My Account → Encryption key, then
  wipe the profile again: the same dialog asks for the passphrase instead.

## Two clients, one channel, and a re-key

The case that used to split a conversation in half, and the reason the Android
client and the desktop both re-read the key directory when they meet an epoch
they hold nothing for.

Needs two accounts in one server, signed in on two clients - two `pnpm dev:duo`
windows, or one desktop and one phone.

1. On client A, open a text channel and say something. A has keyed the channel
   at epoch 1.
2. Add account B to the server, and open the same channel on client B. B holds
   nothing for epoch 1, so it mints epoch 2 and seals it for both of them.
3. Say something on B.

What should happen: A reads it. Before the fix, A was cached on epoch 1, drew
B's message as "Encrypted - no key on this device yet", and - worse - kept
sending under epoch 1, so B could not read A's replies either. Each side sat
behind a padlock until it was restarted.

4. Reply on A, and check B reads it too. A should now be sending under epoch 2.

Messages written *before* B joined stay closed to B. That is the design, not a
failure of this test: earlier epochs are never re-wrapped for a new member.

## Pointing the client at another server

The address in the build is a default, not a decision, so this is worth driving
by hand once.

1. **The address is on screen.** The login screen says which deployment it is
   signing in to, under "Connect to a self-hosted instance". In `pnpm dev` that
   is `localhost:5173` - the Vite dev server proxies to the services, so its own
   origin is the gateway.
2. **A wrong address fails politely.** Open the dialog, type `nope.example.com`,
   Connect. It should say it could not reach that address, and the window should
   still be where it was. Type a host that answers but is not BetweenUs (any web
   site) - "That address is not a BetweenUs server".
3. **A right one switches.** With the container stack up, type `localhost:8080`.
   The window signs out, reloads, and signs in against Nginx instead of the Vite
   proxy - including `/ws/call`, which is the path a real deployment takes. The
   media does not change: it was never going through either of them.
4. **Back again.** The dialog offers the build's own address when the window is
   somewhere else; it is also reachable from Settings → My Account → Server.
5. **Only one variable.** `VITE_API_URL` in the repo-root `.env`, and it only
   affects a packaged build - `pnpm dev` always uses its own origin, because
   the dev server is the gateway. There is no `VITE_WS_URL` any more; if
   something asks for one, it is out of date.

## Notifications, the tray and auto-start

Most of this needs a packaged build (`pnpm --filter @betweenus/desktop build`
then electron-builder), because a development window deliberately refuses to
register itself to start with the system.

1. **Muting.** Open a channel, click the bell in its header. Have the other
   window send to it - no notification, and the bell reads as muted. Sign in on
   another machine (or wipe the profile and sign in again): still muted, because
   the setting is on the account, not the window.
2. **Quiet hours.** Settings → Notifications → Quiet hours, set a window that
   contains the current time. Nothing is raised until it passes. Set one that
   crosses midnight and check the boundary either side.
3. **Do Not Disturb.** Set the status from the user panel; notifications stop
   until it changes.
4. **Unread survives a restart.** Leave messages unread, quit, sign in again -
   the sidebar dots and the tray tooltip come back with the same counts. Open
   the channel and they clear on the account, not only in this window.
5. **Close to tray.** Close the window. The process stays up, the tray icon
   stays there, and a message arriving now still raises a notification.
   Clicking the tray icon brings the window back; Quit on its menu ends it.
6. **Start with the system.** On in settings by default. Reboot: BetweenUs comes
   back in the tray with no window in front of what you were doing. Turn it off
   and reboot again - it stays gone.

**A phone with the app closed is a different test**, and it lives in
`FCM/TESTING.md` because it needs a Firebase project rather than a packaged
build. The short version: a message must wake a swiped-away app and arrive with
its *words* - which means a cold process restored a session and fetched a
channel key - there must be no notification for the conversation already on
screen and one for the same conversation with the screen locked, and a reply
typed into the shade must land in the channel without the app opening. `FCM/`
is the rest of it: the architecture in `README.md`, the payload and the order
of the gates in `PAYLOADS.md`.

## Remote desktop

Needs two machines, or two accounts and a second machine - the interesting
paths are the ones where the person connecting is *not* the owner.

1. **Enrol.** Settings → Remote Access → Allow remote access. The panel should
   report the machine name and "reachable". On a non-Windows machine it also
   warns that control is unavailable; that is expected.
2. **See it.** Sign in on another device, open **Remote machines** beside
   Friends. The machine is there with a green dot. Turn the switch off on the
   first machine and the dot goes grey within a heartbeat.
3. **Connect to your own machine.** Click Connect. No prompt should appear -
   the owner reaching their own desktop is the case this exists for - and the
   screen should arrive within a second or two.
4. **Control.** The session starts watching, not driving. Click **Take
   control**, then move the mouse over the video, click, drag a window, type
   into something, right-click for a context menu, scroll both ways. Esc hands
   control back rather than travelling to the machine. The pointer stays
   visible the whole time and becomes a crosshair - it must never disappear.
5. **Where the click lands.** Do this on a machine running at 125% or 150%
   display scaling, which is most laptops: aim at something in each corner and
   at the middle. It has to land where the pointer is, not short of it. Then
   check the picture is sharp enough to read a menu, in a small window as well
   as maximised.
6. **Two monitors.** On a machine with more than one, a dropdown appears in the
   session header. Switch to the second monitor: the picture changes within a
   second or two, the label follows the picture rather than the click, and a
   click now lands on *that* monitor. Switch back. A view-only session gets the
   dropdown too - looking at the other screen is looking.
7. **From a screen share.** In a voice channel, have somebody share their
   screen and watch it. If you have remote access to a machine of theirs, an
   **Open a session** button sits on the share; it opens a real session and
   asks for control. It must still raise the consent prompt on their side -
   watching a share grants nothing.

8. **Request control.** From an account granted `REMOTE_VIEW` only, the same
   button reads **Request control**: a prompt appears on the machine, and
   whoever is there gives or keeps control. Refusing leaves the session
   watching; granting lasts until the session ends or control is released, and
   never touches the stored grant.
9. **Clipboard.** With `REMOTE_CLIPBOARD` held, copy text on one machine and
   paste on the other, both directions. It is polled once a second, so give it
   a moment; it is text only.
10. **Somebody else.** From the machine's Access dialog, give a second account
   `REMOTE_VIEW` only. Connect as them: a prompt appears **on the machine**,
   and nothing is captured until it is answered. Refuse it once, and let it
   time out once (thirty seconds) - both end the session.
11. **View-only really is.** Accept the session, then try to move the mouse over
   the video. Nothing happens on the machine, and the machine's History tab
   shows `input.refused`.
12. **Revoke while live.** With that session running, untick everything in the
   Access dialog. The controller's window should say the session ended, the red
   banner on the machine should disappear, and History should show
   `session.ended` with reason `revoked`.
13. **Temporary access.** Set an expiry a few minutes out, confirm the machine
   still appears for that account, then wait past it: the machine leaves their
   list and a session is refused with 404.

## A call that follows you

Two accounts in one voice channel, as usual. Everything here is about the call
outliving the screen it was started on.

1. **Walk away from the call.** While connected, switch to another server, open
   a direct message, open the Friends screen, open Settings. The voice panel
   stays at the bottom of whichever sidebar is showing, and — the part that used
   to break — you keep *hearing* the other person the whole way. Silence while
   the panel still says "Voice connected" is the failure this section exists
   for.
2. **Get back to it.** Click the channel name in the panel from another server.
   It loads that server and opens the call's channel, cameras and shared screens
   included.
3. **Two devices, one account.** Sign in as the same account in a browser tab
   (`pnpm dev:web`) and in the Electron window. Join a call from the desktop,
   then join any call from the tab. The desktop call ends and says "This call
   moved to another device — you joined it there", the other participant sees
   the desktop peer leave, and only the tab is in the room. Join again from the
   desktop and the call moves back the same way. What must never happen is both
   being in the call at once, which sounds like the account echoing itself.
4. **Closing a tab mid-call.** With a call up in the browser, close the tab or
   press reload: the browser asks to confirm. Hang up first and it closes
   without a word. The Electron window is deliberately not in this — it has a
   tray behind it.

## The workbench

Phase 26 is layout and paint only — nothing here changes what the client does,
so what is being checked is that nothing *moved* wrongly. One client is enough.

1. **The gutters.** Every region is a rounded card and the window's ground shows
   between them. What to look for is a panel whose corner is square or whose
   content runs under its own edge — a list that scrolls its rows past the
   rounded corner is the usual one.
2. **Hiding a column.** The toggle beside the mark hides the sidebar; the one at
   the far right hides the member list, pins or search. Neither should leave a
   gap where the panel was: the remaining panels take the space. The right-hand
   toggle is absent in a voice channel, on the Friends screen and on the machine
   list, because those have no right-hand panel.
3. **Ctrl+K.** Opens over anything, filters as you type, arrow keys and Enter
   move without touching the mouse, Escape closes. It lists servers, the open
   server's channels and every conversation. Opening a channel from it should
   land in exactly the same place clicking it in the sidebar does.
4. **The command field when idle.** It says where you are — `Server / channel`,
   or the conversation's name — and it keeps up when you switch.
5. **Reduced motion.** Turn on "Show animations in Windows" → off (Settings →
   Accessibility → Visual effects). Dialogs and menus should appear instantly
   rather than rising into place. Nothing should become unreachable.
6. **Sign-in and settings.** Sign out: the login card is the same panel shape on
   the same ground. Open user settings and server settings: both are the
   two-panel layout, not a full-bleed page.

## Watching something together

1. **Pick the right trade.** Share with **Video and motion** and play something
   with movement in it. It should be clean and smooth at 60 fps: 24 Mbps at
   1080p, with the encoder giving up resolution before it gives up frames.
   Share the same thing with **Text and detail** and the opposite happens -
   crisper stills, visible judder on a pan. Both are correct; the wrong one for
   the content is what looks broken.
2. **Sound.** With **Share system audio** on and the motion profile, a
   soundtrack should arrive in stereo and stay full-band through quiet
   passages. On the detail profile it is treated as incidental noise, which is
   right for a shared terminal and wrong for a film.
3. **Latency.** Put a clock with a second hand on the shared screen and look at
   both machines: the gap should be a fraction of a second, not the second or
   more a default jitter buffer costs. Take control of the share and it should
   tighten further.
4. **Native resolution.** Share a 1440p or a scaled display and read something
   small on the far end. It must not look like a 1080p image stretched up; the
   sender keeps the native capture scale and treats the share as high-priority
   video.
5. **What it costs.** `chrome://webrtc-internals` in the receiving window: the
   inbound bitrate should sit in the megabits, not the hundreds of kilobits,
   and the frame rate should hold. Nothing in the app reports this yet.

## How a microphone sounds

Settings → Voice & Video. Everything here applies to a call already running,
so leave a second account listening in the same voice channel.

1. **Pick a device.** The same two lists are on the call controls, behind the
   button beside screen share - check a change made there shows up in settings
   and vice versa. Both should name real devices once the microphone
   has been granted once (before that, the operating system hides the labels
   and they read "Unnamed device"). Switch input mid-call: the other side
   should keep hearing you, from the other microphone. Switch output and the
   call should move to the other speakers. Unplug the chosen microphone and
   rejoin - it must fall back to the default rather than fail the join.
2. **Set the sensitivity.** Click **Let's check**. The bar follows your voice
   and the notch is the threshold: amber under it, blue over it. Set it so
   room tone sits below and speech well above. Type on a mechanical keyboard
   while silent - the bar should twitch under the notch and the far end should
   hear nothing.
3. **It does not clip a word.** With the gate on, say a sentence starting with
   a soft consonant ("something", "fifty") to the far end. The first syllable
   must arrive whole. If words start late, the gate is opening too slowly.
4. **Suppression.** Run a fan or a hiss beside the microphone with **Noise
   suppression** on, then off, and ask the far end. On a runtime with voice
   isolation the difference is dramatic; on one without it, it is the ordinary
   WebRTC suppressor and the difference is smaller. Neither should fail.
5. **Echo.** On speakers rather than headphones, with echo cancellation on,
   the other person should not hear themselves. Turn it off and they will -
   which is the point of the switch, and why it defaults on.
6. **High fidelity.** Play an instrument or a record into the microphone with
   the mode on: it should arrive in stereo, without the pumping that gain
   control causes, and quiet passages should not be cut out. Check the three
   processing switches go grey - the mode has answered the question.
7. **What it costs.** `chrome://webrtc-internals` on the receiving side: about
   64 kbps for a voice and about 128 for high fidelity, with the outbound
   dropping close to nothing during silence in the first case and staying up in
   the second.

### On the phone

Needs a phone, a paired Bluetooth headset and a second account listening.

1. **The permission screen.** On a fresh install, signing in lands on
   **Permissions** before anything else. Skip it with **Continue** - nothing
   should be blocked, and joining a call should still ask for the microphone.
   Settings → This device → **App permissions** opens the same screen and
   counts what is missing. Refuse one, tap **Open settings**, grant it there and
   come back: the row must show it as granted without restarting the app.
2. **The headset is found.** With the headset paired and connected, open the
   call controls and tap the speaker button. **Bluetooth** must be in the
   list - both while a call is running and, from settings, with no call at all.
   If **Nearby devices** was refused, it will not be: that is the permission,
   not the headset, and granting it should make the entry appear.
3. **Automatic means the headset.** Leave the output on **Automatic** and join
   a call with the headset connected: the call must come out of the headset, not
   the speaker. Disconnect it mid-call and the call should fall back to the
   speaker on its own; reconnect and it should return.
4. **Both directions.** Choose **Bluetooth** under **Speak into** and confirm
   the far end hears the headset's microphone rather than the phone's. Choosing
   **Phone microphone** takes playback off the headset as well - that is
   Android routing a call as one device, and the sheet says so.
5. **On an old phone.** Below Android 12 there is no `setCommunicationDevice`
   and no runtime Bluetooth permission; the same picker should still route to
   the headset, through SCO.

## Giving control in a call

Needs two accounts in the same voice channel, and the machine sharing has to
be Windows. Nothing here needs an enrolled machine or a grant - that is the
point of it.

1. **Share a whole screen.** From the voice channel, share a *screen* (not an
   application) and have the other person watch it.
2. **Point at things.** Move the pointer over the share in the watcher's
   window: a labelled cursor with their name appears on the sharer's copy of
   it, and on anybody else's. Move it off the picture and the cursor goes.
   With three people in the call, all three cursors are distinguishable.
   Aim at a corner of something and check the cursor is over the same thing on
   the other screen - if the two machines have different aspect ratios, this is
   where a mistake in the letterbox arithmetic shows.
3. **Ask.** The watcher clicks **Request control**. A prompt appears on the
   sharer's window wherever they are in the app. Refuse it once: the watcher's
   button says why and nothing happens.
4. **Drive.** Ask again and allow it. The watcher's pointer now moves the
   sharer's mouse, clicks land, typing arrives. A red banner sits at the top of
   the sharer's window for the whole time.
5. **Every way out.** Each of these must end it, and the banner must go:
   Escape in the watcher's window; **Release control** in the watcher's window;
   **Take back** on the sharer's banner; the sharer clicking **Stop sharing**;
   the watcher leaving the call; the sharer leaving the call.
6. **A window is not a screen.** Share an application window instead and ask
   for control: it is refused, with a reason. There is no fraction of a screen
   to map a click onto when the thing being shared can be dragged between
   monitors.
7. **It grants nothing afterwards.** Once the share stops, the watcher has no
   access to that machine at all - check the **Remote machines** list from
   their account and it is not there.
## Backend smoke tests

The scripts need Postgres, Redis and the services running, and both exit
non-zero on a failed assertion — CI runs exactly these.

`node apps/services/chat-service/smoke.mjs` walks the REST and WebSocket
surface end to end: register → refresh rotation → server → channel →
WebSocket subscribe → send → realtime receive → history → traversal blocked →
E2EE device directory, key publish/fetch and epoch ordering.

For uploads it asserts what can actually break now that files are ciphertext:
an attachment round-trips byte for byte and is never served inline, a multipart
upload assembles in part order however the parts arrived, an upload ticket is
refused for an account that did not open it, the scratch space parts live in is
not downloadable, an SVG is refused as a profile picture, and an avatar URL
pointing at somebody else's host is refused.

It then brings in a second account and asserts the phase 12 rules: that
`MANAGE_CHANNEL` is enforced, that granting it to one member takes effect and
denying `SEND_MESSAGE` is honoured by chat-service, that a private channel is
absent from a non-member's listing and its history refused, that a direct
message is refused between strangers and allowed between friends, that opening
the same conversation twice reuses one channel, and that a message sent in it
arrives.

Phase 15 adds the social and realtime rules to the same script: an author
deletes their own message, a stranger cannot delete somebody else's until
`DELETE_MESSAGE` is granted, a deleted message leaves history and a second
delete answers 404; a member is added by username, adding them twice is
idempotent, adding without `MANAGE_MEMBER` is refused and an unknown username
is not found; removing a friend takes the right to reopen the conversation with
them. It then holds a second socket open and asserts the fanout itself -
`message.deleted` in the channel, `friends.changed` at the other side of the
friendship, `server.members.changed` at everyone watching the server, and a
`server.subscribe` from somebody no longer in it refused with
`SERVER_FORBIDDEN`.

Phase 15b adds the message actions: an author edits their own message and
`editedAt` is stamped while a second account is refused, pinning works in a
direct message for either participant and needs `MANAGE_MESSAGE` in a server
channel, the pin list shows it and unpinning clears it, a reaction toggles on
and off through one endpoint and a sentence is refused as an emoji, and a
deletion returns a tombstone - unattributed for the author, naming the moderator
otherwise. The same second socket asserts that a deletion, an edit and a
reaction each arrive as `message.updated` carrying the changed message.

`node apps/services/presence-service/smoke.mjs` connects two authenticated
sockets and asserts the handshake, `presence.sync`, online and offline fanout,
typing (including that it is not echoed to its author), the voice roster on
join and leave, the heartbeat, a rejected anonymous socket, a refused
non-member voice join, and status: that a chosen status reaches the other
socket, that invisible reaches it as `offline`, and that the word `invisible`
never appears in anyone else's payload.

`node apps/services/remote-gateway/smoke.mjs` covers remote access, and is all
negative cases: a stranger gets 404 rather than 403 on a machine they cannot
reach, a viewer cannot hand out access, an invented permission and an expiry in
the past are refused, granting control implies view, a wrong agent token is
refused, a session id cannot be borrowed by another account, an input event
without `REMOTE_CONTROL` is refused and audited, and revoking a grant ends the
session running under it.

`node apps/services/notification-service/smoke.mjs` covers preferences and
read state: the preference round trip with the mute list deduplicated, a patch
that leaves untouched fields alone, a minute outside the day refused, your own
message never unread, someone else's counted, history from before you joined
not counted, the read marker clearing the count, a channel you cannot see
answering 404 rather than 403, and an anonymous caller refused. It also covers
the push device registry: a phone registers, a rotated token lands on the same
row rather than making a second one, an unknown platform is refused, an
anonymous caller is refused, and a device unregisters. The registration token
itself is never asserted on, because it is never answered with.

## Self-checks and CI

`pnpm check` runs the package self-checks with no infrastructure at all: the
crypto primitives, storage (including a multipart round trip and the sweep for
abandoned uploads), logger redaction, the desktop E2EE round trip, the message
body encoding that carries attachment manifests, the server-address parsing
behind the login screen's server picker, the letterbox arithmetic that puts a
named cursor and a click in the right place on a shared screen, the screen-
share encoder profiles and their bitrate ceilings, the microphone profiles and
the noise gate (including compiling the worklet that gate's own source is
spliced into), the ICE configuration a client is handed (STUN is never absent,
and an unconfigured deployment relays nothing), the DTLS fingerprint signature
that stops the signalling server standing in the middle of a call, the scan
that keeps one account in one call across every device it is signed in on, and
`AuthService` against an in-memory database (register, login, refresh
rotation, reuse detection, logout).

One check lives outside the packages, because the script it covers does:
`node scripts/data-path.mjs --check` asserts the `.env` rewriting in the data-path
script - the one place in this repo that edits a file somebody else owns, where a
missed key silently loses a value rather than failing.

`.github/workflows/ci.yml` runs those on every pull request, then a second job
that starts Postgres and Redis, applies migrations, boots auth-, server-,
chat- and presence-service and runs both smoke scripts.

## Admin panel

```bash
pnpm admin:create        # prints a username and a generated password, once
pnpm dev:admin           # http://localhost:5174/admin/
```

Worth walking through:

- Before `pnpm admin:create` has ever run, the panel refuses to show a form and
  names the command instead. (`GET /api/v1/admin/status` answers `hasAdmin`.)
- The first login lands on "Choose a password" and nothing else is reachable
  until it is done - the admin API answers `PASSWORD_CHANGE_REQUIRED`.
- Users: search, promote, demote, disable, enable, delete. The last enabled
  administrator cannot be demoted, disabled or deleted, and nobody can demote or
  delete themselves.
- Sign-in providers: enabling without a client secret is refused. With both
  fields filled and the switch on, the desktop login screen shows the provider
  button on its next load; switching it off removes it.
- My account: change username, display name and password. Changing the password
  signs other sessions out and keeps this one.

Lost the password: `pnpm admin:create --reset` issues a new one and revokes the
sessions the old one left behind.

## The web client

```bash
pnpm dev:backend         # leave running
pnpm dev:web             # http://localhost:5175
```

The browser is a *third* client, so it pairs with `pnpm dev:duo` rather than
replacing it: sign in as Bob in the tab and drive Alice from the Electron
window. It runs the same UI, so everything in "What to try" above applies; what
is worth checking is only where the two runtimes differ.

- **No remote-desktop section.** No "Remote machines" in the home sidebar, and
  no "Remote Access" in Settings. The desktop app still has both, and the tab
  never enrols itself as a machine — nothing appears in another client's
  machine list because a browser was left open.
- **Screen share works, without the source picker.** The dialog still asks
  detail-or-motion, then Chromium asks which screen or window; the grid says
  "Your browser will ask" instead of listing sources. System audio is offered
  by the browser's own chooser, not by the checkbox, which stays disabled.
- **Asking for control of a share works from the tab.** Share a screen from the
  Electron window, then "Request control" in the browser: the desktop side
  prompts, and after it grants, the mouse and keyboard in the tab drive that
  machine. The reverse is refused on purpose — share from the tab and the
  desktop client is told "control is not supported on that machine", because
  nothing in a browser can move the host's mouse.
- **A live call blocks a stray close.** With a call up, closing or reloading the
  tab raises the browser's own "leave site?" dialog; the desktop app has no such
  prompt. Joining a call in the tab also ends the same account's call in the
  Electron window — see "A call that follows you" above.
- **Notifications.** The first message that arrives while the tab is in the
  background asks for permission and raises nothing; allow it and the next one
  appears, and clicking it focuses the tab on that channel. The unread count
  shows up in the tab title, which is the only badge a tab has.
- **Provider sign-in.** With Google or GitHub configured in the admin panel,
  the button leaves the page for the provider and comes back signed in - no
  loopback server, unlike the desktop app. Nothing to configure on either: the
  allowed destinations are derived from `PUBLIC_API_URL` and `CORS_ORIGIN`, and
  `localhost` is allowed already. A refused redirect answers `BAD_REDIRECT`.
- **It talks to the origin it was served from.** No `VITE_API_URL` is involved:
  the dev server proxies to the services, and a deployed bundle reaches the
  gateway that served it. The login screen's server picker still points it
  elsewhere, subject to that deployment's CORS.

Behind the gateway the app is at `/` and the panel at `/admin`, so a container
deployment is one address for everything — see below.

## From a second machine on the network

```
pnpm dev:web:lan     # https://<this host>:5175, printed by Vite on startup
```

That is `pnpm dev:web` bound to every interface **and served over TLS**, which
is not a nicety. Browsers withhold the secure-context APIs — `crypto.subtle`,
`navigator.mediaDevices` — from any plain-http origin that is not localhost,
and this app is end-to-end encrypted, so the first thing it does on
`http://192.168.x.x:5175` is `Cannot read properties of undefined (reading
'generateKey')`. Not a degraded call: no usable app at all. The certificate is
self-signed, so each machine clicks through one browser warning, once.
`pnpm dev:web` is unchanged — http, loopback only.

Nothing else has to be exposed. Every REST route and both WebSockets are
proxied by that one dev server, so the other machine reaches auth-, server-,
chat-, presence-, notification- and call-service through the single origin it
loaded the app from. The services stay on loopback, as do Postgres and Redis.

**Media needs nothing from that proxy**, and this is where a call from the
other machine used to die with "Connection to voice server timed out". The dev
SFU advertised `127.0.0.1` in its ICE candidates, so the second machine dialled
itself; the fix was a TCP relay in the dev server plus a candidate rewrite in
the page, and a long explanation of why a port published inside a WSL VM is not
reachable from the LAN.

All of that is gone. Calls are peer to peer, so the two machines negotiate
directly with each other and the dev server is not in the media path at all -
it never had any business being there. The dev server proxies signalling, which
is what a proxy can actually stand in for.

Two browsers on one LAN will find each other on host candidates alone. Two
machines on *different* networks need STUN, which the clients reach themselves
and which needs nothing opened here either.

None of this applies to a real deployment: it is behind the gateway, over TLS,
on one hostname.

## Testing the container stack

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d --build
curl 127.0.0.1:8080/health
```

Everything runs in containers behind Nginx on `8080`, migrations included, so
this is the path that catches what host development hides: image builds,
service-name networking and gateway routing. Stop the dev stack first — both
bind the same host ports.

Renderer output from both windows is mirrored into the terminal that ran
`pnpm dev:duo`, prefixed with `[renderer Alice]` / `[renderer Bob]`. In
development a failing call logs there too: `mesh.ts` warns with the peer id when
an offer, an answer or a fingerprint check fails, so a call that half-works
names which connection is the broken one.

Server-side state is worth checking directly when something looks wrong:

```bash
docker exec betweenus-dev-redis redis-cli zrange presence:online 0 -1
docker exec betweenus-dev-redis redis-cli keys 'presence:voice:*'
```

A published track logs `"encryption":1` — that is the end-to-end encrypted path.

### The data path and the backups

Worth exercising once, because both only run in the container stack:

```bash
pnpm data:path /tmp/betweenus-test          # or D:/betweenus-test on Windows
```

The tree it prints should exist (`data/postgres`, `data/redis`,
`data/media/{pictures,attachments}`, `backup/`), and `.env` should now carry the
four `*_DATA_PATH` values. Bring the stack up, then:

```bash
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml \
  logs db-backup-once db-backup
ls -l /tmp/betweenus-test/backup/           # betweenus-<date>-<time>.sql.gz
```

Two things to confirm rather than assume: `db-backup-once` exited `0` **before**
`migrate` ran (`docker compose ... ps -a` shows both), and a dump restores —
`gunzip -c <dump> | head -40` should be readable SQL, not a truncated file. Set
`BACKUP_INTERVAL_HOURS=1` and recreate `db-backup` if you want to watch the
schedule tick rather than trust it.

Upload an attachment afterwards. If it fails with `EACCES`, the media directory
is still root-owned — the script says so when it cannot chown it (see the
troubleshooting row below).

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Calls work on the LAN but not from another network | The two peers cannot form a direct path - symmetric or carrier-grade NAT on one or both ends. Signalling is fine either way, which is why everything else works. Set `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_KEY_API_TOKEN` (dashboard → Realtime → TURN) and recreate call-service: it mints a relay credential per call and a client uses it only when there is no direct path. Opens no ports at either end. A LAN call is unchanged - a direct path still wins the ICE race whenever there is one |
| Calls still time out from outside after setting the TURN key | `docker logs betweenus-call-service-1 \| grep -i turn`. "Minted Cloudflare TURN credentials" means the key works and the problem is elsewhere; "Could not mint" carries Cloudflare's own answer, usually a wrong key id or a revoked token. A join's `POST /api/v1/calls/token` response should carry a non-empty `iceServers`; if it is empty the service has no key configured, which a container keeps from when it was created |
| Attachments fail only in the container stack, with `EACCES` in the chat-service log | The upload volume mounts at `/data/uploads` and the service runs as uid 1000, but Docker creates a mountpoint it invents itself as root - so nothing could be written. The image now ships that directory owned by `node`, which an *empty* named volume inherits. A volume that already has files in it, or a host path in `UPLOAD_DATA_PATH`, is never seeded from the image: `chown -R 1000:1000` it once |
| `migrate` never starts, and `db-backup-once` exited non-zero | The pre-migration dump failed, and `migrate` waits for it to *succeed* on purpose — a schema change on a deployed database is the one step that cannot be undone. `docker compose ... logs db-backup-once` names it: usually a wrong `POSTGRES_PASSWORD`, or `/backups` not writable. `BACKUP_ON_MIGRATE=0` proceeds without a dump, which is a decision rather than a workaround |
| `couldn't find env file: .../infrastructure/docker/.env` | `--env-file .env` is resolved against the shell's working directory, not against the compose file, and the only `.env` is at the repo root. Run `pnpm dev:infra`, which works from anywhere, or `cd` to the repo root first |
| `Can't reach database server at localhost:5432`, while `Test-NetConnection 127.0.0.1 -Port 5432` says `True` | `localhost` resolves to `::1` first and the container publishes IPv4 only. Whether `::1` answers depends on a relay outside this repo: WSL's NAT networking provided one, mirrored networking does not, so switching modes breaks this without touching anything in the stack. Use `127.0.0.1` in `DATABASE_URL` and `REDIS_URL` - `.env.example` does |
| Everything answers "Request failed", including sign-in | No services are up. `pnpm dev` tears down all ten persistent tasks when any one of them exits non-zero, so a single port clash reads as a dead backend. `curl 127.0.0.1:3001/health` first, and check the last lines of the `pnpm dev` output for which task failed |
| From another machine: `Cannot read properties of undefined (reading 'generateKey')`, or no mic/camera/screen at all | The origin is plain http and is not localhost, so the browser withholds `crypto.subtle` and `navigator.mediaDevices`. Use `pnpm dev:web:lan`, which serves the same app over TLS, and accept the self-signed certificate once |
| `no media relay on <address>:7882 (EADDRINUSE)` at startup | Something else on this host holds 7882 — a second `dev:web:lan`, usually. Calls from *that* address will time out; the others are unaffected |
| The web client goes blank — an empty dark page, no error, nothing to click | Fixed. React unmounts its entire tree when a render throws, so one bad value cost the whole window and said nothing about why. The value was the machine list: it had come back as `null`, and **Join stream** renders the buttons that search it (see the next row). There is an error boundary below `App` now, so the next such bug is a "BetweenUs hit a bug and stopped" screen carrying the message, with the component stack in the console |
| `/api/v1/remote/machines` answers with `index.html` in the web client | Fixed on both sides. `/api/v1/remote` is deliberately absent from the web dev server's proxy table — the web client has no remote-desktop section — and Vite answers an unproxied route with the app's own HTML. A 200 carrying HTML used to be swallowed into `null` and returned as whatever type the caller asked for; a successful reply that is not JSON is now an `INVALID_RESPONSE` error naming the path. A browser tab also no longer asks: **Open a session** on somebody's share is the remote-desktop path, and that is the one thing a tab does not get. **Request control** is unaffected — it rides the call's own data channel |
| `pnpm prod:up` or `docker build` fails with a screen of `TS2307: Cannot find module 'zustand'` in `apps/desktop/src` | Fixed. The image deliberately copies `apps/desktop/src` without its manifest — nothing there should install Electron — but that also meant no `node_modules` for the directory, and the web client compiles that source. The build stage links it to `apps/web/node_modules`, which declares the same set because it is the same UI |
| No online dots or typing indicators | presence-service is down; `curl 127.0.0.1:3005/health` |
| Voice churns: join, leave, join again | Editing desktop source while connected. A hot reload disconnects the room on purpose; rejoin after the reload |
| Messages show the lock placeholder | This device has no key for that epoch — a member holding it must open the channel once to re-wrap |
| Every message shows the lock placeholder after a reinstall | The account identity was not restored: answer the "Unlock your messages" dialog, or sign in with the password rather than resuming a stored session |
| The web client is not on `8080`, or something else answers there | `8080` only serves the app when the *container* stack is up; `pnpm dev:web` is `5175`. It is also a popular port - `{"error":"Cannot GET /"}` or any non-BetweenUs reply means another project owns it. `docker ps` will say which; set `GATEWAY_PORT` in `.env` to something free and `pnpm prod:up` again |
| Signed out on every start, without touching anything | The client used to delete its refresh token whenever the refresh call failed, including "backend not reachable" - fixed; it now keeps the token and the login screen says the server could not be reached. If it still happens, the token really is being rejected: check auth-service logs for `Refresh tokens revoked` |
| "Refresh token was already used; all sessions have been signed out" | A spent token was replayed outside the grace window (`REFRESH_REPLAY_GRACE_MS`, 30s). Two clients sharing one token, or a token that leaked. Signing in again is the only cure - that is the point of the check |
| Provider buttons missing on the login screen | Nobody enabled a provider in the admin panel, or its client id/secret is incomplete |
| OAuth ends on a browser error page | `PUBLIC_API_URL` does not match the callback URL registered with Google or GitHub |
| Admin panel says no administrator exists | `pnpm admin:create` has not been run against this database |
| Remote machine shows offline with the switch on | The agent socket needs the gateway: `curl 127.0.0.1:3008/health`, and check `/ws/remote` is proxied if you are going through Nginx |
| "This machine is no longer enrolled" | Its row was deleted, or it was re-enrolled elsewhere, so the stored token no longer matches. Turn the switch off and on to enrol again |
| Remote session connects but the screen never arrives | The agent could not capture, or the two machines could not form a path. Check the machine`s own console first; then the same TURN question a call has, since the screen travels the same way |
| Nothing happens on the remote machine when you move the mouse | Control is a mode: click **Take control** first. If that is already on, Settings → Remote Access on the machine shows what the input helper reported |
| Mouse moves but nothing is clicked on the remote machine | Injection is Windows-only; on macOS and Linux a session is view-only by design |
| Clipboard does not cross | `REMOTE_CLIPBOARD` has to be granted, and it is polled once a second - it is not instant |
| Clicks land on the wrong monitor | Something changed the display after the session opened. Switch monitor and back: input follows whatever the agent is publishing |
| **Request control** on a screen share is refused straight away | A window is being shared rather than a whole screen, the share stopped, or the machine sharing is not Windows. The refusal says which |
| A share that was stopped is still on everyone else's stage, frozen or black | Fixed. Chrome's own "Stop sharing" bar never went through this app, so the track died and the publication stayed. The capture's `ended` now stops the share the same way the button does, and a viewer leaves the stage on its own when whoever they are watching stops |
| No audio option in Chrome's share dialog | It only appears when the capture asked for audio, which a browser share now always does. The tab/system choice belongs to that dialog - this app's own "Share system audio" checkbox is desktop-only, where it is the thing doing the capturing |
| Named cursors do not appear on a share | Only people who have the share open on the stage send a pointer, and one that goes quiet for four seconds is dropped |
| A shared film judders, or a shared document is blurry | The wrong profile in the picker. Motion keeps frames and gives up resolution; detail does the reverse |
| A share looks soft however it is set | The link cannot carry the ceiling and congestion control has lowered it. `chrome://webrtc-internals` on the receiving side says the real bitrate; there is no readout in the app |
| A share pins the CPU on the sending machine | No hardware H.264 encoder on that machine, so Chromium is encoding in software. Nothing detects this yet |
| `dev:duo` windows say "Request failed" and "Signing in to localhost:8080" | An old `VITE_API_URL` in `.env` pointing at the Nginx container, which `pnpm dev:backend` does not run. Development ignores that variable now; rebuild if the window predates that |
| Windows open on top of each other | Positions are fixed at x=40 and x=760; on a small display, drag them apart |
| Login answers 429 | The per-address credentials limit (20/min) kicked in; wait out the window |
| Signed out of every window at once | A refresh token was replayed, which revokes the whole family. Usually two clients sharing one token — check for a stale profile directory |
