#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${XMIRROR_APP_ROOT:-/opt/xmirror}"
HEALTH_URL="${XMIRROR_HEALTH_URL:-http://127.0.0.1:3000/}"
PM2_BIN="${XMIRROR_PM2_BIN:-$(command -v pm2 || true)}"
SHARED_DIR="$APP_ROOT/shared"
SNAPSHOT_DIR="$APP_ROOT/recovery_snapshots/legacy-layout-$(date -u +%Y%m%dT%H%M%SZ)"
moved_items=()

fail() { printf 'migrate: %s\n' "$*" >&2; exit 1; }
log() { printf 'migrate: %s\n' "$*"; }

[[ "$APP_ROOT" == /* ]] || fail 'XMIRROR_APP_ROOT must be an absolute path'
[[ -f "$APP_ROOT/server.js" ]] || fail "legacy server.js not found under $APP_ROOT"
[[ -n "$PM2_BIN" && -x "$PM2_BIN" ]] || fail 'pm2 is required; set XMIRROR_PM2_BIN when it is outside PATH'
command -v sqlite3 >/dev/null || fail 'sqlite3 is required'
command -v curl >/dev/null || fail 'curl is required'

for item in data archives; do
  [[ -d "$APP_ROOT/$item" && ! -L "$APP_ROOT/$item" ]] || fail "legacy $item directory is missing or already migrated"
  [[ ! -e "$SHARED_DIR/$item" ]] || fail "shared/$item already exists"
done
[[ ! -e "$SHARED_DIR/.env" ]] || fail 'shared/.env already exists'

mkdir -p "$SHARED_DIR" "$SNAPSHOT_DIR"
sqlite3 "$APP_ROOT/data/db.sqlite" ".timeout 5000" ".backup '$SNAPSHOT_DIR/db.sqlite'"
cp -p "$APP_ROOT/.env" "$SNAPSHOT_DIR/.env" 2>/dev/null || true
log "recovery snapshot: $SNAPSHOT_DIR"

rollback() {
  log 'migration failed; restoring legacy layout'
  for item in "${moved_items[@]}"; do
    rm -f -- "$APP_ROOT/$item"
    if [[ -e "$SHARED_DIR/$item" ]]; then
      mv -- "$SHARED_DIR/$item" "$APP_ROOT/$item"
    fi
  done
  "$PM2_BIN" restart xmirror --update-env >/dev/null 2>&1 || \
    (cd "$APP_ROOT" && "$PM2_BIN" start server.js --name xmirror --update-env) >/dev/null 2>&1 || true
  exit 1
}
trap rollback ERR

"$PM2_BIN" stop xmirror
for item in data archives .env; do
  [[ -e "$APP_ROOT/$item" ]] || continue
  mv -- "$APP_ROOT/$item" "$SHARED_DIR/$item"
  moved_items+=("$item")
  ln -s "$SHARED_DIR/$item" "$APP_ROOT/$item"
done

"$PM2_BIN" restart xmirror --update-env
healthy=''
for attempt in {1..10}; do
  if curl --fail --silent --show-error --max-time 5 "$HEALTH_URL" >/dev/null; then
    healthy=1
    break
  fi
  sleep 2
done
[[ -n "$healthy" ]] || fail "health check failed: $HEALTH_URL"
"$PM2_BIN" save
trap - ERR

log "runtime state moved to $SHARED_DIR"
log 'legacy paths now point to shared storage'
