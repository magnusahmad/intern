---
name: task-ledger
description: "Checkpoint and resume consequential multi-step work that may outlive a session, wait on another system, or be interrupted. Use for ongoing work with a concrete outcome and meaningful next step; do not use for quick single-turn tasks."
---

# Task Ledger

Keep long-running work resumable in the company KB without turning ordinary tasks into process.

## Workflow

1. Read `operations/open-tasks.md` in the Intern KB before starting. Resume a matching task rather
   than opening a duplicate.
2. Create or update one concise entry with:
   - outcome
   - current state and last verified evidence
   - next safe action
   - blocker or approval needed, if any
   - last-updated timestamp
3. Refresh the entry after a material state change, before a deliberate wait, and before ending an
   incomplete session. Preserve useful artifacts by linking their paths instead of copying them.
4. When the outcome is verified, remove the open entry and append one concise completion line with
   the evidence to the existing KB log using the `kb` skill's `scripts/kb-log.sh`.

Never store credentials, message bodies containing private data, or speculative status. Keep
judgment in the agent: the ledger records the outcome and evidence, not a rigid execution plan.
