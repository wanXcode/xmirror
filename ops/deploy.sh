#!/usr/bin/env bash
set -Eeuo pipefail

# Safe release deployment for a single-host XMirror installation.
# Runtime state is kept in $APP_ROOT/shared and is never copied from Git.

APP_ROOT="${XMIRROR_APP_ROOT:-/opt/xmirror}"
SOURCE_DIR="${XMIRROR_SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
KEEP_RELEASES="${XMIRROR_KEEP_RELEASES:-5}"
HEALTH_URL="${XMIRROR_HEALTH_URL:-http://127.0.0.1:3000/}"
PM2_BIN="${XMIRROR_PM2_BIN:-$(command -v pm2 || true)}"

fail() { printf 'deploy: %s\n' "$*" >&2; exit 1; }
log() { printf 'deploy: %s\n' "$*"; }

[[ "$APP_ROOT" == /* ]] || fail 'XMIRROR_APP_ROOT must be an absolute path'
[[ "$SOURCE_DIR" == /* ]] || fail 'XMIRROR_SOURCE_DIR must be an absolute path'
[[ -f "$SOURCE_DIR/package-lock.json" && -f "$SOURCE_DIR/server.js" ]] || fail "invalid source directory: $SOURCE_DIR"
[[ "$KEEP_RELEASES" =~ ^[1-9][0-9]*$ ]] || fail 'XMIRROR_KEEP_RELEASES must be a positive integer'
[[ "$APP_ROOT" != *"'"* ]] || fail "XMIRROR_APP_ROOT must not contain an apostrophe"
command -v node >/dev/null || fail 'node is required'
command -v npm >/dev/null || fail 'npm is required'
[[ -n "$PM2_BIN" && -x "$PM2_BIN" ]] || fail 'pm2 is required; set XMIRROR_PM2_BIN when it is outside PATH'
command -v curl >/dev/null || fail 'curl is required'

revision="$(git -C "$SOURCE_DIR" rev-parse --verify HEAD 2>/dev/null || true)"
[[ -n "$revision" ]] || fail 'source must be a Git checkout'
short_revision="${revision:0:12}"
release_id="$(date -u +%Y%m%dT%H%M%SZ)-$short_revision"
release_dir="$APP_ROOT/releases/$release_id"
shared_dir="$APP_ROOT/shared"
snapshot_dir="$APP_ROOT/recovery_snapshots/$release_id"
previous_target=''
legacy_entrypoint=''

mkdir -p "$APP_ROOT/releases" "$shared_dir" "$APP_ROOT/recovery_snapshots"

for item in data archives .env; do
  legacy="$APP_ROOT/$item"
  shared="$shared_dir/$item"
  if [[ -e "$legacy" && ! -L "$legacy" && ! -e "$shared" ]]; then
    fail "legacy $item must be migrated first with ops/migrate-legacy-layout.sh"
  fi
done

mkdir -p "$shared_dir/data" "$shared_dir/archives"

[[ -d "$shared_dir/data" && -d "$shared_dir/archives" ]] || fail 'shared runtime directories are missing'
if [[ -f "$shared_dir/data/db.sqlite" ]]; then
  command -v sqlite3 >/dev/null || fail 'sqlite3 CLI is required to create a consistent database snapshot'
  mkdir -p "$snapshot_dir"
  sqlite3 "$shared_dir/data/db.sqlite" ".timeout 5000" ".backup '$snapshot_dir/db.sqlite'"
  log "database recovery copy: $snapshot_dir"
fi

mkdir "$release_dir"
cleanup_failed_release() {
  if [[ -d "$release_dir" ]]; then
    rm -rf -- "$release_dir"
  fi
}
trap cleanup_failed_release ERR

# Export the exact committed revision, never the dirty production worktree.
git -C "$SOURCE_DIR" archive "$revision" | tar -C "$release_dir" -xf -
# Historical revisions tracked runtime samples; remove them only from this new,
# isolated release before attaching persistent shared storage.
rm -rf -- "$release_dir/data" "$release_dir/archives"

ln -s "$shared_dir/data" "$release_dir/data"
ln -s "$shared_dir/archives" "$release_dir/archives"
[[ ! -f "$shared_dir/.env" ]] || ln -s "$shared_dir/.env" "$release_dir/.env"

log "installing production dependencies"
npm --prefix "$release_dir" ci --omit=dev
log "running regression tests"
npm --prefix "$release_dir" test
node --check "$release_dir/server.js"

if [[ -L "$APP_ROOT/current" ]]; then
  previous_target="$(readlink "$APP_ROOT/current")"
elif [[ -e "$APP_ROOT/current" ]]; then
  fail "$APP_ROOT/current exists and is not a symlink"
elif [[ -f "$APP_ROOT/server.js" ]]; then
  legacy_entrypoint="$APP_ROOT/server.js"
fi

ln -s "$release_dir" "$APP_ROOT/.current-$release_id"
mv -Tf "$APP_ROOT/.current-$release_id" "$APP_ROOT/current"

rollback() {
  log 'restart failed; restoring previous release'
  if [[ -n "$previous_target" ]]; then
    ln -s "$previous_target" "$APP_ROOT/.current-rollback"
    mv -Tf "$APP_ROOT/.current-rollback" "$APP_ROOT/current"
    "$PM2_BIN" delete xmirror >/dev/null 2>&1 || true
    XMIRROR_APP_ROOT="$APP_ROOT" "$PM2_BIN" start "$APP_ROOT/current/ops/ecosystem.config.cjs" --update-env || true
  else
    rm -f -- "$APP_ROOT/current"
    if [[ -n "$legacy_entrypoint" ]]; then
      "$PM2_BIN" delete xmirror >/dev/null 2>&1 || true
      (cd "$APP_ROOT" && "$PM2_BIN" start "$legacy_entrypoint" --name xmirror --update-env) || true
    fi
  fi
  exit 1
}
trap rollback ERR

"$PM2_BIN" delete xmirror >/dev/null 2>&1 || true
XMIRROR_APP_ROOT="$APP_ROOT" "$PM2_BIN" start "$APP_ROOT/current/ops/ecosystem.config.cjs" --update-env
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

# Prune code releases only. Shared data and recovery snapshots are deliberately untouched.
mapfile -t old_releases < <(find "$APP_ROOT/releases" -mindepth 1 -maxdepth 1 -type d -print | sort -r | tail -n "+$((KEEP_RELEASES + 1))")
for old_release in "${old_releases[@]}"; do
  [[ "$old_release" != "$(readlink -f "$APP_ROOT/current")" ]] || continue
  rm -rf -- "$old_release"
done

log "deployed $release_id"
log "runtime data preserved at $shared_dir"
