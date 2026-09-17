#!/usr/bin/env bash

# Resolve the local health-check URL without evaluating the production .env.
# Supported PORT forms intentionally mirror only the simple dotenv values that
# XMirror needs: PORT=3000, PORT="3000", or PORT='3000' (optionally exported).
xmirror_read_port() {
  local env_file="$1"
  local line raw port=''
  local matches=0

  [[ -r "$env_file" ]] || {
    printf 'health-url: cannot read %s\n' "$env_file" >&2
    return 1
  }

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?PORT[[:space:]]*=[[:space:]]*(.*)$ ]]; then
      raw="${BASH_REMATCH[2]}"
      raw="${raw#"${raw%%[![:space:]]*}"}"
      raw="${raw%"${raw##*[![:space:]]}"}"

      if [[ "$raw" =~ ^([0-9]+)[[:space:]]*(#.*)?$ ]]; then
        port="${BASH_REMATCH[1]}"
      elif [[ "$raw" =~ ^\"([0-9]+)\"[[:space:]]*(#.*)?$ ]]; then
        port="${BASH_REMATCH[1]}"
      elif [[ "$raw" =~ ^\'([0-9]+)\'[[:space:]]*(#.*)?$ ]]; then
        port="${BASH_REMATCH[1]}"
      else
        printf 'health-url: unsupported PORT value in %s\n' "$env_file" >&2
        return 1
      fi

      matches=$((matches + 1))
    fi
  done < "$env_file"

  if ((matches > 1)); then
    printf 'health-url: multiple PORT assignments in %s\n' "$env_file" >&2
    return 1
  fi

  if ((matches == 0)); then
    port=3000
  fi

  if ((${#port} > 5)) || ((10#$port < 1 || 10#$port > 65535)); then
    printf 'health-url: PORT must be between 1 and 65535 in %s\n' "$env_file" >&2
    return 1
  fi

  printf '%s\n' "$((10#$port))"
}

xmirror_resolve_health_url() {
  local app_root="$1"
  local default_path="${2:-/healthz}"
  local env_file="$app_root/shared/.env"
  local port=3000

  if [[ ${XMIRROR_HEALTH_URL+x} == x ]]; then
    [[ -n "$XMIRROR_HEALTH_URL" ]] || {
      printf 'health-url: XMIRROR_HEALTH_URL must not be empty\n' >&2
      return 1
    }
    printf '%s\n' "$XMIRROR_HEALTH_URL"
    return 0
  fi

  if [[ -e "$env_file" ]]; then
    port="$(xmirror_read_port "$env_file")" || return 1
  fi

  printf 'http://127.0.0.1:%s%s\n' "$port" "$default_path"
}

xmirror_check_http() {
  local health_url="$1"

  curl --fail --silent --show-error --max-time 5 "$health_url" >/dev/null
}

xmirror_check_health() {
  local health_url="$1"
  local response

  response="$(curl --fail --silent --show-error --max-time 5 "$health_url")" || return 1
  [[ "$response" =~ \"service\"[[:space:]]*:[[:space:]]*\"xmirror\" ]]
}
