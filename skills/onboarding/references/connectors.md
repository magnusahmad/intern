# Connector registry — what onboarding can connect, and how it decides

Onboarding is **evidence-driven**: it does **not** ask for every service unconditionally. It
fingerprints the business (website + repo), proposes the services it actually found, confirms
with the user, and then connects **only** the confirmed set. This file is the registry that
drives that loop (SKILL.md Phase 4). Adding a new service = adding a row here, not editing the
flow.

**The registry is an accelerator, not a whitelist.** No row here — including Stripe and
Cloudflare — is mandatory, and a confirmed service *without* a row still gets connected, via
the generic recipe at the bottom of this file. The agent's actual job is: find the services
this company runs on, work out how to talk to each (profile skill → vendor CLI → REST API),
figure out with the user which ones matter, and auth those.

## How the loop uses this

1. **Detect** — `scripts/detect-integrations.sh URL [--repo PATH]` does a fast public-page +
   repo fingerprint and emits a `detected[]` list. The background website/repo scans
   (`*-signals.json`) add deeper evidence (`checkout_observed`, `stripe_refs`, `hosting`,
   `expected_env_vars`, `app_shape`). Union the two into `detected_integrations` in the state
   file, each entry carrying the `signals` that fired.
2. **Confirm** — show the user the detected set in plain language ("I found Stripe — there's a
   payment link on your pricing page — and your site is on Cloudflare. I did **not** see
   Shopify, WooCommerce, or other tools. Anything I should add or remove?"). Evidence
   *proposes*; the user *decides*. Never silently skip a service they say they use, never force
   one with no evidence.
3. **Onboard** — for each **confirmed** connector, run its recipe below: get its secret(s) via
   the secret scripts (see SKILL.md "Secret entry"), run the read-only probe, write its KB
   pages. Skip connectors that are neither detected nor user-added.

Connectors with `detect: always` (Telegram) run regardless — they're not business-evidence
dependent. Everything else is opt-in by evidence.

## Registry schema (per connector)

| field | meaning |
|---|---|
| `id` / `kind` | stable id; kind ∈ `payments`, `ecommerce`, `hosting`, `channel`, `scheduling`, `site` |
| `detect` | the signals that mark it present (website markers, repo markers, scan-signal fields), or `always` |
| `secrets` | env var(s) to obtain, and the recipe (`discover-secret.sh` first, `enter-secret.sh` fallback). Note least-privilege guidance |
| `probe` | the **read-only** check to confirm the connection works |
| `kb_pages` | curated pages this connector writes |
| `status` | `wired` (recipe implemented) or `stub` (detection only — guide the user, mark a `todo`) |

---

## Wired connectors

### stripe — `payments` — **wired**
- **detect (any):** website `checkout_observed.mechanism ~ ^stripe_` or body has
  `js.stripe.com` / `buy.stripe.com` / `checkout.stripe.com`; repo `stripe_refs` non-empty,
  `STRIPE_*` in `expected_env_vars`, or a `stripe` dependency.
- **secrets:** `STRIPE_SECRET_KEY` — `discover-secret.sh STRIPE_SECRET_KEY --env-file <env>
  --alias STRIPE_API_KEY --root <company_repo_path>`, else `enter-secret.sh` (recommend a
  **restricted/read-only** key).
- **probe:** read-only products, prices, payment links, recent checkout sessions
  (`stripe` skill patterns, `-u "$STRIPE_SECRET_KEY:"`; no CLI needed — see
  `references/stripe-rest-probe.md`). Record `livemode`. Cache the raw output at
  `raw/onboarding/stripe-probe.json` and **reuse it for follow-on tasks in the session**
  instead of re-enumerating the account (re-listing all payment links with per-link
  line-item calls is the classic double-spend).
- **kb_pages:** `operations/stripe.md`, `products/catalog.md`, `company/payments.md`.

### cloudflare — `hosting` — **wired**
- **detect (any):** website served via Cloudflare (`cf-ray` / `server: cloudflare`); repo has
  `wrangler.toml`/`wrangler.jsonc`; scan `hosting: cloudflare_*`.
- **secrets:** `wrangler login` (interactive, local) **or** `CLOUDFLARE_API_TOKEN` via the
  secret scripts for non-interactive.
- **probe:** detect deploy target (`wrangler.toml`, else `wrangler pages project list` /
  `wrangler deployments list`); **do not deploy**.
- **warm-up:** if the repo deploys via `npx`/`npm exec wrangler` and no wrangler is installed,
  kick off `npm exec --yes wrangler --version` in the background at confirmation time — it
  pre-downloads the CLI so the first real deploy doesn't stall ~60–90s (or fail cold).
- **kb_pages:** `operations/hosting.md` (deploy target + site↔Stripe relationship).

### telegram — `channel` — **wired** — `detect: always`
- The handoff channel; runs every time (Phase 7), not evidence-gated.
- **secrets:** `TELEGRAM_BOT_TOKEN` via `enter-secret.sh` (fresh token, never discoverable);
  `TELEGRAM_ALLOWED_USER_IDS` **mandatorily** locked to the owner's id.
- **probe:** send a test message; restart the gateway.
- **kb_pages:** recorded in the onboarding decision log.

---

## Stub connectors (detected, not yet wired)

Detection fires for these so onboarding can **acknowledge** them ("I see you're on Shopify —
I can't fully wire that yet, I've noted it"), guide the user to where the credential is minted,
and append a `todo`. Promote a stub to **wired** by filling in its `secrets`/`probe`/`kb_pages`.

### shopify — `ecommerce` — **stub**
- **detect:** body `cdn.shopify.com` / `myshopify.com` / `Shopify.theme` / `x-shopify-*`
  header; repo `@shopify/*` deps or `SHOPIFY_*` env.
- **secrets (when wired):** Admin API access token (Shopify Admin → Apps → develop apps →
  Admin API token) → `enter-secret.sh SHOPIFY_ADMIN_TOKEN`. Least privilege: read-only scopes.
- **probe (when wired):** read-only `GET /admin/api/.../shop.json`, products, orders count.

### woocommerce — `ecommerce` — **stub**
- **detect:** body `wp-content/plugins/woocommerce` / `wp-json/wc/`; repo `woocommerce` /
  `WC_CONSUMER_*` env.
- **secrets (when wired):** WooCommerce REST API consumer key + secret (WP admin → WooCommerce
  → Settings → Advanced → REST API) → `enter-secret.sh WOOCOMMERCE_KEY` / `_SECRET`.
- **probe (when wired):** read-only `GET /wp-json/wc/v3/system_status`, products.

### paddle / lemonsqueezy / gumroad — `payments` — **stub**
- **detect:** respective CDN/script markers (`cdn.paddle.com`, `lemonsqueezy.com`,
  `gumroad.com`) or repo refs.
- **secrets (when wired):** vendor API key via `enter-secret.sh`; read-only probe of
  products/transactions.

### vercel / netlify — `hosting` — **stub**
- **detect:** `x-vercel-id` / `server: Vercel`; `x-nf-request-id` / `server: Netlify`; repo
  `vercel.json` / `netlify.toml`.
- **secrets (when wired):** platform token via `enter-secret.sh`; record deploy target in
  `operations/hosting.md` (mirrors the Cloudflare recipe).

### squarespace / wix — `site` — **stub**
- **detect:** `static1.squarespace.com`; `x-wix-request-id` / `static.wixstatic.com`.
- Mostly closed platforms with limited APIs — usually **record only** (note in
  `operations/hosting.md`) rather than connect.

### calendly — `scheduling` — **stub**
- **detect:** `calendly.com` embed on the site.
- **secrets (when wired):** Calendly personal access token; read-only event-types probe.

---

## Generic recipe — confirmed services with no registry row

Discovery will regularly surface services this file has never heard of. That is not a gap in
onboarding — it's the normal case the registry only accelerates. For any service the user
confirms matters, connect it like this:

1. **Check the profile first.** If a profile skill exists for the service (e.g. `stripe`), it
   already documents the preferred CLI/API patterns and safety rules — follow it.
2. **Find the official tooling.** Look for a vendor CLI (`brew info <name>`, `npm view
   <name>`, the vendor's developer docs). No CLI is fine — most services expose a REST API
   with token auth; prefer whatever the vendor documents for automation. Offer the copy-paste
   install line if a CLI exists and is missing (never silent-install).
3. **Least privilege.** Where the vendor supports scoped/restricted/read-only tokens,
   recommend one and say which scopes are needed.
4. **Secret entry** via the standard scripts (`discover-secret.sh` first, `enter-secret.sh`
   fallback) into a sensibly named env var — the vendor's conventional name if it has one,
   else `<SERVICE>_API_KEY`. Same invariants: never echoed, never over Telegram.
5. **Read-only probe:** the cheapest authenticated GET that proves the credential works
   (account/whoami, or a list of one resource). Cache the output at
   `raw/onboarding/<id>-probe.json` like any registry connector.
6. **KB page:** `operations/<service>.md` — what the service does for this business, how it's
   wired, where the credential lives (name and location only, never the value).
7. **State:** record it under `connectors.<id>` with `status: "adhoc"` so later runs know it's
   wired without a registry row. If the same service keeps showing up across businesses,
   promote it to a real row above.

Triage before you auth: services on the money path (payments, sales channel, hosting, the
support inbox) are worth connecting; low-stakes detections (analytics pixels, font CDNs, chat
widgets) get a KB mention and no credentials — don't collect keys the user gets no leverage
from.
