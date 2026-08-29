---
sidebar_position: 2
---

# Release Pipeline

Full source: [`development/RELEASING.md`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/development/RELEASING.md)
and [`.github/workflows/release.yml`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/.github/workflows/release.yml).

One version number covers the server images, the Windows desktop build and
the Android artifacts. A release doesn't have to rebuild all of it — what it
skips is carried forward from the previous release rather than left behind.

## Two steps, not one

```mermaid
flowchart TD
    %% TIER 1: TRIGGER & PROMOTION MARKER
    subgraph T_TRIGGER ["Phase 1: Commit Marker Trigger"]
        direction TB
        Commit["<b>Commit on master with marker</b><br/><i>(!major · !feat · !fix · !alpha · !beta · !stable)</i>"]
        ReleasePR["<b>release-pr Job</b><br/><i>Bump package versions · Generate CHANGELOG.md · Open PR</i>"]
        Commit ==>|"1. Automated Workflow Dispatch"| ReleasePR
    end

    %% TIER 2: HUMAN REVIEW GATE
    subgraph T_GATE ["Phase 2: Review & Authorization Gate"]
        direction TB
        MergePR{"<b>Merge Release PR?</b>"}
        Closed["<b>PR Closed without Merge</b><br/><i>Zero Artifacts Built · No Release</i>"]
        ReleasePR --> MergePR
        MergePR -->|"No"| Closed
    end

    %% TIER 3: PARALLEL ARTIFACT BUILD MATRIX
    subgraph T_BUILD ["Phase 3: Parallel Matrix Build & Packaging"]
        direction TB
        subgraph Matrix ["Build Targets"]
            direction LR
            DockerBuild["<b>Docker Images</b><br/><i>9 Microservice Containers</i>"]
            DesktopBuild["<b>Desktop Packaging</b><br/><i>NSIS Windows Installer</i>"]
            AndroidBuild["<b>Android Build</b><br/><i>APK & AAB Bundles</i>"]
        end
        MergePR ==>|"Yes"| Matrix
    end

    %% TIER 4: PUBLICATION & TAG PROMOTION
    subgraph T_PUBLISH ["Phase 4: Publication & Channel Tag Promotion"]
        direction TB
        GHRelease["<b>GitHub Release & Version Tag</b><br/><i>Attach Compiled Binaries & Release Notes</i>"]
        PromoteTags["<b>Promote Channel Tags</b><br/><i>Move :latest, :alpha, :beta to new release</i>"]
        Rollback["<b>Automated Rollback</b><br/><i>Purge failed image tags & remove draft release</i>"]

        Matrix ==>|"All Jobs Succeed"| GHRelease ==> PromoteTags
        Matrix -.->|"Any Target Fails"| Rollback
    end

    %% Styling
    classDef primary fill:#1e40af,stroke:#60a5fa,stroke-width:2px,color:#ffffff;
    classDef decision fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef success fill:#14532d,stroke:#22c55e,stroke-width:2px,color:#ffffff;
    classDef fail fill:#7f1d1d,stroke:#ef4444,stroke-width:2px,color:#ffffff;

    class Commit,ReleasePR,DockerBuild,DesktopBuild,AndroidBuild primary;
    class MergePR decision;
    class GHRelease,PromoteTags success;
    class Closed,Rollback fail;
```

1. **The marker commit opens a release PR.** It bumps `package.json` and
   `apps/desktop/package.json`, writes the `CHANGELOG.md` entry, and records
   what's being built in `.github/release-targets`. Nothing is built yet —
   the diff is the last look before it ships.
2. **Merging that PR is what releases.** Images → desktop installer →
   Android APKs and AAB (one job each, in parallel) → the tag and GitHub
   Release → the moving tags
   (`latest`, `alpha`/`beta`) re-pointed dead last, only once every artifact
   and the Release itself exist.

## Markers

| Marker | Effect |
| --- | --- |
| `!major` | `1.4.2` → `2.0.0`, stable |
| `!feat` | `1.4.2` → `1.5.0`, stable |
| `!fix` | `1.4.2` → `1.4.3`, stable |
| `!alpha` | `0.0.1` → `0.0.2-alpha.1`, pre-release |
| `!beta` | promotes to `0.0.2-beta.1`, same base version |
| `!stable` | promotes to `0.0.2`, no version bump |

A push with no marker releases nothing. A channel promotes but never
demotes in place.

## Scoping to one platform

```text
!alpha(android)        Android artifacts only
!fix(android,desktop)  both clients, no server images
!feat(docker)          the nine service images only
!feat                  everything (empty scope = all)
```

A scope that isn't entirely platform names (`docker`/`desktop`/`android`
and their aliases) is read as an ordinary conventional-commit scope and
changes nothing — `!feat(chat)` still builds everything.

## What a skipped platform gets

Not left behind — carried forward. `<service>-<version>` image tags exist
for every service every release, either freshly built or copied (by
digest, `imagetools create`, no rebuild) from the last release's tag. The
Windows installer and Android APKs are likewise downloaded from the
previous GitHub Release and re-attached under this version's release,
keeping their own (older) filenames — which is the honest answer to "which
build is this." The CHANGELOG carries a table saying exactly which half of
each release is which.

## Manual dispatch

`workflow_dispatch` takes `mode: pr` (open a release PR by hand) or
`mode: release` (build and publish whatever `master` already carries — the
way back after a rollback, or after a merged release PR this workflow
missed).

## On failure

`rollback` deletes the version's image tags and any tag/Release that got as
far as existing, and deliberately leaves the channel tags (`latest`,
`alpha`, `beta`) untouched — they still point at the last release that
finished. The version bump stays on `master`; the next release is computed
from the failed version, so use `!fix` or `!alpha`, not a retry of the same
number.
