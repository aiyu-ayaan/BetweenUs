#!/bin/sh
# Database backups, in the postgres image so pg_dump matches the server.
#
#   backup.sh once   one dump, then exit - what runs before a migration
#   backup.sh loop   one dump now, then one every BACKUP_INTERVAL_HOURS
#
# Dumps land in BACKUP_DIR as gzipped plain SQL, newest BACKUP_KEEP kept. Plain
# SQL rather than a custom-format archive because restoring it needs nothing but
# psql, and the moment you need a restore is the wrong moment to discover the
# tool version does not match.
#
# OFF THE HOST
#
# A dump sitting on the same disk as the database it came from covers a bad
# migration and does not cover a dead disk, which is the failure people actually
# lose data to. Set BACKUP_S3_BUCKET and every dump is also PUT to object
# storage as it is written:
#
#   BACKUP_S3_ENDPOINT   https://s3.eu-central-1.amazonaws.com, or the MinIO /
#                        R2 / B2 / Spaces endpoint. Path style - the bucket goes
#                        after it, not in front of it
#   BACKUP_S3_BUCKET     off, if empty. Nothing else here is read without it
#   BACKUP_S3_PREFIX     key prefix inside the bucket, default betweenus
#   BACKUP_S3_REGION     signing region, default us-east-1, which is what most
#                        S3-compatible servers accept regardless
#   BACKUP_S3_ACCESS_KEY / BACKUP_S3_SECRET_KEY
#   BACKUP_OFFSITE_REQUIRED  1 makes a failed upload a failed backup, which in
#                        `once` mode stops the migration. Default 0: the local
#                        dump is what a bad migration needs, and refusing to
#                        deploy because a bucket was unreachable is its own
#                        outage
#
# Uploading is curl's `--aws-sigv4`, which is the whole of the S3 client here.
# The postgres image has wget and not curl, so curl is added on the first upload
# and not at all in a deployment that does not use this.
#
# ponytail: retention is local-only. Nothing prunes the bucket - set a lifecycle
# rule there, which every S3 implementation has and none of them needs this
# script's help with.
set -eu

MODE="${1:-loop}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-8}"
BACKUP_INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-168}"
PREFIX="${BACKUP_PREFIX:-betweenus}"

log() { echo "[backup] $*"; }

dump() {
  mkdir -p "$BACKUP_DIR"

  # Scratch files are named per run, not per dump, and mktemp is also the
  # writability test - a directory that cannot hold this cannot hold a backup.
  #
  # Per run matters. The scheduled dump and the pre-migration one both wait on
  # the same healthy Postgres and start together, so they reach this line in
  # the same second and used to compute the same `$target.partial`. One of them
  # renamed it; the other found nothing to rename, exited 1, and stopped the
  # migration - and so the whole stack - over a backup that had in fact been
  # taken. `$$` would not have fixed it either: every container's shell is PID
  # 1, so both were `.betweenus.1`.
  if ! scratch="$(mktemp "$BACKUP_DIR/.$PREFIX.XXXXXX" 2>/dev/null)"; then
    log "FAILED: $BACKUP_DIR is not writable (check directory permissions/ownership on BACKUP_DATA_PATH)"
    return 1
  fi
  failed="$scratch.failed"

  target="$BACKUP_DIR/$PREFIX-$(date +%Y%m%d-%H%M%S).sql.gz"
  log "dumping $PGDATABASE to $target"
  # Dump to the scratch name and rename, so a dump interrupted halfway is never
  # mistaken for a backup - by the retention sweep below or by a human.
  #
  # The exit status of a pipeline is gzip's, and gzip succeeds at compressing
  # nothing whatsoever - so `pg_dump | gzip` reports success for a database that
  # refused the connection, and writes a valid empty archive. pg_dump's own
  # status goes in a file instead, because `pipefail` is not in POSIX sh.
  { pg_dump --no-owner --no-privileges || echo "$?" > "$failed"; } | gzip -9 > "$scratch"
  if [ -s "$failed" ]; then
    log "FAILED: pg_dump exited $(cat "$failed")"
    rm -f "$scratch" "$failed"
    return 1
  fi
  rm -f "$failed"
  mv "$scratch" "$target"
  log "wrote $(du -h "$target" | cut -f1) $target"
  if ! upload "$target"; then
    if [ "${BACKUP_OFFSITE_REQUIRED:-0}" = "1" ]; then
      return 1
    fi
    log "the local dump stands; set BACKUP_OFFSITE_REQUIRED=1 to make this fatal"
  fi
  prune
}

# PUT the dump to object storage. Returns 0 when there is nothing configured, so
# a deployment that has not set a bucket is not a deployment reporting failures.
upload() {
  [ -n "${BACKUP_S3_BUCKET:-}" ] || return 0

  endpoint="${BACKUP_S3_ENDPOINT:-}"
  if [ -z "$endpoint" ]; then
    log "FAILED: BACKUP_S3_BUCKET is set and BACKUP_S3_ENDPOINT is not"
    return 1
  fi
  if [ -z "${BACKUP_S3_ACCESS_KEY:-}" ] || [ -z "${BACKUP_S3_SECRET_KEY:-}" ]; then
    log "FAILED: BACKUP_S3_BUCKET is set without BACKUP_S3_ACCESS_KEY/BACKUP_S3_SECRET_KEY"
    return 1
  fi

  # The image ships wget; --aws-sigv4 is curl's, and re-implementing SigV4 in
  # POSIX sh is exactly the kind of thing that is wrong in a way you find out
  # about during a restore.
  if ! command -v curl >/dev/null 2>&1; then
    log "installing curl for the upload"
    if ! apk add --no-cache curl >/dev/null 2>&1; then
      log "FAILED: could not install curl"
      return 1
    fi
  fi

  key="${BACKUP_S3_PREFIX:-betweenus}/$(basename "$1")"
  url="${endpoint%/}/${BACKUP_S3_BUCKET}/${key}"
  log "uploading to $url"

  # --fail turns a 403 into a non-zero exit; without it curl reports success for
  # having successfully received the refusal. The credentials go in --user and
  # never into the log line above.
  if ! curl --fail --silent --show-error        --aws-sigv4 "aws:amz:${BACKUP_S3_REGION:-us-east-1}:s3"        --user "${BACKUP_S3_ACCESS_KEY}:${BACKUP_S3_SECRET_KEY}"        --upload-file "$1" "$url"; then
    log "FAILED: upload of $key"
    return 1
  fi
  log "uploaded $key"
}

# Oldest first, everything past BACKUP_KEEP removed. Only files this script
# wrote: anything else in the directory is somebody's own copy and stays.
prune() {
  ls -1t "$BACKUP_DIR/$PREFIX-"*.sql.gz 2>/dev/null | tail -n "+$((BACKUP_KEEP + 1))" | while read -r old; do
    log "pruning $old"
    rm -f "$old"
  done
}

case "$MODE" in
  once)
    # A pre-migration dump is the point of this mode, so it is on by default and
    # a failure here stops the migration rather than being noted and ignored.
    if [ "${BACKUP_ON_MIGRATE:-1}" = "0" ]; then
      log "BACKUP_ON_MIGRATE=0: skipping the pre-migration dump"
      exit 0
    fi
    dump
    ;;
  loop)
    while true; do
      dump || log "continuing; the next attempt is in ${BACKUP_INTERVAL_HOURS}h"
      log "sleeping ${BACKUP_INTERVAL_HOURS}h"
      sleep "$((BACKUP_INTERVAL_HOURS * 3600))"
    done
    ;;
  *)
    log "unknown mode: $MODE"
    exit 2
    ;;
esac
