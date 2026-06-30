#!/usr/bin/env bash
# Shared, security-critical helpers for the onboarding secret scripts.
# Sourced by enter-secret.sh and discover-secret.sh — never run directly.
#
# Invariant these helpers exist to enforce: a secret VALUE is never printed to
# stdout/stderr, never passed as a process argument (so it can't appear in `ps`
# or the agent's captured command output), and never written anywhere but the
# target .env. Only the secret NAME and its source are ever surfaced.

# --- secret NAME validation -------------------------------------------------
# Names are fixed identifiers we control (STRIPE_SECRET_KEY, TELEGRAM_BOT_TOKEN…).
# Reject anything that isn't a plain env-var identifier before it reaches the
# AppleScript prompt or a grep pattern.
validate_name() {
  local name="$1"
  if [[ ! "$name" =~ ^[A-Z_][A-Z0-9_]*$ ]]; then
    echo "error: invalid secret name '$name' (expected an env-var identifier)" >&2
    return 1
  fi
}

# --- channel guard ----------------------------------------------------------
# Defense in depth behind golden rule 2: even if the agent is tricked into
# running this over Telegram, the script itself refuses. The agent should still
# never invoke us off the local Terminal.
refuse_if_telegram() {
  local channel="${HERMES_CHANNEL:-${AO1_CHANNEL:-local}}"
  if [[ "$channel" == "telegram" ]]; then
    echo "refusing: secrets may only be entered at the local Terminal, never over Telegram" >&2
    return 1
  fi
}

# --- env-file resolution ----------------------------------------------------
# Resolve the target .env. Precedence: explicit --env-file (passed by caller as
# $1) > $HERMES_ENV_FILE > $AO1_ENV_FILE > ./.env. Echoes the resolved path so
# the caller can report *where* a secret landed (path is not sensitive).
resolve_env_file() {
  local explicit="${1:-}"
  if [[ -n "$explicit" ]]; then
    printf '%s\n' "$explicit"
  else
    printf '%s\n' "${HERMES_ENV_FILE:-${AO1_ENV_FILE:-$PWD/.env}}"
  fi
}

# --- the only place a secret value is written -------------------------------
# Upsert NAME=VALUE into ENV_FILE atomically and privately.
#   $1 = NAME, $2 = VALUE (VALUE passed as an argument to this *shell function*,
#   not to any external process, so it stays out of `ps`), $3 = ENV_FILE.
# Uses printf (a shell builtin) for the write — never echo to an external cmd.
write_secret_to_env() {
  local name="$1" value="$2" env_file="$3" tmp dir
  umask 077                                   # temp + .env are owner-only
  dir="$(dirname "$env_file")"
  mkdir -p "$dir"
  tmp="$(mktemp "${env_file}.XXXXXX")"         # same dir => mv is atomic
  if [[ -f "$env_file" ]]; then
    # Drop any prior line for this key (anchored on '=' so STRIPE_KEY doesn't
    # match STRIPE_KEY_2), preserving everything else.
    grep -v "^${name}=" "$env_file" > "$tmp" || true
  fi
  printf '%s=%s\n' "$name" "$value" >> "$tmp"
  mv "$tmp" "$env_file"
  chmod 600 "$env_file"
}
