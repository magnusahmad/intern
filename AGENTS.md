# AGENTS.md — Guidance for Agents Working in `intern`

This repo is the **Intern profile distribution** — a shareable Hermes agent packaged as a
git repository. Consumers install it with:

```bash
hermes profile install https://github.com/magnusahmad/intern
```

The distribution root (`./`) is the Hermes profile root. These files are the distribution
contract:

| File | Purpose |
|------|---------|
| `distribution.yaml` | Manifest: name, version, required env vars |
| `SOUL.md` | Agent personality and operating principles |
| `config.yaml` | Base config (model, toolsets, gateway) |
| `skills/` | Bundled workflow skills (e.g. `google-meet` live copilot) |
| `cron/` | Scheduled job definitions |
| `mcp.json` | MCP server connections |
| `.env.example` | Required env vars template |

---

## What the intern is for

Intern is a helpful intern that lives on the human's machine and does real work for them:
running workflows like the live meeting copilot, billing, and customer-email triage, and keeping
the company's knowledge base current. It is a workflow runner, not a planner or a delegation
gateway. The substance lives in two places: the **skills** (what it can do) and the **KB** (what
it knows).

## The KB is the company brain

The Intern KB at `$INTERN_KB_PATH` is the company's personal wiki and the agent's single source of
truth — company context, strategy, pricing and product catalogue, people, customers, decisions,
and the running log of company history and lore. Habits for any agent running inside this profile:

- **Read the KB for context before acting.** Pull the relevant page(s) for the task at hand.
  Skills depend on this — billing reads the price list and catalogue, the meeting copilot reads
  company strategy, email triage reads who customers are.
- **Write durable facts back.** When you learn something lasting (a decision, a number, a
  customer fact, lore), file a concise entry so future tasks and other skills have it.
- **Keep the KB the source of truth.** Prefer concise, well-placed entries over copying large
  blobs into your work or dumping raw material onto the curated surface. Point skills at the KB
  for the context they need rather than hardcoding it.

---

## For agents working on this distribution itself

- Edit `SOUL.md` to update personality or operating principles.
- Edit `distribution.yaml` to update version or required env vars.
- Edit `config.yaml` to update base model or tool defaults — prefer keeping it generic so
  consumers can override.
- Skills live in `skills/` — each skill is a subdirectory with a `SKILL.md`. New workflows
  (stripe billing, customer-email sorter, KB syncing) are added here.
- Cron jobs live in `cron/` — add `.cron` files there.
- Test changes by importing into a fresh profile: `hermes profile install <local-path> --name test-import`
