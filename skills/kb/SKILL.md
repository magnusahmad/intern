---
name: kb
description: 'Read, capture, and maintain the Intern knowledge base (the company brain) at $INTERN_KB_PATH. Use it two ways — on request ("what do we know about X", "write this down", "check the KB") AND on your own initiative: whenever you learn, correct, or confirm a durable fact about the business while doing any other task, call this skill to capture it. It resolves the KB, orients on existing pages first (so it never duplicates), and writes concise, cross-linked pages plus an append-only log. Idempotent and merge-safe.'
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [macos, linux]
prerequisites:
  # INTERN_KB_PATH is intentionally NOT a prerequisite: when unset the skill resolves the KB to
  # the current working directory (same rule as SOUL.md / onboarding), so Hermes must not prompt.
  commands: []
metadata:
  hermes:
    tags: [kb, knowledge-base, memory, wiki, capture, company-brain]
---

# KB — Capture & Maintain the Company Brain

The Intern KB at `$INTERN_KB_PATH` is durable, shared company memory. This skill is how you
**read it before acting** and **write durable facts back** so tomorrow's you (and every other
skill) inherits what you learned. It is deliberately usable **without being asked** — see
"When to self-invoke."

The single rule that makes the KB trustworthy: **orient before you write.** Always read the
existing structure first so you update the right page instead of creating a duplicate.

## Resolve the KB

- If `INTERN_KB_PATH` is set and non-empty, use it.
- Otherwise use the current working directory (the dir `hermes` was launched from) — the same
  rule SOUL.md and onboarding use, so all three resolve to the same place.

If the orientation files below don't exist yet (e.g. a KB created before this skill), create the
missing ones with minimal stubs — never overwrite an existing file.

## KB layout

```
$INTERN_KB_PATH/
  SCHEMA.md        # conventions + tag taxonomy (the rules; read first)
  index.md         # catalog: every page with a one-line summary (orient here)
  log.md           # append-only capture/action log (audit trail)
  kb-graph.html    # optional visual map (regenerated from [[wikilinks]])
  company/         # profile, brand, legal entity, payments
  products/        # catalog, real prices
  operations/      # stripe, hosting, tooling, how things are wired
  decisions/       # dated decision records
  people/          # team, key contacts (create on demand)
  customers/       # durable customer facts (create on demand; NEVER secrets/PII dumps)
  raw/             # immutable source material — never edit, only add
```

## Orient first (every invocation, read-only)

1. Read `SCHEMA.md` — conventions, tag taxonomy, page types. Create a minimal one if absent.
2. Read `index.md` — the catalog of what already exists. Create it if absent.
3. Skim the tail of `log.md` (last ~20 lines) — recent activity, so you don't redo work.

Only after orienting do you write anything.

## Operation: capture (the core, and what you self-invoke)

When you have a durable fact to record:

1. **Threshold check — is it worth a page edit?** Capture when it's: a new fact not already in
   the KB; a **correction** to something the KB currently says; a decision made; or a durable
   detail about the company, a product/price, operations/tooling, a person, a customer, or
   company lore. **Skip** when it's: transient/task-local, already recorded, speculation (unless
   you record it explicitly as `confidence: low`), or a **secret** (API keys, tokens, passwords,
   card/PII — those never go in the KB; they live only in `.env`).
2. **Find the right home.** Search `index.md` and the relevant folder for an existing page. If
   one exists, **update it** — merge, don't clobber; preserve user-confirmed corrections. If two
   sources disagree, record **both**, mark the field `contested: true`, and surface the conflict
   rather than silently picking one.
3. **Write concisely.** Curated pages stay tight; bulk source material goes under `raw/`. Give
   every page the frontmatter below and **at least two outbound `[[wikilinks]]`** so the KB stays
   a connected graph (e.g. a product links to `[[catalog]]`, `[[payments]]`).
4. **Update the catalog.** Add or refresh the page's one-line summary in `index.md`; bump the
   page's `updated:` date.
5. **Log it.** Append one line to `log.md` via the helper (atomic, correctly formatted):
   ```bash
   scripts/kb-log.sh "captured: <page> — <what changed> (<why/source>)"
   ```
6. **Refresh the graph (optional).** If the KB changed materially, regenerate `kb-graph.html`
   with the bundled generator in the onboarding skill
   (`skills/onboarding/scripts/build_kb_graph.py "$INTERN_KB_PATH"`). Skip if unavailable.

Capture is **idempotent**: re-running with the same fact should update in place and not create a
second page or a duplicate log spam.

## Operation: query

Orient (SCHEMA + index), locate the relevant pages, synthesize a concise answer, and **cite the
pages** you used rather than pasting large blobs. If the question exposes a gap, note it (and
capture the answer if you just discovered it).

## Operation: lint (light health check)

On request ("check/clean the KB"), scan for: orphan pages (no inbound `[[wikilinks]]`), broken
wikilinks (dead targets), pages missing frontmatter, `index.md` entries that no longer exist (or
pages missing from the index), and stale pages (`updated:` > 90 days). Report findings; fix the
mechanical ones (index drift, obvious broken links) and flag judgment calls for the user.

## Page frontmatter (required on every curated page)

```yaml
---
title: Human Readable Title
created: YYYY-MM-DD
updated: YYYY-MM-DD
type: company | product | customer | operations | decision | person | fact
tags: [from SCHEMA.md taxonomy]
sources: [raw/onboarding/website-scan.md]   # optional provenance
confidence: high | medium | low              # optional
contested: true                              # optional, when sources disagree
---
```

Naming: lowercase, hyphens, no spaces (`company-profile.md`, `sauna-wear.md`). Link targets are
the filename without extension (`[[company-profile]]`).

## Guardrails

- **Never store secrets or raw PII** in the KB. Keys/tokens live only in `.env`; customer pages
  hold durable business facts, not payment data or credentials.
- **Never edit `raw/`** — it's immutable source material. Add new files, don't rewrite.
- **Orient before writing**, always — the whole point is to update, not duplicate.
- **Merge, don't clobber** — especially over user-confirmed corrections.
- Keep curated pages concise; push bulk material to `raw/`.

## When to self-invoke (no user request needed)

Per SOUL.md's KB-maintenance mandate: at the end of any task, if you learned or corrected a
durable business fact, **call this skill's capture path before you finish** — don't wait to be
asked. Onboarding's Phase 5 is simply the first, largest capture; day-to-day operation is a
steady stream of small ones. A brain is only a brain if it's actively maintained.
