---
sidebar_position: 3
title: Artifact Size & Budgets
---

# Artifact Size & Budgets

What each BetweenUs client weighs when you download it, how those numbers are
kept honest, and what sets the floor under them.

Every megabyte here is downloaded by somebody on their own connection and data,
and an application grows a little at a time - a dependency here, an asset there
- so nobody ever notices the commit that did it. The budgets below are the
comparison that makes drift visible.

## Measuring

```bash
pnpm desktop:package:win          # builds apps/desktop/release/
pnpm android assembleRelease      # builds apps/android/app/build/outputs/apk/release/
pnpm size                         # print the matrix
pnpm size -- --budget             # the same, but exit 1 on anything over budget
```

`pnpm size` measures what is already on disk and builds nothing. An artifact
that has not been built is reported as absent rather than as a failure, so the
check is safe to run on a machine that has never packaged a client. The
`--budget` form is the one with teeth and runs in release CI, once the artifacts
exist.

`pnpm size --check` is a self-check of the script's own logic and is part of
`pnpm check`.

## The matrix

Measured on `0.0.1-alpha.27`.

### Android

A phone downloads only the APK for its own CPU, so **14.5 MiB** is the figure
that matters for almost everyone.

| APK | Size | Budget |
| :--- | ---: | ---: |
| `armeabi-v7a` (older 32-bit devices) | 9.9 MiB | 13 MiB |
| `arm64-v8a` (most phones) | **14.5 MiB** | 18 MiB |
| `x86` (emulators) | 15.2 MiB | 19 MiB |
| `x86_64` (emulators) | 15.8 MiB | 19 MiB |
| `universal` (all CPUs in one file) | 44.5 MiB | 52 MiB |

The release build runs R8 code shrinking and resource shrinking together, which
takes roughly **70-78%** off the debug build - the `arm64-v8a` APK goes from
53.9 MiB to 14.5. The `universal` APK exists only so you do not have to know
which CPU your phone has; if you do know, take the smaller one.

Most of what remains is the native WebRTC media library, which is why the
32-bit build is several megabytes lighter than the 64-bit one.

### Desktop (Windows)

| | Size | Budget |
| :--- | ---: | ---: |
| **Installer** (`BetweenUs-<version>-Setup.exe`) | **85.0 MiB** | 90 MiB |
| Installed on disk | 300.2 MiB | 310 MiB |
| └ of which application code | 14.7 MiB | - |

The desktop client is an Electron application, so roughly 204 MiB of that
installed footprint is Chromium itself and is the same for every Electron app
ever shipped. The part this project writes is the last row.

## Why the desktop installer is the size it is

Two settings in `electron-builder.yml` do the work that can be done:

- **One locale instead of 55.** Chromium ships a translation table for every
  language it supports. BetweenUs ships one language, so the other 54 were 45 MB
  of translations for menus nobody was reading. Keeping only `en-US` took
  **45 MiB off the installed size** and 7.8 MiB off the download. When BetweenUs
  genuinely ships a translation, that language is added back alongside it.
- **Maximum LZMA compression.** The installer is built once per release and
  downloaded many times, so a slower build for a smaller download is worth it
  every time.

The installer fell by less than the installed size did, and that is expected
rather than odd: locale tables are text and compress extremely well, so they
were already cheap inside the compressed installer while still costing full
price on disk.

Three things are deliberately **not** stripped:

- **GPU fallback libraries** (~31 MiB). These are what render the application on
  a machine with no working graphics driver. Removing them saves 31 MB and
  produces a black window for the people who most need the fallback.
- **The Chromium licence file** (15.3 MiB). Whether it may be removed is a
  licensing question rather than a size one.
- **Chromium itself** (204 MiB). This is the floor for an Electron application.

## How budgets work

Budgets live in `scripts/artifact-size.mjs`, not in this page - a number
somebody has to remember to look up is a number that is already stale.

They are set from a measured build plus a little room to grow. A budget below
what already ships would fail on its first run and simply get raised to whatever
was measured, which is how a budget stops meaning anything. Raising one is a
deliberate act that belongs in the commit needing the room, with the reason in
the message.

The renderer bundle carries the loosest budget on purpose: it is the one figure
that grows with features rather than with toolchains, and a megabyte of new
product is not a regression. The desktop figures carry the tightest, because
almost nothing should move them except an Electron upgrade - which is exactly
the event worth being told about.

## See also

- [Release Pipeline](./release-pipeline.md) - how these artifacts are built and published.
- [Client Updates](./client-updates.md) - how an installed client downloads a newer one.
