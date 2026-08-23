# Client updates

`RELEASING.md` is how a release is cut. This is how the three clients notice
one and take it.

There is no store, no update server and no `latest.yml`. A release is a GitHub
Release with named files attached, and every client reads that same list. The
only thing that differs is what a client can do with what it finds.

| Client | What an update is | Who does the installing |
| --- | --- | --- |
| Desktop, installed | `BetweenUs-<version>-Setup.exe` | the NSIS installer |
| Desktop, portable | `BetweenUs-<version>-Portable.exe` | the app, by swapping its own exe |
| Android | `BetweenUs-<version>-<abi>.apk` | Android's package installer |
| Web | a reload | nobody - the deployment was already updated |

---

## Desktop

`apps/desktop/electron/updates.ts` holds the rules and the download;
`main.ts` holds the part that needs the app; `src/stores/updates.ts` and
`src/components/UpdateNotice.tsx` are the UI, which the web client shares.

### The flavour is the whole problem

Windows ships as two builds from one `electron-builder.yml`: an NSIS installer
and a single portable exe. They are not interchangeable. Handing a portable
copy the installer does not update it - it installs a *second* BetweenUs into
Program Files and leaves the portable one exactly as it was, running, out of
date, and now confusing.

So the flavour is decided first, and it decides everything after it:

```text
app.isPackaged == false                   -> unpacked   (a dev run: no updates at all)
process.env.PORTABLE_EXECUTABLE_FILE set  -> portable   (only ever -Portable.exe)
otherwise                                 -> installer  (only ever -Setup.exe)
```

`PORTABLE_EXECUTABLE_FILE` is set by electron-builder's portable target and is
the only runtime difference between the two builds: the portable exe unpacks
itself into a temp directory and runs from there, so `process.execPath` is the
unpacked copy while that variable is the file the user actually keeps.

There is deliberately no fallback between the two assets. A release that built
one and not the other offers nothing rather than the wrong one.

### Applying it

**Installed.** Start the setup exe and quit. NSIS closes the running app,
replaces the installation and starts it again.

**Portable.** There is no installer, so the app does the swap itself:

```text
1. rename  BetweenUs.exe  ->  BetweenUs.exe.old     (Windows allows this on a
                                                     running executable; it does
                                                     not allow deleting one)
2. copy    the download   ->  BetweenUs.exe          (copy, not rename: the
                                                     download is in the user
                                                     data directory, which may
                                                     be on another volume)
3. start   BetweenUs.exe, quit
4. next launch: delete BetweenUs.exe.old
```

The user's copy stays exactly where they put it, which is the point of a
portable build.

If any step fails - a read-only folder, a locked file, a copy that ran out of
disk - the download is still on the disk and still runnable, so the file
manager is opened on it and the reason is shown. Nothing is left half-swapped:
the rename happens before the copy, so the worst case is the old exe under its
`.old` name and the new one alongside it.

### Channels

The same three as Android, and cumulative in the same way:

| Channel | Offered |
| --- | --- |
| `stable` | finished releases only |
| `beta` | betas, and every stable release |
| `alpha` | everything |

The default is the channel this build belongs to, so an alpha install is not
stranded on stable until the version it is running is released. It is stored
in `betweenus-settings.json` next to the other machine-local switches, because
it is a property of this copy of the app rather than of the account.

"Newer" is by version and never by publish date: a stable release cut after an
alpha is not an upgrade for somebody running that alpha.

### When it asks

On launch and then every six hours, plus a **Check for updates** button in
Settings → Updates. The GitHub API is unauthenticated, which is sixty requests
an hour per address - ample for that, and the reason a refused check is
reported rather than retried.

### Why not electron-updater

It would want a `latest.yml` published alongside the assets, a `publish` block
in the builder config, and a second release path to keep working. And it still
could not update the portable build, which is half of what ships. The rules
above are two hundred lines with a self-check (`electron/updates.check.ts`).

---

## Web

A tab cannot install anything. The deployment is updated by whoever runs it,
and a tab picks the new build up when it reloads - so the entire feature is
noticing that a reload is now worth doing, and offering it.

What it watches is the **asset fingerprint**, not a version number.

Vite names every built file `index-<hash>.js`, and the hash moves exactly when
the contents do. `index.html` is the one unhashed file, and is the list of
which hashes are current. So:

```text
running  = the /assets/… names in this document
served   = the /assets/… names in a no-store fetch of /index.html
different, and neither empty  ->  offer a reload
```

Nothing has to be remembered at release time, which is the reason it is not the
web client's `package.json` version: that number is not bumped by the release
workflow (only the root and desktop manifests are), so a check against it would
never fire.

Either side coming back empty is "cannot tell" and never "changed" - a
development server, a 502 page, a proxy's holding page and an offline tab all
land there, and prompting a reload on the strength of a failed fetch is a
reload loop.

A visible tab asks every five minutes, and any tab asks the moment it is
brought back to the front - which is both the cheapest moment and the one where
a week-old tab is most likely to be stale.

See `apps/desktop/src/services/web-update.ts`.

---

## Android

Unchanged, and the design the desktop one was modelled on: a check on launch, a
daily WorkManager job on unmetered network for a phone nobody has opened, the
per-ABI APK rather than the universal one, and `PackageInstaller` for the
install - so a refusal comes back with a reason. See phase 15 of
`ANDROID_TODO.md`.

---

## What the release has to keep true

The asset names are the contract. All three clients match on the suffix:

```text
BetweenUs-<version>-Setup.exe        desktop, installed
BetweenUs-<version>-Portable.exe     desktop, portable
BetweenUs-<version>-<abi>.apk        Android, per ABI
BetweenUs-<version>-universal.apk    Android, fallback
```

Renaming any of those silently stops that client being offered updates - the
check still runs, finds the release, and finds nothing in it it can apply. They
are set in `apps/desktop/electron-builder.yml` and in the `android` job of
`.github/workflows/release.yml`.

Carried-forward artifacts keep the version they were built for in their name,
which is correct and is what the clients compare against: the version offered
comes from the release tag, not from the file name.
