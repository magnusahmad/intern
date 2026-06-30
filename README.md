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

**Your knowledge base is created in the directory you run `hermes` from.** So `cd` into the
folder you want your company brain to live in, then launch:

```bash
cd ~/my-company    # the folder where you want the KB to live
hermes
```

Onboarding fires automatically — there's no magic phrase to type, no path to configure. A guard
in `SOUL.md` detects that setup isn't finished and starts the `onboarding` skill, which creates
the KB right there and remembers the location for next time.

## What happens on first run

The intern walks you through setup at the Terminal, then hands you off to Telegram:

| Phase | What the intern does |
|---|---|
| **1 · Trigger** | Detects first run, creates the KB + its state file in your working directory, greets you in plain language |
| **2 · Tools** | Checks `gh` (and, on demand later, `stripe`/`wrangler`) — gives you copy-paste install lines for anything missing |
| **3 · Your company** | Asks for your website URL (and optional repo), scans both **in the background**, then fingerprints which services you actually use |
| **4 · Connect** | Shows what it detected (e.g. Stripe, Cloudflare), confirms with you, and connects **only those** — read-only, secrets entered locally and never echoed. No Stripe? It won't ask for one |
| **5 · Knowledge base** | Builds the KB and synthesizes a company profile from website + repo + your confirmed providers, flagging anything that conflicts |
| **6 · Telegram** | BotFather → token (local) → **locks the bot to your user ID** → restarts the gateway → sends a test message |
| **7 · Done** | Verifies everything, writes a decision record, and teaches your first Telegram commands |

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
| **onboarding** | First-run business setup — drives Phases 1–7 above; resumable via a state file | ✅ Available |
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
