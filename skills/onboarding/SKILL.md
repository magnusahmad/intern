---
name: onboarding
description: First-run business setup for the intern profile. Drives a non-technical owner from a fresh install to "I run my business through Telegram" — probing tooling, fingerprinting the company website + repo to detect which services it actually uses, then wiring only those credentials locally — via a connector registry for common services (Stripe, Cloudflare, …) plus a generic discover→CLI→auth recipe for anything else — plus Telegram, and bootstrapping the KB as the company brain. No specific vendor is ever required. When the user launches with a task, a task-first fast path connects only what the task needs (one consolidated confirmation) and defers the rest to the background. Resumable and idempotent via a single state file.
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [macos]
prerequisites:
  # INTERN_KB_PATH is intentionally NOT listed: when unset the skill resolves the KB to the
  # current working directory and persists it (Phase 1), so Hermes must not prompt for it.
  # Only `gh` is a hard prerequisite. `stripe`/`wrangler` are checked on demand in Phase 4,
  # and only when their connector is actually detected + confirmed — a business that uses
  # neither should not be nagged to install them.
  commands: [gh]
metadata:
  hermes:
    tags: [onboarding, setup, first-run, kb, stripe, cloudflare, telegram]
    spec: specs/03-onboarding-flow.md
---

# Onboarding — First-Run Business Setup

This skill turns a fresh `intern` install into a working business-ops agent. It owns
Phases 1–7 of the onboarding flow (spec `specs/03-onboarding-flow.md`). The single design
goal: **a non-coder who can open Terminal and paste a line or two should succeed.** Do as
much as possible yourself; ask the human only for things only they can do (browser logins,
secrets, business facts).

## When to use

Load this skill when **any** of these is true:

- `$INTERN_KB_PATH/.onboarding-state.json` is missing or its `status` is not `complete`
  (the SOUL.md first-run guard sends you here automatically — this is the normal trigger).
- The user says "finish onboarding", "set up my business", "redo setup", or similar.

If the state file exists and is `complete`, do **not** re-run onboarding. Operate normally
from the KB instead.

**If the user's message contains an actual task** (not just a greeting), do not run the full
flow front-to-back — use the **Task-first fast path** below. Time-to-first-value is the metric
that matters: the user should see their task done in minutes, with onboarding completing
quietly around it.

## Task-first fast path (launched with a task)

When onboarding is incomplete and the user has already given you a task, **never ask "should I
skip onboarding?"** — the answer is always the same: run the minimal path that unblocks the
task, and finish the rest in the background or as `todos`.

1. **Set up silently — no user turn, no walls of output.** Run Phase 1 (resolve KB + state
   file) and Phase 2 (env probe), derive the website URL from the repo if possible (see
   Phase 3), and run the fast fingerprint probe. Target well under a minute, one short status
   line per phase. Skip the Phase 1 greeting — the task is the greeting.
2. **Map the task to its required connectors.** E.g. "create a payment link and redeploy the
   site" → whatever payment provider and host *this business* actually uses (Stripe + Cloudflare
   for one company; something else entirely for another — the fingerprint tells you). Only those
   connectors' secrets and probes are on the critical path; everything else is deferrable.
3. **Ask exactly one consolidated question** covering everything that gates the task: the
   proposed website URL (if derived), the detected connectors to confirm, any risk callout the
   task implies (live payment-provider write, production deploy), and a one-line note of what
   you're deferring (Telegram, deep-scan synthesis, KB pages). One question — not one per
   topic.
4. **On confirmation:** kick off background scans and CLI warm-ups (see Phase 4), connect only
   the required connectors, **do the task**, and deliver its result.
5. **Then — in the same turn you deliver the task result, before ending it** — dispatch the
   deferred onboarding work as a background child: call the `delegate_task` tool with
   `background: true` and a task prompt that runs Phase 5 end-to-end (KB bootstrap + scan
   reconciliation; Telegram stays a `todo`). Brief the child for **completeness, not
   minimalism**: its job is all of Phase 5 — structure *and* synthesis — and the yardstick is
   that tomorrow's run could redo today's task from the KB alone, without re-discovering
   anything you just learned (which objects exist at each connector and their real IDs, how
   the site builds and deploys, where the code references what you changed). Point the child
   at the Phase 5 spec, the state file, and the `raw/` artifacts as inputs rather than
   enumerating page contents in the prompt — every business is different and Phase 5 already
   defines the shape. "Minimal orientation stubs" is a failed Phase 5, not a lean one. The
   child writes KB files and `.done` markers, so its work survives your turn ending. Recording a `todo` instead of dispatching is a
   **fallback only** — permitted solely when `delegate_task` is unavailable or errors, and the
   todo must say which it was. Ending the run with `kb.done: false` and no dispatched child is
   a failed fast path, not a fast one.

The task itself runs under **normal operating rules** (SOUL.md: confirm irreversible or
outward-facing actions), not under onboarding's read-only rule — that rule governs
onboarding's own probes, and the consolidated question above is where the task's live-write
risk gets confirmed. For payment-link work specifically, use the `stripe` skill.

## Golden rules (read before every phase)

1. **Idempotent + resumable.** `$INTERN_KB_PATH/.onboarding-state.json` (§schema below) is the
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
7. **One consolidated question per gate.** A user round-trip is the single biggest cost in
   time-to-first-value. Never ask for something derivable (the website URL is usually in the
   repo) or already decided (the first-run guard's own routing). Batch confirmations that
   land within a turn or two of each other into one question.
8. **Agent tooling never touches the company repo.** Probe/bootstrap/verify helper scripts
   live in this skill's `scripts/` or under `$TMPDIR` — never written into the company repo
   (they'd violate read-only and need cleanup later).
9. **Verify once, then stop.** One focused verification pass per change. Don't rewrite a
   near-identical verifier or re-check what just passed.
10. **Keep the screen quiet.** The user should see questions, diffs to files the business owns
    (site source, KB pages), and results. State-file updates, probes, and internal tooling get
    one status line each — use `scripts/state.sh` for state mutations instead of ad-hoc python
    heredocs, and never surface the source or diff of your own throwaway scripts.

## Secret entry (Phases 4 & 6) — you run the scripts, the value never reaches you

Don't hand-write secret-entry scripts per run, and don't ask the user to paste a key into the
chat. Two reviewed scripts ship in `scripts/`; **you** run them (with the user's approval) and
the secret value flows straight into `.env` without ever entering your context. The security
invariant: a secret is never a command argument, never in captured stdout, never echoed — you
only ever see a `✓ … saved` line.

- **Discovery first:** `scripts/discover-secret.sh NAME --env-file <profile .env> [--alias ALT] [--root DIR]`
  copies an existing value from the current environment or a sibling project `.env` (search the
  parent of the launch dir plus any `--root` you pass, e.g. the company repo path). It reports
  only the *source*, never the value. Exit 0 = saved; exit 1 = not found.
- **Manual entry fallback:** when discovery exits non-zero, `scripts/enter-secret.sh NAME
  --env-file <profile .env> [--prompt "text"]` pops a native macOS dialog with **hidden input**.
  The user types into the OS dialog (not the terminal, not the chat); the value goes straight to
  `.env`. Exit non-zero = cancelled/empty, nothing written.

Use `<profile .env>` = the same `.env` you persist `INTERN_KB_PATH` into (Phase 1). The scripts set
`.env` to `chmod 600` and refuse to run if the channel is Telegram (defense in depth behind
golden rule 2 — you must still never invoke them off the local Terminal).

---

## Phase 1 — First-run trigger & greeting

1. **Resolve the KB location with zero manual setup:**
   - If `INTERN_KB_PATH` is set and non-empty, use it.
   - Otherwise default to the **current working directory** — the directory the user launched
     `hermes` from (`pwd`). This is deliberate: the KB lives right next to the project the
     owner is working in, so they never have to configure a path by hand.
   - Create the directory + structure if absent (the state file lives inside it).
   - **Persist the resolved absolute path** into the profile's `.env` as `INTERN_KB_PATH` (append
     it if missing; never echo other secrets while doing so). This makes every later run and
     the SOUL.md first-run guard resolve to the same KB without any manual step, and keeps this
     profile's KB from colliding with any other profile's.
2. Read `$INTERN_KB_PATH/.onboarding-state.json`. If absent, create it with `status:
   "in_progress"`, `started_at` = now, `machine: "macos"`, `model_provider` = whatever the
   user configured (default `openrouter`), and all steps `done: false` (use the schema below).
   For every later mutation use the bundled helper — one quiet line, no heredocs:

   ```bash
   scripts/state.sh "$INTERN_KB_PATH/.onboarding-state.json" set steps.env_probe.done true \
     steps.env_probe.notes '"gh present; stripe missing (deferred)"'
   scripts/state.sh "$INTERN_KB_PATH/.onboarding-state.json" todo "Re-run website scan"
   ```
3. Greet the user in plain, non-technical language. Explain in 3–4 sentences what you're about
   to do: check their tools, read their website and repo, find and connect the services their
   business actually runs on (payments, hosting, and the like — whatever the scans turn up),
   and set up Telegram so they can run the business from their phone. Don't name specific
   vendors you haven't detected yet. Tell them setup happens here at the Terminal because it
   involves passwords, and that day-to-day will happen on Telegram.

If resuming (`status: in_progress` with some steps done), say so briefly and jump to the first
incomplete step instead of re-greeting from scratch.

## Phase 2 — Environment probe

Homebrew is assumed present. Only **`gh` is required** here. The `stripe` and `wrangler` CLIs
are **connector-specific** — they're only needed if Phase 4 detects + confirms those services,
so don't gate setup on them now. Run the checks, print a present/missing table, and do **not**
silent-install — for anything missing, give the user a copy-paste line (prefix `!` so output
lands in-session).

| Tool | Check | Needed for | Install if missing |
|---|---|---|---|
| `gh` | `gh auth status` | repo access over HTTPS | `!brew install gh` then `gh auth login` |
| `stripe` *(deferred)* | `stripe --version` | billing probes — **only if Stripe is confirmed** | `!brew install stripe/stripe-cli/stripe` |
| `wrangler` *(deferred)* | `wrangler --version` | Cloudflare — **only if Cloudflare is confirmed** | `!brew install cloudflare-wrangler2` (or `npm i -g wrangler`) |

Notes:
- **Model provider** is the user's choice (configured in `.env` / `config.yaml`; Hermes prompts
  for the key on first run). You don't probe a CLI for it — you're already running on it. Just
  confirm the agent can complete a model turn (it can if it's responding).
- `gh` over HTTPS only. This machine's SSH-to-GitHub is unreliable; never rely on
  `git push`/SSH (see Safety).
- Note the present/missing result for `stripe`/`wrangler` so Phase 4 can offer the install line
  exactly when a connector that needs one is confirmed — don't block here on a missing one.
- `stripe`/`wrangler` are just the pre-bundled examples. Whatever service Phase 4 actually
  confirms, its CLI gets the same treatment on demand: check, offer the install line, never
  silent-install.

Mark `env_probe.done: true` with a `notes` summary (e.g. `"gh present; stripe missing (deferred)"`)
once `gh` is present. A deferred CLI being absent does not hold up this phase.

## Phase 3 — Company inputs + launch background scans

**Derive before you ask.** If a company repo is at hand (the launch directory or a path the
user gave), try to derive the website URL from it first: `wrangler.jsonc`/`wrangler.toml`
routes, a `CNAME` file, `package.json` `homepage`, or canonical/`og:url` tags in the site
source. If you find one, **propose it for confirmation folded into the Phase 4 connector
question** — one question, not two. Only stop and ask when nothing is derivable.

The inputs to record (asking only for what you couldn't derive):

1. **Company website URL** (required — derived or asked).
2. **Company repo directory** (optional; default to the launch directory when it is one). If
   given, verify it's a git repo (`git -C <path> rev-parse --is-inside-work-tree`); record the
   path either way.
3. Any extra docs or URLs they want you to read (optional).

Write these into `inputs` in the state file. Then **immediately spawn two background
subagents** — one for the website, one for the repo (skip the repo one if no repo was given) —
by calling the `delegate_task` tool with `background: true` (one entry in `tasks` per scan),
using the prompts in `references/website-scan-subagent.md` and
`references/repo-scan-subagent.md`. "Spawn a subagent" always means a `delegate_task` call —
never a shell trick like `nohup`/`&`, and never a silent downgrade to a `todo`. These are read-only extraction agents that write their
findings to files under `raw/onboarding/` and touch a `.done` marker when finished. Both are
**budgeted, self-limiting scans** (page caps, per-fetch timeouts, a soft deadline well inside
the child timeout, incremental writes) — a subagent that burns its whole 600s slot and writes
nothing is worse than a partial artifact; see the reference files. For repo-only onboarding
scans or manual repo-scan handoffs, follow `references/repo-onboarding-scan-artifacts.md`:
write both `repo-scan.md` and `repo-signals.json`, create `repo-scan.done` only after both are
present, and run focused ad-hoc artifact verification when no canonical suite applies.

Set `website_scan.background: true` / `repo_scan.background: true` with their `result_path`s.
Then tell the user: *"I'm reading your website and repo in the background while we keep setting
things up,"* and continue. **Do not wait for the deep scans.**

Delegation is enabled in `config.yaml` (`orchestrator_enabled: true`,
`max_concurrent_children: 3`, `child_timeout_seconds: 600`, child toolsets
`[terminal, file, web]`). The file + `.done`-marker handoff means partial work survives even
if a child times out or the gateway restarts.

**Then run the fast fingerprint probe (synchronous — this gates Phase 4).** The deep scans are
slow and background; detection must be *fast*, so run the bundled probe now and wait for it (a
few seconds):

```bash
scripts/detect-integrations.sh "<website_url>" [--repo <company_repo_path>] --out "$INTERN_KB_PATH/raw/onboarding/detected.json"
```

It fetches a few public pages + greps the repo (read-only, no secrets) and emits two lists:

- `detected[]` — services its fixed markers recognized (payments, ecommerce, hosting, channel
  providers).
- `candidates[]` — everything it *saw but couldn't classify*: unrecognized third-party domains
  the pages reference (script/link/iframe/form) and unrecognized env-var name prefixes from the
  repo (names only, never values). **You do the classifying** — you know what `klaviyo.com` or
  `RESEND_API_KEY` is even though the script doesn't. Real services found here go into the
  Phase 4 proposal alongside `detected`; noise gets ignored.

Write the results into `detected_integrations` in the state file. Phase 4 connects **only**
what's detected/confirmed (plus anything the user adds), so a non-Stripe business is never
asked for a Stripe key. See `references/connectors.md` for the registry that drives this.

## Phase 4 — Discover + connect the services the business actually uses (read-only)

Your job here is open-ended discovery, not a checklist: **find the services this company runs
on, work out how to talk to each one (CLI or API), figure out with the user which ones matter,
and auth those.** `references/connectors.md` holds ready-made recipes for common services
(Stripe, Cloudflare, …) — those rows are **accelerators, not a whitelist, and none of them is
mandatory**. A business with no Stripe and no Cloudflare is a perfectly normal outcome; never
nudge the user toward a service the evidence doesn't support. Telegram is the exception — it
always runs, in Phase 6.

1. **Discover.** Union three evidence sources: the Phase 3 fingerprint — both its `detected[]`
   list *and* its `candidates[]` list, which you classify yourself (an unrecognized
   `RESEND_API_KEY` env prefix or `js.klaviyo.com` script tag is a real service the fixed
   markers don't know) — whatever the deep scans have surfaced so far (`checkout_observed`,
   `stripe_refs`, `hosting`, `expected_env_vars`), and **your own inspection** — response
   headers, script tags and embeds, SDK dependencies, env-var names in the repo, links and
   badges in the site footer, OAuth callback routes. Anything the business plausibly operates
   through belongs on the candidate list, registry row or not.

2. **Confirm + prioritize.** Show the user the candidate set in **plain language**, naming the
   evidence, e.g.:
   > I found **Stripe** — there's a payment link on your pricing page — and your site is hosted
   > on **Cloudflare**. I didn't see Shopify, WooCommerce, or other tools. Want me to connect
   > those two? Anything I should add?

   Evidence **proposes**; the user **decides** — and importance drives the order: services on
   the money path (payments, the sales channel, hosting) come first; low-stakes detections
   (analytics pixels, font CDNs, chat widgets) get recorded in the KB, not authed — don't
   collect credentials the user gets no leverage from. Add anything they name even without
   evidence; drop anything they say they don't use. Record each as `detected`/`confirmed` in
   the state. **Never ask for a service that's neither detected nor user-confirmed** — that's
   the whole point (no unconditional Stripe key prompt).

3. **For each confirmed service, connect it** — via its registry recipe when
   `references/connectors.md` has a row, otherwise via the **generic recipe** in the same file:
   check whether the profile already ships a skill for it (e.g. `stripe`), else find the
   vendor's official CLI, else use its REST API with a least-privilege token. Either way:
   - **Tooling check:** if the recipe needs a CLI (`stripe`, `wrangler`) that Phase 2 found
     missing, offer the copy-paste `!brew install …` now — only now is it known to be needed.
   - **Warm up deploy tooling in the background.** If Cloudflare is confirmed, the repo deploys
     via `npx`/`npm exec wrangler`, and the CLI is missing, start
     `npm exec --yes wrangler --version` in the background *now* so a later deploy doesn't pay
     the ~60–90s cold download (and stumble through failed attempts first). Same idea for any
     other confirmed connector whose CLI a foreseeable task will need.
   - **Secret(s):** obtain via the secret scripts (see "Secret entry" above) — discovery first,
     hidden-input dialog fallback. Never echo, never pass as an argument, refuse on Telegram.
   - **Read-only probe:** run the recipe's probe (e.g. Stripe products/prices/links;
     `wrangler` deploy-target detection). **No writes, no deploys.** Write the raw probe output
     to `raw/onboarding/<id>-probe.json` (e.g. `stripe-probe.json`) and **reuse that cache** for
     any follow-on work in the session — don't re-enumerate the account (the classic waste:
     re-listing 100 payment links with per-link line-item calls the probe already made).
   - **KB pages:** write the recipe's curated pages (Stripe → `operations/stripe.md`,
     `products/catalog.md`, `company/payments.md`; Cloudflare → `operations/hosting.md`,
     including the site↔payment-link relationship). Never paste live IDs/emails into anything
     shareable — KB only.
   - Mark `connectors.<id>.done: true` with a short `notes`.

4. **Stub connectors** (`status: stub` in the registry — Shopify, WooCommerce, Paddle, etc.):
   acknowledge them, point the user at where that platform mints its API credential, and append
   a `todo` to wire it later. Don't block onboarding on a stub. (A stub row is a head start on
   detection markers — if the user confirms one matters now, the generic recipe can still wire
   it today.)

Onboarding stays **read-only** on every connector — auth + probe + record, no live writes or
deploys. A service that recurs across businesses earns a registry row in
`references/connectors.md`; until then the generic recipe covers it — this phase needs no
change either way.

## Phase 5 — KB bootstrap + reconcile scans

**In the task-first fast path this phase runs *after* the task result is delivered** — as a
background child dispatched via `delegate_task` with `background: true` — the task needs
connectors, not KB pages, so synthesis must never sit between connector confirmation and the
task. If any later user turn reveals this phase is still not done (e.g. they ask whether the
KB exists), don't just report status: dispatch it (or run it inline if delegation is
unavailable) in that same turn.

1. **Create the KB structure** (§KB structure below) **only if absent.** Never overwrite an
   existing page.
2. **Reconcile the background scans.** Check for the `.done` markers
   (`raw/onboarding/website-scan.done`, `raw/onboarding/repo-scan.done`). Poll briefly (a few
   short checks, not an indefinite wait). For each scan that's done, read its
   `*-scan.md` + `*-signals.json`. For any scan still running or timed out, append a
   `todo` ("re-run website scan", etc.) and **proceed anyway** — never block completion on a
   scan.
3. **Synthesize the company profile.** Triangulate the available sources (website signals, repo
   signals, and the **payment-provider ground truth** from whichever connector was confirmed —
   Stripe for most, otherwise Shopify/Woo/etc., or none) into `company/company-profile.json` and
   the curated pages. Apply this precedence — don't let the loudest source win:

   | Facet | Authoritative source | Others used for |
   |---|---|---|
   | What's actually sold + real prices | **confirmed payment connector** (e.g. Stripe); if none, **website** | website = marketing, repo = wiring |
   | Business-model classification | **all sources combined** (incl. `detected_integrations`) | — |
   | Branding / positioning / tone | **website** | repo theme = colors/fonts |
   | Legal / registration / entity | **website footer + Terms/Privacy** | repo rarely has this |
   | Stack / deploy / payment wiring / ID locations | **repo** | website = observed checkout |

   If no payment connector was confirmed, fall back to marketed prices from the website and mark
   them as *marketed, unverified* — don't invent a Stripe.

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
   python3 <this-skill-dir>/scripts/build_kb_graph.py "$INTERN_KB_PATH"
   open "$INTERN_KB_PATH/kb-graph.html"
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

## Phase 6 — Telegram activation (the handoff)

1. **Create the bot:** walk the user through @BotFather (`/newbot`, pick a name + username).
   Get the **bot token** into `.env` as `TELEGRAM_BOT_TOKEN` via `scripts/enter-secret.sh
   TELEGRAM_BOT_TOKEN --env-file <profile .env> --prompt "Paste the bot token from @BotFather"`
   (the hidden-input dialog — see "Secret entry" above). A fresh token won't be discoverable, so
   this is the manual-entry path. No echo, never via Telegram.
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

## Phase 7 — Acceptance check + handoff

Verify the **definition of done** (all must pass):

- [ ] Model provider configured; the agent can run a model turn.
- [ ] `$INTERN_KB_PATH` exists with the structure below and at least the curated company pages.
- [ ] Integrations were **detected and confirmed** (not blindly asked for); every **confirmed**
      connector is `done` (its read-only probe ran and its KB pages were written), and every
      detected-but-`stub` one is queued as a `todo`. A business with no payment/hosting provider
      is allowed to have none connected.
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

Lives at `$INTERN_KB_PATH/.onboarding-state.json`. Single source of truth for resume/idempotency.

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
  "detected_integrations": [
    { "id": "stripe",     "kind": "payments", "signals": [ { "source": "https://example.com/pricing", "marker": "buy.stripe.com link" } ] },
    { "id": "cloudflare", "kind": "hosting",  "signals": [ { "source": "repo:.../acme-site", "marker": "wrangler.toml" } ] }
  ],
  "steps": {
    "env_probe":    { "done": true,  "notes": "gh present; stripe+wrangler checked on demand" },
    "website_scan": { "done": false, "background": true, "result_path": "raw/onboarding/website-scan.md" },
    "repo_scan":    { "done": false, "background": true, "result_path": "raw/onboarding/repo-scan.md" },
    "detect":       { "done": false, "result_path": "raw/onboarding/detected.json" },
    "connectors": {
      "stripe":     { "detected": true,  "confirmed": true,  "done": false, "status": "wired" },
      "cloudflare": { "detected": true,  "confirmed": true,  "done": false, "status": "wired" },
      "shopify":    { "detected": false, "confirmed": false, "done": false, "status": "stub" }
    },
    "kb":           { "done": false },
    "telegram":     { "done": false }
  },
  "todos": []
}
```

`connectors` is keyed by connector id (see `references/connectors.md`); only **confirmed** ones
are connected, and a confirmed `wired` connector is `done` once its probe ran and pages were
written. Detected `stub` connectors stay `done: false` and add a `todo`. A confirmed service
with no registry row is connected via the generic recipe and recorded with `status: "adhoc"`.

A step that times out or is skipped appends a human-readable item to `todos` so a later run
(or the user asking "finish onboarding") completes it.

## KB structure (created only if absent)

This is the same layout the `kb` skill maintains day-to-day — onboarding creates it and does the
first big capture; the `kb` skill keeps it current after. Create the orientation files
(`SCHEMA.md`, `index.md`, `log.md`) here too so ongoing capture has something to orient on.

```
$INTERN_KB_PATH/
  README.md
  .onboarding-state.json
  SCHEMA.md                     # conventions + tag taxonomy (shared with the `kb` skill)
  index.md                      # catalog of pages (orient here before writing)
  log.md                        # append-only capture/action log
  kb-graph.html                 # Obsidian-style visual map (regenerated from [[wikilinks]])
  company/
    profile.md
    website.md
    payments.md
    company-profile.json      # structured profile other skills read (see references/)
  products/
    catalog.md
  operations/
    stripe.md                 # only if Stripe was confirmed (per-connector pages)
    hosting.md                # deploy target + site↔payment-link relationship (if a host was confirmed)
  decisions/
    YYYY-MM-DD-onboarding.md
  raw/
    onboarding/
      detected.json           # fast fingerprint output that gated Phase 4
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
- If `$INTERN_KB_PATH` doesn't exist at Phase 1, create the KB dir first, then the state file.
- **Never ask "should I skip onboarding?"** when the user launched with a task — the first-run
  guard already routed you here and the Task-first fast path defines the answer. That question
  is a wasted round-trip with a known answer.
- **Stripe and Cloudflare are worked examples throughout this skill, not requirements.** Plenty
  of businesses use neither. Detection decides what to propose; the user decides what to
  connect; "no payment provider and no host connected" is a valid, complete onboarding. For a
  confirmed service without a registry row, use the generic recipe in
  `references/connectors.md` — don't skip it just because it isn't pre-wired, and don't force a
  registry service just because a recipe exists.
- If the user explicitly skips a remaining onboarding phase (for example the Telegram handoff)
  to complete an urgent operational task, record the skipped phase in `.onboarding-state.json`
  with a `todo`, keep `status: in_progress`, and proceed. The first-run guard allows other work
  after an explicit skip; do not keep blocking on onboarding — and when the task arrived at
  launch, don't even ask (see "Task-first fast path").
- If Stripe is confirmed and the Stripe CLI is missing, a successful direct REST probe is
  enough; use `references/stripe-rest-probe.md` and do not stall onboarding just to install
  the CLI.
- Onboarding is read-only for Stripe. For live post-onboarding Payment Link work, use the
  `stripe` skill rather than extending onboarding into write operations.
- Fast detector hits for Shopify/WooCommerce/etc. can come from old docs, migration specs, or
  env-var references. Treat them as proposals only; after user confirmation, mark declined
  detections explicitly rather than queuing them as work.
- Secret discovery can find values in sibling project `.env` files. That's useful for reusable
  service keys, but for fresh channel setup (especially the Telegram bot token) verify that the
  discovered token belongs to this business/profile before treating Telegram as complete.
- Don't hand-write python heredocs to mutate `.onboarding-state.json` — that's what
  `scripts/state.sh` is for (golden rule 10).
- Don't write helper/probe/verifier scripts into the company repo (golden rule 8) — you'll have
  to clean them up and then verify the cleanup, which is waste stacked on waste.
- One verification pass per change (golden rule 9). Re-running a rewritten-but-equivalent
  verifier adds minutes and screen noise, not confidence.
- The gateway can't restart itself — Phase 6 needs the user (or you) to run
  `hermes gateway restart`.
