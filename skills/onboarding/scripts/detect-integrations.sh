#!/usr/bin/env bash
# Fast, read-only provider fingerprint for onboarding's detect->confirm->onboard
# loop. Fetches a few public pages and (optionally) greps the company repo, then
# emits a JSON list of *detected* integrations with the signals that fired. It
# proposes; the agent confirms with the user before connecting anything.
#
# It NEVER reads or emits secret values — only public page markers and the
# presence (not contents) of repo files/env-var names.
#
# Usage:
#   detect-integrations.sh URL [URL ...] [--repo PATH] [--out FILE]
#
# Output (stdout, or --out FILE): JSON
#   { "detected": [ { "id": "stripe", "kind": "payments",
#                     "signals": [ {"source": "...", "marker": "..."} ] }, ... ],
#     "checked_urls": [...], "repo": "..." }
#
# Exit 0 always (detection is advisory); network/page errors are noted, not fatal.

set -uo pipefail

URLS=()
REPO=""
OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="${2:-}"; shift 2 ;;
    --out)  OUT="${2:-}";  shift 2 ;;
    -*) echo "error: unknown argument '$1'" >&2; exit 2 ;;
    *)  URLS+=("$1"); shift ;;
  esac
done
[[ ${#URLS[@]} -gt 0 || -n "$REPO" ]] || { echo "usage: detect-integrations.sh URL [URL ...] [--repo PATH] [--out FILE]" >&2; exit 2; }

UA="Mozilla/5.0 (compatible; HermesOnboarding/1.0; +read-only fingerprint)"
HITS_FILE="$(mktemp)"        # lines: id<TAB>kind<TAB>source<TAB>marker
trap 'rm -f "$HITS_FILE" "${BODY:-}" "${HDRS:-}"' EXIT

record() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >> "$HITS_FILE"; }

# --- website fingerprints ---------------------------------------------------
# Each pattern: a (kind, id, marker, regex) checked against headers or body.
# Body and header checks are case-insensitive.
scan_url() {
  local url="$1"
  BODY="$(mktemp)"; HDRS="$(mktemp)"
  if ! curl -sSL -m 15 -A "$UA" -D "$HDRS" -o "$BODY" "$url" 2>/dev/null; then
    return 0   # unreachable page is fine; just no signals from it
  fi
  local hb; hb="$(cat "$HDRS" "$BODY" 2>/dev/null)"
  # hosting / CDN
  grep -qiE 'server:[[:space:]]*cloudflare|^cf-ray:' "$HDRS"     && record cloudflare hosting  "$url" "cf-ray/server header"
  grep -qiE 'server:[[:space:]]*vercel|^x-vercel-id:' "$HDRS"    && record vercel    hosting  "$url" "x-vercel-id/server header"
  grep -qiE 'server:[[:space:]]*netlify|^x-nf-request-id:' "$HDRS" && record netlify hosting  "$url" "netlify header"
  # commerce platforms
  grep -qiE 'cdn\.shopify\.com|myshopify\.com|Shopify\.theme|x-shopify' <<<"$hb" && record shopify     ecommerce "$url" "shopify markers"
  grep -qiE 'wp-content/plugins/woocommerce|woocommerce[-./]|wp-json/wc/' <<<"$hb" && record woocommerce ecommerce "$url" "woocommerce markers"
  grep -qiE 'cdn11\.bigcommerce\.com|bigcommerce\.com/s-' <<<"$hb" && record bigcommerce ecommerce "$url" "bigcommerce cdn"
  grep -qiE 'static1\.squarespace\.com|squarespace\.com' <<<"$hb"  && record squarespace site     "$url" "squarespace markers"
  grep -qiE 'x-wix-request-id|_wixCssStates|static\.wixstatic\.com' <<<"$hb" && record wix site "$url" "wix markers"
  # payments
  grep -qiE 'js\.stripe\.com|buy\.stripe\.com|checkout\.stripe\.com' <<<"$hb" && record stripe       payments "$url" "stripe.js / payment link"
  grep -qiE 'cdn\.paddle\.com|paddle\.com/api|create\.paddle' <<<"$hb"        && record paddle       payments "$url" "paddle markers"
  grep -qiE 'lemonsqueezy\.com|app\.lemonsqueezy' <<<"$hb"                     && record lemonsqueezy payments "$url" "lemon squeezy markers"
  grep -qiE 'gumroad\.com' <<<"$hb"                                           && record gumroad      payments "$url" "gumroad markers"
  grep -qiE 'paypalobjects\.com|paypal\.com/sdk' <<<"$hb"                      && record paypal       payments "$url" "paypal sdk"
  # scheduling / other
  grep -qiE 'calendly\.com' <<<"$hb"                                          && record calendly     scheduling "$url" "calendly embed"
  rm -f "$BODY" "$HDRS"; BODY=""; HDRS=""
}

for u in "${URLS[@]:-}"; do [[ -z "$u" ]] || scan_url "$u"; done

# --- repo fingerprints (presence only, never values) ------------------------
if [[ -n "$REPO" && -d "$REPO" ]]; then
  src="repo:$REPO"
  { [[ -f "$REPO/wrangler.toml" || -f "$REPO/wrangler.jsonc" ]]; } && record cloudflare hosting "$src" "wrangler config"
  [[ -f "$REPO/vercel.json" ]]  && record vercel  hosting "$src" "vercel.json"
  [[ -f "$REPO/netlify.toml" ]] && record netlify hosting "$src" "netlify.toml"
  # grep tracked text for service markers (quietly, presence only).
  # Use rg when available (it respects .gitignore, so it skips node_modules/.git);
  # only fall back to grep when rg is ABSENT — never on a non-match, or a "not found"
  # would trigger a full-tree grep through node_modules and hang on a real repo.
  if command -v rg >/dev/null; then
    rg_or_grep() { rg -li --max-count 1 "$1" "$REPO" >/dev/null 2>&1; }
  else
    rg_or_grep() { grep -rliE --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build "$1" "$REPO" >/dev/null 2>&1; }
  fi
  rg_or_grep 'stripe|price_[a-z0-9]|plink_|pk_(live|test)' && record stripe      payments  "$src" "stripe refs in code/env"
  rg_or_grep '@shopify/|SHOPIFY_|myshopify'                && record shopify     ecommerce "$src" "shopify refs in code/env"
  rg_or_grep 'woocommerce|WC_CONSUMER|WOOCOMMERCE_'        && record woocommerce ecommerce "$src" "woo refs in code/env"
  rg_or_grep 'PADDLE_|@paddle'                             && record paddle      payments  "$src" "paddle refs in code/env"
  rg_or_grep 'TELEGRAM_BOT_TOKEN'                          && record telegram    channel   "$src" "telegram env var"
fi

# --- emit grouped JSON ------------------------------------------------------
CHECKED="$(printf '%s\n' "${URLS[@]:-}")" REPO_OUT="$REPO" \
python3 - "$HITS_FILE" <<'PY' > "${OUT:-/dev/stdout}"
import json, os, sys
hits = {}
order = []
with open(sys.argv[1]) as f:
    for line in f:
        line = line.rstrip("\n")
        if not line:
            continue
        cid, kind, source, marker = line.split("\t", 3)
        if cid not in hits:
            hits[cid] = {"id": cid, "kind": kind, "signals": []}
            order.append(cid)
        hits[cid]["signals"].append({"source": source, "marker": marker})
checked = [u for u in os.environ.get("CHECKED", "").splitlines() if u]
out = {
    "schema_version": 1,
    "detected": [hits[c] for c in order],
    "checked_urls": checked,
    "repo": os.environ.get("REPO_OUT") or None,
}
print(json.dumps(out, indent=2))
PY
