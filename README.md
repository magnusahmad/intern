# Intern

**Intern is a self-onboarding teammate that helps you run your business.** You install it once at
your Terminal and it sets *itself* up — researching your company, connecting to the tools you
already use, building a knowledge base it maintains on its own, and wiring up a secure messaging
interface. By the time it sends you its first hello on Telegram, it already knows your business
and is ready to start doing real work in it.

It ships as a **Hermes profile distribution**. The design goal is simple: **a non-coder who can
open Terminal and paste a line or two should succeed — and never has to leave that first Terminal
window to finish onboarding.** Every script and skill it needs comes pre-packaged.

---

## Getting started (the one manual part)

These are the only hand-done steps. After this, Intern does the rest.

```bash
hermes profile install https://github.com/magnusahmad/intern
hermes profile use intern
hermes setup model     # pick your model/provider and enter its key (skip if already set)
cd ~/my-company        # the folder where you want the knowledge base to live
hermes
```

`hermes setup model` lets you choose whatever model/provider you like and stores the key in
`~/.hermes/.env` — if you've used Hermes before, that key is already there and you can skip it.
You do **not** need to create a `.env` by hand: Intern writes its per-profile secrets into the
profile's own `.env` for you during onboarding, locally and without echoing them back.

**The knowledge base is created in the directory you run `hermes` from**, so `cd` into the folder
you want your company brain to live in before launching. Onboarding then fires automatically —
there's no magic phrase to type and no path to configure. A guard in `SOUL.md` detects that setup
isn't finished, starts the `onboarding` skill, creates the KB right there, and remembers the
location for next time.

## How Intern onboards itself

Everything below happens in that one Terminal window — no second tool, no dashboard, no pasting
secrets into a browser. Then it hands you off to Telegram.

1. **It researches your business.** You point it at your website, your code repo, and any company
   documents; it reads all of them (the heavy scans run in the background) to learn what you sell,
   your brand and legal entity, and how your site is built.
2. **It figures out your tools and connects to them.** From that research it fingerprints which
   services you actually use — payments, hosting, ecommerce — and authenticates itself to **only
   those**. It never asks for a credential to a tool you don't use, and secrets are entered
   locally and never echoed back.
3. **It builds a self-maintaining knowledge base.** It synthesizes everything into a company
   "brain" it keeps current — reading it for context before every task and writing new facts back
   after. This is what lets it act on your behalf with the right context every time.
4. **It sets up your messaging interface, securely.** It creates your Telegram bot, locks it to
   your account, and brings the gateway online so you can run the business from your phone. Secrets
   and interactive logins never travel over Telegram.
5. **It says hello — and it's ready to work.** The first message it sends you on Telegram isn't a
   "setup complete" notice; it's a teammate that already understands your business and can start
   doing things in it.

The detailed flow, all at the local Terminal:

| Phase | What Intern does |
|---|---|
| **1 · Trigger** | Detects first run, creates the KB + its state file in your working directory, greets you in plain language |
| **2 · Tools** | Checks `gh` (and, on demand later, `stripe`/`wrangler`) — gives you copy-paste install lines for anything missing |
| **3 · Research** | Takes your website URL, optional repo, and company documents; scans them **in the background**, then fingerprints which services you actually use |
| **4 · Connect** | Shows what it detected (e.g. Stripe, Cloudflare), confirms with you, and authenticates to **only those** — read-only, secrets entered locally and never echoed. No payments provider? It won't invent one |
| **5 · Knowledge base** | Builds the self-maintaining KB and synthesizes a company profile from website + repo + your confirmed providers, flagging anything that conflicts |
| **6 · Messaging** | BotFather → token (local) → **locks the bot to your account** → restarts the gateway → sends a test message |
| **7 · Ready** | Verifies everything, writes a decision record, and teaches your first Telegram commands |

Setup runs at the **local Terminal** because it involves passwords and browser logins; day-to-day
runs on **Telegram**. It's safe to close the terminal mid-flow: onboarding is **resumable and
idempotent** — re-run `hermes` (or say "finish onboarding") and it picks up from the last
incomplete step.

## The knowledge base is the company brain

Intern is backed by a knowledge base (`$INTERN_KB_PATH`) — your company's personal wiki and single
source of truth. Onboarding bootstraps it: company profile, branding, legal entity, product
catalogue and real prices (from your connected provider), hosting, and decisions. After that
Intern **reads** it for context before any task and **writes** durable new facts back so it stays
current on its own — the `kb` skill is self-invoked whenever Intern learns or corrects something
about the business (a standing mandate in `SOUL.md`), with a daily cron backstop catching anything
missed. Every skill draws on it — billing uses the price list, the meeting copilot uses company
strategy, email triage uses customer context.

## Skills

| Skill | Description | Status |
|-------|-------------|--------|
| **onboarding** | First-run business setup — drives Phases 1–7 above; resumable via a state file | ✅ Available |
| **kb** | Read, capture, and maintain the company brain — self-invoked whenever Intern learns a durable fact; orients before writing so it never duplicates | ✅ Available |
| **stripe** | Stripe billing/storefront operations and purchase verification for support workflows | ✅ Available |
| **google-meet** | Live meeting copilot — join/observe a Meet, transcribe captions, optionally speak, follow up | ✅ Available |
| **customer-email-sorter** | Triage customer/support email with read-only mailbox handling and draft-only replies (not wired by v1 onboarding) | ✅ Available |

## Roadmap

- **Source-specific capture jobs** — real-time capture (the `kb` skill) and the daily backstop
  sweep are in place; next is per-source ingestion (chat, email, meeting notes) into `raw/` for
  the `kb` skill to curate.
- **More connectors** — the onboarding connector registry already detects Shopify, WooCommerce,
  Paddle, Vercel, Netlify and more; wiring their credential recipes promotes them from detected to
  fully connected.
- **v2 onboarding** — optional email/Meet/customer-triage setup, and multi-provider choice for
  model/hosting/payments. v1 deliberately keeps the core path bulletproof.

## Reference

- First-run onboarding flow: [specs/03-onboarding-flow.md](specs/03-onboarding-flow.md).
- OS-level sandboxing, audit, and rollback for autonomous agent runs is sketched as a
  future/reference design in [specs/02-dynamic-openshell-policy.md](specs/02-dynamic-openshell-policy.md).
  It is not part of the distribution today.
