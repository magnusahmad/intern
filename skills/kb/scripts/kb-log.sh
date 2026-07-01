#!/usr/bin/env bash
# Append one timestamped entry to the KB's append-only log ($INTERN_KB_PATH/log.md).
# Deterministic + atomic so the audit trail stays correctly formatted no matter how
# many small captures happen. Creates log.md with a header if it doesn't exist yet.
#
# Usage:
#   kb-log.sh "captured: products/sauna-wear — price 49.99 confirmed from Stripe"
#   kb-log.sh --kb /path/to/kb "message"
#
# Exit: 0 on success; 2 on usage error.

set -euo pipefail

KB="${INTERN_KB_PATH:-$PWD}"
if [[ "${1:-}" == "--kb" ]]; then
  KB="${2:-}"; shift 2
fi
MSG="${1:-}"
[[ -n "$MSG" ]] || { echo "usage: kb-log.sh [--kb DIR] \"message\"" >&2; exit 2; }
[[ -n "$KB" ]] || { echo "error: KB path is empty (set INTERN_KB_PATH or pass --kb)" >&2; exit 2; }

mkdir -p "$KB"
LOG="$KB/log.md"
if [[ ! -f "$LOG" ]]; then
  printf '# KB Log\n\nAppend-only record of what the Intern learned and filed. Newest at the bottom.\n\n' > "$LOG"
fi

# ISO-8601 local timestamp; message on one line (collapse embedded newlines).
ts="$(date +%Y-%m-%dT%H:%M:%S%z)"
oneline="$(printf '%s' "$MSG" | tr '\n' ' ')"
printf -- '- %s  %s\n' "$ts" "$oneline" >> "$LOG"
echo "✓ logged to $LOG"
