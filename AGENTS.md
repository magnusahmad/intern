# AGENTS.md

Guidance for agents working in `ao1-intern`:

- Use red/green TDD for every runtime behavior.
- Treat `/Users/magnus/Documents/Projects/ao1-kb` as the source of KB markdown and concept-routing rules.
- V1 writes processed markdown into this repo, but the purpose is eventual KB write-back behind `kb_write_enabled`.
- Do not commit secrets, model API keys, OAuth refresh tokens, private keys, or copied Codex credentials.
- Scheduler installation is manual: generate reviewed artifacts and instructions, do not mutate real crontab or LaunchAgents.
- Keep the manual trigger path behavior-identical to the scheduled observer path.
