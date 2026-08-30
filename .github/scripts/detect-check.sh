#!/bin/sh
# Self-check for the `merged` job's detect step in .github/workflows/release.yml.
#
# That step is the one that decides whether a push is a release, which kind, and
# what it builds - and it is the step that has been wrong twice. It once asked
# `git show --name-only` which files a commit touched, which prints nothing at
# all for a merge commit, so the shape it existed for never fired. Reading it
# did not catch that; running it does.
#
# So the step is lifted out of the YAML verbatim and run against throwaway
# repositories built to look like each shape a push can take. `pnpm check` runs
# this, which means a change to that step fails CI rather than a release.
#
# Usage: sh .github/scripts/detect-check.sh [repo root, default .]
set -u

ROOT="$(cd "${1:-.}" && pwd)"
WORKFLOW="$ROOT/.github/workflows/release.yml"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The step's script, unedited: everything indented under its `run: |` up to the
# first line that leaves that block.
awk '
  /^      - name: Is this the release commit$/ { found = 1 }
  found && /^        run: \|$/ { body = 1; next }
  body {
    if ($0 != "" && $0 !~ /^          /) exit
    print substr($0, 11)
  }
' "$WORKFLOW" > "$WORK/body.sh"
test -s "$WORK/body.sh" || { echo "detect step not found in $WORKFLOW"; exit 1; }
printf '#!/bin/sh\nset -e\n' | cat - "$WORK/body.sh" > "$WORK/detect.sh"

fail=0

# A throwaway repository carrying $1 as its version.
setup() {
  rm -rf "$WORK/r"
  mkdir -p "$WORK/r/.github" "$WORK/r/scripts"
  cp "$ROOT/scripts/release-version.mjs" "$WORK/r/scripts/"
  cd "$WORK/r" || exit 1
  printf '{"name":"x","version":"%s"}\n' "$1" > package.json
  git init -q .
  git config user.email t@example.com
  git config user.name t
  git add -A
  git commit -qm 'chore: base'
}

# run EVENT MODE INPUT_TARGETS SUBJECT BEFORE_SHA
run() {
  : > "$WORK/out.txt"
  out="$(EVENT="$1" MODE="$2" INPUT_TARGETS="$3" SUBJECT="$4" BEFORE_SHA="$5" \
         GITHUB_OUTPUT="$WORK/out.txt" GITHUB_SHA="$(git rev-parse HEAD)" \
         sh "$WORK/detect.sh" 2>&1; echo "exit=$?")"
  out="$out
$(cat "$WORK/out.txt")"
}

# check NAME EXPECTED...
check() {
  name="$1"
  shift
  bad=0
  for want in "$@"; do
    case "$out" in
      *"$want"*) ;;
      *) echo "FAIL $name: expected '$want'"; bad=1 ;;
    esac
  done
  if [ "$bad" = 0 ]; then
    echo "ok   $name"
  else
    echo "$out"
    fail=1
  fi
}

# A !patch rebuilds the version master already carries, and nothing else moves.
setup 1.2.3
git tag v1.2.3
before="$(git rev-parse HEAD)"
git commit -q --allow-empty -m '!patch(desktop,docs): rebuild the installer'
run push '' '' '!patch(desktop,docs): rebuild the installer' "$before"
check 'a patch rebuilds in place' \
  release=true patch=true version=1.2.3 targets=desktop docs=true carry=1.2.3 exit=0

# There is nothing to replace when the version was never published.
setup 9.9.9
before="$(git rev-parse HEAD)"
git commit -q --allow-empty -m '!patch: rebuild'
run push '' '' '!patch: rebuild' "$before"
check 'a patch of an unreleased version refuses' 'has nothing to replace' exit=1

# A merged release PR builds what the PR wrote down, not everything.
setup 1.2.3
git tag v1.2.3
printf 'android\ndocs\n' > .github/release-targets
node -e "const m=require('./package.json');m.version='1.3.0';require('fs').writeFileSync('package.json',JSON.stringify(m))"
git add -A
git commit -qm 'chore(release): v1.3.0'
run push '' '' 'chore(release): v1.3.0' ''
check 'a merged release PR keeps its scope' \
  release=true patch=false version=1.3.0 targets=android docs=true carry=1.2.3 exit=0

# And everything, when nothing was written down.
setup 1.2.3
git tag v1.2.3
node -e "const m=require('./package.json');m.version='1.3.0';require('fs').writeFileSync('package.json',JSON.stringify(m))"
git add -A
git commit -qm 'Merge pull request #7 from chore/release-v1.3.0'
run push '' '' 'Merge pull request #7 from chore/release-v1.3.0' ''
check 'a merge commit is read from the version field' \
  release=true version=1.3.0 targets=docker,desktop,android docs=false

setup 1.2.3
git tag v1.2.3
before="$(git rev-parse HEAD)"
git commit -q --allow-empty -m 'fix(chat): something unrelated'
run push '' '' 'fix(chat): something unrelated' "$before"
check 'an ordinary push is not a release' release=false 'Not a release commit' exit=0

# A push carrying both is a release: the release contains the rebuild.
setup 1.2.3
git tag v1.2.3
git commit -q --allow-empty -m '!patch: rebuild'
before="$(git rev-parse HEAD~1)"
node -e "const m=require('./package.json');m.version='1.3.0';require('fs').writeFileSync('package.json',JSON.stringify(m))"
git add -A
git commit -qm 'chore(release): v1.3.0'
run push '' '' 'chore(release): v1.3.0' "$before"
check 'a release beats a patch in the same push' release=true patch=false version=1.3.0

setup 1.2.3
git tag v1.2.3
run workflow_dispatch patch 'android, docs' '' ''
check 'a dispatched patch reads its own targets' \
  release=true patch=true targets=android docs=true exit=0

setup 1.2.3
git tag v1.2.3
run workflow_dispatch release '' '' ''
check 'a dispatched release is not a patch' \
  release=true patch=false targets=docker,desktop,android docs=false

cd "$ROOT" || exit 1
if [ "$fail" = 0 ]; then
  echo 'release detect self-check passed'
fi
exit "$fail"
