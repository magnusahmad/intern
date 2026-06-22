# AGENTS.md — Guidance for Agents Working in `ao1-intern`

This repo is the **AO1 Intern profile distribution** — a shareable Hermes agent
packaged as a git repository. Consumers install it with:

```bash
hermes profile install https://github.com/magnusahmad/ao1-intern
```

The distribution root (`./`) is the Hermes profile root. These files are the
distribution contract:

| File | Purpose |
|------|---------|
| `distribution.yaml` | Manifest: name, version, required env vars |
| `SOUL.md` | Agent personality and operating principles |
| `config.yaml` | Base config (model, toolsets, delegation, gateway) |
| `skills/` | Bundled skills (ao1-intern, ao1-kb-filing) |
| `cron/` | Scheduled job definitions |
| `mcp.json` | MCP server connections |
| `.env.example` | Required env vars template |

---

## For agents running inside this profile

**Routing:**
- Resolve the target repo before launching a worker. Use explicit repo names first, then aliases from the Intern resolver.
- Start the worker in the target repo cwd so the target repo `AGENTS.md` is naturally in scope.
- Treat `$AO1_KB_PATH` as durable AO1 memory. Use concise KB pointers instead of copying large KB content into handoffs.
- Default to Codex for repo-heavy, shell-heavy, implementation-heavy work.
- Use Claude print mode for bounded analysis when the operator asks for Claude or config selects it.
- Explicit operator backend choice wins over defaults.

**Conversation continuity:**
- Hermes owns the chat session, active process handle, `/resume`, `/stop`, `/approve`, `/deny`, `/background`, and user replies.
- When delegating to a worker, do not treat worker launch as task completion. Wait for the worker's final answer and return that answer in the same response.
- If the work is intentionally backgrounded, send an explicit status reply with the worker/session id, current state, and what operator action resumes or checks it.
- Do not create an Intern-specific `waiting_for_user` or `waiting_for_approval` state machine.
- If a worker asks a question, relay it in the same Hermes chat and submit the operator reply to the active worker process.

**Safety and audit:**
- Live-service confirmation rules belong in the target repo `AGENTS.md`, not in generated Intern prompts.
- Do not put secrets, OAuth tokens, private keys, raw terminal logs, or full prompts into audit artifacts.
- Record concise delegation metadata under `.ao1-intern/delegations/`: origin, target cwd, backend, command template name, Hermes/process ids, timestamps, status, and final operator summary.
- Keep manual triggers and scheduled observer behavior aligned when replacing any V1 filing behavior.

**KB filing (ao1-kb-filing skill):**
- Read AO1 KB rules first, then transform latest raw connector manifest items into concise KB-ready markdown.
- Follow KB-local rules in `AGENTS.md`, `README.md`, and `index.md`.
- Keep raw connector exports out of the curated surface.
- Include owner, review date, sources, related links, concept target, and evidence IDs.
- Prefer existing concept folders and pages when they fit.
- Create a new concept slug only when no current concept is appropriate.
- Record why an item was kept, merged, split, or discarded.

**Rules for all work:**
- Use red/green TDD for every runtime behavior.
- Do not commit secrets, model API keys, OAuth refresh tokens, private keys, or copied Codex credentials.
- Keep heavy-lift agent delegation loosely coupled: Codex and Claude should be backend choices, not baked-in Intern semantics.
- Put repo-specific operating rules in the target repo's `AGENTS.md`, and point those rules to the relevant AO1 KB context.

---

## For agents working on this distribution itself

- Edit `SOUL.md` to update personality or operating principles.
- Edit `distribution.yaml` to update version or required env vars.
- Edit `config.yaml` to update base model or tool defaults — but prefer keeping it generic so consumers can override.
- Skills live in `skills/` — each skill is a subdirectory with a `SKILL.md`.
- Cron jobs live in `cron/` — add `.cron` files there.
- Test changes by importing into a fresh profile: `hermes profile install <local-path> --name test-import`
