# Releasing

One version number covers the whole product - the server images, the Windows
desktop build and the Android artifacts - and a release does not have to
rebuild all of it. This is how to cut one, and what happens to the parts that
were not rebuilt.

The rules live in `scripts/release-version.mjs` and `scripts/release-notes.mjs`,
both of which self-check under `pnpm check`, and the flow in
`.github/workflows/release.yml`.

---

## Two steps, not one

1. A marker at the start of a commit subject on `master` opens (or updates) a
   release PR. It bumps `package.json` and `apps/desktop/package.json`, writes
   the `CHANGELOG.md` entry and records what the release builds in
   `.github/release-targets`. Nothing is built.
2. **Merging that PR is what releases.** The images, the installer and the APKs
   are built, then the tag and the GitHub Release are created, and the moving
   image tags are re-pointed last of all.

Closing the PR without merging releases nothing and costs nothing.

## Markers

| Marker | From | To | |
| --- | --- | --- | --- |
| `!major` | `1.4.2` | `2.0.0` | stable |
| `!feat` | `1.4.2` | `1.5.0` | stable |
| `!fix` | `1.4.2` | `1.4.3` | stable |
| `!alpha` | `0.0.1` | `0.0.2-alpha.1` | pre-release |
| `!alpha` | `0.0.2-alpha.1` | `0.0.2-alpha.2` | |
| `!beta` | `0.0.2-alpha.3` | `0.0.2-beta.1` | promote, same base version |
| `!stable` | `0.0.2-beta.2` | `0.0.2` | promote to stable, no bump |

A push with no marker is not a release. When a push carries several, the
strongest wins in the order above. A channel can be promoted but not demoted in
place: `!alpha` on a beta starts a fresh alpha on the *next* patch, because
`0.0.2-alpha.1` sorts below a `0.0.2-beta.1` that has already shipped.

## Building one platform

A marker may name the platforms the release is for, in the scope position:

```text
!alpha(android)            the Android artifacts, nothing else
!fix(android,desktop)      both clients, no server images
!feat(docker)              the nine service images, no clients
!feat                      everything, which is what no scope means
```

The names, with the aliases each accepts:

| Target | Also spelled | What it builds |
| --- | --- | --- |
| `docker` | `server`, `servers`, `images`, `backend`, `web`, `api` | all nine service images, `web` and `admin-web` among them, both architectures |
| `desktop` | `windows`, `win`, `electron` | the Windows installer and the portable exe |
| `android` | `apk`, `mobile` | the per-ABI APKs, the universal APK and the AAB |

`all` is the explicit way to say what an empty scope means. Several scoped
markers in one push are the union of what they ask for.

**A scope that is not entirely platform names is a conventional-commit scope
and changes nothing.** `!feat(chat)` builds all three, and so does
`!feat(android,chat)`: half a platform list is not one, and guessing otherwise
would quietly ship a release with two thirds of it missing.

There is no `web`-without-`docker`. The web client is a container like every
other service, and splitting it out would buy one combination for the cost of a
second tagging, promoting and rollback path.

## What happens to the platforms it skipped

They are carried forward, not left behind:

- **Images.** `<service>-<version>` is created for every service whatever was
  built, from the previous release's tag when nothing was. `imagetools create`
  copies the manifest list whole, both architectures with it, and pulls
  nothing. `promote` therefore has a complete set to point `latest` and the
  channel tag at, and the deployment bundle can pin the version.
- **Installers and APKs.** They are downloaded from the previous GitHub Release
  and attached to this one under their own names, which still carry the version
  they were built for. That is deliberate: the file name is the honest answer to
  "which build is this".

Carrying is transitive without trying to be. If `v0.0.6` carried the APKs from
`v0.0.5`, they are `v0.0.6` assets like any other, and `v0.0.7` takes them from
there.

The first release has nothing to carry from, so a scoped marker with no
previous tag behind it quietly builds everything instead.

## Where it says so

Every entry ends with a table naming each platform and either "Built here" or
the release its artifacts came from:

```markdown
### Artifacts

| Platform | This release |
| --- | --- |
| Server images | Carried forward from [v0.0.4](.../releases/tag/v0.0.4) |
| Desktop (Windows) | Carried forward from [v0.0.4](.../releases/tag/v0.0.4) |
| Android | Built here |
```

It is written into `CHANGELOG.md` rather than only into the GitHub Release, so
it is in the release PR's diff where it can still be argued with, and it is
read back out of the file at publish time - edits on the PR branch included.

## Releasing by hand

`workflow_dispatch` takes a `mode`:

- `pr` opens the release PR, with a `marker` and a `targets` input (`all`, or
  any of `docker`/`desktop`/`android`, comma-separated).
- `release` builds and publishes the version `master` already carries, reading
  `.github/release-targets` for what to build. This is the way back after a
  rollback, and after a release PR that merged without being noticed.

## When it fails

`rollback` deletes the version image tags and any tag and Release that got
created, and deliberately does not touch the channel tags: they still point at
the last release that finished, which is why `promote` runs dead last. The
version bump stays on `master`, so the next release is computed from the
version that failed - use `!fix` or `!alpha`, not another attempt at the same
number.
