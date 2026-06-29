# Business profile — synthesis reference (Phase 6)

The point of the scans is not to dump the website into the KB — it is to **understand the
business**: what it is, what it sells, at what prices, under what brand and legal entity, on
what stack. That understanding becomes the spine of the KB and the context every later skill
reads.

Synthesis runs in the **main onboarding agent** at Phase 6, once Stripe (Phase 4) and the
background scans are in. It triangulates all three sources into
`$AO1_KB_PATH/company/company-profile.json` plus curated KB pages.

## Business-model classification

A business is frequently **hybrid**. Record a `primary` plus `secondary[]`, each with its
evidence and confidence — never force a single label.

| Model | Tell-tale signals |
|---|---|
| `ecommerce_physical` | product catalog, "add to cart", shipping/returns policy, Stripe **one-time** prices + **shipping rates**, address collection |
| `ecommerce_digital` | downloadable/licensed goods, one-time Stripe prices, no shipping |
| `saas` | pricing **tiers**, "sign up / log in / dashboard", Stripe **recurring** prices/subscriptions, app framework + auth in repo, API/docs |
| `consumer_app` | App Store / Play Store links, "download the app", mobile-first, in-app purchase (often **not** Stripe) |
| `marketplace` | multiple sellers/vendors, commission/payout language, Stripe Connect |
| `services_agency` | "book a call", "get a quote", consulting/portfolio, no self-serve checkout |
| `content_media` | subscriptions/memberships/paywall, ad-driven, newsletter |

## Source precedence (don't let the loudest source win)

| Facet | Authoritative source | Others used for |
|---|---|---|
| What's actually sold + real prices | **Stripe** | website = marketing, repo = wiring |
| Business-model classification | **all three combined** | — |
| Branding / positioning / tone | **website** | repo theme = colors/fonts |
| Legal / registration / entity | **website footer + Terms/Privacy** | repo rarely has this |
| Stack / deploy / Stripe wiring / ID locations | **repo** | website = observed checkout |

## Conflict handling

When sources disagree on a material fact, **do not silently resolve**. Record both values, set
`needs_confirmation: true` on the field, add a line to `open_questions`, and ask the user at
reconcile time. The classic case — website advertises `$29/mo` but the active Stripe price is
`$39/mo` — is the most common real-world mismatch; surfacing it is a feature, not a failure.
Brand name ≠ Stripe account / legal entity is the other common one.

## Resilience

- Re-running synthesis overwrites `company-profile.json` from current signals + Stripe, but
  **merges back** user-confirmed corrections — never destroy them.
- If a scan is missing/timed out, synthesize from whatever is available and leave a `todo`. A
  later run finishes the scan and re-synthesizes.

## `company-profile.json` schema

Lives at `$AO1_KB_PATH/company/company-profile.json`.

```json
{
  "schema_version": 1,
  "generated_at": "2026-06-29T10:30:00Z",
  "business_model": {
    "primary": "saas",
    "secondary": ["ecommerce_digital"],
    "evidence": [
      { "model": "saas", "signal": "recurring Stripe prices + dashboard routes in repo", "confidence": "high" },
      { "model": "ecommerce_digital", "signal": "one-time 'lifetime license' Payment Link", "confidence": "medium" }
    ]
  },
  "brand": {
    "name": "Acme",
    "tagline": "...",
    "audience": "...",
    "tone": "...",
    "logo_url": "...",
    "colors": ["#..."],
    "social": {},
    "support_channels": []
  },
  "legal": {
    "entity_name": "Acme Technologies Ltd",
    "registration_number": null,
    "vat_id": null,
    "registered_address": null,
    "jurisdiction": null,
    "contact_email": null,
    "source": "website_footer+terms",
    "needs_confirmation": true
  },
  "products": [
    {
      "name": "Pro plan",
      "type": "subscription",
      "category": "...",
      "prices": [
        { "amount": 3900, "currency": "usd", "cadence": "month",
          "source": "stripe", "marketed_amount": 2900, "needs_confirmation": true }
      ],
      "stripe_ids": { "product": "prod_...", "price": "price_..." }
    }
  ],
  "tech": {
    "stack": ["next.js"],
    "hosting": "cloudflare_pages",
    "stripe_wiring": "checkout in src/app/checkout/...",
    "catalog_defined_in": "content/products.ts",
    "expected_env_vars": ["STRIPE_SECRET_KEY", "..."]
  },
  "open_questions": [
    "Website lists $29/mo but active Stripe price is $39/mo — which is correct?"
  ]
}
```
