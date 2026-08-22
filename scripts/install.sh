#!/bin/sh
# Install or upgrade a BetweenUs deployment without cloning the repository.
#
#   curl -fsSL https://raw.githubusercontent.com/aiyu-ayaan/BetweenUs/master/scripts/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --dir /srv/betweenus --version alpha
#
# The stack runs from published images, so the only things a host actually
# needs are the compose file, the Nginx config it mounts, the backup script it
# mounts, and a .env. This fetches those four and starts the stack. The layout
# it writes is the repository's, so every command in DEPLOYMENT.md works
# unchanged in the directory this creates.
#
# Re-running is the upgrade path: the three tracked files are refreshed, .env
# is left exactly as it is, and the images are pulled again.
set -eu

REPO="${BETWEENUS_REPO:-aiyu-ayaan/BetweenUs}"
REF="${BETWEENUS_REF:-master}"
DIR=""
VERSION=""
START=1

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="${2:?--dir needs a path}"; shift 2 ;;
    --version) VERSION="${2:?--version needs a tag or channel}"; shift 2 ;;
    --ref) REF="${2:?--ref needs a branch or tag}"; shift 2 ;;
    --no-start) START=0; shift ;;
    -h|--help)
      sed -n '2,14p' "$0" 2>/dev/null || true
      echo "  --dir PATH        where to install        (default ./betweenus)"
      echo "  --version TAG     BETWEENUS_VERSION       (default latest)"
      echo "  --ref REF         branch/tag to fetch the compose files from"
      echo "  --no-start        write the files, start nothing"
      exit 0 ;;
    *) DIR="$1"; shift ;;
  esac
done
DIR="${DIR:-${BETWEENUS_DIR:-./betweenus}}"

die() { echo "install: $*" >&2; exit 1; }
say() { echo "==> $*"; }

command -v docker >/dev/null 2>&1 || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "the docker compose plugin is missing (docker-compose v1 is not enough)"
command -v curl >/dev/null 2>&1 || die "curl is required"

RAW="https://raw.githubusercontent.com/$REPO/$REF"
fetch() { curl -fsSL "$RAW/$1" -o "$2" || die "could not fetch $1 from $REPO@$REF"; }

# 48 bytes of hex. openssl when it is there, /dev/urandom when it is not.
secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 48
  else
    head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# Replace KEY="..." in .env, or append it when the example did not have it.
set_env() {
  key="$1"; value="$2"
  if grep -q "^$key=" .env; then
    tmp=$(mktemp)
    KEY="$key" VALUE="$value" awk '
      index($0, ENVIRON["KEY"] "=") == 1 { print ENVIRON["KEY"] "=\"" ENVIRON["VALUE"] "\""; next }
      { print }
    ' .env > "$tmp"
    mv "$tmp" .env
  else
    printf '%s="%s"\n' "$key" "$value" >> .env
  fi
}

mkdir -p "$DIR/infrastructure/docker" "$DIR/infrastructure/nginx"
cd "$DIR"

say "fetching the stack from $REPO@$REF"
fetch infrastructure/docker/docker-compose.yml infrastructure/docker/docker-compose.yml
fetch infrastructure/docker/backup.sh          infrastructure/docker/backup.sh
fetch infrastructure/nginx/nginx.conf          infrastructure/nginx/nginx.conf

FRESH=0
if [ ! -f .env ]; then
  FRESH=1
  say "writing .env with generated secrets"
  fetch .env.example .env
  PGPASS=$(secret)
  set_env POSTGRES_PASSWORD "$PGPASS"
  set_env DATABASE_URL "postgresql://postgres:$PGPASS@postgres:5432/betweenus?schema=public"
  set_env REDIS_URL "redis://redis:6379"
  set_env JWT_SECRET "$(secret)"
  set_env JWT_REFRESH_SECRET "$(secret)"
  set_env SETTINGS_SECRET "$(secret)"
  set_env NODE_ENV "production"
  set_env LOG_LEVEL "info"
  set_env CORS_ORIGIN ""
  chmod 600 .env
else
  say "keeping the .env that is already here"
fi

[ -n "$VERSION" ] && set_env BETWEENUS_VERSION "$VERSION"

C="docker compose --env-file .env -f infrastructure/docker/docker-compose.yml"

if [ "$START" -eq 0 ]; then
  say "files written to $(pwd). Start it with:"
  echo "    $C pull && $C up -d"
  exit 0
fi

say "pulling images"
$C pull
say "starting"
$C up -d

cat <<EOF

BetweenUs is up in $(pwd).

  health      curl -s http://localhost:8080/health
  logs        $C logs -f
  stop        $C down
  upgrade     re-run this installer in this directory

EOF

if [ "$FRESH" -eq 1 ]; then
  cat <<'EOF'
Two things left, both in DEPLOYMENT.md:

  1. Set PUBLIC_API_URL in .env to the public URL this deployment answers on,
     then `docker compose ... up -d` again. OAuth callbacks are built from it.
  2. Create the first administrator - there is no sign-up for the panel:

     docker compose --env-file .env -f infrastructure/docker/docker-compose.yml \
       run --rm -w /repo/packages/database migrate \
       ./node_modules/.bin/tsx prisma/create-admin.ts

EOF
fi
