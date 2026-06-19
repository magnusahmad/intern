# AO1 Intern V2: Hermes Gateway, KB, And Swappable Worker Agents

Status: draft for implementation

## Summary

AO1 Intern V2 should be a thin operator surface over Hermes, the AO1 KB, and subscription-metered worker agents such as Codex and Claude. Hermes owns chat delivery, per-chat sessions, resume, slash commands, background process handles, user back-and-forth, and conversational planning. Intern owns AO1-specific conventions: which repo a request targets, which KB context matters, which backend to prefer by default, and how outputs are audited.

The important simplification: do not build a deterministic Intern chat planner or a new Intern state machine for delegated work. Hermes already has OpenRouter-backed chat, sessions, `/resume`, `/stop`, `/approve`, `/deny`, `/background`, active-process guards, and process input/output tools. Use those instead.

## Goals

- Keep Intern independent from any single model vendor or coding-agent ecosystem.
- Route heavy work to Codex, Claude, or later backends while preserving one user-facing chat surface.
- Use subscription-metered inference where useful, especially for local repo and CLI work.
- Make back-and-forth questions feel native in the Intern interface.
- Keep task-specific safety and context rules in `AGENTS.md` files and AO1 KB pages, not in a bespoke orchestration language.
- Preserve the current discipline that manual and scheduled paths share behavior.

## Non-Goals

- Do not create a custom `waiting_for_user` / `waiting_for_approval` workflow engine.
- Do not create a deterministic local chat planner for the Intern.
- Do not invent a JSON protocol for backend follow-up questions.
- Do not make Codex the architectural center of Intern.
- Do not duplicate Hermes gateway, session storage, or background process management.
- Do not hide dangerous live-service rules inside generated prompts when they belong in target repo instructions.

## Architecture

```text
User message
-> Hermes gateway
-> Hermes session for the chat/thread
-> AO1 Intern skill/profile context
-> target repo selection
-> target repo AGENTS.md + AO1 KB context
-> worker backend: Codex, Claude, or another agent
-> Hermes relays progress, questions, answers, and final result
```

Hermes remains the interactive shell around the work. Intern V2 should be implemented as repo-local code plus Hermes skill/profile instructions that teach Hermes how AO1 wants work routed.

## Core Design Decisions

### 1. Hermes Owns Conversation Continuity

Each Telegram/web thread maps to a Hermes session. If a worker agent asks a question, Hermes returns that question in the same chat. The user's reply continues the same Hermes session, and Hermes can submit the reply to the active worker process.

No extra Intern task-state table is required for normal operation. If we store anything, it should be audit metadata only: origin, target repo, backend, process/session id, started time, completed time, and final summary path.

### 2. Worker Agents Are Backends, Not Intern Semantics

Codex and Claude are selected because they are useful and often subsidized through subscriptions. Intern should not assume one of them is the permanent execution layer.

Initial backend choices:

- Codex for repo-heavy, shell-heavy, implementation-heavy work.
- Claude Code print mode for bounded non-interactive analysis or edits.
- Claude Code interactive/tmux mode only when true multi-turn Claude work is needed.
- Explicit user backend choice wins over defaults.

This can start as documented launch templates rather than a generalized adapter framework.

### 3. `AGENTS.md` Is The Rule Boundary

For codebase work, target repo `AGENTS.md` files are the operational contract. They should tell worker agents:

- Which AO1 KB pages or folders to read for context.
- Which repo-local commands and tests matter.
- Which live systems are high-risk.
- Which actions require explicit operator confirmation.
- How to verify changes after mutation.

Intern's job is to launch the worker in the correct target repo so that its `AGENTS.md` is naturally loaded. If a Stripe repo needs pricing safety rules, those rules belong in that repo's `AGENTS.md`, with links or paths to relevant AO1 KB context.

### 4. AO1 KB Is Durable Memory

AO1 KB remains the source of durable company context and concept-routing rules. Intern V2 can retrieve or point to KB context, but it should avoid copying large KB blobs into every handoff. Prefer concise references and repo rules that direct agents to the right files.

### 5. Manual And Scheduled Paths Stay Aligned

Current V1 filing behavior can remain while V2 is introduced. When V2 replaces a behavior, the manual trigger and scheduled observer must call the same underlying path or Hermes skill with the same inputs.

## User Flows

### Heavy Repo Task

```text
User:
Can you update the onboarding copy in memento and run tests?

Hermes:
Uses the AO1 Intern context to identify the target repo.
Starts Codex or Claude in that repo.
Worker reads repo AGENTS.md and relevant KB context.
Worker edits, tests, and reports result.
Hermes returns the summary to the same chat.
```

### Example Live Stripe Pricing Task

```text
User:
Update Pro pricing to $25/month in Stripe.

Hermes:
Routes to the Stripe-owning repo and starts the selected worker backend.

Worker:
Reads that repo's AGENTS.md.
Reads the KB pricing/billing context named by AGENTS.md if it exists.
Inspects current Stripe state.
Asks for explicit confirmation before live mutation.

Hermes:
Relays the question to the user.

User:
yes

Hermes:
Submits the answer to the active worker process.

Worker:
Runs the Stripe CLI mutation.
Reads the live Stripe object back.
Reports object ids and verification.

Hermes:
Returns the final concise audit summary.
```

The confirmation behavior comes from target repo rules, not from an Intern-specific approval engine.

### Scheduled KB Filing

Current `file-latest-sync` can remain as the batch implementation until replaced. Any V2 replacement must expose the same behavior to manual chat triggers and scheduled runs.

## Implementation Plan

### Phase 1: Specify And Install The Hermes-Level Intern Surface

- Add an AO1 Intern Hermes skill/profile that explains target repo selection, KB usage, backend selection, and audit expectations.
- If the repo-local Telegram bridge is used during dogfood, keep it as a transport shim into `hermes chat`; it must not classify user messages into local Intern intents.
- Document the operator commands that should be used through Hermes gateway.

### Phase 2: Add Target Repo Resolution

- Implement a small resolver for known AO1 repos and aliases.
- Return target cwd, KB context pointers, and preferred backend.
- Red/green tests should cover explicit repo names, aliases, ambiguous requests, and unknown targets.

### Phase 3: Add Backend Launch Templates

- Codex background PTY template for long repo work.
- Codex one-shot template for bounded tasks.
- Claude print-mode template for bounded tasks.
- Claude interactive/tmux template only if needed.
- Red/green tests should assert generated commands, cwd, and no secret material in prompts or logs.

### Phase 4: Add Minimal Audit Artifacts

- Write one artifact per delegated run under `.ao1-intern/delegations/`.
- Record origin, backend, cwd, command template name, external process/session id, started/completed timestamps, and final operator summary.
- Do not store secrets, OAuth tokens, or full raw terminal logs by default.

### Phase 5: Move Operator UX To Hermes Gateway

- Configure Hermes gateway allowlisting/pairing for Magnus and Suley.
- Use Hermes sessions for `/resume`, `/stop`, `/approve`, `/deny`, `/background`, and `/compress`.
- Retire or freeze any bespoke `telegram-poll` planner behavior; Telegram must be a Hermes Agent chat surface.

## Expected Repo Changes

- `skills/ao1-intern/SKILL.md`: Hermes-facing AO1 Intern operating guide.
- `src/target-repos.mjs`: target repo and alias resolver.
- `src/backend-templates.mjs`: command builders for Codex and Claude launch patterns.
- `src/delegation-audit.mjs`: minimal audit artifact writer.
- `tests/target-repos.test.mjs`: resolver tests.
- `tests/backend-templates.test.mjs`: command builder tests.
- `tests/delegation-audit.test.mjs`: secret scan and artifact shape tests.
- `README.md`: mark V2 Hermes gateway path as the preferred operator path once implemented.
- `src/chat-control.mjs`: forward allowlisted Telegram text to Hermes Agent instead of running an Intern planner.

## Acceptance Criteria

- A Telegram/Hermes gateway message can route a task to a target repo and selected backend without custom Intern planning or session state.
- A worker agent launched from Intern sees the target repo `AGENTS.md` and can follow KB pointers from that file.
- Codex and Claude can both be selected through config or explicit user request.
- A follow-up question from a worker can be answered in the same Hermes chat and submitted back to the active worker process.
- Live-service safety rules are documented in the relevant target repo `AGENTS.md`, not hardcoded as generated handoff prompts.
- Delegated runs create concise audit artifacts without secrets.
- Existing scheduled filing behavior remains available while V2 is introduced.

## Open Questions

- Which target repos should be in the first resolver table?
- Should the default backend be Codex for all implementation work, or should Claude be the default for bounded analysis?
- Where should the AO1 Intern Hermes skill be installed from during dogfood: this repo, `~/.hermes/skills`, or both?
- Which KB pages should be referenced by the first target repo `AGENTS.md` updates?
- When V2 is stable, should the custom Node Telegram bridge be removed or kept as a fallback?
