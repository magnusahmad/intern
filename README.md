# AO1 Intern

A helpful intern that lives on your machine and does real work for you — joining meetings,
handling billing and customer email, and keeping your company knowledge current. Installed as a
**Hermes profile distribution**, so one command gives you the whole agent:

```bash
hermes profile install https://github.com/magnusahmad/ao1-intern
```

Then copy `.env.example` to `.env` and fill in your keys. Run `hermes` or address the agent via
Telegram/Discord.

---

## What You Get

The distribution ships a personality (`SOUL.md`), base config (`config.yaml`), and a set of
**workflow skills** under `skills/`:

| Skill | Description | Status |
|-------|-------------|--------|
| **google-meet** | Live meeting copilot — join/observe a Meet, transcribe captions, optionally speak, follow up after | ✅ Available |
| **stripe** | Stripe billing/storefront operations and purchase verification for support workflows | ✅ Available |
| **customer-email-sorter** | Triage customer/support/feedback email with read-only mailbox handling, local ledgers, and draft-only replies | ✅ Available |
| **kb-syncing** | Pull new information into the KB and keep it current | 🔜 Coming soon |

## The KB Is the Company Brain

The agent is backed by the **AO1 KB** (`$AO1_KB_PATH`) — your company's personal wiki and single
source of truth. It holds company context, strategy, pricing and product catalogue, people,
customers, decisions, and the running log of company history and lore.

The intern uses the KB two ways: it **reads** it for context before doing a task, and it **writes**
durable new facts back so the knowledge stays current. Skills can draw on it — billing can use the
price list, the meeting copilot can use company strategy, and email triage can use customer context.

## Roadmap

- **Capture → KB cron scripts** — scheduled jobs that pull messages (chat, email, meeting notes)
  into raw captures and summarize them into curated KB entries. *(to be built)*
- **Onboarding portal** — lets you select the services you actually use, honing the agent's
  profile and skillset down to just what's relevant to you. *(to be built)*
- **More workflow skills** — KB syncing and additional company operations workflows.

## Reference

OS-level sandboxing, audit, and rollback for autonomous agent runs is sketched as a future/
reference design in [specs/02-dynamic-openshell-policy.md](specs/02-dynamic-openshell-policy.md).
It is not part of the distribution today.
