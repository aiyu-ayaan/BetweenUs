# Changelog

## [0.0.1-alpha.22](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.21...v0.0.1-alpha.22) (2026-09-02)

### Features

* The rate-limit window slides
* The rotation grace moves to Redis, and a second instance becomes possible
* A socket that stops when the account does
* Something that actually deploys the images the pipeline pushes
* A secret can come from a file, and a signing secret can be rotated
* A backup that leaves the host
* A migration check that replays the whole history, and the one-off the rename needs
* Back leaves the call screen, and a dock stands in for it
* A shared screen goes out with its sound
* The conversation says when somebody joins
* Let a new member be added with the chat history, and hide sealed rows
* One-to-one calls on every client, and a header that shows the name
* Add PACKAGE_VERSION fallback in AdminHealthService for app version retrieval
* Enhance voice channel and share stage with fullscreen toggle and layout adjustments

### Bug fixes

* A picture's type comes from its bytes, not from its uploader
* The health page, pointed at a deployment that is genuinely sick
* The three smoke scripts have been run, and two of them failed
* The two migrations that sorted backwards get a stamp that does not
* A film share holds its resolution instead of walking down to 480p
* The High profile preference that never once fired
* A share stops asking for a bitrate floor and sitting at 480p
* The call bar no longer leaves a status bar of empty space
* The call dock appears for a call started after the shell
* Coming back from picture-in-picture lands on the call
* A share picked from the sheet reaches the preview

### Other changes

* Screen share audio, floating call dock, 1-to-1 direct calls, and sliding rate limiter
* Point at the phase 35-38 proposal
* What decides a share's picture is both clients, not one
* Document release trigger conventions in Release-Commit.md and update CLAUDE.md

### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Built here |
| Desktop (Windows) | Built here |
| Android | Built here |

## [0.0.1-alpha.21](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.20...v0.0.1-alpha.21) (2026-08-31)

### Features

* Show whether the TURN relay would actually carry a call

### Bug fixes

* Resolve the relay from configuration, not from a mint that can 404

### Other changes

* Add live TURN relay health probe and unify static relay configuration
* Update submodule pointer for the phase 29 relay docs
* One relay, configured in one place
* Stop passing a hosted TURN key nothing reads any more
* !docs : Updating docs

### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Built here |
| Desktop (Windows) | Built here |
| Android | Built here |

## [0.0.1-alpha.20](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.19...v0.0.1-alpha.20) (2026-08-31)

### Features

* Accept an operator's own TURN server, not only Cloudflare's

### Other changes

* Add custom TURN relay support and coturn deployment runbooks
* Ignore session handoff file in gitignore
* A worked coturn setup on Oracle Cloud
* Update submodule pointer for the TURN runbook link
* A runbook for standing up a coturn relay
* Update submodule pointer for the TURN credential note
* Update submodule pointer for the phase 28 relay docs
* A second way to configure a relay, and where it has to live
* Pass TURN_URLS through to call-service and remote-gateway

### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Built here |
| Desktop (Windows) | Built here |
| Android | Built here |

## [0.0.1-alpha.19](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.18...v0.0.1-alpha.19) (2026-08-30)

### Features

* Warn about failing echo cancellation during a call
* Report server health, storage and bandwidth to the admin panel
* Surface echo canceller failure in voice settings
* Three-level noise suppression and echo canceller health
* Admin server health and storage contract
* Pin a face to the call stage, and stop the stage moving on its own
* A call stage that holds still, and a pin for the face that matters
* Make connection error banners dismissable across all views
* Say what is holding a share's picture down
* Put a status dot on every face in a conversation
* Decide who may see when you were last here
* Last seen in the header, and a profile a double tap away
* Say who is here, when they were last here, and what they say
* Give an account an about line and a last-seen time
* Give the forward picker icons, faces and a limit
* Forward a message into another channel
* Carry a forwarded-from tag inside the message body
* Open the photo behind an avatar
* Add dedicated PermissionDetailScreen subpage for each permission
* Add hierarchical settings subsections and options subpages
* Fix icon colors and create dedicated permissions page
* Declining stops the ring on this account's other devices
* Update changelog for alpha release 0.0.1-alpha.18 with new features, bug fixes, and documentation improvements
* Upgrade 3D hero showcase with interactive subsystem inspector and vector icons
* Add interactive 3D logo showcase and spatial chips to landing page

### Bug fixes

* Let the API client load outside Vite for the self-checks
* Scope event buffer lookup for query responses in smoke test
* Ask for the microphone somebody chose, not one like it
* Stop the SDP asking for a bitrate floor nobody can afford
* Stop blaming the microphone for a link that never connected
* Show the about line on a profile, and your own status on yours
* List everywhere a forward could go, not one server's channels
* Let the share picker be seen before the files are claimed
* Give the seen-by row its tap back
* Show the other person's photo in a direct message header
* Derive the version code from the version name
* Derive the build version from the repository manifest
* Resolve system daylight/dark theme state synchronization in themes and settings
* Disable navigation drawer gesture on settings screens
* Start the app after an install and after an update
* Cap a message at ten files where they are picked
* Size the message cap for its manifest
* Stop the ring elsewhere, and announce a call once
* Apply WebRTC signals one at a time per peer
* Recover a forked identity on the next sign-in

### Other changes

* Fix call echo, add tiered noise suppression, and admin server health
* Noise suppression levels and why echo is a separate problem
* Update development submodule pointer
* Document the echo path and three-level noise suppression
* Explain how the health snapshot is assembled
* Document the health screen and its unmeasurable fields
* Who is on the call stage, and what is allowed to move
* How a microphone is chosen, and why it must be exact
* What decides a share's picture, and what must never be a floor
* Stop committing the Kotlin compiler's scratch directory
* Describe who may see a last-seen time
* Describe last seen and the about line across the suite
* Describe forwarding across the clients
* Describe the profile photo viewer across the clients
* Make all sub-settings direct top-level items and remove nested cross-links
* Enforce strict Setting -> Subsection -> Option hierarchy for settings
* Remove redundant Calls & Data and Auto Update rows from main settings
* Remove redundant Privacy & Safety row from main settings screen
* Add rule that AI assistants must never push code
* Document the patch marker and the docs deploy
* Revert a failed release, rebuild one in place, deploy the docs
* Add the patch marker and the docs scope
* Document how the installer starts the app
* Document the ten-file cap and what it protects
* Document declining across an account's devices
* Document call.answered and the once-per-call roster
* Document one-signal-at-a-time negotiation
* Document per-kind backups and identity recovery
* !docs : Updating docs
* Add top-level section links and automate changelog extraction
* Add download links to navbar, hero section, and intro pointing to GitHub Releases
* Update verifiable architecture, sequence, and lifecycle diagrams to Archify standard

### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Built here |
| Desktop (Windows) | Built here |
| Android | Built here |

## [0.0.1-alpha.18](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.17...v0.0.1-alpha.18) (2026-08-29)

### Features

* Draw a voice message as a voice message
* A microphone, one look, and two windows
* One look, and a window that keeps moving
* Hold the microphone where send used to be
* Give a message an expiry and one look
* Read the time off the server's clock
* Divide the message list by day
* Rebuild a dead call link instead of asking the user to rejoin
* Expand max zoom level to 3000% with dynamic stepping
* Register zoom controls in MDXComponents and linearize architecture diagram
* Add interactive zoom pan and fullscreen controls for Mermaid diagrams

### Bug fixes

* Make a one-time message actually one-time
* Stop a one-time viewer closing itself, and refuse it on the web
* Fetch a one-time message before burning it
* One look each, and let people see what they opened
* Send an audio file with its own name and type
* Make the voice waveform visible, and lose the inner card
* Forget a deleted picture's plaintext
* Follow the device's 24-hour setting
* Tell the time the way the reader's system does
* Stop call tiles stretching to the shape of the stage
* Mark subproject as dirty to indicate uncommitted changes
* Say when no relay is configured instead of failing silently
* Recover broken call links instead of dropping them
* Sign in without asking to unlock the key

### Other changes

* Changes done for alpha release
* Add cache buster query parameter to LOC badge
* Remove legacy FCM directory and DEPLOYMENT.md in favor of docs/
* Say what stops a one-time message being opened twice
* The web opens one-time messages in the app instead
* Say what each client can actually stop
* Describe one look each and the MessageView table
* Describe how an attachment is named and typed
* Describe voice messages and their waveforms
* Describe messages that stop existing
* Point at the server-clock notes
* Write down the rule for clocks and expiry
* Point at the clock and timezone notes
* Record the clock and timezone rules
* Point at the day divider notes
* Describe the message list's day dividers
* Migrate push suppression doc to docs/ and update references
* Document pnpm android:* across the public docs
* Run the Gradle build from pnpm
* Document link recovery, signalling reconnect, and the relay's role
* Update system architecture section with Archify Mermaid diagram
* Standardize all flowcharts to vertical Archify format with zoom & pan support
* Streamline architecture flowchart layout and contrast
* Update high-level runtime architecture diagram and devdocs protocol
* Sign-in no longer asks to unlock the key
* !docs : Updating docs

### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Built here |
| Desktop (Windows) | Built here |
| Android | Built here |

## [0.0.1-alpha.17](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.16...v0.0.1-alpha.17) (2026-08-28)

### Other changes

* Enhance APK and AAB build process with matrix support

### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Carried forward from [v0.0.1-alpha.16](https://github.com/aiyu-ayaan/BetweenUs/releases/tag/v0.0.1-alpha.16) |
| Desktop (Windows) | Carried forward from [v0.0.1-alpha.16](https://github.com/aiyu-ayaan/BetweenUs/releases/tag/v0.0.1-alpha.16) |
| Android | Built here |

## [0.0.1-alpha.16](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.15...v0.0.1-alpha.16) (2026-08-28)

### Features

* Draw release notes as markdown on the sheet and the screen
* Draw release notes as markdown rather than as their source
* Give adding a friend its own screen
* Add project code style configuration and permissions settings
* Adaptive shell for tablets and foldables
* Clear one conversation, from a three-dot menu in its header
* Blocking, clearing your own history, and a way back into a forgotten account
* Outgoing mail settings and a per-account password reset
* Forgotten passwords, admin-configured SMTP, and a Bloom-filtered username check
* Block a user, and clear your own history everywhere
* Blocks, password resets, SMTP settings and a cleared-chats marker

### Bug fixes

* A blank line is a paragraph break when the notes are read
* Download the update without being asked, and say which channel is on
* Take the new-messages bar away the moment it is read
* Stop offering yourself a conversation with yourself
* Stop a refused DM crashing the members list
* Draw a person's name once
* Retry channel self-heal after a dropped mint request

### Other changes

* Changes done for alpha release
* Release notes are drawn as markdown on every client
* Point the submodule at the updates rewrite
* One Windows installer, a download that happens on its own, two Android jobs
* One Windows build, and make it a real installer
* Point at the members-list follow-up
* Describe the two searches and the row that refuses
* Downgrade Java version to 17 in project configuration files
* Point at submodule safety guidance
* Point at pushed dev-docs, including the consistency guideline
* Android uses the screen it is on
* Clearing one conversation
* Android has the accounts pass too
* The accounts pass across the public docs and README
* Point at the accounts-pass tracker
* Correct README "no light theme" claim
* Record device and cross-network verification across clients

### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Built here |
| Desktop (Windows) | Built here |
| Android | Built here |

## [0.0.1-alpha.15](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.14...v0.0.1-alpha.15) (2026-08-27)

### Features

* Add dynamic wallpaper theming (Material You) toggle and system palette generator
* Add fluid slide & fade transitions and animated theme grid for themes screen
* Create dedicated theme pages and navigation across all platforms
* Add 16-theme suite, custom accents, system sync, and appearance settings
* Expand theme suite to 16 themes with category filtering
* Add theme suite with system sync and custom accents
* Enhance user and server settings UI with desktop header and close button
* Add betweenus skill configuration for agents and claude

### Bug fixes

* Use ECR Public mirror for node and nginx images to avoid pull limit issues
* Eliminate status bar color seam across chat, friends, servers, and sub-screens
* Match status bar and toolbar background across settings and themes screens
* Dynamic status bar icon tinting on light themes & update documentation
* Sync native window titlebar overlay with active theme
* Ensure live theme switching with css rules and dual-target property injection
* Map loopback origins to localhost and handle youtube embed errors gracefully
* Use youtube.com embed with strict-origin referrer to fix video unavailable error
* Fix player host offscreen parking and tab switching for web sync
* Broaden youtube origins and CSP frame-src for web client

### Other changes

* Changes done for new release
* Document Android Material You dynamic wallpaper theming
* Update guidelines for AI assistants and contributors in SKILL.md
* Document loopback origin security mapping and embed error handling
* Update architecture and development documentation with sync and embed fixes
* Update references to CLAUDE.md and add commit guidelines
* Add AGENTS.md symlink pointing to CLAUDE.md
* Update master reference index and submodule pointer
* Update development submodule ref to include README
* Add root CLAUDE.md to repository
* Organize devdocs folder and link root claude.md
* Add root CLAUDE.md pointer to private development docs
* Migrate development documentation and claude.md to private submodule

### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Built here |
| Desktop (Windows) | Built here |
| Android | Built here |

## [0.0.1-alpha.14](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.13...v0.0.1-alpha.14) (2026-08-26)

### Features

* The web client gets a search box, not just a paste box
* Apps is a screen on the stage, not a popover
* One Apps button, and a fullscreen board
* The sidebar music and gamepad buttons open the options
* Ludo and Carrom, the second with real physics
* Play Together - a games panel on the voice stage
* Referee a game on /ws/call
* The Play Together contract and the rules of four games

### Bug fixes

* The sidebar menu was clipped, the die was never seen, and carrom aimed backwards
* A game nobody could sit down in looked like a board that ignored clicks
* Give the Listen Together player a real origin
* Keep the notice strips clear of the window controls
* Swap a portable update from a helper script, not from the app
* Give the YouTube embed a referrer so Listen Together loads

### Other changes

* Changes done for new release
* Browse means two different things, and says which
* The gamepad is a dot on the Apps button now
* The last roll, the forward flick, and the clipped menu
* The library is six games, and the rules take two more arguments
* Ludo and Carrom
* Record Play Together
* Play Together
* Record the three desktop fixes and the new portable swap
* !docs : Docs is done
* Update favicon and brand logo with app icon

### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Built here |
| Desktop (Windows) | Built here |
| Android | Built here |

## [0.0.1-alpha.13](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.12...v0.0.1-alpha.13) (2026-08-25)

### Features

* Pressing play on the page plays it for the call
* Press a video, the call watches it - no link, no button
* Press a video on YouTube and it plays, without the queue detour
* The Listen Together panel
* The Listen Together player, and the clock it runs on
* Listen Together, the shared transport on /ws/call
* Show the marks in the composer as they are typed
* Return makes a newline inside a list, quote or fence
* Carry a list on to its next item
* Render markdown in messages
* A markup parser, ported from android
* Draw bulleted and numbered lists in messages
* Bulleted and numbered lists
* Bubble-style message rows, matching the android layout

### Bug fixes

* The pause button that did nothing, in a window that was silent
* Nothing plays in the browser, on the one event that catches it
* The browser is not a second player
* A seek that snapped back, and a browser that could be heard
* The second copy of the song, playing in the browser tab
* One Listen Together panel, on the stage, bounded
* The sandbox that made it silent, and YouTube itself in the call
* Hide the members panel by default
* Grow the composer with what is typed, up to a cap
* Wrap long composer text instead of scrolling it
* Shrink the chat header call button to match its neighbours
* Double-click reply, not native word-select
* Swipe right-to-left replies, left-to-right stays the drawer's
* A peer id that survives a reconnect, and a seat held for one
* Reopen a socket the background killed, on the way back
* Only a refused credential ends a session

### Other changes

* Changes done for new release
* Add interactive installation & setup section and feature highlights
* Update architecture and service docs with listen together and rich formatting
* A blocked window looks like a blocked window
* The browser that had to stop playing, and the seek that had to stay put
* Clicking a video is the control
* Playing what you found, and the browser that was making its own noise
* The panel's shape, and the two bugs it came from
* Browsing YouTube in the call, and the sandbox that made it silent
* Listen Together

### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Built here |
| Desktop (Windows) | Built here |
| Android | Built here |

## [0.0.1-alpha.12](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.11...v0.0.1-alpha.12) (2026-08-24)

### Features

* Repaint a changed picture, name or server without a restart
* Repaint a changed picture or name where it already is
* Announce a changed profile or server, rather than let it go stale
* Draw several photos as one album, not several cards
* Draw several photos as one album, not several attachments
* Draw messages the way a phone messenger draws them
* Offer a way back down when the conversation is scrolled up
* Let the sheets take their colour from the scheme
* Put the call controls in a floating toolbar
* Repaint the entry, friends and settings screens
* Redraw the conversation
* Move the shell onto the scheme, and give it motion
* Rebuild the shared controls in the expressive language
* Give the client a Material 3 Expressive theme
* Seen-by faces on a message, and swipe a row to reply
* Draw who has seen a message, and reply on a double click
* Say who has read a message, derived from the read markers
* Hold a call when another one takes the audio, and say so
* Say when the connection is down, and stop retrying after 30s

### Bug fixes

* Pad connection banner for status bar insets and consume them in shell
* Give the drawer a fixed gutter, not a fraction of the screen
* Make the status dot subscribe to statuses rather than to a function
* Give the drawer a third of the row rather than half
* Split the row down the middle, and make a swipe prove it is one
* Make the call screen readable, and let the chrome leave downwards
* Give the gutter to the drawer by moving the gesture, not guarding it
* Size the composer's buttons to the bar they are in
* Give the left edge to the drawer, the message to the reply
* Ask the system for the swipe area instead of ceding it
* Leave the left edge to Back and the drawer
* Catch up after the background, and stop the drawer stealing the swipe
* Centre the initial in a pictureless avatar
* Show the notification the prompt was asked for, and fade the read line
* Scope refresh-token reuse revocation to one sign-in

### Other changes

* Changes done for new release
* Record the live profile and server updates, and the status dot that was not live
* Correct the swipe-to-reply rule, and note the jump button
* Record the Material 3 Expressive redesign
* Record the Android catch-up and the drawer gesture
* Record read receipts and the reply shortcuts
* Record the session, hold and reconnect work
* !docs : Docs is done

### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Built here |
| Desktop (Windows) | Built here |
| Android | Built here |

## [0.0.1-alpha.11](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.10...v0.0.1-alpha.11) (2026-08-23)

### Features

* Ring somebody into the call from the call controls
* Add somebody to a call from inside the call
* A Calls & data screen, and a phone that reports what it moved
* A Calls & Data page, and per-link measurement to fill it
* Record what each link in a call moved, and add up a month of them

### Bug fixes

* Size the surface to the frame, so "fit" actually fits
* Show a whole camera, and give the call dock room to breathe
* Drop an answer that arrives after the connection is already settled

### Other changes

* Changes done for new release
* Note why the scaling type alone did not stop the crop
* Record the in-call ring on the web, and the phone showing a whole frame
* Record the per-link call data, the analytics page and the Android screens

### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Built here |
| Desktop (Windows) | Built here |
| Android | Built here |

## [0.0.1-alpha.10](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.9...v0.0.1-alpha.10) (2026-08-23)

### Features

* Show a call log in settings, and count what a call moved
* Record a per-person call log in call-service
* Optimize full-screen views, settings, and voice for mobile viewports
* Convert right panels to mobile slide-over sheets
* Add mobile header and hamburger navigation toggle
* Offer a reload when a newer build is being served
* Create android-style workspace navigation drawer
* Check for, download and apply updates, per Windows flavor
* Add responsive hooks and breakpoint utilities
* Answer a ring without leaving the window
* Answer a ring from the lock screen
* Carry a ring to every device the person has
* Ring one person into a call

### Bug fixes

* Add ensure-electron script to prevent MODULE_NOT_FOUND during install
* Fix server members slide-over panel and auto-navigate to text on voice disconnect
* Remove duplicate mobile TopBar header and fix friends tab clipping
* Point the updater at the repository that publishes the APKs
* Correct indentation for ConnectionSheet visibility in VoiceChannelScreen
* Add drag region to LoginScreen for better window interaction
* Auto-extract and configure electron binary on install and dev
* The microphone is on when it is opened, not a moment later

### Other changes

* Changes done for new release
* Record the call log in TRACK, TODO and TESTING
* Remove obsolete SDD progress ledger file
* How each client notices a release and takes it
* Add implementation plan for mobile web responsive UI adaptation
* Add design spec for mobile web responsive UI adaptation
* A ring is not channel-scoped news, so focus does not swallow it
* Write down what a ring is and why it may be loud
* Desktop installers point at the deployment, not at localhost

### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Built here |
| Desktop (Windows) | Built here |
| Android | Built here |

## [0.0.1-alpha.9](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.8...v0.0.1-alpha.9) (2026-08-23)

### Features

* Show how long the call has been running
* Input sensitivity, which was not blocked after all
* Tell the owner when somebody is on their machine
* Web push, so a closed tab is still reachable
* Safety numbers, so a lying key directory can be caught
* Implement file transfer functionality over data channel
* A share sheet hand-off now asks where it is going

### Bug fixes

* The packaged app died before it opened a window
* A copied image could not be pasted into a message
* A socket whose token expired gave up instead of refreshing
* A network blip during refresh signed you out
* A voice channel stopped listing people who had left
* Stop throwing away the microphone you picked
* The microphone gate was refused by CSP, so it never ran
* Correct every Nexora reference to the real repo name, BetweenUs
* Stop tracking .claude/worktrees, unbreak recursive-submodule checkouts

### Other changes

* Changes done for new release
* Record the main-process crash in the packaged desktop app
* Record the share picker and clipboard paste on Android
* Record the two faults that ended live sessions
* !docs : Docs is done
* Add the missing Notifications architecture page
* Make localhost:3000/ work for dev, keep /Nexora/ in production
* Match the desktop client's exact theme
* Center the Android screenshot
* Embed the Android screenshot, add offline local search
* Redesign the doc pages, not just the landing page
* Redesign the landing page
* Add Android client architecture page
* Split the one giant ERD into per-section diagrams
* Add pnpm docs / docs:build / docs:install root scripts
* Replace default Docusaurus README with a project-specific one
* Add docs deploy workflow, triggered by a !docs marker
* Deployment, CI, security, testing and local-run guides
* Per-service REST/WebSocket reference
* Architecture, system design and database schema content
* Scaffold Docusaurus site under docs/

### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Built here |
| Desktop (Windows) | Built here |
| Android | Built here |

## [0.0.1-alpha.8](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.7...v0.0.1-alpha.8) (2026-08-22)

### Features

* Print every command the deployment needs after the copy
* The installer copies the files and stops there
* Install a deployment without cloning the repository
* Paste a picture into the composer
* Send into BetweenUs from the system share sheet

### Bug fixes

* One owner for the message list's scroll
* Keep the call header clear of the status bar

### Other changes

* Changes done for android release
* The no-clone install path, and the build commands it dated
* Record the share sheet, composer paste and the two screen fixes

### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Carried forward from [v0.0.1-alpha.7](https://github.com/aiyu-ayaan/BetweenUs/releases/tag/v0.0.1-alpha.7) |
| Desktop (Windows) | Carried forward from [v0.0.1-alpha.7](https://github.com/aiyu-ayaan/BetweenUs/releases/tag/v0.0.1-alpha.7) |
| Android | Built here |

## [0.0.1-alpha.7](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.6...v0.0.1-alpha.7) (2026-08-22)

### Features

* Audio devices follow whatever is plugged in

### Bug fixes

* Add caching for Electron build and implement retry logic for packaging
* A link that is refused or unanswered can now recover
* The self-view is inside its corners, and PiP shows the speaker
* Incoming video stops flickering
* The speaking ring reads a level that is actually there

### Other changes

* Done with the enhancement
* The second call-screen pass, and the one bug it did not close

### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Built here |
| Desktop (Windows) | Built here |
| Android | Built here |

## [0.0.1-alpha.6](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.5...v0.0.1-alpha.6) (2026-08-22)

### Features

* A platform a release skips keeps the last one's artifacts
* A marker can name the platforms it is for
* Reconnect a dropped call, and end one that cannot be reconnected
* A notification read on one device takes itself down on the others
* The connection panel, ported from the desktop
* The green speaking ring lights for your own tile too
* Do not wake a phone for a message being read on another device
* A daily update check, and an install that reports what happened
* The auto update screen, and the prompt on launch
* Fetch, download and hand over a newer release
* The rules for which release a device should install

### Bug fixes

* The self-view snaps to a corner, and the chrome gets out of the way
* Video has the rounded corners it appears to have
* Every attachment goes out under the foreground service

### Other changes

* Done with the enhancement
* The call-screen pass recorded in TRACK.md
* RELEASING.md, and the pass recorded in TRACK.md
* Remove outdated Android chat notification suppression and PiP design documents
* Catch every doc up to push suppression, self-update, and the send-path fix
* One send path for every attachment
* The daily check and the installer session
* Record the self-update phase

### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Built here |
| Desktop (Windows) | Built here |
| Android | Built here |

## [0.0.1-alpha.5](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.4...v0.0.1-alpha.5) (2026-08-21)

### Features

* Phase 13 hardening - Keystore session, private CA, crash reports, CI
* The remote clipboard, both directions
* A direct call rings, full-screen, with the app dead
* A call ducks for a prompt and holds for a phone call
* The member menu - message, add friend, mute, copy id
* A colon menu, the server's own emoji in the picker, and animated ones
* Bold, italic, strike, code and quotes in a message body
* Back out of a call and it keeps going in a floating window
* A call takes the whole screen
* Publish the service images for arm64 as well as amd64
* Let a caller ask for a channel key that is not the cached one
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

* The release build, broken by a listener that no longer exists
* Picture-in-picture refuses cleanly, and knows when it is on
* The screen share picker could not open
* A reply typed into the shade that cannot be sent is kept, not dropped
* Adding somebody to a server no longer means guessing a username
* The self-view that was always an empty box
* Let admin:create and seed run from the deployed image
* Repair action refs mangled by the arm64 patch script
* Point `latest` at every release, not only stable ones
* Re-read the channel key when somebody joins the call
* Stop the scheduled backup racing the pre-migration one
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

* Done with the enhancement
* The picker that would not open, and what picture-in-picture needs
* Phase 27's call half is answered by call.roster, and Android rings from it
* Record this pass in TRACK.md and ANDROID_TODO.md
* Reconcile TRACK.md and ANDROID_TODO.md with what the code actually has
* Record the call-screen fixes and what to try on a device
* Betweenus is also available on arm docs
* Apha release done
* Record the missing `latest` tag and the image slimming
* Build the runtime from a production install, not the build stage
* Record the call key's epoch and how it is kept current
* Pin the one re-read on a rotated channel key
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

## [0.0.1-alpha.4](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.3...v0.0.1-alpha.4) (2026-08-21)

### Features

* Phase 13 hardening - Keystore session, private CA, crash reports, CI
* The remote clipboard, both directions
* A direct call rings, full-screen, with the app dead
* A call ducks for a prompt and holds for a phone call
* The member menu - message, add friend, mute, copy id
* A colon menu, the server's own emoji in the picker, and animated ones
* Bold, italic, strike, code and quotes in a message body
* Back out of a call and it keeps going in a floating window
* A call takes the whole screen

### Bug fixes

* Picture-in-picture refuses cleanly, and knows when it is on
* The screen share picker could not open
* A reply typed into the shade that cannot be sent is kept, not dropped
* Adding somebody to a server no longer means guessing a username
* The self-view that was always an empty box
* Let admin:create and seed run from the deployed image

### Other changes

* Done with the enhancement
* The picker that would not open, and what picture-in-picture needs
* Phase 27's call half is answered by call.roster, and Android rings from it
* Record this pass in TRACK.md and ANDROID_TODO.md
* Reconcile TRACK.md and ANDROID_TODO.md with what the code actually has
* Record the call-screen fixes and what to try on a device

## [0.0.1-alpha.3](https://github.com/aiyu-ayaan/BetweenUs/compare/v0.0.1-alpha.2...v0.0.1-alpha.3) (2026-08-21)

### Features

* Publish the service images for arm64 as well as amd64

### Bug fixes

* Repair action refs mangled by the arm64 patch script

### Other changes

* Betweenus is also available on arm docs

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

