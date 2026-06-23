# Read-only customer email pipeline with Himalaya

Use this when a mailbox should be processed for customer feedback/support signals via Himalaya while preserving the mailbox exactly as-is.

## Core rule

Do **not** move, delete, flag, archive, or send emails from the processing job unless the operator explicitly asks for that capability. Use Himalaya read operations only:

```bash
himalaya -o json envelope list --account <account> --folder INBOX --page-size 50 order by date desc
himalaya message read --account <account> <id>
```

Maintain a local ledger outside the curated repo/KB for dedupe and raw customer data. For Hermes profiles, a portable default is:

```text
${CUSTOMER_EMAIL_STATE_DIR:-$HERMES_HOME/customer-email}/
  pending_batch.json
  processed_ledger.json
  events.jsonl
```

## Candidate collection pattern

1. List recent envelopes as JSON.
2. Exclude automated senders/domains: payment notifications, no-reply senders, provider notifications, newsletters, app/billing alerts.
3. Include customer-like signals: replies, questions, support/order/shipping/refund/return/product terms.
4. Compute a stable-ish local fingerprint from folder, mailbox ID, date, sender, and subject.
5. Skip fingerprints already in `processed_ledger.json`.
6. Read the message body only for unprocessed candidates.
7. Emit `pending_batch.json` for the agent to analyze.

Do not use Himalaya IDs alone as durable identifiers; they are mailbox-relative and may shift after mailbox changes.

## Reply and safety policy

Default to draft-only:

- never send email from the scheduled processor
- set `workflow.safe_to_auto_reply=false` unless the operator has approved an auto-reply policy
- require human review for refunds, chargebacks, medical/health claims, legal/privacy/payment/security issues, angry customers, address changes, shipping/order handling, and ambiguous cases

## Idempotency pitfall

The record-append step should be idempotent by fingerprint: if a fingerprint is already in the ledger, do **not** append another JSONL row. This matters when cron jobs are retried or manually run.
