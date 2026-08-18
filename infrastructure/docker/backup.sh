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
set -eu

MODE="${1:-loop}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-8}"
BACKUP_INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-168}"
PREFIX="${BACKUP_PREFIX:-nexora}"

log() { echo "[backup] $*"; }

dump() {
  mkdir -p "$BACKUP_DIR"
  target="$BACKUP_DIR/$PREFIX-$(date +%Y%m%d-%H%M%S).sql.gz"
  log "dumping $PGDATABASE to $target"
  # Dump to a partial name and rename, so a dump interrupted halfway is never
  # mistaken for a backup - by the retention sweep below or by a human.
  #
  # The exit status of a pipeline is gzip's, and gzip succeeds at compressing
  # nothing whatsoever - so `pg_dump | gzip` reports success for a database that
  # refused the connection, and writes a valid empty archive. pg_dump's own
  # status goes in a file instead, because `pipefail` is not in POSIX sh.
  failed="$BACKUP_DIR/.$PREFIX.failed"
  rm -f "$failed"
  { pg_dump --no-owner --no-privileges || echo "$?" > "$failed"; } | gzip -9 > "$target.partial"
  if [ -s "$failed" ]; then
    log "FAILED: pg_dump exited $(cat "$failed")"
    rm -f "$target.partial" "$failed"
    return 1
  fi
  mv "$target.partial" "$target"
  log "wrote $(du -h "$target" | cut -f1) $target"
  prune
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
