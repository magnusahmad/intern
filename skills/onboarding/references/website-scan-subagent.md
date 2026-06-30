# Website scan subagent — spawn prompt (extraction)

Spawn this as a **background** child at Phase 3. It is **read-only**: it gathers raw signals
with provenance and writes them to files. It does **not** classify the business — synthesis
happens later in the main agent (Phase 6).

- **Toolsets:** `web`, `file` (Hermes built-in web-extract / browser-navigate / computer-use —
  no Firecrawl key required).
- **Inputs:** the company `website_url`, plus any `extra_sources` URLs.
- **Output files** (under `$INTERN_KB_PATH/raw/onboarding/`):
  - `website-scan.md` — human-readable findings.
  - `website-signals.json` — structured signals (see facets below), every fact tagged with the
    URL it came from.
  - touch `website-scan.done` **last**, only after both files are written.

## Spawn prompt (paste into the child task)

> You are a read-only website-extraction subagent for business onboarding. Crawl the company
> site and extract raw signals — do not classify the business, just gather evidence with
> provenance. Crawl at minimum: **home, products/shop, pricing, about, contact, footer links,
> and the Terms / Privacy / Legal pages.** The footer + Terms + Privacy are where legal /
> registration facts live — scan them explicitly.
>
> Extract these facets, each tagged with the source URL and a confidence (high/medium/low):
> - **Branding:** brand name, tagline/value prop, target audience, tone/voice, logo URL, brand
>   colors + fonts (from CSS), social handles, support channels.
> - **Products / catalog (as marketed):** per product — name, short description, category, type
>   (physical/digital/subscription/service), and listed price points.
> - **Pricing (as marketed):** amount, currency, cadence (one-time vs recurring + interval),
>   tier name. Mark these as *marketed* (may differ from what Stripe actually sells).
> - **Legal / registration:** legal entity name (often ≠ brand), company/registration number,
>   VAT/tax ID, registered address, jurisdiction, contact/support email.
> - **Checkout mechanism observed:** Stripe Payment Link / Checkout URL, app-store link,
>   contact/quote form, etc. This is a strong business-model signal — record it.
>
> Write `$INTERN_KB_PATH/raw/onboarding/website-scan.md` (readable) and
> `website-signals.json` (structured), then `touch
> $INTERN_KB_PATH/raw/onboarding/website-scan.done`. Do not modify anything outside
> `raw/onboarding/`. If a page is unreachable, note it and continue — partial results are fine.

## `website-signals.json` shape

```json
{
  "schema_version": 1,
  "scanned_at": "2026-06-29T10:05:00Z",
  "pages_visited": ["https://example.com/", "https://example.com/pricing", "..."],
  "brand": { "name": "...", "tagline": "...", "colors": ["#..."], "social": {}, "_source": "https://example.com/" },
  "products": [ { "name": "...", "type": "subscription", "prices": [ { "amount": 2900, "currency": "usd", "cadence": "month", "_source": "https://example.com/pricing" } ] } ],
  "legal": { "entity_name": "...", "registration_number": null, "vat_id": null, "registered_address": null, "jurisdiction": null, "contact_email": null, "_source": "https://example.com/terms" },
  "checkout_observed": [ { "mechanism": "stripe_payment_link", "url": "https://buy.stripe.com/...", "_source": "https://example.com/pricing" } ],
  "unreachable": []
}
```
