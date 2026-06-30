---
name: onboarding
description: First-run business setup for the ao1-intern profile. Drives a non-technical owner from a fresh install to "I run my business through Telegram" — probing tooling, wiring Stripe/Cloudflare/Telegram credentials locally, scanning the company website and repo in the background, and bootstrapping the KB as the company brain. Resumable and idempotent via a single state file.
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [macos]
prerequisites:
  # AO1_KB_PATH is intentionally NOT listed: when unset the skill resolves the KB to the
  # current working directory and persists it (Phase 1), so Hermes must not prompt for it.
  commands: [stripe, wrangler, gh]
metadata:
  hermes:
    tags: [onboarding, setup, first-run, kb, stripe, cloudflare, telegram]
    spec: specs/03-onboarding-flow.md
---

# Onboarding — First-Run Business Setup

This skill turns a fresh `ao1-intern` install into a working business-ops agent. It owns
Phases 1–8 of the onboarding flow (spec `specs/03-onboarding-flow.md`). The single design
goal: **a non-coder who can open Terminal and paste a line or two should succeed.** Do as
much as possible yourself; ask the human only for things only they can do (browser logins,
secrets, business facts).

## When to use

Load this skill when **any** of these is true:

- `$AO1_KB_PATH/.onboarding-state.json` is missing or its `status` is not `complete`
  (the SOUL.md first-run guard sends you here automatically — this is the normal trigger).
- The user says "finish onboarding", "set up my business", "redo setup", or similar.

If the state file exists and is `complete`, do **not** re-run onboarding. Operate normally
from the KB instead.

## Golden rules (read before every phase)

1. **Idempotent + resumable.** `$AO1_KB_PATH/.onboarding-state.json` (§schema below) is the
   single source of truth. Before any phase, read it and **skip steps already `done`**. After
   any phase, write completion back and bump `updated_at`. The user *will* close the terminal
   mid-flow and Hermes gateway restarts wipe conversation context — the state file is what
   lets you resume from the last incomplete step.
2. **Never print a secret. Never accept a secret over Telegram.** Secrets are entered only at
   the local Terminal and written straight into `.env` without echoing them back. If the
   active channel is Telegram, refuse secret entry and tell the user to finish setup at the
   local Terminal. (Telegram retains chat history on its servers.)
3. **Never overwrite an existing KB page.** Create structure only if absent. Merge, don't
   clobber — especially user-confirmed corrections.
4. **Read-only on everything during onboarding.** No live Stripe writes, no Cloudflare
   deploys, no writes to the company repo, no `git push`. Auth + record only.
5. **Don't block on background scans.** Website/repo scans run as background subagents. If a
   scan isn't done at reconcile time, record a `todo` and finish onboarding anyway.
6. **Don't silent-install.** Offer copy-paste `!brew install …` commands the user runs
   in-session; never install tooling yourself.

---

## Phase 1 — First-run trigger & greeting

1. **Resolve the KB location with zero manual setup:**
   - If `AO1_KB_PATH` is set and non-empty, use it.
   - Otherwise default to the **current working directory** — the directory the user launched
     `hermes` from (`pwd`). This is deliberate: the KB lives right next to the project the
     owner is working in, so they never have to configure a path by hand.
   - Create the directory + structure if absent (the state file lives inside it).
   - **Persist the resolved absolute path** into the profile's `.env` as `AO1_KB_PATH` (append
     it if missing; never echo other secrets while doing so). This makes every later run and
     the SOUL.md first-run guard resolve to the same KB without any manual step, and keeps this
     profile's KB from colliding with any other profile's.
2. Read `$AO1_KB_PATH/.onboarding-state.json`. If absent, create it with `status:
   "in_progress"`, `started_at` = now, `machine: "macos"`, `model_provider` = whatever the
   user configured (default `openrouter`), and all steps `done: false` (use the schema below).
3. Greet the user in plain, non-technical language. Explain in 3–4 sentences what you're about
   to do: check their tools, read their website and repo, connect Stripe and Cloudflare, and
   set up Telegram so they can run the business from their phone. Tell them setup happens here
   at the Terminal because it involves passwords, and that day-to-day will happen on Telegram.

If resuming (`status: in_progress` with some steps done), say so briefly and jump to the first
incomplete step instead of re-greeting from scratch.

## Phase 2 — Environment probe

Homebrew is assumed present. Verify the three CLIs v1 needs. Run the checks, then print a
present/missing table. Do **not** silent-install — for anything missing, give the user a
copy-paste line and ask them to run it (prefix `!` so output lands in-session).

| Tool | Check | Needed for | Install if missing |
|---|---|---|---|
| `stripe` | `stripe --version` | billing probes | `!brew install stripe/stripe-cli/stripe` |
| `wrangler` | `wrangler --version` | Cloudflare | `!brew install cloudflare-wrangler2` (or `npm i -g wrangler`) |
| `gh` | `gh auth status` | repo access over HTTPS | `!brew install gh` then `gh auth login` |

Notes:
- **Model provider** is the user's choice (configured in `.env` / `config.yaml`; Hermes prompts
  for the key on first run). You don't probe a CLI for it — you're already running on it. Just
  confirm the agent can complete a model turn (it can if it's responding).
- `gh` over HTTPS only. This machine's SSH-to-GitHub is unreliable; never rely on
  `git push`/SSH (see Safety).

Mark `env_probe.done: true` with a `notes` summary (e.g. `"stripe+wrangler+gh present"`) only
when every required CLI is present. If something's missing, leave it not-done and wait for the
user.

## Phase 3 — Company inputs + launch background scans

Ask, in plain language, for:

1. **Company website URL** (required).
2. **Company repo directory** (optional). If given, verify it's a git repo
   (`git -C <path> rev-parse --is-inside-work-tree`); record the path either way.
3. Any extra docs or URLs they want you to read (optional).

Write these into `inputs` in the state file. Then **immediately spawn two background
subagents** — one for the website, one for the repo (skip the repo one if no repo was given) —
using the prompts in `references/website-scan-subagent.md` and
`references/repo-scan-subagent.md`. These are read-only extraction agents that write their
findings to files under `raw/onboarding/` and touch a `.done` marker when finished.

Set `website_scan.background: true` / `repo_scan.background: true` with their `result_path`s.
Then tell the user: *"I'm reading your website and repo in the background while we keep setting
things up,"* and continue immediately to Phase 4. **Do not wait for the scans.**

Delegation is enabled in `config.yaml` (`orchestrator_enabled: true`,
`max_concurrent_children: 3`, `child_timeout_seconds: 600`, child toolsets
`[terminal, file, web]`). The file + `.done`-marker handoff means partial work survives even
if a child times out or the gateway restarts.

## Phase 4 — Stripe (read-only)

1. **No-echo secret entry.** Ask the user to paste their `STRIPE_SECRET_KEY`. Recommend a
   restricted/read-only key for setup. Write it straight into `.env` — do not print it back,
   do not include it in any summary. (If on Telegram: refuse, per golden rule 2.)
2. **Read-only probes** using the `stripe` skill patterns (`-u "$STRIPE_SECRET_KEY:"`):
   products, prices, payment links, and recent checkout sessions.
3. **Record live-vs-test mode** from `livemode` in the responses.
4. **Write KB pages** (concise, curated): `operations/stripe.md` (account mode, how billing is
   wired), `products/catalog.md` (products/prices/links as ground truth), `company/payments.md`
   (checkout mechanism, currencies). Never paste live object IDs, customer emails, or payment
   IDs into anything that could be shared publicly — KB only.
5. Mark `stripe.done: true`.

Onboarding is **read-only on Stripe.** No creating/updating/deactivating objects.

## Phase 5 — Cloudflare (auth + record only)

1. **Authenticate:** `wrangler login` (interactive browser, local) — or, if the user prefers
   non-interactive, have them put `CLOUDFLARE_API_TOKEN` in `.env` (no echo) and use that.
2. **Detect the deploy target:** prefer a `wrangler.toml`/`wrangler.jsonc` found by the repo
   scan. Otherwise list Pages projects / Workers (`wrangler pages project list`,
   `wrangler deployments list`) and ask the user which one is their site.
3. **Record** deploy method + project name in `operations/hosting.md`, plus the relationship
   between the site and its Stripe links (so the `stripe` skill knows what to update when a
   Payment Link changes).
4. **Do not deploy anything.** Auth + record only.
5. Mark `cloudflare.done: true`.

## Phase 6 — KB bootstrap + reconcile scans

1. **Create the KB structure** (§KB structure below) **only if absent.** Never overwrite an
   existing page.
2. **Reconcile the background scans.** Check for the `.done` markers
   (`raw/onboarding/website-scan.done`, `raw/onboarding/repo-scan.done`). Poll briefly (a few
   short checks, not an indefinite wait). For each scan that's done, read its
   `*-scan.md` + `*-signals.json`. For any scan still running or timed out, append a
   `todo` ("re-run website scan", etc.) and **proceed anyway** — never block completion on a
   scan.
3. **Synthesize the company profile.** Triangulate the three sources (website signals, repo
   signals, Stripe ground truth) into `company/company-profile.json` and the curated pages.
   Apply this precedence — don't let the loudest source win:

   | Facet | Authoritative source | Others used for |
   |---|---|---|
   | What's actually sold + real prices | **Stripe** | website = marketing, repo = wiring |
   | Business-model classification | **all three combined** | — |
   | Branding / positioning / tone | **website** | repo theme = colors/fonts |
   | Legal / registration / entity | **website footer + Terms/Privacy** | repo rarely has this |
   | Stack / deploy / Stripe wiring / ID locations | **repo** | website = observed checkout |

4. **Surface conflicts — don't silently resolve.** When sources disagree on a material fact
   (classic: website says `$29/mo` but the active Stripe price is `$39/mo`; or brand name ≠
   Stripe account/legal entity), record both, set `needs_confirmation: true` on the field, add
   it to `open_questions`, and **ask the user**. Stale website pricing vs live Stripe is the
   single most common real-world mismatch — surfacing it is a feature.
5. **Re-runnable synthesis.** Re-running overwrites `company-profile.json` from current signals
   + Stripe, but **merges back** (never destroys) user-confirmed corrections.
6. Write curated pages: `company/profile.md`, `company/website.md`, `company/payments.md`,
   `products/catalog.md`, `operations/*.md`. Raw material stays under `raw/onboarding/`.
   **Link related pages with Obsidian-style `[[wikilinks]]`** (e.g. `profile.md` links to
   `[[catalog]]`, `[[payments]]`, `[[hosting]]`; a decision links to what it touches). These
   links are what make the KB a navigable graph — both in Obsidian and in the visual below —
   so don't skip them. Use the page's filename without extension as the link target.
7. **Generate the visual KB graph.** Run the bundled generator (it ships in this skill at
   `scripts/build_kb_graph.py`) against the KB, then open the result so the user sees it:

   ```bash
   python3 <this-skill-dir>/scripts/build_kb_graph.py "$AO1_KB_PATH"
   open "$AO1_KB_PATH/kb-graph.html"
   ```

   It writes `kb-graph.html` — a self-contained, Obsidian-style force-directed graph (nodes
   colored by folder, drag/zoom/hover) that opens in any browser; no Obsidian needed. It's
   deterministic and re-runnable, so regenerate it whenever the KB changes (later you can run
   it on request, e.g. "show me my knowledge base"). The KB folder also opens directly as an
   Obsidian vault for anyone who has Obsidian, since the pages use `[[wikilinks]]`.
8. **Show the user what you built — don't just print a status checklist.** Give a short,
   friendly summary of the knowledge base, in plain language:
   - **Where it lives** — the KB path (e.g. `~/my-company`).
   - **Its layout** — walk the main folders and what each holds, briefly. For example:
     > Here's your company brain so far:
     > - `company/` — who BlueBalls is: profile, brand, and your legal entity (Ahmad Company Limited, Hong Kong)
     > - `products/` — your catalog and real prices ($49.99 Sauna Wear, sold via Stripe Payment Link)
     > - `operations/` — how billing and hosting are wired (Stripe, Cloudflare)
     > - `decisions/` — a log of choices we make together
     > - `raw/` — the raw scan material I summarized this from
   - **2–4 headline facts** you learned about the company (model, top product + price, brand,
     legal entity) so they can sanity-check the synthesis at a glance.
   - **Anything in `open_questions`** that still needs their confirmation.
   - **Point them at the graph** you just opened (`kb-graph.html`) as a visual map of how it all
     connects, and mention they can open the folder in Obsidian too if they use it.
   - **That it grows over time.** Say plainly that this is a starting point and you'll keep
     adding to and refining `{company}`'s brain as you learn more — every task you run teaches
     it something, and you maintain it so it stays the source of truth. Use the company's
     actual name, not a placeholder.

   Keep it tight — a handful of lines, not a wall of text.
9. Mark `kb.done: true`.

See `references/business-profile.md` for the company-profile schema and the business-model
classification signals.

## Phase 7 — Telegram activation (the handoff)

1. **Create the bot:** walk the user through @BotFather (`/newbot`, pick a name + username).
   Have them paste the **bot token locally** into `.env` as `TELEGRAM_BOT_TOKEN` — no echo.
2. **Get the user's Telegram user ID** (e.g., message @userinfobot).
3. **Mandatorily lock the bot** by setting `TELEGRAM_ALLOWED_USER_IDS` to that single ID in
   `.env`. An unlocked business-ops bot is a security hole — this is not optional.
4. **Restart the gateway:** `hermes gateway restart`. The gateway cannot restart itself, so
   tell the user this is required for the bot to come online; run it (or have them run it).
5. **Send a test message** to the user via the bot and confirm they received it.
6. Mark `telegram.done: true`.

Remind the user: secrets and customer data should not be discussed over Telegram if avoidable;
surface the `privacy.redact_pii: false` tradeoff (customer data may pass through Telegram in
plaintext) as a conscious choice they're accepting.

## Phase 8 — Acceptance check + handoff

Verify the **definition of done** (all must pass):

- [ ] Model provider configured; the agent can run a model turn.
- [ ] `$AO1_KB_PATH` exists with the structure below and at least the curated company pages.
- [ ] Stripe read-only probe returned the catalog into the KB.
- [ ] Cloudflare authenticated; deploy target recorded in `operations/hosting.md`.
- [ ] Company repo recorded (if provided); its scan reconciled or queued as a `todo`.
- [ ] Telegram bot created, **locked to the owner's user ID**, gateway restarted, test message
      received.

Background scans may still be pending — they're `todos`, not blockers.

Then:
1. Write `decisions/<YYYY-MM-DD>-onboarding.md` summarizing what was set up (no secrets).
2. Set `.onboarding-state.json` `status: "complete"`, bump `updated_at`.
3. Teach the first Telegram commands the user can try now:
   - "summarize my business"
   - "check Stripe sales"
   - "what needs my attention today?"

---

## `.onboarding-state.json` schema

Lives at `$AO1_KB_PATH/.onboarding-state.json`. Single source of truth for resume/idempotency.

```json
{
  "schema_version": 1,
  "status": "in_progress",
  "started_at": "2026-06-29T10:00:00Z",
  "updated_at": "2026-06-29T10:20:00Z",
  "machine": "macos",
  "model_provider": "openrouter",
  "inputs": {
    "website_url": "https://example.com",
    "company_repo_path": "/Users/owner/Projects/acme-site",
    "extra_sources": []
  },
  "steps": {
    "env_probe":    { "done": true,  "notes": "stripe+wrangler+gh present" },
    "website_scan": { "done": false, "background": true, "result_path": "raw/onboarding/website-scan.md" },
    "repo_scan":    { "done": false, "background": true, "result_path": "raw/onboarding/repo-scan.md" },
    "stripe":       { "done": false },
    "cloudflare":   { "done": false },
    "kb":           { "done": false },
    "telegram":     { "done": false }
  },
  "todos": []
}
```

A step that times out or is skipped appends a human-readable item to `todos` so a later run
(or the user asking "finish onboarding") completes it.

## KB structure (created only if absent)

```
$AO1_KB_PATH/
  README.md
  .onboarding-state.json
  kb-graph.html                 # Obsidian-style visual map (regenerated from [[wikilinks]])
  company/
    profile.md
    website.md
    payments.md
    company-profile.json      # structured profile other skills read (see references/)
  products/
    catalog.md
  operations/
    stripe.md
    hosting.md                # Cloudflare deploy target + site↔Stripe relationship
  decisions/
    YYYY-MM-DD-onboarding.md
  raw/
    onboarding/
      website-scan.md / website-signals.json / website-scan.done
      repo-scan.md / repo-signals.json / repo-scan.done
```

Curated pages stay concise; raw scan output stays under `raw/onboarding/`.

## Safety posture (enforced regardless of approval mode)

- **No secret ever printed**, and no secret accepted over Telegram.
- **Stripe is read-only during onboarding.** Live writes require explicit confirmation later.
- **No Cloudflare deploy** during onboarding — auth + record only.
- **Company repo is read-only during onboarding.** Later operational writes happen on a
  branch, never push to `main` unprompted, always confirm a deploy. Use `gh` over HTTPS
  (SSH to GitHub is unreliable on this machine; never rely on `git push`/SSH).
- Surface the `privacy.redact_pii: false` + customer-data-over-Telegram tradeoff as a
  conscious choice.

## Pitfalls

- Don't re-run completed steps — always read the state file first.
- Don't block onboarding on a slow scan; queue a `todo` and move on.
- Don't paste live Stripe IDs / customer emails / payment IDs into anything shareable.
- If `$AO1_KB_PATH` doesn't exist at Phase 1, create the KB dir first, then the state file.
- The gateway can't restart itself — Phase 7 needs the user (or you) to run
  `hermes gateway restart`.
