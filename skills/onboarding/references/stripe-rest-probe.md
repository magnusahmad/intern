# Stripe REST probe fallback

Use this during onboarding when Stripe is confirmed but the `stripe` CLI is missing or not worth installing. The goal is read-only grounding for KB pages without printing secrets.

## When

- `STRIPE_SECRET_KEY` was discovered/saved by `scripts/discover-secret.sh` or entered through `scripts/enter-secret.sh`.
- The `stripe` CLI is missing, deferred, or would require extra setup.
- You need products, prices, payment links, and a small recent checkout-session count for onboarding synthesis.

## Rules

- Never print the key or pass it as a visible command argument.
- Load the key from the profile `.env` inside the script/process.
- Use HTTP Basic auth with `<key>:`.
- Keep probes read-only: `GET /v1/products`, `GET /v1/prices`, `GET /v1/payment_links`, optionally `GET /v1/checkout/sessions?limit=5`.
- The probe script lives under `$TMPDIR` (or this skill's directory) — **never in the company repo** (SKILL.md golden rule 8; it would violate read-only and need cleanup later).
- The JSON artifact is the **session cache**: any follow-on task that needs Stripe account state (e.g. cloning a payment link) must read `raw/onboarding/stripe-probe.json` first and only call the API for what the cache doesn't hold. Don't re-enumerate payment links with per-link line-item calls the probe already made.
- Redact live Payment Link URLs before writing curated KB pages. Full IDs/URLs may appear only in raw probe output if already present in the existing company KB/repo and needed for operations; otherwise prefer redaction.
- Record `livemode`, product names/descriptions, human-readable prices, whether prices are recurring, and active Payment Link presence.
- If the REST probe succeeds, do not block onboarding to install the Stripe CLI.

## Minimal Python shape

1. Read the profile `.env` and set `STRIPE_SECRET_KEY` in process memory only.
2. Build `Authorization: Basic base64(STRIPE_SECRET_KEY + ':')`.
3. Fetch:
   - `/v1/products?limit=20&active=true`
   - `/v1/prices?limit=30&active=true&expand[]=data.product`
   - `/v1/payment_links?limit=20&active=true`
   - `/v1/checkout/sessions?limit=5` (optional support/analytics readiness check)
4. Write a compact JSON artifact under `$INTERN_KB_PATH/raw/onboarding/stripe-probe.json`.
5. Summarize only non-secret facts into `operations/stripe.md`, `company/payments.md`, and `products/catalog.md`.
