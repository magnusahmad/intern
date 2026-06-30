# Spec 03 — AO1 Intern Onboarding Flow (Hardened)

Status: Draft · 2026-06-29
Scope: First-run business setup for the `ao1-intern` Hermes profile distribution.
Owner skill (to build): `skills/onboarding/SKILL.md`

---

## 1. Purpose

Turn `ao1-intern` from "a profile with some skills" into a **first-run business setup
agent**. After installing the profile, a non-technical small-business owner should be able
to go from zero to "I run my business through Telegram" with the intern doing almost all of
the work — installing tooling, wiring credentials, scanning the company's website and repo,
and bootstrapping the KB as the company brain.

The single design goal: **a non-coder who can open Terminal and copy-paste one or two lines
should succeed.** Everything that can be done by the agent is done by the agent.

---

## 2. Target user & locked scope

**User:** owns a small business, has access to their own company repo, is *not* a coding
whiz. Can open Terminal and paste a command.

**Environment assumptions (locked for v1):**

| Assumption | Decision |
|---|---|
| Machine | macOS with Homebrew already installed |
| Model provider | **Codex subscription** (ChatGPT/Codex auth, no per-token API key) |
| Payments | **Stripe** |
| Hosting | **Cloudflare** (Pages/Workers via `wrangler`) |
| Knowledge | **AO1 KB** at `$AO1_KB_PATH` |
| Website ingestion | Hermes's shipped **computer-use / web-extract / browser-navigate** — no Firecrawl key dependency |
| Company repo | **Optional** input; scanned for stack, deploy config, and Stripe references |
| Operating channel | **Telegram** (after onboarding) |

**Explicitly out of scope for v1** (do not build into the onboarding flow):

- Email / Himalaya / ProtonMail Bridge / customer-email triage setup. The
  `customer-email-sorter` skill stays in the distribution but is **not** wired by onboarding.
- Google Meet copilot setup.
- Multi-provider model choice, multi-provider hosting, multi-provider payments.

These can return in v2; keeping them out makes v1 bulletproof.

---

## 3. End-to-end flow (the spine)

```
Phase 0  Manual bootstrap (README): install Hermes → install profile → `codex login` → start `hermes` locally
Phase 1  Deterministic first-run trigger (SOUL.md → onboarding skill)
Phase 2  Environment probe (verify codex, stripe, wrangler, gh)
Phase 3  Company inputs: website URL + optional repo path
            └─► spawn BACKGROUND subagents to scan website + repo (non-blocking)
Phase 4  Stripe: local key entry (no echo) → read-only probes → KB pages
Phase 5  Cloudflare: wrangler auth → detect deploy target → record
Phase 6  KB bootstrap (idempotent): create structure, reconcile background scan results
Phase 7  Telegram activation: BotFather → token (local) → lock to user ID → restart → test msg
Phase 8  Acceptance check + handoff (first Telegram commands)
```

The two halves are deliberately separated by channel:

- **Phases 0–7 run at the local Terminal** (interactive auth + secret entry).
- **Phase 8 onward is Telegram.** Secrets and interactive auth must *never* travel through
  Telegram (chat history is retained on Telegram's servers).

---

## 4. Architecture decisions (the hardening)

These are the load-bearing fixes that make the flow reliable.

### 4.1 Deterministic entrypoint (keystone)
Do **not** rely on the user typing a magic phrase, and do **not** assume a Hermes "setup
hook." Instead, `SOUL.md` — which is reloaded fresh every session — carries a first-run
guard:

> Before doing anything else, check whether `$AO1_KB_PATH/.onboarding-state.json` exists and
> is marked complete. If it is missing or incomplete, this is onboarding: load the
> `onboarding` skill and resume from the last incomplete step.

This makes onboarding fire regardless of phrasing **and** makes it survive the gateway
restarts that wipe conversation context.

### 4.2 Model provider = Codex subscription
The irreducible manual step is **`codex login`** (browser-based subscription auth, local
only), not pasting an API key. `config.yaml` must point the agent's model at the Codex
backend rather than OpenRouter.

> Implementation note (verify exact keys before coding): set `model.provider` to the Codex
> provider Hermes exposes and authenticate via `codex login`. The current dev machine's
> `config/ao1-intern.local.json` shows a `codex_exec` block (`model: gpt-5.5`,
> `service_tier: fast`) and `model_provider.credential_ref: keychain://…`, which is the
> reference for how Codex is wired locally. Confirm whether the shipped `config.yaml` should
> express Codex as the chat model directly or via the codex-exec path.

Onboarding does a lot of careful tool use; the model must be a capable one (Codex
subscription satisfies this).

### 4.3 Secrets: local `.env`, never echoed, never via Telegram
The distribution ships `.env`-based secrets (`.env`/`.env.*` are gitignored; the keychain
model in `config/ao1-intern.local.json` is dev-machine-only and does **not** ship). The
onboarding skill:
- accepts secrets only at the local Terminal,
- writes them straight into `.env` without printing them back,
- refuses to accept or display secrets if the active channel is Telegram.

Secret entry is handled by two reviewed scripts the agent runs (with the user's approval),
**not** by ad-hoc scripts generated per run and **not** by asking the user to paste keys into
the chat — `skills/onboarding/scripts/discover-secret.sh` (copies an existing key from the
environment or a sibling project `.env`, reporting only the source) and `enter-secret.sh` (a
native macOS hidden-input dialog the user types into). The value flows into `.env` out-of-band:
it is never a command argument, never in captured stdout, never echoed — keeping it out of the
agent's context entirely. Both scripts `chmod 600` the `.env` and self-refuse on Telegram.

### 4.4 Idempotent, resumable state
A single source of truth tracks progress: `$AO1_KB_PATH/.onboarding-state.json` (schema in
§6). Every phase:
- checks the state file before acting (skip if done),
- never overwrites an existing KB,
- writes its completion back to the state file.

This is what makes re-runs and post-restart resumes safe for a non-coder who will close the
terminal mid-flow.

### 4.5 Non-blocking scans via background subagents
Website scanning and repo scanning are slow and must **not** block the interactive flow.
Hermes delegation is enabled (`config.yaml`: `orchestrator_enabled: true`,
`max_concurrent_children: 3`, `child_timeout_seconds: 600`, default child toolsets
`[terminal, file, web]`). At Phase 3 the onboarding orchestrator **spawns two background
subagents** and immediately continues with the interactive Stripe/CF/Telegram steps. The
subagents write their findings to fixed paths under `raw/onboarding/` plus a `.done` marker;
Phase 6 reconciles them into curated KB pages. See §7.

### 4.6 Safety posture for a non-technical operator
A non-coder will mostly say "yes," so the profile must hard-gate the dangerous actions
itself (§9). Live Stripe writes, Cloudflare deploys, `git push`, and any
repo write require explicit confirmation regardless of approval mode.

---

## 5. Phases in detail

### Phase 0 — Manual bootstrap (documented in README)
The only hand-done part. README states plainly that this is the one manual step:

```bash
hermes profile install https://github.com/magnusahmad/ao1-intern
hermes profile use ao1-intern
codex login          # authenticate the Codex subscription (browser, one time)
cp .env.example .env # then run hermes
hermes
```

On first `hermes`, Phase 1 fires automatically.

### Phase 1 — First-run trigger
SOUL.md guard (§4.1) loads the `onboarding` skill. The skill creates
`$AO1_KB_PATH/.onboarding-state.json` (status `in_progress`) if absent, then greets the user
in plain language and explains what it's about to do.

### Phase 2 — Environment probe
Homebrew is assumed present. Verify (and offer to install via copy-paste `!brew install …`,
which the user runs so output lands in-session) the tools actually needed for v1:

| Tool | Check | Needed for |
|---|---|---|
| `codex` | `codex --version` + auth status | model provider |
| `stripe` | `stripe --version` | billing probes |
| `wrangler` | `wrangler --version` | Cloudflare |
| `gh` | `gh auth status` | repo access over HTTPS (per machine policy: no SSH) |

Verify each before continuing; print a present/missing table. Do not silent-install.

### Phase 3 — Company inputs (+ launch background scans)
Ask, in plain language, for:
1. **Company website URL** (required).
2. **Company repo directory** (optional). If given, verify it is a git repo.
3. Any extra docs/URLs the user wants read.

Then **immediately spawn background subagents** (§7) for website + repo scanning and tell
the user "I'm reading your website and repo in the background while we keep setting things
up." Continue without waiting.

### Phase 4 — Stripe
- Local, no-echo entry of `STRIPE_SECRET_KEY` into `.env` (recommend a restricted/read-only
  key for setup).
- Read-only probes: products, prices, payment links, recent checkout sessions (uses the
  existing `stripe` skill patterns).
- Record live-vs-test mode.
- Write KB: `operations/stripe.md`, `products/catalog.md`, `company/payments.md`.
- Mark `stripe` done in state.

### Phase 5 — Cloudflare
- `wrangler login` (interactive, local) or `CLOUDFLARE_API_TOKEN` if the user prefers
  non-interactive.
- Detect the deploy target: prefer `wrangler.toml`/`wrangler.jsonc` found by the repo scan;
  otherwise list Pages projects / Workers and confirm with the user which one is the site.
- Record deploy method + project name in KB `operations/hosting.md`. Record the
  relationship between the site and Stripe links (the `stripe` skill needs this to "update
  the deployed site" when a Payment Link changes).
- **Do not deploy anything during onboarding.** Just authenticate + record.
- Mark `cloudflare` done in state.

### Phase 6 — KB bootstrap + reconcile scans
- Create the KB structure (§8) only if absent; never overwrite existing pages.
- Reconcile background scans: read `raw/onboarding/website-scan.md` and
  `raw/onboarding/repo-scan.md` once their `.done` markers exist (poll briefly; if a scan is
  still running or timed out, proceed and leave a TODO note in the state file so a later run
  finishes it — never block onboarding completion on a scan).
- Summarize raw scan output into concise curated pages (`company/profile.md`,
  `company/website.md`, `products/catalog.md`, etc.). Raw material stays under
  `raw/onboarding/`.
- Mark `kb` done in state.

### Phase 7 — Telegram activation (the handoff)
- Walk the user through BotFather to create a bot; token entered **locally** into `.env`.
- Get the user's Telegram user ID (e.g., via @userinfobot).
- **Mandatorily** set `TELEGRAM_ALLOWED_USER_IDS` to that ID — an unlocked business-ops bot
  is a security hole. (The dev machine config already locks to a single ID.)
- `hermes gateway restart` (the gateway cannot restart itself).
- Send a **test message** and confirm the user received it.
- Mark `telegram` done in state.

### Phase 8 — Acceptance + handoff
Verify the definition of done (§9), write `decisions/<date>-onboarding.md`, set
`.onboarding-state.json` status `complete`, and teach the first Telegram commands:
- "summarize my business"
- "check Stripe sales"
- "what needs my attention today?"

---

## 6. `.onboarding-state.json` schema

Lives at `$AO1_KB_PATH/.onboarding-state.json`. Single source of truth for resume/idempotency.

```json
{
  "schema_version": 1,
  "status": "in_progress",
  "started_at": "2026-06-29T10:00:00Z",
  "updated_at": "2026-06-29T10:20:00Z",
  "machine": "macos",
  "model_provider": "codex",
  "inputs": {
    "website_url": "https://example.com",
    "company_repo_path": "/Users/owner/Projects/acme-site",
    "extra_sources": []
  },
  "steps": {
    "env_probe":   { "done": true,  "notes": "stripe+wrangler+gh+codex present" },
    "website_scan":{ "done": false, "background": true, "result_path": "raw/onboarding/website-scan.md" },
    "repo_scan":   { "done": false, "background": true, "result_path": "raw/onboarding/repo-scan.md" },
    "stripe":      { "done": false },
    "cloudflare":  { "done": false },
    "kb":          { "done": false },
    "telegram":    { "done": false }
  },
  "todos": []
}
```

A step that times out or is skipped appends a human-readable item to `todos` so a later run
(or the user asking "finish onboarding") completes it.

---

## 7. Discovery: website + repo scanning and business-model synthesis

This is the intelligence of the whole flow. The point is not to "dump the website into the
KB" — it is to **understand the business**: what kind of company it is, what it sells, at
what prices, under what brand and legal entity, on what stack. That understanding becomes
the spine of the KB and the context every later skill reads.

### 7.1 Two-stage design: extract → synthesize

Classification needs *all* sources together (and Stripe ground truth), so we split the work:

1. **Extraction (background subagents, Phase 3).** Two read-only subagents independently pull
   structured *raw signals* from the website and the repo and write them to files. They do
   not classify the business — they gather evidence with provenance.
2. **Synthesis (main onboarding agent, Phase 6).** Once Stripe (Phase 4) and the scans are
   in, the main agent triangulates all three sources into a single
   `company-profile.json` + curated KB pages, resolving conflicts and flagging what the user
   must confirm.

This matches the non-blocking requirement: the heavy crawl/grep runs in the background while
the interactive Stripe/CF/Telegram steps proceed; the reasoning happens when everything is
present.

### 7.2 What we're inferring — the company profile

The target is a structured profile with these facets. Each fact carries a `source` and
`confidence`, because the whole thing is inferential.

**a) Business model (the headline classification).** One or more of:

| Model | Tell-tale signals |
|---|---|
| `ecommerce_physical` | product catalog, "add to cart", shipping/returns policy, Stripe **one-time** prices + **shipping rates**, address collection |
| `ecommerce_digital` | downloadable/licensed goods, one-time Stripe prices, no shipping |
| `saas` | pricing **tiers**, "sign up / log in / dashboard", Stripe **recurring** prices/subscriptions, app framework + auth in repo, API/docs |
| `consumer_app` | App Store / Play Store links, "download the app", mobile-first, in-app purchase (often **not** Stripe) |
| `marketplace` | multiple sellers/vendors, commission/payout language, Connect in Stripe |
| `services_agency` | "book a call", "get a quote", consulting/portfolio, no self-serve checkout |
| `content_media` | subscriptions/memberships/paywall, ad-driven, newsletter |

A business is frequently **hybrid** (e.g. SaaS + ecommerce add-ons). Record a primary plus
secondaries, each with its evidence — never force a single label.

**b) Products / catalog.** Per product: name, short description, category, type
(physical / digital / subscription / service), and its price points.

**c) Pricing.** Per price: amount, currency, cadence (one-time vs recurring + interval),
tier name, whether it's *marketed* (website) vs *actually sold* (Stripe).

**d) Branding.** Brand name, tagline/value prop, target audience, tone/voice, logo URL,
brand colors + fonts (from site CSS/repo theme), social handles, support channels.

**e) Company / legal registration.** Legal entity name (often ≠ brand), company/registration
number, VAT/tax ID, registered address, jurisdiction, contact + support email. These appear
almost exclusively in the **footer, Terms, and Privacy Policy** — scan those explicitly.

**f) Technical reality (repo).** Stack/framework, hosting (CF Pages/Workers), build/deploy,
where Stripe is wired, hardcoded Stripe IDs and checkout URLs, expected env-var names (reveal
other services in use), and **where products/pricing are defined in code/config** (so future
edits know where to go).

### 7.3 Website scan subagent (extraction)

- Tools: web-extract / browser-navigate / computer-use (Hermes built-ins; no Firecrawl key).
- Crawl, at minimum: home, products/shop, pricing, about, contact, **footer links**, and the
  **Terms / Privacy / Legal** pages (for registration facts).
- Extract the facets in §7.2 a–e as raw signals, each tagged with the URL it came from.
- Note checkout mechanism observed (Stripe Payment Link/Checkout URL, app store, contact
  form) — this is a strong business-model signal.
- Output: `$AO1_KB_PATH/raw/onboarding/website-scan.md` (human-readable) **and**
  `raw/onboarding/website-signals.json` (structured), then touch `website-scan.done`.

### 7.4 Repo scan subagent (extraction)

- Tools: file + terminal, **read-only** — must not modify the company repo.
- Read `README`, `package.json`/lockfiles, framework markers, `wrangler.toml`/`wrangler.jsonc`,
  `.env.example`/config for expected env-var names.
- Detect app shape: presence of auth, dashboard routes, API routes → SaaS/app; static
  storefront + cart → ecommerce; marketing-only site → services/other.
- Grep for Stripe references: `plink_`, `price_`, `prod_`, `pk_live`/`pk_test`, `cs_`,
  checkout/payment-link URLs; and locate where catalog/pricing is defined in code or content.
- Output: `$AO1_KB_PATH/raw/onboarding/repo-scan.md` **and**
  `raw/onboarding/repo-signals.json`, then touch `repo-scan.done`.

### 7.5 Synthesis & triangulation (Phase 6, main agent)

The three sources are authoritative for different things. The agent applies this precedence
rather than letting the loudest source win:

| Facet | Authoritative source | Others used for |
|---|---|---|
| What's actually sold + real prices | **Stripe** | website = marketing claims, repo = wiring |
| Business-model classification | **all three combined** | — |
| Branding / positioning / tone | **website** | repo theme = colors/fonts |
| Legal / registration / entity | **website footer + Terms/Privacy** | repo rarely has this |
| Stack / deploy / Stripe wiring / ID locations | **repo** | website = observed checkout only |

**Conflict handling (do not silently resolve).** When sources disagree on a material fact —
classic case: website advertises `$29/mo` but Stripe's active price is `$39/mo`, or the
website brand name differs from the Stripe account / legal entity — record both, mark the
field `needs_confirmation: true`, and **ask the user** at reconcile time. Stale website
pricing vs live Stripe is the single most common real-world mismatch; surfacing it is a
feature, not a failure.

Synthesis writes `company-profile.json` (§7.6) plus the curated pages: `company/profile.md`,
`company/website.md`, `company/payments.md`, `products/catalog.md`, and `operations/*.md`.

### 7.6 `company-profile.json` schema

Lives at `$AO1_KB_PATH/company/company-profile.json`; the durable structured profile other
skills can read.

```json
{
  "schema_version": 1,
  "generated_at": "2026-06-29T10:30:00Z",
  "business_model": {
    "primary": "saas",
    "secondary": ["ecommerce_digital"],
    "evidence": [
      { "model": "saas", "signal": "recurring Stripe prices + dashboard routes in repo", "confidence": "high" },
      { "model": "ecommerce_digital", "signal": "one-time 'lifetime license' Payment Link", "confidence": "medium" }
    ]
  },
  "brand": {
    "name": "Acme",
    "tagline": "…",
    "audience": "…",
    "tone": "…",
    "logo_url": "…",
    "colors": ["#…"],
    "social": {},
    "support_channels": []
  },
  "legal": {
    "entity_name": "Acme Technologies Ltd",
    "registration_number": null,
    "vat_id": null,
    "registered_address": null,
    "jurisdiction": null,
    "contact_email": null,
    "source": "website_footer+terms",
    "needs_confirmation": true
  },
  "products": [
    {
      "name": "Pro plan",
      "type": "subscription",
      "category": "…",
      "prices": [
        { "amount": 3900, "currency": "usd", "cadence": "month",
          "source": "stripe", "marketed_amount": 2900, "needs_confirmation": true }
      ],
      "stripe_ids": { "product": "prod_…", "price": "price_…" }
    }
  ],
  "tech": {
    "stack": ["next.js"],
    "hosting": "cloudflare_pages",
    "stripe_wiring": "checkout in src/app/checkout/…",
    "catalog_defined_in": "content/products.ts",
    "expected_env_vars": ["STRIPE_SECRET_KEY", "…"]
  },
  "open_questions": [
    "Website lists $29/mo but active Stripe price is $39/mo — which is correct?"
  ]
}
```

### 7.7 Reconciliation contract (timeouts & resilience)

- The main flow **never blocks** on the scans. At Phase 6 it checks for the `.done` markers.
- `child_timeout_seconds` is 600s. If a scan exceeds it or errors, the main flow records a
  `todo` ("re-run website scan"), synthesizes from whatever sources are available, and still
  reaches `complete`. A later run finishes the missing scan and re-synthesizes.
- Subagents write to **files** (not just return values) so partial work survives a gateway
  restart mid-onboarding.
- Synthesis is **re-runnable**: re-running it overwrites `company-profile.json` from current
  signals + Stripe, but never destroys user-confirmed corrections (those are merged back).

---

## 8. KB structure (created only if absent)

```
$AO1_KB_PATH/
  README.md
  .onboarding-state.json
  company/
    profile.md
    website.md
    payments.md
  products/
    catalog.md
  operations/
    stripe.md
    hosting.md          # Cloudflare deploy target + site↔Stripe relationship
  decisions/
    YYYY-MM-DD-onboarding.md
  raw/
    onboarding/
      website-scan.md
      repo-scan.md
```

Curated pages stay concise; raw scan output stays under `raw/onboarding/`.

---

## 9. Definition of done (acceptance check)

Onboarding is `complete` only when all of these pass:

- [ ] `codex` authenticated; agent can run a model turn.
- [ ] `$AO1_KB_PATH` exists with the §8 structure and at least the curated company pages.
- [ ] Stripe read-only probe returned the catalog (products/prices/links) into KB.
- [ ] Cloudflare authenticated and the deploy target is recorded in `operations/hosting.md`.
- [ ] Company repo recorded (if provided) and its scan reconciled or queued as a `todo`.
- [ ] Telegram bot created, **locked to the owner's user ID**, gateway restarted, test
      message received.
- [ ] `decisions/<date>-onboarding.md` written; state file `status: complete`.

Background website/repo scans may still be pending — they are tracked as `todos`, not
blockers.

---

## 10. Safety posture

The onboarding skill and `config.yaml` must enforce, independent of approval mode:

- **No secret ever printed**, and no secret accepted over Telegram.
- **Live Stripe writes** require explicit confirmation; onboarding itself is read-only on
  Stripe.
- **No Cloudflare deploy** during onboarding; auth + record only.
- **Company repo is read-only during onboarding.** Later operational writes happen on a
  branch, never push to `main` unprompted, always confirm a deploy. Use `gh` over HTTPS (per
  machine policy SSH to GitHub is unreliable; never rely on `git push`/SSH).
- Surface the `privacy.redact_pii: false` + customer-data-over-Telegram tradeoff to the user
  as a conscious choice.

---

## 11. File changes this spec implies

| File | Change |
|---|---|
| `skills/onboarding/SKILL.md` | **New.** Owns Phases 1–8; drives the state file; spawns/reconciles scan subagents. |
| `SOUL.md` | Add first-run guard (§4.1) + "onboard the company first, then operate from KB." |
| `config.yaml` | Point model at Codex provider (§4.2); tighten approval gates for live Stripe / CF deploy / repo write / git push. |
| `.env.example` | Reframe for Codex (drop required OpenRouter key), group by onboarding step, add `STRIPE_SECRET_KEY`, `CLOUDFLARE_API_TOKEN` (optional), keep Telegram. |
| `distribution.yaml` | Name onboarding as entrypoint; update `env_requires` (Codex auth, company repo path optional, Cloudflare); drop OpenRouter-required framing. |
| `README.md` | Replace "What You Get" with the Phase 0 → Telegram first-run flow; fix the `kb-syncing` "coming soon" claim. |
| `cron/` | (Later) capture→KB jobs once KB is bootstrapped — out of scope for this spec. |

---

## 12. Open implementation questions

1. **Exact Codex provider wiring in `config.yaml`** — express Codex as the chat model
   directly, or route via the codex-exec path shown in `config/ao1-intern.local.json`?
   Confirm the provider key Hermes expects and how it reads Codex subscription auth.
2. **Subagent backgrounding semantics** — confirm Hermes delegation can run children
   fire-and-forget (file-based handoff) vs. orchestrator blocking on child return. The
   file + `.done` marker contract (§7) is designed to work either way, but verify.
3. **`wrangler` non-interactive path** — confirm whether `CLOUDFLARE_API_TOKEN` covers
   listing Pages/Workers, or whether `wrangler login` (browser) is required for discovery.
4. **Where `.onboarding-state.json` should live** if `$AO1_KB_PATH` doesn't exist yet at
   Phase 1 — create the KB dir first, then the state file inside it.
```
