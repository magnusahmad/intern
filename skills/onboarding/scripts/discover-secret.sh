#!/usr/bin/env bash
# Try to find a secret the user already has on this machine and copy it into
# .env — without ever printing the value. Reports only WHICH source it came
# from (a path/var name, which is not sensitive), so the agent and user can see
# what happened without the secret entering the agent's context.
#
# Sources searched, in order (first hit wins):
#   1. the current environment (an exported var of the same name)
#   2. sibling project .env files under the given roots (and the parent of CWD)
#
# It deliberately does NOT crawl the whole filesystem or pull from credential
# stores, to avoid silently grabbing an over-privileged or unrelated key.
#
# Usage:
#   discover-secret.sh NAME [--env-file PATH] [--root DIR ...] [--alias NAME ...]
#
# --alias adds extra source key names to look for (e.g. STRIPE_API_KEY when the
# target is STRIPE_SECRET_KEY). The value is always saved under the target NAME.
#
# Exit status: 0 = found and saved; 1 = not found (agent should fall back to
# enter-secret.sh); 2 = usage / refused.

set -euo pipefail
# Source by absolute path — do NOT cd, so $PWD stays the user's launch directory
# (discovery uses the parent of CWD as a search root).
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

NAME="${1:-}"
shift || true
ENV_FILE_ARG=""
ROOTS=()
KEYS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE_ARG="${2:-}"; shift 2 ;;
    --root)     ROOTS+=("${2:-}");      shift 2 ;;
    --alias)    KEYS+=("${2:-}");       shift 2 ;;
    *) echo "error: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

[[ -n "$NAME" ]] || { echo "usage: discover-secret.sh NAME [--env-file PATH] [--root DIR ...] [--alias NAME ...]" >&2; exit 2; }
validate_name "$NAME"
refuse_if_telegram
for k in "${KEYS[@]:-}"; do [[ -z "$k" ]] || validate_name "$k"; done

ENV_FILE="$(resolve_env_file "$ENV_FILE_ARG")"
KEYS=("$NAME" "${KEYS[@]:-}")                 # target name is always a source key
ROOTS+=("$(dirname "$PWD")")                  # always consider the parent of CWD

FOUND_VALUE=""   # secrets returned through this global, never via stdout

# Pull NAME=value (optionally `export `-prefixed, optionally quoted) out of a
# .env-style file. Sets FOUND_VALUE on success.
read_from_env_file() {
  local key="$1" file="$2" line val
  [[ -f "$file" ]] || return 1
  line="$(grep -E "^(export[[:space:]]+)?${key}=" "$file" 2>/dev/null | tail -n1)" || return 1
  [[ -n "$line" ]] || return 1
  val="${line#*=}"
  val="${val%\"}"; val="${val#\"}"
  val="${val%\'}"; val="${val#\'}"
  [[ -n "$val" ]] || return 1
  FOUND_VALUE="$val"
}

# 1) current environment
for key in "${KEYS[@]}"; do
  [[ -z "$key" ]] && continue
  if [[ -n "${!key:-}" ]]; then
    FOUND_VALUE="${!key}"
    write_secret_to_env "$NAME" "$FOUND_VALUE" "$ENV_FILE"
    unset FOUND_VALUE
    echo "✓ ${NAME} discovered in the current environment (\$${key}) and saved to ${ENV_FILE}"
    exit 0
  fi
done

# 2) sibling project .env files (root level + one directory deep)
for root in "${ROOTS[@]}"; do
  [[ -z "$root" && "$root" != "" ]] && continue
  [[ -d "$root" ]] || continue
  while IFS= read -r candidate; do
    [[ -z "$candidate" ]] && continue
    # don't re-read the file we're writing to
    [[ "$candidate" -ef "$ENV_FILE" ]] 2>/dev/null && continue
    for key in "${KEYS[@]}"; do
      [[ -z "$key" ]] && continue
      if read_from_env_file "$key" "$candidate"; then
        write_secret_to_env "$NAME" "$FOUND_VALUE" "$ENV_FILE"
        unset FOUND_VALUE
        echo "✓ ${NAME} discovered in ${candidate} (as \$${key}) and saved to ${ENV_FILE}"
        exit 0
      fi
    done
  done < <(find "$root" -maxdepth 2 \( -name '.env' -o -name '.env.*' \) 2>/dev/null)
done

echo "not found: no existing ${NAME} on disk — use enter-secret.sh for manual entry" >&2
exit 1
