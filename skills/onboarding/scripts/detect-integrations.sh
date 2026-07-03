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
#     "candidates": [ { "hint": "klaviyo.com", "type": "domain",
#                       "signals": [ {"source": "...", "marker": "script → js.klaviyo.com"} ] },
#                     { "hint": "TWILIO", "type": "env_prefix",
#                       "signals": [ {"source": "repo:...", "marker": "TWILIO_AUTH_TOKEN"} ] } ],
#     "checked_urls": [...], "repo": "..." }
#
# `detected` is what the fixed regexes recognized. `candidates` is everything the
# script *saw* but could not classify: third-party domains referenced by the
# pages (script/link/iframe/form) and unrecognized env-var name prefixes from
# the repo — names only, never values. The agent classifies candidates itself
# (it knows what klaviyo.com is; this script doesn't need to) and triages them
# per the connector registry's money-path-vs-pixel rule. Unknown-to-this-script
# must never mean invisible.
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
CAND_FILE="$(mktemp)"        # lines: page-url<TAB>attr=url  (raw, classified in python)
ENVV_FILE="$(mktemp)"        # lines: source<TAB>ENV_VAR_NAME (names only, never values)
trap 'rm -f "$HITS_FILE" "$CAND_FILE" "$ENVV_FILE" "${BODY:-}" "${HDRS:-}"' EXIT

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
  # open-world candidates: every third-party URL the page references via
  # script/link/iframe/form, raw here, classified + filtered in the emitter.
  grep -oiE "(src|href|action)[[:space:]]*=[[:space:]]*[\"'][^\"']+" "$BODY" 2>/dev/null |
    awk -v u="$url" '{ print u "\t" $0 }' >> "$CAND_FILE"
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
  # open-world candidates: harvest env-var NAMES (never values) from code refs
  # and .env example files; the emitter surfaces unrecognized prefixes.
  ENV_RE='process\.env\.[A-Z][A-Z0-9_]*|import\.meta\.env\.[A-Z][A-Z0-9_]*|os\.environ(\.get)?\(["'"'"']?[A-Z][A-Z0-9_]*'
  {
    if command -v rg >/dev/null; then
      rg -o --no-filename "$ENV_RE" "$REPO" 2>/dev/null
    else
      grep -rEoh --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build "$ENV_RE" "$REPO" 2>/dev/null
    fi
    find "$REPO" -maxdepth 2 \( -name '.env.example' -o -name '.env.sample' -o -name '.env.template' \) -not -path '*/node_modules/*' 2>/dev/null |
      while IFS= read -r f; do grep -oE '^[A-Z][A-Z0-9_]*=' "$f" 2>/dev/null | sed 's/=$//'; done
  } | sort -u | awk -v s="$src" '{ print s "\t" $0 }' >> "$ENVV_FILE"
fi

# --- emit grouped JSON ------------------------------------------------------
CHECKED="$(printf '%s\n' "${URLS[@]:-}")" REPO_OUT="$REPO" \
python3 - "$HITS_FILE" "$CAND_FILE" "$ENVV_FILE" <<'PY' > "${OUT:-/dev/stdout}"
import json, os, re, sys
from urllib.parse import urlparse

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

# --- open-world candidates ---------------------------------------------------
# Domains the pages reference that the fixed regexes above didn't classify, and
# unrecognized env-var prefixes from the repo. The agent does the classifying.

# Pure-infrastructure hosts: referencing these says nothing about which services
# the business operates through. Keep this list boring and short.
CDN_NOISE = {
    "googleapis.com", "gstatic.com", "jsdelivr.net", "unpkg.com",
    "cloudflare.com", "jquery.com", "bootstrapcdn.com", "fontawesome.com",
    "typekit.net", "w3.org", "schema.org", "polyfill.io",
}
# Domains the fixed regexes already handle — re-listing them as candidates
# would double-report what `detected` covers.
KNOWN_SERVICE_DOMAINS = {
    "stripe.com", "paddle.com", "lemonsqueezy.com", "gumroad.com",
    "paypal.com", "paypalobjects.com", "shopify.com", "myshopify.com",
    "bigcommerce.com", "squarespace.com", "wix.com", "wixstatic.com",
    "woocommerce.com", "calendly.com", "vercel.com", "netlify.com",
    "cloudflareinsights.com", "telegram.org",
}
# Env prefixes that carry no service signal (generic config words) or that the
# fixed regexes / this profile already know about.
GENERIC_ENV_PREFIXES = {
    "NODE", "NPM", "PATH", "PORT", "HOST", "HOSTNAME", "DEBUG", "LOG", "CI",
    "HOME", "USER", "APP", "PUBLIC", "ENV", "BASE", "API", "SECRET", "TOKEN",
    "KEY", "URL", "DATABASE", "DB", "SERVER", "CLIENT", "ADMIN", "TEST",
    "DEV", "PROD", "AUTH", "SESSION", "COOKIE", "CORS", "HTTP", "HTTPS",
    "MAX", "MIN", "DEFAULT", "ENABLE", "DISABLE", "FEATURE", "BUILD",
    # app-config nouns, not vendors (a vendor hiding behind one of these will
    # still surface via its domain on the site or the deep repo scan)
    "CURRENCY", "CHECKOUT", "SHIPPING", "NEWSLETTER", "SOCIAL", "DIAG",
    "EMAIL", "PRICE", "PRODUCT", "ORDER", "PAYMENT", "WEBHOOK", "CACHE",
    "QUEUE", "WORKER", "CRON", "RATE", "TIMEOUT", "RETRY", "SITE", "STORE",
    "AGENT", "MODEL", "CHAT", "ALLOWED", "CUSTOMER", "SUPPORT", "CONTACT",
}
KNOWN_ENV_PREFIXES = {
    "STRIPE", "CLOUDFLARE", "TELEGRAM", "SHOPIFY", "WOOCOMMERCE", "WC",
    "PADDLE", "HERMES", "INTERN", "OPENROUTER",
}
FRAMEWORK_ENV_PREFIX = re.compile(r"^(NEXT_PUBLIC_|VITE_|REACT_APP_|NUXT_PUBLIC_|EXPO_PUBLIC_)")

def registrable(host):
    host = host.lower().rstrip(".")
    labels = host.split(".")
    if len(labels) >= 3 and labels[-2] in {"co", "com", "net", "org", "ac", "gov", "edu"} and len(labels[-1]) <= 3:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:]) if len(labels) >= 2 else host

own_domains = {registrable(urlparse(u).netloc) for u in checked if urlparse(u).netloc}

attr_re = re.compile(r"""^(src|href|action)\s*=\s*["'](.+)$""", re.I)
domain_cands = {}   # registrable -> {"hint", "type", "signals", seen_markers}
with open(sys.argv[2]) as f:
    for line in f:
        line = line.rstrip("\n")
        if "\t" not in line:
            continue
        page, raw = line.split("\t", 1)
        m = attr_re.match(raw)
        if not m:
            continue
        attr, target = m.group(1).lower(), m.group(2)
        if not target.lower().startswith(("http://", "https://")):
            continue
        host = urlparse(target).netloc.split(":")[0]
        if not host or "." not in host:
            continue
        reg = registrable(host)
        if reg in own_domains or reg in CDN_NOISE or reg in KNOWN_SERVICE_DOMAINS:
            continue
        entry = domain_cands.setdefault(reg, {"hint": reg, "type": "domain", "signals": [], "_seen": set()})
        marker = f"{attr} → {host}"
        if marker not in entry["_seen"] and len(entry["signals"]) < 3:
            entry["_seen"].add(marker)
            entry["signals"].append({"source": page, "marker": marker})

env_cands = {}      # prefix -> {"hint", "type", "signals", seen_vars}
var_re = re.compile(r"([A-Z][A-Z0-9_]*)$")
with open(sys.argv[3]) as f:
    for line in f:
        line = line.rstrip("\n")
        if "\t" not in line:
            continue
        source, token = line.split("\t", 1)
        m = var_re.search(token)
        if not m:
            continue
        var = FRAMEWORK_ENV_PREFIX.sub("", m.group(1))
        prefix = var.split("_", 1)[0]
        if len(prefix) < 2 or prefix in GENERIC_ENV_PREFIXES or prefix in KNOWN_ENV_PREFIXES:
            continue
        entry = env_cands.setdefault(prefix, {"hint": prefix, "type": "env_prefix", "signals": [], "_seen": set()})
        if var not in entry["_seen"] and len(entry["signals"]) < 5:
            entry["_seen"].add(var)
            entry["signals"].append({"source": source, "marker": var})

candidates = []
for entry in list(domain_cands.values())[:30] + list(env_cands.values())[:20]:
    entry.pop("_seen", None)
    candidates.append(entry)

out = {
    "schema_version": 1,
    "detected": [hits[c] for c in order],
    "candidates": candidates,
    "checked_urls": checked,
    "repo": os.environ.get("REPO_OUT") or None,
}
print(json.dumps(out, indent=2))
PY
