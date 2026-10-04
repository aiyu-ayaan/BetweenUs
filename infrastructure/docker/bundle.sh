#!/bin/sh
# Assemble the flat deployment folder: everything a host needs to run a release,
# and nothing else.
#
#   sh infrastructure/docker/bundle.sh <out-dir>            compose follows `latest`
#   sh infrastructure/docker/bundle.sh <out-dir> 1.0.13     compose pinned to 1.0.13
#
# A host runs from this folder plus its own `.env` - not from a checkout. The
# release attaches it as assets and the deploy jobs copy it onto the host, so
# the only state on the host is `.env` and the data paths it names.
#
# The paths are flattened because the folder sits on its own rather than in the
# repo tree: `../nginx/nginx.conf` becomes `./nginx.conf`. `BETWEENUS_VERSION`
# in `.env` still overrides the pinned version.
set -eu

OUT="${1:?usage: bundle.sh <out-dir> [version]}"
VERSION="${2:-}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$OUT"

if [ -n "$VERSION" ]; then
  sed -e "s|\.\./nginx/nginx\.conf|./nginx.conf|" \
      -e "s|\${BETWEENUS_VERSION:-latest}|\${BETWEENUS_VERSION:-${VERSION}}|g" \
      "$SRC/docker/docker-compose.yml" > "$OUT/docker-compose.yml"
else
  sed -e "s|\.\./nginx/nginx\.conf|./nginx.conf|" \
      "$SRC/docker/docker-compose.yml" > "$OUT/docker-compose.yml"
fi
cp "$SRC/docker/backup.sh" "$OUT/backup.sh"
cp "$SRC/docker/deploy.sh" "$OUT/deploy.sh"
cp "$SRC/docker/docker-compose.secrets.yml" "$OUT/docker-compose.secrets.yml"
cp "$SRC/nginx/nginx.conf" "$OUT/nginx.conf"
chmod +x "$OUT/deploy.sh"

# A compose file that still reaches outside the folder would deploy fine from a
# checkout and fail on a host that has none - catch it here instead.
if grep -n '\.\./' "$OUT/docker-compose.yml"; then
  echo "bundle.sh: docker-compose.yml still references a path outside the bundle" >&2
  exit 1
fi
