# AO1 Intern

AO1 dogfood repo for the internal Intern agent. V1 observes AO1 KB syncs, reads latest raw connector manifests, filters important information, and writes KB-ready markdown into this repo for review and later KB write-back.

## Intended User Experience

The operator surface should be chat-first. Magnus and Suley should not need to run npm commands during normal use; those commands are internal plumbing for tests, scheduled jobs, and setup.

The primary control channel is Telegram. Once the Telegram bot webhook bridge is connected, use messages like:

```text
review latest artifacts
review latest artefacts and update the kb
review generated policy artifacts
status
help
```

The chat router maps `review latest artifacts` / `review latest artefacts and update the kb` to the `ao1-kb-filing` skill and the same `fileLatestSync` path used by the scheduled observer. If `kb_write_enabled` is still false, the Intern stages KB-ready markdown in this repo only. If the KB write switch and explicit KB write-root permission are enabled, the same chat intent can write to the KB.

Telegram users must be explicitly allowlisted in config, and the bot token plus webhook secret stay behind Keychain refs:

```json
{
  "chat": {
    "primary_channel": "telegram",
    "telegram": {
      "enabled": false,
      "host": "127.0.0.1",
      "port": 17671,
      "webhook_path": "/webhook",
      "allowed_senders": ["telegram:123456789"],
      "bot_token_ref": "keychain://ao1-intern/telegram-bot-token",
      "webhook_secret_ref": "keychain://ao1-intern/telegram-webhook-secret",
      "bot_api_base_url": "https://api.telegram.org",
      "reply_to_unauthorized": false
    }
  }
}
```

The repo now contains the dependency-free chat control plane, Telegram webhook adapter, local HTTP bridge, and outbound Telegram text sender. The bridge accepts Telegram Bot API webhook callbacks, verifies `X-Telegram-Bot-Api-Secret-Token`, dispatches approved messages into `handleInternChatMessage`, and sends replies back through `sendMessage`.

Local connection setup:

1. Create an uncommitted local config from `config/ao1-intern.example.json`.
2. Set `chat.telegram.enabled` to `true`.
3. Replace `allowed_senders` with Magnus and Suley's normalized Telegram user ids, such as `telegram:123456789`.
4. Store runtime secrets in Keychain. The `keychain://ao1-intern/name` ref maps to the generic-password service `ao1-intern/name`.

```bash
security add-generic-password -a ao1-intern -s ao1-intern/telegram-bot-token -w '<bot-token-from-botfather>' -U
security add-generic-password -a ao1-intern -s ao1-intern/telegram-webhook-secret -w '<random-secret-token>' -U
```

The bridge is internal plumbing and should be run by a reviewed host process or LaunchAgent, not by day-to-day users:

```bash
npm run intern -- telegram-bridge --config /path/to/local-ao1-intern.json
```

Use BotFather to create the bot and get the bot token. Then set the Telegram webhook to the public HTTPS URL that forwards to `http://127.0.0.1:17671/webhook`, using the same secret token stored in Keychain. Do not commit the local config, bot token, webhook secret, or public tunnel credentials.

## Commands

```bash
npm test
npm run intern -- file-latest-sync --kb /Users/magnus/Documents/Projects/ao1-kb
npm run intern -- file-latest-sync --kb /Users/magnus/Documents/Projects/ao1-kb --config config/ao1-intern.example.json
npm run intern -- file-latest-sync --kb /Users/magnus/Documents/Projects/ao1-kb --config config/ao1-intern.example.json --permissions config/permissions.example.json
npm run intern -- file-latest-sync --kb /Users/magnus/Documents/Projects/ao1-kb --commit-policy manual
npm run intern -- file-latest-sync --kb /Users/magnus/Documents/Projects/ao1-kb --classifier codex --config config/ao1-intern.example.json
npm run intern -- schedule-artifacts --kb /Users/magnus/Documents/Projects/ao1-kb --config config/ao1-intern.example.json
npm run intern -- policy-artifacts --permissions config/permissions.example.json --config config/ao1-intern.example.json
npm run intern -- review-artifacts --config config/ao1-intern.example.json
npm run intern -- runtime-probe --config config/ao1-intern.example.json
npm run intern -- scheduled-runtime-smoke --config config/ao1-intern.example.json
npm run intern -- launchd-preflight --kb /Users/magnus/Documents/Projects/ao1-kb --config config/ao1-intern.example.json
npm run intern -- telegram-bridge --config config/ao1-intern.local.json
```

The schedule command only writes reviewable cron/LaunchAgent artifacts and install instructions. It does not install anything. With the default config, the generated scheduled command wraps a direct `node src/cli.mjs` observer in the reviewed macOS `host-broker.sb` sandbox profile copied to `runtime.macos_sandbox.launch_agent_profile_path`, so launchd can apply it without an npm wrapper.

On macOS, the LaunchAgent also needs the scheduled Node runtime to have Full Disk Access when the Intern repo and KB live under `~/Documents`. The generated install guide names the exact runtime path from config, currently `/opt/homebrew/bin/node`; without that human-granted OS permission, launchd can hang before Node reads the repo entrypoint. `launchd-preflight` submits a one-shot launchd job that runs the configured Node runtime against repo and KB sentinel files, removes that job on success or timeout, and exits nonzero until launchd-spawned Node can read them. When that Node probe fails, it also runs a short launchd file-read diagnostic so TCC errors such as `Operation not permitted` are visible in the preflight output.

The default runtime boundary is `host-broker`: the filing path enforces the generated broker policy before spawning Hermes one-shot or Codex exec. This prevents command, flag, cwd, and secret-prompt drift inside the checked-in runtime path.

The Codex path intentionally ignores the user's Codex config. Intern does not update `~/.codex` or rely on its default model; the reviewed `codex_exec` config is the source of truth. Attempts to set `ignore_user_config: false` or `ephemeral: false` fail before command or policy generation.

The v1 commit policy is `per-run`: each successful filing run creates its own commit for auditability. Use `--commit-policy manual` or `--commit false` for local review runs that should leave files uncommitted.

Direct KB write-back is disabled by default. To enable it for a reviewed run, set `kb.kb_write_enabled` to `true` and declare an explicit KB write root in the permissions manifest passed with `--permissions`; otherwise filed markdown stays in the intern repo only. When enabled, new KB concept files are created and existing concept files are appended to rather than overwritten.

`policy-artifacts` also writes `host-broker.sb`, a reviewable macOS `sandbox-exec` profile generated from the same host-broker policy, plus `com.ao1.intern.openshell-gateway.plist`, a reviewed LaunchAgent artifact for the local OpenShell gateway. These artifacts are manual-only for now: review them before use, and do not install or apply them automatically.

The generated macOS sandbox profile includes narrow runtime reads required by launchd-spawned Node on this machine, including the LaunchServices lookup and `/Users/magnus/.CFUserTextEncoding`. Keep these as explicit reviewed permissions instead of replacing them with broad home-directory reads.

Run `review-artifacts` after generating schedule and policy artifacts. It checks that required artifacts exist, generated files contain no secret-like values, KB writes remain disabled, write roots stay in the Intern repo, Codex remains read-only/user-config-isolated/ephemeral, the scheduled cron/LaunchAgent commands use the reviewed sandbox wrapper, and the macOS sandbox profile includes the launchd runtime metadata permissions. This is a machine gate, not a substitute for human review before install.

Manual OS-level smoke after generating policy artifacts:

```bash
sandbox-exec -f .ao1-intern/policies/host-broker.sb /opt/homebrew/bin/npm run intern -- scheduled-runtime-smoke --config config/ao1-intern.example.json
```

Manual OpenShell gateway LaunchAgent install after review:

```bash
launchctl bootstrap gui/$(id -u) .ao1-intern/policies/com.ao1.intern.openshell-gateway.plist
```

Manual OpenShell gateway LaunchAgent removal:

```bash
launchctl bootout gui/$(id -u) .ao1-intern/policies/com.ao1.intern.openshell-gateway.plist
```

## Local Runtime

Hermes is expected at `/Users/magnus/.local/bin/hermes`. OpenShell is expected at `/Users/magnus/.local/bin/openshell`; V1 treats NemoClaw as available through OpenShell unless a standalone `nemoclaw` command appears later.

The runtime probe requires Hermes, Codex, and a runnable containment layer. When OpenShell is the containment layer, it also runs `openshell status` so a disconnected gateway is reported before a scheduled filing run starts.

```bash
/Users/magnus/.local/bin/openshell-gateway generate-certs --output-dir /Users/magnus/.local/state/openshell/ao1-gateway/tls
cp config/openshell-gateway.example.toml /Users/magnus/.config/openshell/ao1-gateway.toml
```

Do not commit generated gateway TLS or JWT material. Keep it under local state or Keychain-managed paths.

Start the local gateway manually while dogfooding, or use the generated LaunchAgent after review:

```bash
DOCKER_HOST=unix:///Users/magnus/.docker/run/docker.sock /Users/magnus/.local/bin/openshell-gateway \
  --config /Users/magnus/.config/openshell/ao1-gateway.toml \
  --tls-cert /Users/magnus/.local/state/openshell/ao1-gateway/tls/server/tls.crt \
  --tls-key /Users/magnus/.local/state/openshell/ao1-gateway/tls/server/tls.key \
  --tls-client-ca /Users/magnus/.local/state/openshell/ao1-gateway/tls/ca.crt \
  --enable-mtls-auth true \
  --port 17670
```

Then verify:

```bash
/Users/magnus/.local/bin/openshell status
npm run intern -- runtime-probe --config config/ao1-intern.example.json
```
