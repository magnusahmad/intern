#!/usr/bin/env bash
# Capture a secret from the user via a native macOS dialog (hidden input) and
# write it straight into .env — without the value ever touching the terminal,
# this script's stdout, or any process argument list.
#
# The agent runs this (with the user's approval); the user types into the OS
# dialog, not the chat and not the terminal. The agent only ever sees the final
# "saved" line. This is the manual-entry path used when a secret can't be
# auto-discovered (e.g. a fresh Telegram bot token).
#
# Usage:
#   enter-secret.sh NAME [--env-file PATH] [--prompt "human text"]
#
# Examples:
#   enter-secret.sh TELEGRAM_BOT_TOKEN --env-file ~/my-company/.env
#   enter-secret.sh STRIPE_SECRET_KEY  --prompt "Paste a restricted Stripe key"
#
# Exit status: 0 = saved; non-zero = cancelled / empty / refused (the value was
# NOT written). On any non-zero exit the agent should treat the secret as unset.

set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

NAME="${1:-}"
shift || true
ENV_FILE_ARG=""
PROMPT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE_ARG="${2:-}"; shift 2 ;;
    --prompt)   PROMPT="${2:-}";        shift 2 ;;
    *) echo "error: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

[[ -n "$NAME" ]] || { echo "usage: enter-secret.sh NAME [--env-file PATH] [--prompt TEXT]" >&2; exit 2; }
validate_name "$NAME"
refuse_if_telegram

if [[ "$(uname)" != "Darwin" ]]; then
  echo "error: enter-secret.sh needs macOS (osascript) for the hidden-input dialog" >&2
  exit 3
fi

ENV_FILE="$(resolve_env_file "$ENV_FILE_ARG")"
[[ -n "$PROMPT" ]] || PROMPT="Paste your ${NAME} (input is hidden, not stored in terminal history)"

# The dialog runs in its own process; its only output is the typed text, which
# we capture into a variable and never echo. AppleScript returns just the text;
# on Cancel, osascript exits non-zero and writes "User canceled" to stderr (no
# secret), which we turn into a clean message.
if ! VALUE="$(osascript <<APPLESCRIPT 2>/dev/null
set r to display dialog "${PROMPT}" with title "Hermes secret entry" default answer "" with hidden answer buttons {"Cancel", "Save"} default button "Save"
return text returned of r
APPLESCRIPT
)"; then
  echo "cancelled: ${NAME} not entered (nothing written)" >&2
  exit 4
fi

if [[ -z "$VALUE" ]]; then
  echo "empty: ${NAME} not entered (nothing written)" >&2
  exit 5
fi

write_secret_to_env "$NAME" "$VALUE" "$ENV_FILE"
unset VALUE
echo "✓ ${NAME} saved to ${ENV_FILE}"
