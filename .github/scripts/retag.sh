#!/bin/sh
# Point more names at images that are already in the repository.
#
#   IMAGE_REPO=aiyuayaan/betweenus .github/scripts/retag.sh 0.0.1-alpha.22 alpha latest
#
# Every service listed below gets `<service>-<dest>` for each destination,
# resolving to exactly the manifest `<service>-<source>` resolves to.
#
# WHY NOT `docker buildx imagetools create`
#
# That is what this replaced, and it is what took the pipeline down twice in one
# morning. `imagetools create` does not re-point a name; it *copies* - it reads
# the manifest list and then every child manifest under it and pushes them back,
# which is four extra registry reads per tag, ninety a release across nine
# services and two channel tags. Docker Hub counts every one of those against
# the pull limit, the limit is per six hours, and the release after the one that
# exhausted it fails in `images` before it builds anything:
#
#   429 Too Many Requests
#   toomanyrequests: You have reached your unauthenticated pull rate limit.
#
# A tag in the same repository needs none of that. The blobs are already there;
# only the name is new. So this reads the manifest once and PUTs the identical
# bytes under the other name - one read and one write per tag, no children, and
# authenticated, which `imagetools` was evidently not doing whatever the CLI had
# been logged into.
set -eu

: "${IMAGE_REPO:?IMAGE_REPO is not set}"
: "${DOCKERHUB_USERNAME:?DOCKERHUB_USERNAME is not set}"
: "${DOCKERHUB_TOKEN:?DOCKERHUB_TOKEN is not set}"

[ $# -ge 2 ] || { echo "usage: retag.sh <source-suffix> <dest-suffix>..." >&2; exit 2; }
SRC="$1"
shift

# The one list. It used to be written out in three places in release.yml, and a
# service added to two of them is a service with no `latest`.
TARGETS="auth-service server-service chat-service presence-service
notification-service call-service remote-gateway web admin-web"

REGISTRY=https://registry-1.docker.io
# Both list media types and both single-image ones: Docker Hub stores whichever
# buildx pushed, and asking for the wrong set gets a converted manifest back -
# a different digest under the new name, which is not a re-tag.
ACCEPT='application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json'

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Valid for five minutes, which is longer than this takes, and refreshed anyway
# if the registry ever answers 401.
auth() {
  TOKEN="$(curl -fsS -u "${DOCKERHUB_USERNAME}:${DOCKERHUB_TOKEN}" \
    "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${IMAGE_REPO}:pull,push" \
    | jq -r .token)"
  [ -n "$TOKEN" ] && [ "$TOKEN" != null ]
}

# curl, with the two answers worth retrying handled: 429 is the rate limit that
# started all this and it is transient within a burst, 5xx is Docker Hub. Prints
# the status code; the body is left in $WORK/body.
request() {
  method="$1"; url="$2"; shift 2
  delay=5
  attempt=1
  while :; do
    code="$(curl -sS -o "$WORK/body" -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer $TOKEN" "$@" "$url")"
    case "$code" in
      2*) echo "$code"; return 0 ;;
      401) auth; ;;                       # token expired mid-run
      429|5*) [ "$attempt" -lt 5 ] || { echo "$code"; return 1; }
              echo "  $code from $method, retrying in ${delay}s" >&2
              sleep "$delay"
              delay=$((delay * 3)) ;;
      *) echo "$code"; return 1 ;;
    esac
    attempt=$((attempt + 1))
    [ "$attempt" -le 6 ] || { echo "$code"; return 1; }
  done
}

auth

failed=0
for target in $TARGETS; do
  src="${target}-${SRC}"
  if ! code="$(request GET "${REGISTRY}/v2/${IMAGE_REPO}/manifests/${src}" \
                 -H "Accept: ${ACCEPT}" -D "$WORK/headers")"; then
    echo "::error::${IMAGE_REPO}:${src} could not be read (HTTP ${code})"
    cat "$WORK/body" >&2 || true
    failed=1
    continue
  fi
  cp "$WORK/body" "$WORK/manifest.json"

  # PUT with a different Content-Type than the manifest was stored under gets it
  # rejected, so the type comes back off the GET rather than being assumed.
  ctype="$(tr -d '\r' < "$WORK/headers" \
    | awk 'tolower($1) == "content-type:" { print $2 }' | tail -n 1)"
  digest="$(tr -d '\r' < "$WORK/headers" \
    | awk 'tolower($1) == "docker-content-digest:" { print $2 }' | tail -n 1)"

  for dest in "$@"; do
    if code="$(request PUT "${REGISTRY}/v2/${IMAGE_REPO}/manifests/${target}-${dest}" \
                 -H "Content-Type: ${ctype}" --data-binary "@$WORK/manifest.json")"; then
      echo "${IMAGE_REPO}:${target}-${dest} -> ${digest}"
    else
      echo "::error::${IMAGE_REPO}:${target}-${dest} was not written (HTTP ${code})"
      cat "$WORK/body" >&2 || true
      failed=1
    fi
  done
done

exit "$failed"
