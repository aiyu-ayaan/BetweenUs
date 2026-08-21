# Changelog

## [0.0.1-alpha.2](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.1...v0.0.1-alpha.2) (2026-08-21)

### Features

* Let a caller ask for a channel key that is not the cached one

### Bug fixes

* Point `latest` at every release, not only stable ones
* Re-read the channel key when somebody joins the call
* Stop the scheduled backup racing the pre-migration one

### Other changes

* Apha release done
* Record the missing `latest` tag and the image slimming
* Build the runtime from a production install, not the build stage
* Record the call key's epoch and how it is kept current
* Pin the one re-read on a rotated channel key

## [0.0.1-alpha.1](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.0...v0.0.1-alpha.1) (2026-08-20)

### Features

* Release through a PR, and undo a release that fails halfway
* Marker-driven releases to Docker Hub, with the clients attached
* Implement adaptive stage grid scaling, uniform video cards, and floating control dock
* Redesign call screen with WhatsApp-style adaptive layout, PiP self-view, and camera flip
* Draw the four new pushes, and undraw a deleted message
* Push for deletes, friends, servers and calls
* Use PushGate.shouldSuppress in PushService
* Add PushGate.shouldSuppress active channel check with unit tests
* Make message URLs clickable hyperlinks and render rich OpenGraph previews
* Add URL unfurling service and metadata API endpoint
* Add WhatsApp-style permission flow and top notification warning banner
* Remove overlay on image cards and save media as bu_{date}
* Add permissions carousel screen with progress and allow-all button
* FCM push, so a swiped-away phone is reachable
* Hide server people/members list by default
* Send files in the background, and shrink a video first
* Crop and rotate before a picture is sent or stored
* Set an avatar and a server icon from the phone
* Manage a machine's access and read its audit trail
* Add and remove a server's own emoji
* Make and edit a server's own roles
* Sign in with a provider, and open invite links
* Accept a mobile redirect, bound to a challenge the app keeps
* Upload large attachments in parts
* Invites as links, previewed before they are accepted
* Show what an invite leads to before it is accepted
* Convert every sent photo to JPEG, HEIC included
* Decode HEIC in the client, and send every photo as JPEG
* One data path, and a dump before every migration
* The headers a browser needs to be told once
* A server's own emoji, animated ones included
* Type ":" and a name to reach an emoji
* What you can do about a person, from the list that names them
* A link, so anybody can be let in without being added
* One screen at a time - a new share replaces the one before it
* A key per machine, so a lost one can be revoked
* Invite management, and a line that was lying about the slug
* Microphone processing, a hi-fi mode, and where the call comes out
* Reconnect when the network comes back, not when the timer says
* A reaction says who left it, not just how many
* A list of servers this client has been on, and a contract check
* Tell a LAN it is a LAN - a manual bitrate, frame rate and codec
* An unread line that survives a restart, and a way to reach it
* The same two notes when somebody joins or leaves a call
* Two notes when somebody joins the call, two when they leave
* A cache on desktop and web, so opening the app is not a spinner
* Look at a photo before sending it, and show a video's first frame
* Look at a photo before sending it, and drop files anywhere
* Scroll back through history on desktop and web
* Replies, on all three clients
* A monitor plugged in mid-session is noticed
* The roles screen learns to draw a server's own roles
* Two ways to be driven, two targets
* A chord that arrives as a chord
* Add Firebase Crashlytics configuration to appInsightsSettings
* A blob that leaves when its message does
* An attachment row per upload, so a blob has an owner
* Roles a server can invent for itself
* A session that survives its two halves landing on different replicas
* A record of what was done, and a way past the first hundred rows
* Edit who is on a private channel
* Measure the call, and say when nobody can hear you
* Push to talk
* Turn one person down, or off, without touching the others
* Invites that expire, run out and can be taken back
* Sweep what nothing was sweeping, and stop scanning for agent tokens
* Rotate a channel's key when somebody loses access to it
* A channel can be set to mentions only
* The roster comes from the service that holds the sockets
* Send presence only to the people entitled to it
* Go idle on its own after ten minutes, and come back
* Rate limit login per account as well as per address
* Add emoji picker and quick camera button in composer, auto-hiding camera when keyboard is open
* Display You in accent color for current user in chat view, pinned and search panels
* Enhance chat screen with media viewer, video player and gallery storage
* Add storage write permissions and video/audio attachment support
* Implement WhatsApp-style media picker and attachment sheet
* Add media and camera permissions and FileProvider setup
* Keep channel keys, so cached history opens without the network
* Open on what the app already knows, not on a spinner
* Spend the bitrate, send the whole screen
* Tell the gateway where a phone can reach it
* Come back to where you were, and go where a tap says
* Lay the share stage out like a meeting client
* A share takes the whole screen, the way it has to
* A call that looks like a call to the system
* Drop the browser context menu
* A gateway for clients that cannot use a Vite proxy
* Voice, video, screen share and the remote-desktop viewer
* Servers, channels, messages, members, settings
* The stores, and the widgets every screen is built from
* The whole REST surface, and end-to-end encryption
* Sign in, switch servers, and land on home
* Nexora palette, and a server address the build does not decide
* Initialize Android project structure with basic configurations and resources
* Implement Picture-in-Picture (PiP) overlay for voice calls
* Add Teams-style floating Picture-in-Picture mode and fix screen occlusion
* One entrance for everything that opens on top
* Carry the workbench into the surfaces inside the panels
* Rebuild the client as a workbench of floating panels
* Enhance screen capturing on Windows with background throttling adjustments
* Add initial configuration for build and typecheck tasks
* One call per account, whichever device joins last
* Warn before a browser tab with a live call is closed
* Keep the call running while the client navigates away
* Add BM25 search engine for UI/UX style guides with design system generation and persistence options
* Add Hide/Show camera controls to expand stream content to full width
* Add Teams and Google Meet style Side Gallery camera layout alongside screen share
* Add auto-hiding controls, participant toggle, and polished glassmorphic UI for fullscreen mode
* The screen goes straight to the controller, not through a room
* A mesh of peer connections, where the SFU used to be
* A switchboard, so two clients can find each other without an SFU
* Relay media through TURN, so a call works from another network
* A render that throws is a message, not a blank window
* Implement LAN SFU and ICE candidate rewriting for remote access
* Reach the dev stack from a second machine on the network
* Notifications and provider sign-in in a browser
* Serve the web client at the root of the gateway
* Add the browser client as its own app
* Gate the remote-desktop section on the Electron bridge
* Restore the account encryption key on any machine you sign in on
* Store a sealed identity backup so an account is not tied to one machine
* Update TypeScript configuration and add path mappings for shared packages
* Check at startup that LiveKit accepts our tokens
* Give a new server a voice channel as well as #general
* Add packaging scripts for portable and NSIS targets in desktop app
* Enhance deployment instructions and add production scripts for easier setup
* Change microphone and speakers from inside the call
* Give Voice & Video something to set
* Let a deployment choose where local uploads live
* Publish the microphone the way this machine is set up
* Close the microphone when nobody is talking
* Decide what a microphone should sound like
* Encode a screen share like something worth watching
* Give control of a screen share in a call, with named cursors
* Choose which monitor a session watches
* Request control from somebody's screen share
* Public ingress that fits a tunnel you already run
* Be a remote machine, and reach one
* Enrolment, grants, sessions and the relay
* Remote machines, grants, sessions and an audit trail
* Proxy LiveKit signalling, so a deployment is one hostname
* Choose the server from the login screen
* One address for a whole deployment, resolved at runtime
* Message actions - tombstones, edits, pins, reactions, search
* Implement message deletion and friend event notifications
* Add high-res icon rendering and portable production build target
* Set taskbar, electron window, system tray, and installer application icon
* Integrate brand icon from icon.svg with dark gradient styling across desktop app
* Honour mutes, quiet hours and Do Not Disturb
* System tray, close to tray, and start with the system
* Notification-service owns mutes, quiet hours and read state
* Play video and audio inline, and cap image previews
* Upload avatars and server icons
* Attach, preview and download files in the message view
* Encrypted attachments, compressed and uploaded in parts
* Attachment manifest and settable profile pictures
* Multipart uploads and a picture/attachment split
* Drop the default Electron menu bar
* Rebuild the client as a Discord-shaped app
* Choosable status, with invisible resolved server-side
* Friends, user search and direct messages
* Private channels with a member allowlist
* Per-member permission overrides and one access resolver
* Web admin panel for users and sign-in providers
* Sign in with Google or GitHub
* Admin API, account management and OAuth sign-in
* Admin role, OAuth provider config, and `pnpm admin:create`
* Notifications for messages and voice joins
* Request-scoped logging with a correlated request id
* Refresh-token reuse detection and service-level rate limits
* Screen-share picker, theatre layout and paged grid
* Voice channel screen with participant tiles
* Voice channels, online status and typing indicators
* Encrypted messages, LiveKit calls, two-window dev harness
* Enhance development configuration for API and WebSocket URLs
* Local-disk uploads when S3 is not configured
* Electron shell and Discord-style chat client
* Nginx gateway routing and full-stack compose
* Message REST API and /ws/chat realtime gateway
* Workspaces, membership and channels
* Registration, login, refresh rotation and /me
* Shared types, config, logger, auth, permissions, events, database

### Bug fixes

* Download the two artifacts by name, and promote after publishing
* Mark gradlew executable in the index
* Decode a keystore secret in every shape it actually arrives in
* A merged release PR builds again
* Detect the release commit by the version moving, not by files changing
* Follow the compose split, and give prod:up something to pull
* Make the integration smokes match the services they test
* Restore the workspace links that typecheck resolves through
* Remove image file size from preview overlay header
* Remove duplicate avatar icon from account settings picture picker
* Keep the call's peer id in step with its socket
* Adjust launcher icon scale to 54% safe-zone to prevent circle mask clipping
* Update Firebase Crashlytics connection settings with actual values
* A second machine reads the history, not a wall of padlocks
* Fix drop image preview loading and discard upload handling
* Derive the OAuth redirect allow list, and take a username to sign in
* The key, the roster and the sign-in prompt
* Give every video tile the shape of the picture in it
* Re-anchor the message list when the keyboard opens
* Ensure backup directory permissions and add diagnostic write check
* An origin is not a string that starts the same way
* The endpoints behind a token still get a budget
* A session is not an entitlement to every attachment
* A socket frame is as big as the traffic, not as big as ws allows
* A token does not get to say how it is checked
* A caller does not get to choose which bucket counts them
* A picture sent from a phone says how big it is
* A growing row is not somebody scrolling away
* A picture that has been decrypted stays decrypted
* Scrolling away is something only the reader does
* A paired Bluetooth headset is found again
* The list stopped stuttering when pictures arrive
* A moderator cannot edit or kick an administrator
* An attachment is not served to a stranger
* Managing members is not permission to conscript the directory
* A capture bound to a device does not follow the one you plug in
* Open a channel at its newest message, not wherever the last one sat
* The server picker's recreate() was talking to nobody
* A still screen is not a share that ended
* Remove redundant YOU badge in message rows
* Hanging up now ends the call notification
* Watching a share no longer bounces back to the grid
* Mute the microphone, not just the track carrying it
* Say who is in a voice channel, and notice when it changes
* Do not start a projection before the service can carry one
* Stop asking the sender for 720p30
* A share that is not moving has not ended
* Be seen in the call, and give up on one that never answers
* Rejoin the call when the socket comes back
* Leaving a call goes back to the conversation, not into one
* Show a share at the shape and the resolution it is sent at
* Rotating during a share no longer loops until it crashes
* Write a message body the way the other clients read one
* Returning to a call from its notification no longer ends it
* Send a call to the speaker, not to silence
* The four transceiver slots a call is actually made of
* Start the dev gateway as part of pnpm dev
* Show a server the moment this account is added to it
* Re-read the key directory when a message arrives at an unknown epoch
* A failed call can be joined again
* Say which address could not be reached
* Fix server icon size and active background outline in server rail
* One Nexora mark, and a rail tile that says where it goes
* Keep the user strip at the bottom of the sidebar
* Put each layout toggle on the side it controls
* Only offer the right-panel toggle where there is a right panel
* Use the WGC feature name this Chromium actually knows
* Update codec type from RTCRtpCodecCapability to RTCRtpCodec
* Keep camera feeds permanently visible in fullscreen mode and only auto-hide controls
* Fix muted speaking flicker, add fullscreen theatre mode, and gate stream audio to viewers
* Maximize P2P screen sharing quality with High Profile H.264, SDP bandwidth signaling, and BWE fast-start
* Preserve native video quality
* Raise 60 fps bitrate ceiling
* Sync remote media state
* ICE candidates were being dropped, so no call ever connected
* The deployed SFU advertised its bridge address, so media never arrived
* /livekit reached LiveKit's root, so the WebSocket never upgraded
* Refuse to hand a client an SFU address only the server can reach
* A browser tab does not ask for a machine list it will never show
* A 200 that is not JSON is a failure, not null data
* The relay could not have 7881, so the candidate does not ask for it
* Address the containers by IPv4, not by "localhost"
* Serve the LAN dev app over TLS, or it has no crypto at all
* A stopped share should leave everyone else's stage, and let the browser own the audio question
* Give turbo enough slots for every persistent task
* Advertise an SFU address the host can actually reach
* Let the service write the volume its uploads go to
* Point the doctor at the compose file that is running the SFU
* Find the SFU from the host, not only from inside Docker
* Let a member who joined after the key was minted key itself
* Keep the package CommonJS; share the theme through a .mjs
* Stop a signed-in session dying on a backend that is not up yet
* Add type module and resolve electron binary installation
* Stop the dev SFU starting with a placeholder LiveKit secret
* Drop the workspace path mappings from tsconfig.base.json
* Let any member key an empty channel
* Stop sending requests without a bearer token
* Default LIVEKIT_URL to the gateway path in every mode
* Allow empty CLOUDFLARE_TUNNEL_TOKEN for compatibility with local setups
* Attach the gate after the track, not with it
* Bind the spliced gate source to a name instead of renaming it
* A shared screen no longer echoes the call back into it
* The pointer no longer disappears when control is taken
* The click lands where the pointer is, at the display size
* Control now reaches the machine, and add request-control
* Development ignores VITE_API_URL
* Announce a permission change to the member it is about
* Clear the unread line on its own, kill the last blue outline
* Clear an unread badge on focus, and mark where reading stopped
* Set AppUserModelID and explicit window.setIcon for Windows taskbar icon
* Replace thin rotated stroke path with solid bold CallEnd disconnect handset icon
* Fix disconnect button icon orientation and layout
* Notify only when the channel is not on screen, and cache history
* Migrations and OpenSSL in the container stack
* Upgrade SFU to v1.13.5 so track publishing negotiates
* Remove container loopback node_ip to fix WebRTC UDP media publishing in Docker
* Allow electron audio permissions, fix livekit docker UDP ports and voice channel retry
* Resolve dev-duo port conflict, voice connecting state & control buttons
* Improve logging for debugging and handle room disposal on hot reload
* Leave the roster on every disconnect, not just the button
* Allow the LiveKit origin through the renderer CSP
* Stop a third Electron window during pnpm dev:duo

### Other changes

* First Release Done
* Refactor Docker Compose Configuration
* Update android development tracking for active chat notification suppression
* Add implementation plan for android active chat notification suppression
* Add design spec for android active chat notification suppression
* Add new SVG icon with gradient backgrounds and headset details
* Implement code changes to enhance functionality and improve performance
* Launcher icon sourced from desktop SVG with gradient headset pads and #3730A2 background
* Launcher icon with #3730A2 background, 75% zoom mark, and monochrome layer
* Install BetweenUs adaptive launcher icon and render all density mipmaps
* Restore original clean template launcher icons in android res
* Record URL hyperlinking and rich link previews across Android, Web, and Desktop in TRACK.md
* Record permission carousel progression and notification banner in TRACK.md
* Record clean image preview and bu_date naming in TRACK.md
* Record push across the development documents, and untrack google-services.json
* Record Android permissions carousel in TRACK.md
* Update TRACK.md for TopBar toggle cleanup
* Remove duplicate right panel toggle from TopBar
* Update TRACK.md for default hidden member list
* Update TRACK.md for chat attachment preview and discard fix
* Record this pass, and name the key-publish trap
* Upload a few parts at a time rather than one
* Rename the app to BetweenUs
* A feature table that says which client each thing works on
* Invite management has a screen now, and deep links have a reason
* Configure ABI splits, resource filtering, and bundle splitting to reduce release APK size
* Update README with data path commands and pre-migration backup details
* Who the API believes, and what it still does not
* The follow latch, the media cache, and what to click
* The Bluetooth fix, the device pickers and the permission screen
* Keep the Android client out of the build context
* No signing config, and the launcher icon is ours
* Custom emoji, R8, and a README that says what this app now does
* R8 on, code and resources shrunk
* The authorization pass, and the two things it did not build
* Ten items closed, and the three that are only half closed
* The join and leave tones, and what to listen for
* What landed this pass, and what it did not close
* What landed this pass, and the migrations waiting behind it
* Track the accepted work in its own document
* Add initial Android project configuration files
* Correct post-SFU claims and open phase 27 for push notifications
* Replace tokei badge with working sloc.xyz live LOC calculator
* Update README with dynamic GitHub shields for LOC and repo metrics
* Add badge tags and shields to repository README
* Add Android client entries to architecture and request flow in README
* Update README with Android client and enhanced chat media documentation
* Update ANDROID_TODO with image/video viewer and storage album features
* Update ANDROID_TODO with WhatsApp-style media picker
* Record the Android local cache and where channel keys now live
* Add modules.xml for project configuration in Android module
* The share stage, and why a call outlives its screen
* Write down the slot contract, since breaking it is silent
* The epoch re-read, and how to test a re-key with two clients
* Split :core and :ui-common out of :app
* Add phased Android client roadmap
* Update README with home preview image and clarify P2P WebRTC mesh architecture
* Record phase 26 - the workbench
* Add new skills for UI library selection, prototyping, and animation review
* Record phase 25 - the call follows the account
* Improve negotiation logic and track handling for media streams
* What an operator has to do about media, which is now almost nothing
* Remove LiveKit, and the deployment settings that only existed for it
* An SFU and a Cloudflare Tunnel were never going to fit together
* The relay is what makes a call work over the tunnel
* How to tell a broken /livekit proxy from a broken SFU
* A loopback LIVEKIT_URL is the one that only works on the server
* Drop the join step logs and LiveKit's debug level
* What a blank web client was, and the two halves of the fix
* Mirrored networking alone does not open the WSL VM
* Check the LAN address answers before telling the SFU to advertise it
* The three ways a dev stack looks dead when it is only unstarted
* Why a call could not be joined in development, and what says so now
* Pin the invited member's first message
* The refresh grace window, and where the web client actually listens
* Describe the shared image build and what makes a rebuild slow again
* Build every image from one Dockerfile instead of nine
* Keep the desktop app and the worktrees out of the build context
* Cover the identity backup endpoints in the chat-service smoke run
* Describe identity backup, its threat-model cost, and how to port it
* Add .dockerignore
* Improve LiveKit key management and enhance server probing logic
* Update environment variable notes for clarity on DATABASE_URL and POSTGRES_PASSWORD alignment
* Update Nginx configuration to use dynamic upstream variables for improved service resolution
* Point the README at DEPLOYMENT.md and spell out which API URL a client uses
* Merge: deployment guide
* Merge: storage volume mapping for local uploads
* Write down how to actually deploy this
* Record the in-call device picker and the processor fix
* Record the microphone work
* Record the screen-share encoding work
* Record monitor selection and in-call control
* Record the remote-desktop and screen-share audio fixes
* Record phases 17 and 18
* Record phase 16, one address for a whole deployment
* Add a source-available, view-only licence
* Add the request flow, renderer to Prisma to Postgres and back
* Rewrite the README around the architecture
* Note what the history cache does not cover yet
* Pnpm dev:backend runs the services without the renderer
* Record phase 14 — notifications, the tray and auto-start
* Record phase 13 — media, attachments and profile pictures
* Cover uploads in the smoke script
* Cover phase 12 in the smoke scripts and dev:duo
* Rename workspace to server across the stack
* Plan phase 12 — servers, permissions and direct messages
* Record the admin panel, OAuth and notifications
* Move landed phase 10 work into Done
* Record phase 10 progress
* GitHub Actions pipeline with an integration job
* Presence smoke test, and make the chat smoke fail loudly
* Record voice/presence verification and the publish issue
* MVP quick start and honest verification status
* Add local Postgres/Redis compose, env template, development docs
* Init git

