#!/bin/sh
# Put a release on the host, and take it off again if it does not come up.
#
#   ./deploy.sh              the newest release on whatever channel .env follows
#   ./deploy.sh 0.0.2        that version exactly
#   ./deploy.sh alpha        the newest alpha
#
# Run from the deployment directory - the one holding `.env` and a checkout of
# `infrastructure/`. The pipeline pushes images and moves the channel tags and
# then stops, which is where this starts: nothing between `promote` and a human
# typing `docker compose pull` had ever existed.
#
# WHAT MAKES THIS MORE THAN `pull && up -d`
#
# It puts the old version back. `up -d` on a bad release leaves the deployment
# broken and the operator reading logs to work out which version was good; the
# version that was running is written down here before anything moves, and if the
# gateway does not come back healthy it is restored and the script exits non-zero.
# That is the whole difference between a deploy step and two commands in a
# README.
#
# It also pulls before it stops anything. `docker compose pull` on nine images
# over a slow link is minutes during which the old version keeps serving, and
# only then does `up -d` swap them - so a pull that fails is not an outage, it is
# a deploy that did not happen.
#
# The migration runs itself: `migrate` is a service in the compose file, ordered
# behind the pre-migration dump, and `up -d` waits for it before starting
# anything that serves traffic. If it fails, nothing starts, and the rollback
# below puts the previous images back - which is the case worth being careful
# about, because the database has already been changed by then. That is what the
# dump is for, and restoring it is a human's decision and not this script's.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="${DEPLOY_COMPOSE_FILE:-$HERE/docker-compose.yml}"

# Two layouts, and this runs in both. In a checkout it is
# infrastructure/docker/deploy.sh with `.env` two levels up; in the deployment
# bundle attached to each release it is one flat directory with `.env` beside it.
# Looking for the neighbour first is what makes the same file work either way.
if [ -n "${DEPLOY_ENV_FILE:-}" ]; then
  ENV_FILE="$DEPLOY_ENV_FILE"
elif [ -f "$HERE/.env" ]; then
  ENV_FILE="$HERE/.env"
else
  ENV_FILE="$(cd "$HERE/../.." && pwd)/.env"
fi
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:8080/health}"
# Nine images have to be pulled, a dump taken and the migrations applied before
# the gateway answers. Generous on purpose: a deploy that rolls back because it
# was impatient is worse than one that takes another minute.
HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-180}"

log() { echo "[deploy] $*"; }

[ -f "$ENV_FILE" ] || { log "no .env at $ENV_FILE"; exit 1; }

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

# What is running now, so there is something to go back to. An empty value is a
# deployment following `latest`, and putting *that* back is also correct.
# Kept to what a docker tag may contain, which does the quote-stripping and
# one more thing besides. A `.env` copied from a Windows machine has CRLF line
# endings, and a version read with the carriage return still on it builds
# `aiyuayaan/betweenus:auth-service-alpha<CR>` - which docker refuses as an
# invalid reference, after the deploy has already written the version into
# `.env`. `tr -cd` deleting everything a tag cannot contain covers that, the
# surrounding quotes and any trailing space in one expression.
previous="$(grep -E '^BETWEENUS_VERSION=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -cd 'A-Za-z0-9_.-')"
wanted="${1:-$previous}"

log "currently ${previous:-latest}, deploying ${wanted:-latest}"

# A `!patch` rebuilds the artifacts of a version that is already deployed, so
# the version does not change and the tag does not move - only what it resolves
# to does. `up -d` compares the running container against the image the tag
# names *now*, which is the new one, so it does recreate; but nothing here
# should depend on that comparison being made for us. A deploy of the version
# already running is a replacement, and it is stated rather than inferred:
# every container comes down and comes back on the image just pulled.
if [ "${DEPLOY_RECREATE:-}" = 1 ] || [ "$wanted" = "$previous" ]; then
  recreate=--force-recreate
  log "same version: replacing the running containers rather than leaving them"
else
  recreate=
fi

# Written into .env rather than exported, because the next person to run
# `docker compose up -d` by hand has to get the same version this did. A
# deployment whose running images disagree with its .env is one restart away
# from an unplanned upgrade.
set_version() {
  if grep -qE '^BETWEENUS_VERSION=' "$ENV_FILE"; then
    # A temporary file and a move, so an interrupted write cannot leave the
    # deployment with a half-written .env and no secrets in it.
    tmp="$ENV_FILE.deploy.$$"
    sed "s|^BETWEENUS_VERSION=.*|BETWEENUS_VERSION=\"$1\"|" "$ENV_FILE" > "$tmp"
    cat "$tmp" > "$ENV_FILE"
    rm -f "$tmp"
  else
    printf '\nBETWEENUS_VERSION="%s"\n' "$1" >> "$ENV_FILE"
  fi
}

healthy() {
  waited=0
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    if curl --fail --silent --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

set_version "$wanted"

# Before anything is stopped. The old version is still serving while this runs.
log "pulling"
if ! compose pull; then
  log "FAILED: pull. Nothing was changed."
  set_version "$previous"
  exit 1
fi

log "starting"
if compose up -d --remove-orphans $recreate && healthy; then
  log "up on ${wanted:-latest}"
  # Only now. An image the deployment might have to roll back to is not garbage,
  # which is what the week is for: everything older than that is a release two
  # or more behind, and it is on Docker Hub if it is ever wanted again.
  #
  # `-a` rather than dangling layers only, because nine tagged images a release
  # is what actually fills a Pi's disk - and a host that fills up reaches for
  # `docker system prune -a --volumes`, which is the command to stay away from
  # here: it takes `backup-data` with it the moment the container that wrote the
  # pre-migration dump has been cleaned up, and that dump is the whole answer to
  # a migration that went wrong. Images are prunable. Volumes are not.
  docker image prune --force --all --filter "until=168h" >/dev/null 2>&1 || true
  exit 0
fi

log "FAILED: ${wanted:-latest} did not come up healthy within ${HEALTH_TIMEOUT}s"
compose ps || true
compose logs --tail 40 migrate || true

log "rolling back to ${previous:-latest}"
set_version "$previous"
if compose up -d --remove-orphans && healthy; then
  log "rolled back to ${previous:-latest}"
else
  # The bad case, and the one worth being loud about: the deployment is down and
  # the previous images did not bring it back. Usually that means the migration
  # ran and the old code cannot read the new schema, which is the dump's job.
  log "ROLLBACK FAILED: the deployment is down. The pre-migration dump is in the backup volume."
fi
exit 1
