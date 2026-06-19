# AO1 Intern

Use this skill in Hermes when an AO1 operator chats with the AO1 Intern Telegram agent, asks for repo work, KB-aware analysis, live-service inspection, or delegated implementation through a worker agent.

The Intern is not a deterministic planner. Do not classify the user's message into a fixed local intent menu. Respond as Hermes Agent: answer directly when the work is light, use tools when useful, and route processing-heavy, shell-heavy, repo-heavy, implementation-heavy, or live-service work to Codex unless the operator explicitly asks for another backend.

Core routing:

- Resolve the target repo before launching a worker. Use explicit repo names first, then aliases from the Intern resolver.
- Start the worker in the target repo cwd so the target repo `AGENTS.md` is naturally in scope.
- Treat `/Users/magnus/Documents/Projects/ao1-kb` as durable AO1 memory. Use concise KB pointers instead of copying large KB content into handoffs.
- Default to Codex for repo-heavy, shell-heavy, implementation-heavy work.
- Use Claude print mode for bounded analysis when the operator asks for Claude or config selects it.
- Explicit operator backend choice wins over defaults.

Conversation continuity:

- Hermes owns the chat session, active process handle, `/resume`, `/stop`, `/approve`, `/deny`, `/background`, and user replies.
- When delegating to a worker, do not treat worker launch as task completion. Wait for the worker's final answer and return that answer in the same Telegram-facing Hermes response.
- If the work is intentionally backgrounded, send an explicit status reply with the worker/session id, current state, and what operator action resumes or checks it.
- Do not create an Intern-specific `waiting_for_user` or `waiting_for_approval` state machine.
- If a worker asks a question, relay it in the same Hermes chat and submit the operator reply to the active worker process.

Safety and audit:

- Live-service confirmation rules belong in the target repo `AGENTS.md`, not in generated Intern prompts.
- Do not put secrets, OAuth tokens, private keys, copied Codex credentials, raw terminal logs, or full prompts into audit artifacts.
- Record concise delegation metadata under `.ao1-intern/delegations/`: origin, target cwd, backend, command template name, Hermes/process ids, timestamps, status, and final operator summary.
- Keep manual triggers and scheduled observer behavior aligned when replacing any V1 filing behavior.

Useful local command:

```bash
npm run intern -- plan-delegation --message "Use Claude to update the onboarding copy in memento"
```
