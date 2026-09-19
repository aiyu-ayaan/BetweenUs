---
sidebar_position: 5
---

# Client Updates

Full source: [`development/UPDATES.md`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/development/UPDATES.md).

[The release pipeline](./release-pipeline.md) publishes a GitHub Release with
named files attached. This is how the three clients notice one and take it.

There is no store, no update server and no `latest.yml`. Every client reads the
same release list; what differs is what it can do with what it finds.

| Client | What an update is | Who installs it |
| --- | --- | --- |
| Desktop (Windows) | `BetweenUs-<version>-Setup.exe` | the NSIS installer, silently |
| Desktop (Linux) | `BetweenUs-<version>.AppImage` | the app, writing it over its own file |
| Android | `BetweenUs-<version>-<abi>.apk` | Android's package installer |
| Web | a reload | nobody — the deployment was already updated |

## Desktop

Windows ships one build: an installer. A portable exe shipped beside it until
the pair of them made every update a question of which build was asking, and
handing a portable copy the installer installs a *second* BetweenUs rather than
updating the first. One build, one asset, no question.

```mermaid
flowchart TD
    %% TIER 1: APP STARTUP & RUNTIME DETECTION
    subgraph T_BOOT ["Phase 1: Environment Detection"]
        direction TB
        Launch["<b>Client Launches</b>"]
        IsPackaged{"<b>Is Packaged Production Build?<br/>(app.isPackaged)</b>"}
        DevRun["<b>Development / Unpacked Run</b><br/><i>Auto-updates disabled</i>"]
        CheckRelease["<b>Fetch Latest GitHub Release Metadata</b>"]

        Launch --> IsPackaged
        IsPackaged -->|"No"| DevRun
        IsPackaged -->|"Yes"| CheckRelease
    end

    %% TIER 2: VERSION COMPARISON
    subgraph T_DIFF ["Phase 2: Version Comparison"]
        direction TB
        HasNewer{"<b>Newer Version Available?<br/>(semver.gt)</b>"}
        UpToDate["<b>Client Up-To-Date</b><br/><i>No action needed</i>"]
        Prompt["<b>Display In-App Update Banner</b>"]

        CheckRelease --> HasNewer
        HasNewer -->|"No"| UpToDate
        HasNewer -->|"Yes"| Prompt
    end

    %% TIER 3: BACKGROUND DOWNLOAD & VALIDATION
    subgraph T_DOWNLOAD ["Phase 3: Background Staging"]
        direction TB
        Download["<b>Download Installer Asset in Background</b><br/><i>Staged in &lt;userData&gt;/updates/</i>"]
        VerifyHash["<b>Verify SHA-256 Digest & Authenticode Signature</b>"]
        ReadyToInstall["<b>Ready to Install</b><br/><i>Show 'Restart and Install' button</i>"]

        Prompt ==> Download ==> VerifyHash ==> ReadyToInstall
    end

    %% TIER 4: SILENT EXECUTION
    subgraph T_EXEC ["Phase 4: Silent NSIS Update & Relaunch"]
        direction TB
        SpawnNSIS["<b>Spawn BetweenUs-Setup.exe --updated /S --force-run</b>"]
        Quit["<b>Gracefully Quit Running Client</b><br/><i>Release locks for NSIS overwrite</i>"]
        Relaunched["<b>Relaunch New Version Automatically</b>"]

        ReadyToInstall ==> SpawnNSIS ==> Quit ==> Relaunched
    end

    %% Styling
    classDef primary fill:#1e40af,stroke:#60a5fa,stroke-width:2px,color:#ffffff;
    classDef decision fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef success fill:#14532d,stroke:#22c55e,stroke-width:2px,color:#ffffff;
    classDef neutral fill:#334155,stroke:#64748b,stroke-width:1px,color:#f8fafc;

    class Launch,CheckRelease,Prompt,Download,VerifyHash,ReadyToInstall,SpawnNSIS,Quit primary;
    class IsPackaged,HasNewer decision;
    class Relaunched,UpToDate success;
    class DevRun neutral;
```

A release that built the other platforms only offers this one nothing, rather
than something it cannot apply: Windows is only ever handed the setup exe and
Linux only ever the AppImage.

### The installer

Assisted rather than one-click, and per user:

| | |
| --- | --- |
| Where it goes | the user chooses, and an update keeps that choice |
| Elevation | none — a per-user install never asks for an administrator |
| Shortcuts | desktop and start menu |
| Uninstall | leaves AppData, so reinstalling does not lose anyone's keys |

### Applying it

The download waits in `<userData>/updates`. **Restart and install** starts it
as `--updated /S --force-run` — silent, into the directory already chosen, and
BetweenUs starts again when it is done — and this process quits so NSIS has
nothing left to close. Started with no arguments it opens its wizard behind the
running app, which is exactly what made the button look dead.

If it cannot be started at all, the download is on the disk and runnable, so
the file manager opens on it and the reason is shown.

### Starting BetweenUs when the installer is done

electron-builder starts the app from two places — the finish page's
"Run BetweenUs" checkbox, and the silent install an update performs — and both
went through `StdUtils::ExecShellAsUser`, whose job is handing a launch *down*
from an elevated installer to the signed-in user. It does that by asking the
desktop shell to run the file on its behalf, and the error it fails with is
discarded. A shell that will not take the call ends both paths the same way:
the installer finishes and nothing opens, after a first install and after an
update alike.

This installer is never elevated, so there is nothing to hand a launch down
from. `apps/desktop/nsis/installer.nsh` replaces both with a plain
`ExecShell` on the installed executable — the finish page through
`customFinishPage`, the silent update through `customInstall`. A machine where
the old call worked now starts the app twice; the second copy sees the
single-instance lock, hands the window to the first and quits.

### Linux: one AppImage, replaced in place

Linux ships one build too, an AppImage, for the same reason Windows ships an
installer: it is the one format that can update itself. There is no installer
to run. The update is writing the new AppImage over the file the app was
started from, which the AppImage runtime names in `APPIMAGE`. Replacing a
*running* AppImage is safe, because the FUSE mount holds the old inode open.
The file is copied beside the target and renamed over it, so a failure leaves
the old build runnable, and the app relaunches from the same path.

That only works when the file is somewhere the user can write, which is what
the installer script is for:

```bash
curl -fsSL https://raw.githubusercontent.com/aiyu-ayaan/BetweenUs/master/scripts/install-linux.sh | sh
```

| | |
| --- | --- |
| Where it goes | `~/.local/share/betweenus/BetweenUs.AppImage`, so the updater can write over it |
| Elevation | none: per user, and it refuses to run as root |
| Shortcuts | a menu entry and icon, plus a `betweenus` command in `~/.local/bin` |
| Integrity | the download is checked against the sha256 GitHub records for the asset |
| Channels | `--channel beta` / `--channel alpha`, the same cumulative rules as the app |
| Uninstall | `--uninstall`, which leaves `~/.config/@betweenus/desktop`, so keys survive a reinstall |

Re-running it is always safe and is the manual update path. `--version` pins a
release and `--from-file` installs a local AppImage.

An AppImage run from anywhere else still works. It updates itself as long as
its own directory is writable. A `linux-unpacked` tree has no single file to
replace, so it reports itself as `unpacked` and is never offered an update.

**Why it starts in about a second.** `compression: maximum` is right for the
NSIS installer, which is unpacked once. The legacy AppImage toolset turned it
into xz with 1 MB blocks, and an AppImage is read page by page through FUSE
for as long as it runs: a cold start took 90 seconds. The builder now uses the
static AppImage runtime (`toolsets.appimage` in `electron-builder.yml`). It
compresses with zstd, starts in about 1.5 s on the same machine, and carries
its own FUSE client, so it runs without `libfuse2`, which Ubuntu 22.04 and
later do not install. Every release boots the AppImage in CI before
publishing it (`.github/scripts/smoke-appimage.sh`).

**Sandbox.** An AppImage cannot ship a setuid `chrome-sandbox`, so Chromium
relies on unprivileged user namespaces. Where the kernel refuses them (Ubuntu
24.04's AppArmor policy), the AppImage's own launcher detects that and passes
`--no-sandbox`. That holds for a relaunch after an update and a start from
the session too, because both go through the AppImage file.

### Start with the system

On by default on both platforms, and switched in Settings → Notifications →
This computer.

| | Windows | Linux |
| --- | --- | --- |
| Mechanism | `app.setLoginItemSettings` (the Run key) | an XDG autostart entry, `~/.config/autostart/betweenus.desktop` |
| Started as | `--hidden`, straight to the tray | the same |
| Dev channel | its own entry, per app name | `betweenus-dev.desktop` |

`setLoginItemSettings` does nothing on Linux: no error and no effect. So
`electron/autostart.ts` writes the entry that GNOME, KDE, Cinnamon, XFCE and
MATE all honour. It is rewritten on every launch while the switch is on,
because an AppImage can be moved and the entry has to follow it. `Exec` is
quoted the way the Desktop Entry spec asks, so an install path with a space
still starts. A development window never registers itself on either
platform.

### When it downloads

A check finds an offer and fetches it there and then: the download is the slow
half and it is the half that can happen quietly. Installing is always asked
for. A download that is still waiting when the app is closed is picked back up
on the next launch — the file name carries the version — and anything that is
no longer an upgrade on this build is deleted.

### The notes are drawn as markdown

A release body is `### Features` with a list under it, `**bold**`, a fenced
block of shell. Every client used to show that text exactly as it arrived,
hashes and asterisks included. All three now render it.

It is the message parser doing it, with one rule switched on:

```text
parse(text)       chat            no headings - a heading in a chat line is shouting
parseNotes(text)  release notes   headings, and a table's `| --- |` rule swallowed
```

The drawing is per client — `components/ReleaseNotes.tsx` on desktop and web,
`feature/update/ReleaseNotes.kt` on Android — because the message list lays
custom emoji and link previews over its blocks and none of that belongs in a
changelog. Headings come out at two sizes, lists get a marker gutter, fenced
code gets its own ground.

Tables are not parsed: the rule row is swallowed, the rows stay as pipes.

### Channels

Cumulative, and the same three as Android:

| Channel | Offered |
| --- | --- |
| `stable` | finished releases only |
| `beta` | betas, and every stable release |
| `alpha` | everything |

The default is the channel this build belongs to, so an alpha install isn't
stranded on stable until the version it's running is released. It's stored in
`betweenus-settings.json` — a property of this copy of the app, not of the
account. Changing it in Settings → Updates takes effect on the spot and
re-checks; the offer in hand is dropped, because it was picked on the old
channel.

"Newer" is by version and never by publish date: a stable release cut after an
alpha is not an upgrade for somebody running that alpha.

It checks on launch and then every six hours, plus a **Check for updates**
button in Settings → Updates. The GitHub API is unauthenticated — sixty
requests an hour per address — which is why a refused check is reported rather
than retried.

### Why not electron-updater

It would want a `latest.yml` published alongside the assets, a `publish` block
in the builder config, and a second release path to keep working. The rules
here are two hundred lines with a self-check beside them
(`electron/updates.check.ts`).

## Web: notice, then reload

A tab can't install anything. The deployment is updated by whoever runs it and
a tab picks the new build up when it reloads, so the whole feature is noticing
that a reload is now worth doing.

What it watches is the **asset fingerprint**, not a version number. Vite names
every built file `index-<hash>.js` and the hash moves exactly when the contents
do; `index.html` is the one unhashed file and lists which hashes are current.

```text
running  = the /assets/… names in this document
served   = the /assets/… names in a no-store fetch of /index.html
different, and neither empty  →  offer a reload
```

Nothing has to be remembered at release time. That's why it isn't the web
client's `package.json` version — the release workflow bumps the root and
desktop manifests only, so a check against that number would never fire.

Either side coming back empty is "cannot tell", never "changed": a development
server, a 502 page, a proxy's holding page and an offline tab all land there,
and prompting a reload on a failed fetch is a reload loop.

A visible tab asks every five minutes, and any tab asks the moment it's brought
back to the front — the cheapest moment, and the one where a week-old tab is
most likely to be stale.

## Android

A check on launch, a daily WorkManager job on unmetered network for a phone
nobody has opened, the per-ABI APK rather than the universal one, and
`PackageInstaller` for the install so a refusal comes back with a reason. See
[the Android client](../architecture/android-client.md).

## The asset names are the contract

```text
BetweenUs-<version>-Setup.exe        desktop (Windows), installed
BetweenUs-<version>.AppImage         desktop (Linux, x86_64)
BetweenUs-<version>-<abi>.apk        Android, per ABI
BetweenUs-<version>-universal.apk    Android, fallback
```

Renaming any of these silently stops that client being offered updates: the
check still runs, finds the release, and finds nothing in it it can apply. They
are set in `apps/desktop/electron-builder.yml` and in the `android` job of
`.github/workflows/release.yml`. The Linux installer script matches the same
AppImage name, so it depends on this contract too.

Carried-forward artifacts keep the version they were built for in their file
name, which is correct — the version a client compares against comes from the
release tag, not from the name.
