# OS Sandboxing, Audit, and Rollback for Autonomous Agent Runs

Status: draft for implementation

## Summary

AO1 Intern runs worker agents (Hermes, Codex) autonomously. This spec defines the
runtime containment for those runs. The containment is **OS-level only**: filesystem,
network egress, and process isolation. The agent decides what it needs and acts
without per-action human approval. We do not scope connector-semantic actions (e.g.
which Stripe calls are allowed) and we do not harden against prompt injection in this
iteration.

Containment is provided by **NVIDIA OpenShell** (the sandbox) and **NemoClaw** (the
management stack that runs agents inside OpenShell). AO1 does not rebuild that layer.
The one capability NemoClaw/OpenShell does **not** provide — recovery of mutated or
deleted local files — is added by AO1 as a thin rollback layer on top, using existing
open-source tools (git, restic, OverlayFS) rather than a custom engine.

The contract:

```text
Static baseline (fs + network ceiling, set by operator, deny-by-default)
-> agent runs inside OpenShell sandbox via NemoClaw, no per-action approval
-> in-baseline operations auto-allowed; out-of-baseline operations fail closed + logged
-> NemoClaw/OpenShell emit the audit trail (tool calls, network, fs boundary)
-> AO1 snapshots writable roots before the run
-> on damage, AO1 rolls back local filesystem state from the snapshot
```

## Threat Model

**Assume an honest-but-fallible agent.** The sandbox exists to (a) contain *accidental*
blast radius, (b) produce a deterministic record of what was touched, and (c) make
local damage *recoverable*. It is **not** a defense against an adversarial or
prompt-injected agent: an agent that can pick its own grant within the baseline can do
harm within that baseline, and out-of-process enforcement is not perfect (NemoClaw has
publicly had an agent copy its own config and restart to evade controls). Hardening
against a hostile agent is explicitly out of scope for this iteration.

The only hard boundary is the **static baseline** the agent cannot widen durably.

## Scope

In scope:

- OS-level containment: filesystem roots, network egress, process isolation.
- Autonomous execution with no per-action human approval.
- A deterministic audit trail of resources and operations the agent touched.
- A recovery/rollback path for local filesystem damage (deleted docs, wrong mutations).

Out of scope (this iteration):

- Connector-semantic policy (which Stripe/QuickBooks/Gmail operations are allowed).
- Prompt-injection hardening or defense against an adversarial agent.
- Per-action or per-operation human approval workflows.
- Rollback of external side effects (a sent email, a Stripe mutation) — see
  "Irreversibility boundary".

## Architecture: NemoClaw / OpenShell vs AO1

OpenShell and NemoClaw are not alternatives. NemoClaw runs agents **inside** OpenShell.

| Capability | Owner |
|---|---|
| Container process isolation | OpenShell |
| Filesystem boundary (RW `/sandbox` + `/tmp`, system read-only) | OpenShell |
| Network egress containment (deny-by-default) | OpenShell |
| Network policy definition + enforcement | NemoClaw |
| Credential gateway + inference proxy (secrets never reach the agent) | NemoClaw |
| Audit logging of tool calls and network requests | NemoClaw |
| Sandbox lifecycle orchestration | NemoClaw |
| **Filesystem snapshot / rollback / file recovery** | **AO1 (this spec)** |

AO1 adopts the NemoClaw/OpenShell layer rather than reimplementing network allow-lists,
credential injection, or audit collection. The repo's checked-in `src/policy.mjs`,
`src/host-broker.mjs`, and `src/secrets.mjs` become the **host-side bridge/fallback**
used only when the sandbox is unavailable; they are not the primary enforcement path.

## The Static Baseline (the ceiling)

NemoClaw is deny-by-default. The baseline policy lives in one file
(`nemoclaw-blueprint/policies/openclaw-sandbox.yaml`) and defines the maximum authority
any run can have:

- **Filesystem:** read roots and writable roots (writable confined to `/sandbox`; the
  workspace is mounted in as described under "Rollback").
- **Network:** the egress endpoints the agent may reach.
- **Hard exclusions:** paths and destinations never granted (e.g. `~/.ssh`, unrelated
  repos, host escape).

The baseline is set once by the operator/distribution, equivalent in role to the
existing `config/permissions.example.json` ceiling. Static changes to the baseline take
effect on the next sandbox creation; dynamic changes reset to baseline when the sandbox
stops. The baseline is therefore the durable ceiling, by design.

## Autonomous Execution (no approval)

- Endpoints and paths **listed in the baseline are auto-allowed**. There is no prompt
  and no human in the loop for in-baseline operations. This is NemoClaw's default
  behavior, not something AO1 builds.
- Operations **outside the baseline fail closed**: the request is denied and logged. For
  unattended and scheduled runs, AO1 does **not** start NemoClaw's interactive TUI
  approver, so an out-of-baseline hit becomes a logged deny rather than a blocking
  prompt. "The model decides what it needs" therefore means: within the baseline the
  agent acts freely; beyond it, the action is denied and recorded, with no human gate.
- If a class of work legitimately needs more reach, the operator widens the static
  baseline file — an out-of-band config edit, not a per-run approval.

## Audit Trail

Sourced from runtime facts, never from the agent's own account of what it did:

- **Tool calls + network requests:** from NemoClaw's audit log (host, port, requesting
  binary, allow/deny).
- **Filesystem changeset:** from the OverlayFS upper layer of the run — added/modified
  files plus whiteout entries (deletions). This is a real diff.
- **Process/exec:** command log, with secret values scrubbed (reuse
  `assertNoSecretsInText` from `src/secrets.mjs`).

The combined record is written **append-only, outside the writable roots**, keyed by run
id, extending the existing `.ao1-intern/delegations/` artifact
(`src/delegation-audit.mjs`). The agent cannot edit its own trail.

## Rollback (the only piece AO1 builds — thin)

Rollback recovers **local filesystem state**. AO1 builds no rollback engine; it
orchestrates three OSS mechanisms:

1. **OverlayFS (in-container, kernel):** the run's upper layer is both the audit diff
   and a discardable changeset. Discarding it = rollback of an unmerged run.
2. **git (version-controlled roots — the KB and target repos):** every run starts from a
   clean tree and produces one per-run commit (the v1 per-run commit policy already does
   this). Rollback = `git revert <run-commit>`. This covers most "important docs".
3. **restic (non-git writable roots):** `restic backup` the writable root before the run;
   rollback = `restic restore` to the pre-run snapshot. Scriptable, path-level, deduped.

Glue AO1 adds:

- Snapshot-before-run of the writable roots (git clean-tree check + commit, or restic
  backup).
- `rollback <run-id>` command that calls `git revert` or `restic restore` for that run.
- Optional `unlink` interposition → move deletions to `.ao1-intern/trash/<run-id>/` so
  in-baseline deletions are recoverable without a full rollback.
- A retention window for snapshots and trash.

### Irreversibility boundary

Rollback covers the local filesystem only. **External side effects — a sent email, a
Stripe mutation, a posted accounting entry — cannot be rolled back.** For those the
audit trail is the only recourse. This is stated plainly so "rollback" is not oversold;
it is an accepted consequence of descoping connector control.

## Expected Repo Changes

- `nemoclaw-blueprint/policies/openclaw-sandbox.yaml`: the static baseline (fs + network
  ceiling), derived from the current `config/permissions.example.json`.
- `src/runtime-probe.mjs`: correct the readiness model — NemoClaw runs on OpenShell, so
  they are complementary, not interchangeable. Readiness = OpenShell sandbox up **and**,
  when NemoClaw is used, its gateway connected. (Today it blocks only if *neither* is
  found, `src/runtime-probe.mjs:34-39`.)
- `src/run-snapshot.mjs`: snapshot-before-run (git clean-tree/commit or restic backup).
- `src/rollback.mjs` + `rollback <run-id>` CLI: `git revert` / `restic restore` wrapper.
- `src/delegation-audit.mjs`: extend the run record with the NemoClaw audit log
  reference, the OverlayFS changeset, and the snapshot/restore handle.
- `src/policy.mjs`, `src/host-broker.mjs`, `src/secrets.mjs`: demote to host-side
  bridge/fallback for when the sandbox is unavailable; document them as not the primary
  enforcement path.
- Tests: baseline-ceiling validation, audit record shape (no secrets), snapshot+rollback
  round-trip, restic/git restore correctness, fail-closed on out-of-baseline egress.

## Implementation Plan

### Phase 1: Baseline and sandbox wiring
- Author `openclaw-sandbox.yaml` from the existing permissions ceiling.
- Run a worker under NemoClaw/OpenShell with the baseline; confirm in-baseline ops are
  auto-allowed and out-of-baseline egress fails closed + logged (no interactive approver
  in unattended mode).

### Phase 2: Audit consumption
- Collect NemoClaw audit log + OverlayFS changeset + scrubbed exec log into the
  `.ao1-intern/delegations/` run record, append-only, outside writable roots.

### Phase 3: Snapshot + rollback
- Snapshot-before-run (git for repo roots, restic for the rest).
- `rollback <run-id>` wrapper; retention window; optional trash-on-delete.

### Phase 4: Probe and fallback
- Fix `runtime-probe` readiness model; fail closed if the sandbox is unavailable
  (stop, or run the host-broker bridge only for explicitly allowed bounded work).

### Phase 5: Dogfood
- Run KB filing and delegated repo work under the sandbox; verify audit completeness and
  a real rollback of a deleted KB page and a wrong mutation.

## Acceptance Criteria

- A run executes inside OpenShell/NemoClaw with no per-action human approval.
- In-baseline filesystem and network operations are auto-allowed; out-of-baseline egress
  is denied and logged without prompting.
- The agent cannot durably widen its own baseline.
- Every run produces an append-only audit record of files touched, hosts contacted, and
  commands run, sourced from runtime facts and stored outside writable roots.
- A deleted document and an unwanted file mutation can both be recovered via
  `rollback <run-id>` (git revert or restic restore).
- The audit trail and rollback rely on NemoClaw/OpenShell + git/restic/OverlayFS, not a
  custom enforcement or rollback engine.
- External side effects are documented as non-recoverable; only the audit trail covers
  them.
- If the sandbox is unavailable, the system fails closed per the configured fallback.

## Open Questions

- How is the workspace mounted into `/sandbox` — copy-in, bind-mount behind an overlay,
  or restic snapshot of a bind-mount? (Determines whether mutations hit the live tree
  mid-run.)
- restic vs OverlayFS-discard as the primary rollback mechanism for non-git roots, or
  both?
- What retention window for snapshots and `.ao1-intern/trash/`?
- Should the host-broker/`sandbox-exec` bridge remain a real fallback execution path, or
  only a preflight check before requiring the sandbox?
- Where is the audit record stored long-term — repo, AO1 control plane, or both — given
  the agent must not be able to edit it?
```
