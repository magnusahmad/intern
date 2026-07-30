# Run Intern in Slack with Centaur

This overlay runs Intern's charter and skills inside Centaur's existing Codex harness. Centaur
provides Slack ingress, durable threads, sandbox isolation, tools, and credential boundaries.
It is not a Hermes harness.

## 1. Boot the pinned overlay

Follow Centaur's [quickstart](https://centaur.run/quickstart) through cluster setup, then export:

```bash
export OP_SERVICE_ACCOUNT_TOKEN=...
export OP_VAULT=...
export SLACK_BOT_TOKEN=...
export SLACK_SIGNING_SECRET=...
export SLACKBOT_API_KEY=...
```

From the Centaur checkout, use the absolute path to this repo's pinned values file:

```bash
CENTAUR_EXTRA_VALUES=/path/to/intern/centaur/values.example.yaml just up
just smoke
```

`values.example.yaml` pins both repositories, maps Intern's existing `skills/` directly into the
sandbox, and disables Intern-side tools/workflows so Centaur remains the single capability layer.

## 2. Connect Slack

In the Slack app:

1. Set Event Subscriptions' Request URL to `https://<your-host>/api/webhooks/slack`.
2. Subscribe to `app_mention`.
3. Grant `app_mentions:read` and `chat:write`.
4. Set Interactivity & Shortcuts to the same webhook if you use Block Kit actions.
5. Reinstall the app, invite it to a test channel, and mention it:

```text
/invite @<bot-name>
@<bot-name> reply with exactly PONG
```

Add message events and matching history scopes only if the bot must respond without a mention.
For a private local ingress, use Centaur's
[Tailscale Funnel guide](https://centaur.run/operate/tailscale-funnel).

## 3. Verify the real path

```bash
just status
just logs slackbot
```

Confirm the webhook receives `POST /api/webhooks/slack`, the mention completes in its Slack
thread, and a second `@mention` in that thread retains context. If the overlay is missing,
inspect `CENTAUR_SKILL_DIRS` and `/workspace/.agents/skills` in the assigned sandbox as described
in the [overlay guide](https://centaur.run/extend/overlay).

## Current boundary

Do not point `INTERN_KB_PATH` at `/home/agent/state`: Centaur state is sandbox/thread-local, so
that would fork the company brain across Slack threads. The bundled prompt therefore treats KB
writes as unavailable until the deployment exposes a shared, concurrency-safe KB tool or service.
A read-only context source is enough for a pilot; full Intern parity requires the shared write
boundary.

Centaur currently hardcodes its supported harnesses; wrapping `hermes` as a shell command would
lose streaming, resume, and steering semantics. A real Hermes harness belongs upstream as a
first-class adapter. See Centaur's pinned
[harness types](https://github.com/paradigmxyz/centaur/blob/43b5adc2878184925f2414a05853d7d4981c08ab/services/api-rs/crates/centaur-session-core/src/lib.rs#L354-L364).
