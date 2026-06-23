# Stripe purchase verification for customer email workflows

Use this reference when inbound support/customer-feedback email should be checked against Stripe before treating the sender as a verified customer or using country/order context.

## Pattern

1. Load `STRIPE_SECRET_KEY` from the environment or local `.env` without printing it.
2. Use read-only Stripe API calls only.
3. Prefer Checkout Sessions for storefront purchases, because purchase email and country are often in `customer_details` even when no Stripe Customer object exists.
4. Match inbound sender email case-insensitively against `checkout_session.customer_details.email` or `customer_email`.
5. Treat as a verified purchase only when:
   - `payment_status == "paid"`
   - `status == "complete"`
6. Prefer `customer_details.address.country` for analytics country with source `stripe_checkout_session` or `checkout_session`.
7. Preserve only minimal audit fields in structured output:
   - checkout session ID
   - payment intent/payment ID
   - amount total
   - currency
   - verified boolean
   - country

## Why not rely only on Customer Search?

For Stripe Checkout and Payment Links, the email may appear on Checkout Sessions even when `customers/search query=email:'...'` returns no Customer object. Use Customer Search as a supplement, not the only verification path.

## Minimal Python shape

```python
sessions = stripe_get("checkout/sessions", {
    "limit": 100,
    "expand[]": ["data.payment_intent"],
})["data"]

for session in sessions:
    details = session.get("customer_details") or {}
    session_email = (details.get("email") or session.get("customer_email") or "").lower()
    if session_email == inbound_email.lower():
        verified = session.get("payment_status") == "paid" and session.get("status") == "complete"
        country = (details.get("address") or {}).get("country")
        payment_intent = session.get("payment_intent")
        payment_id = payment_intent.get("id") if isinstance(payment_intent, dict) else payment_intent
```

## Agent prompt rule

When an email-processing job includes Stripe context, preserve it instead of re-inferring from email text:

- `purchase.verified_purchase` or `stripe.verified_purchase` confirms whether the sender is a purchaser.
- If verified, prefer checkout/order country over quoted address text.
- Never send replies automatically solely because a sender is verified; reply policy remains separate.
