---
name: customer-email-sorter
description: Triage and process customer/support/feedback emails from a configured mailbox with read-only mailbox access, optional purchase verification, local ledgers, draft-only replies, and analytics-ready JSONL records.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [email, support, customer-feedback, mailbox, stripe, analytics, cron]
    related_skills: [stripe]
---

# Customer Email Sorter

## When to use

Use this skill when the operator asks to:

- process customer/support/feedback emails
- classify inbound product feedback, support requests, shipping issues, refunds, or spam
- build or operate an email triage cron job
- verify whether an email sender is a purchaser
- calculate analytics such as negative-review rate by country
- draft support replies for human review

Do not use this for unrelated personal email, outbound campaigns, or newsletter blasting unless the operator explicitly defines a separate policy.

## Core safety policy

1. **Never mutate the mailbox by default.** Do not move, delete, archive, flag, purge, expunge, copy, send, reply, or forward emails unless the operator explicitly requests that capability.
2. **Never send customer replies automatically.** Draft only. Set `workflow.safe_to_auto_reply=false` unless an approved auto-reply policy is in scope.
3. **Never print secrets.** Mailbox credentials, payment-provider keys, and API tokens must stay in env/config/keychain, not chat or public docs.
4. **Keep raw customer content private.** Raw email bodies belong in the mailbox or local runtime state, not in public skills, shared profile-distribution docs, or curated KB pages.
5. **Prefer payment/order systems for purchase and country truth.** Use verified checkout/order data before inferring from email text.
6. **Escalate sensitive cases.** Refunds, chargebacks, medical/health claims, legal/privacy/payment/security issues, angry customers, and ambiguous cases require human review.
7. **Keep distribution content generic.** Do not include company names, personal names, mailbox addresses, customer data, account IDs, order IDs, absolute home paths, or profile names in this skill.

## Runtime state

Use a local state directory outside the curated repo/KB for dedupe and raw-ish processing artifacts:

```text
${CUSTOMER_EMAIL_STATE_DIR:-$HERMES_HOME/customer-email}/
  pending_batch.json       # latest candidate batch
  processed_ledger.json    # processed fingerprints
  events.jsonl             # one structured analysis record per processed email
```

If the active project already has a collector script, prefer its documented state path. If not, create a small script with explicit read-only mailbox operations and idempotent record append behavior.

## Candidate collection pattern

1. List recent messages/envelopes with the configured mailbox CLI/API.
2. Exclude known automated senders/domains: payment notifications, no-reply senders, provider notifications, newsletters, app/billing alerts.
3. Include likely customer signals: replies, questions, support/order/shipping/refund/return/product terms.
4. Compute a stable local fingerprint from folder/mailbox ID/date/sender/subject.
5. Skip fingerprints already in `processed_ledger.json`.
6. Read message bodies only for unprocessed candidates.
7. Emit `pending_batch.json` for agent analysis.

For Himalaya-backed IMAP, read-only commands look like:

```bash
himalaya -o json envelope list --account <account> --folder INBOX --page-size 50 order by date desc
himalaya message read --account <account> <id>
```

Do not use mailbox IDs alone as durable identifiers; they can be mailbox-relative and shift after mailbox changes.

## Purchase verification

When a payment provider is configured, enrich candidates using read-only lookup before analysis. For Stripe storefronts, use the `stripe` skill's Checkout Session purchase-verification pattern:

- match sender email against checkout/customer email
- set verified purchase only for paid and complete sessions/orders
- prefer verified checkout/order country for analytics
- preserve only minimal audit fields in the JSONL record

If verification is unavailable or inconclusive, proceed with `verified_purchase=false`/`unknown`, not a guess.

## Analysis schema

Append one denormalized JSON object per processed candidate. Keep fields simple for SQL/pandas/group-by analysis:

```json
{
  "schema_version": 1,
  "message": {
    "fingerprint": "...",
    "source": "mailbox-cli-or-api",
    "folder": "INBOX",
    "mailbox_id": "...",
    "date": "2026-01-01T12:00:00Z",
    "subject": "...",
    "from_email": "customer@example.invalid",
    "from_name": null,
    "to_email": "support@example.invalid",
    "has_attachment": false
  },
  "customer": {
    "email": "customer@example.invalid",
    "name": null,
    "country": "unknown",
    "country_source": "unknown",
    "order_id": null,
    "payment_id": null
  },
  "analysis": {
    "category": "support_request",
    "priority": "normal",
    "sentiment": "neutral",
    "is_negative": false,
    "summary": "Short operator-safe summary.",
    "customer_quotes": [],
    "use_cases": [],
    "product_signals": [],
    "instruction_gaps": [],
    "objections": [],
    "requested_features": [],
    "marketing_permission_candidate": false
  },
  "workflow": {
    "needs_reply": true,
    "needs_human_review": true,
    "escalation_reason": "Human should approve support reply.",
    "safe_to_auto_reply": false,
    "draft_reply": "...",
    "processed_at": "2026-01-01T12:05:00Z"
  },
  "purchase": {
    "provider": null,
    "verified_purchase": false,
    "country": null,
    "amount_total": null,
    "currency": null
  }
}
```

## Stable enums

Categories:

- `customer_feedback`
- `support_request`
- `shipping_order_issue`
- `refund_or_charge_issue`
- `medical_or_health_claim`
- `business_partnership`
- `spam_or_auto`
- `unknown`

Sentiment:

- `positive`
- `neutral`
- `negative`
- `mixed`
- `unknown`

Country source:

- `checkout_session`
- `order`
- `shipping_address`
- `email_text`
- `email_tld`
- `unknown`

Prefer `unknown` over overconfident inference.

## Processing procedure

1. Run the collector or read the cron pre-run output path.
2. Read `pending_batch.json` from the state directory.
3. If there are no candidates, stay silent unless asked for a status update.
4. For each candidate, start from its empty/default analysis record.
5. Preserve purchase/payment-provider context from the collector.
6. Fill analysis and workflow fields.
7. Set `workflow.safe_to_auto_reply=false`.
8. Append completed records through the collector's record/idempotency path, not by hand-editing JSONL when a script exists.
9. Notify the operator only for actionable customer/support items.

## Digest format

Use concise Markdown and avoid unnecessary personal data:

```markdown
## Customer email digest

| From | Verified | Country | Category | Sentiment | Human review | Summary |
|---|---:|---:|---|---|---:|---|
| redacted@example.invalid | ✅ | US | support_request | neutral | ✅ | Needs a shipping-status reply. |

**Draft reply**
> Hi ...
```

Do not include large raw email bodies, full addresses, full names, order IDs, payment IDs, or secrets in chat unless the operator explicitly asks and the channel is appropriate.

## Analytics recipe

Negative customer-feedback rate by country:

```python
import json
from collections import defaultdict
from pathlib import Path

state_dir = Path(os.environ.get("CUSTOMER_EMAIL_STATE_DIR", Path.home() / ".hermes" / "customer-email"))
rows = [json.loads(line) for line in (state_dir / "events.jsonl").open() if line.strip()]
by_country = defaultdict(lambda: [0, 0])
for row in rows:
    if row.get("analysis", {}).get("category") != "customer_feedback":
        continue
    country = row.get("customer", {}).get("country") or "unknown"
    by_country[country][1] += 1
    if row.get("analysis", {}).get("is_negative") is True:
        by_country[country][0] += 1

for country, (negative, total) in sorted(by_country.items()):
    print(country, negative, total, negative / total if total else 0)
```

## Cron job shape

A recurring processor should look like:

```text
Name: Customer email sorter
Schedule: every 15m
Workdir: active project repository
Script: collector script that prints pending_batch.json path
Skills: customer-email-sorter,stripe
Toolsets: terminal,file
```

Prompt pattern:

- read the `pending_batch.json` path printed by the script
- if candidate count is zero, produce an empty final response
- fill one analysis record per candidate
- append records and update only local ledger/events files
- never mutate the mailbox
- never send replies
- notify only for actionable items

## Verification checklist

- [ ] Collector/listing uses read-only mailbox operations only.
- [ ] Collector does not print mailbox/payment secrets.
- [ ] Candidate filtering excludes automated/no-reply/payment notification senders.
- [ ] Purchase verification is read-only and uses verified paid/complete order or checkout status.
- [ ] Processed records are appended once only by fingerprint.
- [ ] Cron job has this skill attached.
- [ ] No raw customer bodies, full addresses, customer names, order IDs, payment IDs, or secrets are copied into public docs or reusable skills.
