---
sidebar_position: 4
---

# Docs Deployment

This site is built and deployed by
[`.github/workflows/docs.yml`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/.github/workflows/docs.yml),
following the same marker convention as [the release pipeline](/deployment/release-pipeline):
a commit on `master` whose subject starts with `!docs` builds this
Docusaurus site and publishes it. Unlike a release, there's no version to
bump and no PR step — a `!docs` push ships directly, because there's no
compiled artifact whose diff is worth reviewing before it goes out.

```mermaid
flowchart TD
    %% TIER 1: TRIGGER
    subgraph T_TRIGGER ["Phase 1: Commit Trigger & Dispatch"]
        Trigger["<b>Push to master with !docs marker</b><br/><i>(or manual workflow_dispatch)</i>"]
    end

    %% TIER 2: RUNNER & BUILD
    subgraph T_BUILD ["Phase 2: CI Environment & Docusaurus Compilation"]
        direction TB
        Setup["<b>Setup Node.js & Dependencies</b><br/><i>npm ci in docs/</i>"]
        BuildSite["<b>Compile Docusaurus Production Build</b><br/><i>npm run build (HTML / CSS / JS / Search Index)</i>"]
        Trigger ==> Setup ==> BuildSite
    end

    %% TIER 3: GH-PAGES PUBLISH
    subgraph T_PUBLISH ["Phase 3: GitHub Pages Deployment"]
        direction TB
        Deploy["<b>Deploy build/ to gh-pages branch</b><br/><i>(peaceiris/actions-gh-pages force-push)</i>"]
        PagesHost["<b>GitHub Pages CDN</b><br/><i>Serves live docs from /BetweenUs/</i>"]
        BuildSite ==> Deploy ==> PagesHost
    end

    %% Styling
    classDef primary fill:#1e40af,stroke:#60a5fa,stroke-width:2px,color:#ffffff;
    classDef success fill:#14532d,stroke:#22c55e,stroke-width:2px,color:#ffffff;

    class Trigger,Setup,BuildSite,Deploy primary;
    class PagesHost success;
```

## The `gh-pages` branch

The workflow force-pushes the built static site to a `gh-pages` branch — a
new commit each run, authored by the Actions bot, containing only the
built HTML/CSS/JS. That branch never appears in a pull request and is
never merged; it exists purely as what GitHub Pages serves from
(**Settings → Pages → Deploy from a branch → `gh-pages`**). This mirrors
how a classic GitHub Pages deploy works, and is the same shape
`electron-builder`/`create-docusaurus`'s own `npm run deploy` script uses
under the hood.

## Trigger detail

Reusing the same "marker at the start of a commit subject" idea as
`release.yml`, but simpler — one job, no version state, no rollback:

- `push` to `master`: the workflow checks whether any pushed commit's
  subject starts with `!docs`; if none does, the job exits without
  building anything.
- `workflow_dispatch`: always builds and deploys, for a manual redeploy
  (useful right after merging a docs PR that didn't itself carry the
  marker, or after a Pages outage).

A release can also ask for this deploy, by naming `docs` in its marker
scope (`!fix(android,docs)`). That runs the same build from `release.yml`
after the release is published, and shares this concurrency group, so a
`!docs` push and a release carrying `docs` queue behind one another rather
than force-pushing `gh-pages` at the same moment. See
[Release Pipeline](/deployment/release-pipeline).

## Running it locally first

Always build locally before pushing a `!docs` commit — see
[Running Locally](/running-locally#docs-site).
