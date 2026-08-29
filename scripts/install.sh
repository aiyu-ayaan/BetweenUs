#!/bin/sh
# Fetch everything a BetweenUs deployment needs, without cloning the repository.
#
#   curl -fsSL https://raw.githubusercontent.com/aiyu-ayaan/BetweenUs/master/scripts/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --dir /srv/betweenus --version alpha
#
# The stack runs from published images, so the only things a host actually
# needs are the compose file, the Nginx config it mounts, the backup script it
# mounts, and a .env. This copies those four in and stops there: you edit .env -
# at minimum PUBLIC_API_URL - and start the stack yourself. It never starts
# anything, so it cannot bring a half-configured deployment up.
#
# The layout it writes is the repository's, so every compose command
# works unchanged in the directory it creates.
#
# Re-running is the upgrade path: the three tracked files are refreshed and
# .env is left exactly as it is.
set -eu

REPO="${BETWEENUS_REPO:-aiyu-ayaan/BetweenUs}"
REF="${BETWEENUS_REF:-master}"
DIR=""
VERSION=""

usage() {
  cat <<'USAGE'
install.sh - fetch a BetweenUs deployment's files. Starts nothing.

  --dir PATH        where to put them        (default ./betweenus)
  --version TAG     BETWEENUS_VERSION: a release, or alpha/beta/latest
  --ref REF         branch or tag to fetch the files from (default master)
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="${2:?--dir needs a path}"; shift 2 ;;
    --version) VERSION="${2:?--version needs a tag or channel}"; shift 2 ;;
    --ref) REF="${2:?--ref needs a branch or tag}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) DIR="$1"; shift ;;
  esac
done
DIR="${DIR:-${BETWEENUS_DIR:-./betweenus}}"

die() { echo "install: $*" >&2; exit 1; }
say() { echo "==> $*"; }

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v docker >/dev/null 2>&1 ||
  echo "install: warning - docker is not on this machine's PATH. The files are still written." >&2

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

HERE=$(pwd)
C="docker compose --env-file .env -f infrastructure/docker/docker-compose.yml"

cat <<EOF

Files are in $HERE

  .env                                    generated secrets, yours to edit
  infrastructure/docker/docker-compose.yml
  infrastructure/docker/backup.sh
  infrastructure/nginx/nginx.conf

EOF

if [ "$FRESH" -eq 1 ]; then
  cat <<EOF
Next, in that order. Every command below is run from $HERE:

  cd $HERE

  1. Edit .env. The secrets are generated; what only you can decide is
     PUBLIC_API_URL - the public URL this deployment answers on, which the
     OAuth callback is built from - and, if you are publishing it,
     CLOUDFLARE_TUNNEL_TOKEN. See the deployment documentation in docs/ for details.

       \${EDITOR:-nano} .env

  2. Start the stack.

       $C pull
       $C up -d

     Bringing its own Cloudflare Tunnel up too, once CLOUDFLARE_TUNNEL_TOKEN
     is set - leave this out when a cloudflared already runs on the host:

       $C --profile public up -d

  3. Create the first administrator - there is no sign-up for the panel.
     The password is printed once.

       $C run --rm -w /repo/packages/database migrate ./node_modules/.bin/tsx prisma/create-admin.ts

  4. Check it, and read the logs if it does not answer.

       curl -s http://localhost:8080/health
       $C ps
       $C logs -f --tail=100

Day to day:

  stop            $C down
  one-off backup  $C run --rm -e BACKUP_ON_MIGRATE=1 db-backup-once
  upgrade         re-run this installer, then $C pull && $C up -d

EOF
else
  cat <<EOF
That was an upgrade: .env was left alone. Apply it with

  cd $HERE
  $C pull
  $C up -d

EOF
fi
