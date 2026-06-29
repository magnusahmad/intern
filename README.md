# AO1 Intern

A **first-run business-setup agent** that lives on your machine and then runs your business
from Telegram. Install it as a **Hermes profile distribution** and, on first run, the intern
onboards your whole company for you — checks your tools, reads your website and repo, connects
Stripe and Cloudflare, sets up Telegram, and builds your knowledge base as the company brain.

The design goal: **a non-coder who can open Terminal and paste a line or two should succeed.**

---

## Getting started (the one manual part)

These are the only hand-done steps. After this, the intern does the rest.

```bash
hermes profile install https://github.com/magnusahmad/ao1-intern
hermes profile use ao1-intern
hermes setup model     # pick your model/provider and enter its key (skip if already set)
hermes
```

`hermes setup model` lets you choose whatever model/provider you like and stores the key in
`~/.hermes/.env` — if you've used Hermes before, that key is already there and you can skip it.
You do **not** need to create a `.env` by hand: the intern writes the per-profile secrets
(Stripe, Telegram, etc.) into the profile's own `.env` for you during onboarding.

On first `hermes`, onboarding fires automatically — there's no magic phrase to type. A guard in
`SOUL.md` detects that setup isn't finished and starts the `onboarding` skill.

## What happens on first run

The intern walks you through setup at the Terminal, then hands you off to Telegram:

| Phase | What the intern does |
|---|---|
| **1 · Trigger** | Detects first run, creates `$AO1_KB_PATH/.onboarding-state.json`, greets you in plain language |
| **2 · Tools** | Checks `stripe`, `wrangler`, `gh` — gives you copy-paste install lines for anything missing |
| **3 · Your company** | Asks for your website URL (and optional repo), then scans both **in the background** while setup continues |
| **4 · Stripe** | You paste your key locally (never echoed); read-only probe pulls your catalog into the KB |
| **5 · Cloudflare** | `wrangler login`, detect your deploy target, record it — **no deploys** during setup |
| **6 · Knowledge base** | Builds the KB and synthesizes a company profile from website + repo + Stripe, flagging anything that conflicts |
| **7 · Telegram** | BotFather → token (local) → **locks the bot to your user ID** → restarts the gateway → sends a test message |
| **8 · Done** | Verifies everything, writes a decision record, and teaches your first Telegram commands |

Setup runs at the **local Terminal** (it involves passwords and browser logins). Day-to-day
runs on **Telegram** — secrets and interactive auth never travel through Telegram.

It's safe to close the terminal mid-flow: onboarding is **resumable and idempotent**. Re-run
`hermes` (or say "finish onboarding") and it picks up from the last incomplete step.

## The KB Is the Company Brain

The agent is backed by the **AO1 KB** (`$AO1_KB_PATH`) — your company's personal wiki and single
source of truth. Onboarding bootstraps it: company profile, branding, legal entity, product
catalogue and real prices (from Stripe), hosting, and decisions. After that the intern **reads**
it for context before any task and **writes** durable new facts back so it stays current. Every
skill draws on it — billing uses the price list, the meeting copilot uses company strategy, email
triage uses customer context.

## Skills

| Skill | Description | Status |
|-------|-------------|--------|
| **onboarding** | First-run business setup — drives Phases 1–8 above; resumable via a state file | ✅ Available |
| **stripe** | Stripe billing/storefront operations and purchase verification for support workflows | ✅ Available |
| **google-meet** | Live meeting copilot — join/observe a Meet, transcribe captions, optionally speak, follow up | ✅ Available |
| **customer-email-sorter** | Triage customer/support email with read-only mailbox handling and draft-only replies (not wired by v1 onboarding) | ✅ Available |

## Roadmap

- **Capture → KB cron scripts** — scheduled jobs that pull messages (chat, email, meeting notes)
  into raw captures and summarize them into curated KB entries. *(to be built)*
- **v2 onboarding** — optional email/Meet/customer-triage setup, and multi-provider choice for
  model/hosting/payments. v1 deliberately locks these to keep first-run bulletproof.

## Reference

- First-run onboarding flow: [specs/03-onboarding-flow.md](specs/03-onboarding-flow.md).
- OS-level sandboxing, audit, and rollback for autonomous agent runs is sketched as a
  future/reference design in [specs/02-dynamic-openshell-policy.md](specs/02-dynamic-openshell-policy.md).
  It is not part of the distribution today.
