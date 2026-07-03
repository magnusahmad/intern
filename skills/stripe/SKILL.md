---
name: stripe
description: 'Use Stripe CLI and REST API for billing/storefront operations: Payment Links, Checkout Sessions, Products, Prices, Shipping Rates, and purchase verification for customer support workflows.'
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
prerequisites:
  env_vars: [STRIPE_SECRET_KEY]
  commands: [curl, stripe]
metadata:
  hermes:
    tags: [stripe, payments, billing, ecommerce, support]
    homepage: https://stripe.com/docs/api
---

# Stripe

## When to use

Use this skill when the operator asks to:

- inspect or update Stripe Payment Links, Products, Prices, Shipping Rates, Checkout Sessions, or related billing objects
- verify whether an email sender is a purchaser
- enrich support/customer-feedback records with purchase, country, amount, or payment context
- debug Stripe checkout configuration
- replace immutable Stripe objects safely

## Safety rules

1. **Never print secrets.** Load `STRIPE_SECRET_KEY` from environment or local `.env`, but do not echo it.
2. **Prefer read-only inspection first.** Inspect current objects before creating, updating, or deactivating anything.
3. **Treat live mode as production.** If API responses show `livemode: true`, changes affect real customers.
4. **Do not deactivate or replace live objects until references are updated and verified.** Website or app checkout links must point at the replacement before old objects are disabled.
5. **Document new object IDs in the project source of truth.** Use the active repo's operations docs or KB; do not hardcode company-specific IDs into this reusable skill.

## Authentication

### Load the key once, then reuse it

The terminal is a **persistent shell** — exports survive across commands. If
`STRIPE_SECRET_KEY` isn't already in the environment, source it **once** and
never re-read `.env` again this session:

```bash
[ -n "$STRIPE_SECRET_KEY" ] || { set -a; . ./.env 2>/dev/null; [ -n "$HERMES_HOME" ] && . "$HERMES_HOME/.env" 2>/dev/null; set +a; }
```

Every later command just uses `$STRIPE_SECRET_KEY`. Re-parsing `.env` inside
each script is a per-command tax that adds nothing.

**Batch API work into few commands.** One script that inspects the reference
objects AND performs the write beats a chain of single-call scripts — each
separate command is a full model round-trip. For "clone an existing payment
link with one variation," aim for two commands total: one read (dump the
reference link, line items, promo state), one write (create product/price/
link from those values).

### API-key mode, best for agents and cron

```bash
stripe --api-key "$STRIPE_SECRET_KEY" payment_links list
```

or REST:

```bash
curl -s "https://api.stripe.com/v1/payment_links?limit=5" \
  -u "$STRIPE_SECRET_KEY:"
```

### Browser login mode, interactive only

```bash
stripe login
```

Use this only when you need CLI features such as `stripe listen` and a human can complete the browser confirmation.

## Key objects

| Object | REST endpoint | CLI command |
|---|---|---|
| Payment Link | `GET/POST /v1/payment_links` | `stripe payment_links list/update` |
| Shipping Rate | `GET/POST /v1/shipping_rates` | `stripe shipping_rates create/list` |
| Product | `GET /v1/products` | `stripe products list` |
| Price | `GET /v1/prices` | `stripe prices list` |
| Checkout Session | `GET /v1/checkout/sessions` | `stripe checkout sessions list` |
| Customer | `GET /v1/customers/search` | `stripe customers search` |

## Common inspection commands

List payment links with shipping options:

```bash
curl -s "https://api.stripe.com/v1/payment_links?limit=10&expand[]=data.shipping_options" \
  -u "$STRIPE_SECRET_KEY:" | python3 -c '
import json,sys
for p in json.load(sys.stdin).get("data", []):
    print(p.get("id"), p.get("url"), "active=", p.get("active"), "livemode=", p.get("livemode"))
    print("  shipping:", [s.get("shipping_rate") for s in p.get("shipping_options", [])])
'
```

List products:

```bash
curl -s "https://api.stripe.com/v1/products?limit=20" \
  -u "$STRIPE_SECRET_KEY:" | python3 -c '
import json,sys
for p in json.load(sys.stdin).get("data", []):
    print(p.get("id"), "|", p.get("name"), "| active:", p.get("active"))
'
```

List prices for a product:

```bash
curl -s "https://api.stripe.com/v1/prices?product=prod_XXXXX&limit=10" \
  -u "$STRIPE_SECRET_KEY:" | python3 -c '
import json,sys
for p in json.load(sys.stdin).get("data", []):
    print(p.get("id"), "|", p.get("unit_amount"), p.get("currency"), "| active:", p.get("active"))
'
```

## Replacing immutable Payment Link fields

Many Stripe object fields cannot be changed after creation. Payment Link `shipping_options` and Shipping Rate `delivery_estimate` are common examples. If an immutable field must change, create a replacement object and migrate references.

### 1. Create or identify a Shipping Rate

```bash
curl -s -X POST "https://api.stripe.com/v1/shipping_rates" \
  -u "$STRIPE_SECRET_KEY:" \
  -d "display_name=Worldwide shipping" \
  -d "type=fixed_amount" \
  -d "fixed_amount[amount]=1899" \
  -d "fixed_amount[currency]=usd" \
  -d "delivery_estimate[minimum][unit]=business_day" \
  -d "delivery_estimate[minimum][value]=14" \
  -d "delivery_estimate[maximum][unit]=business_day" \
  -d "delivery_estimate[maximum][value]=21"
```

Use `business_day` singular, not `business_days`.

### 2. Get the Price ID

```bash
curl -s "https://api.stripe.com/v1/prices?product=prod_XXXXX&limit=5" \
  -u "$STRIPE_SECRET_KEY:" | python3 -m json.tool
```

### 3. Create a replacement Payment Link

```bash
curl -s -X POST "https://api.stripe.com/v1/payment_links" \
  -u "$STRIPE_SECRET_KEY:" \
  -d "line_items[0][price]=price_XXXXX" \
  -d "line_items[0][quantity]=1" \
  -d "shipping_options[0][shipping_rate]=shr_XXXXX"
```

If a recreation call fails with `400`, retry with the minimal required creation payload plus only known-accepted options: `line_items`, `shipping_options`, `automatic_tax[enabled]`, `allow_promotion_codes`, `billing_address_collection`, `phone_number_collection[enabled]`, `submit_type`, and `shipping_address_collection[allowed_countries][i]`.

### 4. Update site/app references and verify

Update the active repo's checkout URL references. Then verify the deployed or local page no longer contains the old URL and does contain the new one.

**Verification is one check, not a suite.** A single `curl` of the live page confirming the new
payment-link URL is present (and the old one absent, when replacing) is sufficient evidence —
done. Do not write throwaway verifier scripts, poll in sleep loops, re-parse the DOM, or
re-check the same fact across multiple URLs; if the page isn't live yet, one short retry after
the deploy finishes is the cap. A link swap also needs **no local browser session** — don't
start a dev server, navigate, or click the widget to watch an `href` change; the post-deploy
`curl` is the whole check.

### 5. Deactivate the old object

```bash
curl -s -X POST "https://api.stripe.com/v1/payment_links/plink_OLD_ID" \
  -u "$STRIPE_SECRET_KEY:" \
  -d "active=false"
```

## Purchase verification for support/email workflows

Use Checkout Sessions first for storefront purchases. Payment Links and Checkout can store purchase email and country in `customer_details` even when no Stripe Customer object exists.

Read-only pattern:

1. Load `STRIPE_SECRET_KEY` without printing it.
2. Query recent Checkout Sessions:

   ```bash
   curl -s "https://api.stripe.com/v1/checkout/sessions?limit=100&expand[]=data.payment_intent" \
     -u "$STRIPE_SECRET_KEY:" > /tmp/stripe-sessions.json
   ```

3. Match inbound sender email case-insensitively against `customer_details.email` or `customer_email`.
4. Treat as verified only when:
   - `payment_status == "paid"`
   - `status == "complete"`
5. Prefer `customer_details.address.country` as analytics country with source `stripe_checkout_session`.
6. Preserve only necessary audit fields in structured output: checkout session ID, payment ID, amount, currency, country, verified boolean.

Minimal Python shape:

```python
for session in sessions:
    details = session.get("customer_details") or {}
    session_email = (details.get("email") or session.get("customer_email") or "").lower()
    if session_email == inbound_email.lower():
        verified = session.get("payment_status") == "paid" and session.get("status") == "complete"
        country = (details.get("address") or {}).get("country")
        payment_intent = session.get("payment_intent")
        payment_id = payment_intent.get("id") if isinstance(payment_intent, dict) else payment_intent
```

## Pitfalls

- `stripe login` hangs in headless/cron contexts. Use `--api-key` or REST with `-u "$STRIPE_SECRET_KEY:"`.
- Many fields are immutable. Do not keep retrying unsupported update params; create a replacement object.
- Shipping Rates cannot be deleted; deactivate unused ones with `active=false` if supported.
- Checkout buyers may not appear in Customer Search. Prefer Checkout Session matching for support verification.
- Use `python3 -m json.tool` when `jq` is not available.
- Never copy live object IDs, account IDs, customer emails, or payment IDs into public distribution docs or skills.
