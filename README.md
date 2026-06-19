# AO1 Intern

A general-purpose research and operations Hermes agent backed by a durable knowledge base. Installed as a **Hermes profile distribution** — one command gives you the whole agent:

```bash
hermes profile install https://github.com/NousResearch/ao1-intern
```

Then copy `.env.example` to `.env` and fill in your keys. Run `hermes` or address the agent via Telegram/Discord.

---

## What You Get

| Component | Description |
|-----------|-------------|
| **SOUL.md** | Agent personality and operating principles |
| **config.yaml** | Base model, toolsets, delegation, and gateway config |
| **skills/ao1-intern** | Hermes-facing routing rules for repo work and KB context |
| **skills/ao1-kb-filing** | KB sync → curated markdown filing workflow |
| **src/kb-*.mjs** | KB interaction helpers (rules, sync, classification, filing) |

## Core Capabilities

**KB-aware routing** — The agent reads the AO1 KB (`$AO1_KB_PATH`) for company context, concept maps, and research records before routing work.

**Swappable backend agents** — Heavy repo, shell, or implementation work defaults to Codex; bounded analysis defaults to Claude print mode. Explicit user choice always wins.

**Systematic research filing** — Connector sync items are classified against KB rules, grouped by concept, and written as KB-ready markdown. Manual and scheduled paths use identical code.

**Multi-repo coordination** — Backend agents are launched in the target repo so its `AGENTS.md` provides operational rules naturally.

## KB Filing Commands (Node.js CLI)

```bash
npm install
npm test

# File latest KB sync to this repo (review staged markdown)
npm run intern -- file-latest-sync --kb $AO1_KB_PATH

# File with explicit permissions manifest
npm run intern -- file-latest-sync --kb $AO1_KB_PATH \
  --permissions config/permissions.example.json

# File without committing (review before committing)
npm run intern -- file-latest-sync --kb $AO1_KB_PATH --commit-policy manual

# Plan a delegation without executing it
npm run intern -- plan-delegation --message "Use Codex to inspect ao1-intern"
```

Direct KB write-back is disabled by default. Filed markdown stages in `runs/` until reviewed. When `kb_write_enabled` is set in the permissions manifest, new KB concept files are created and existing files are appended to rather than overwritten.

The schedule command only writes reviewable cron/LaunchAgent artifacts and install instructions. It does not install anything. With the default config, the generated scheduled command wraps a direct `node src/cli.mjs` observer in the reviewed macOS `host-broker.sb` sandbox profile copied to `runtime.macos_sandbox.launch_agent_profile_path`, so launchd can apply it without an npm wrapper.

On macOS, the LaunchAgent also needs the scheduled Node runtime to have Full Disk Access when the Intern repo and KB live under `~/Documents`. The generated install guide names the exact runtime path from config, currently `/opt/homebrew/bin/node`; without that human-granted OS permission, launchd can hang before Node reads the repo entrypoint. `launchd-preflight` submits a one-shot launchd job that runs the configured Node runtime against repo and KB sentinel files, removes that job on success or timeout, and exits nonzero until launchd-spawned Node can read them. When that Node probe fails, it also runs a short launchd file-read diagnostic so TCC errors such as `Operation not permitted` are visible in the preflight output.

The default runtime boundary is `host-broker`: the filing path enforces the generated broker policy before spawning Hermes one-shot or Codex exec. This prevents command, flag, cwd, and secret-prompt drift inside the checked-in runtime path.

The Codex path intentionally ignores the user's Codex config. Intern does not update `~/.codex` or rely on its default model; the reviewed `codex_exec` config is the source of truth. Attempts to set `ignore_user_config: false` or `ephemeral: false` fail before command or policy generation.

The v1 commit policy is `per-run`: each successful filing run creates its own commit for auditability. Use `--commit-policy manual` or `--commit false` for local review runs that should leave files uncommitted.

Direct KB write-back is disabled by default. To enable it for a reviewed run, set `kb.kb_write_enabled` to `true` and declare an explicit KB write root in the permissions manifest passed with `--permissions`; otherwise filed markdown stays in the intern repo only. When enabled, new KB concept files are created and existing concept files are appended to rather than overwritten.

`policy-artifacts` also writes `host-broker.sb`, a reviewable macOS `sandbox-exec` profile generated from the same host-broker policy, plus `com.ao1.intern.openshell-gateway.plist`, a reviewed LaunchAgent artifact for the local OpenShell gateway. The host-broker policy records that `shell-unrestricted` is allowed for this dogfood phase, but the shell chat skill is controlled by `chat.shell.enabled` and Telegram sender allowlisting. These artifacts are manual-only for now: review them before use, and do not install or apply them automatically.

The generated macOS sandbox profile includes narrow runtime reads required by launchd-spawned Node on this machine, including the LaunchServices lookup and `/Users/magnus/.CFUserTextEncoding`. Keep these as explicit reviewed permissions instead of replacing them with broad home-directory reads.

Run `review-artifacts` after generating schedule and policy artifacts. It checks that required artifacts exist, generated files contain no secret-like values, KB writes remain disabled, write roots stay in the Intern repo, Codex remains read-only/user-config-isolated/ephemeral, the scheduled cron/LaunchAgent commands use the reviewed sandbox wrapper, and the macOS sandbox profile includes the launchd runtime metadata permissions. This is a machine gate, not a substitute for human review before install.

Manual OS-level smoke after generating policy artifacts:

```bash
sandbox-exec -f .ao1-intern/policies/host-broker.sb /opt/homebrew/bin/node src/cli.mjs scheduled-runtime-smoke
```

Manual OpenShell gateway LaunchAgent install after review:

```bash
launchctl bootstrap gui/$(id -u) .ao1-intern/policies/com.ao1.intern.openshell-gateway.plist
```

Manual OpenShell gateway LaunchAgent removal:

```bash
launchctl bootout gui/$(id -u) .ao1-intern/policies/com.ao1.intern.openshell-gateway.plist
```

## OpenShell & Sandbox (Future Distribution Content)

The OpenShell gateway, macOS LaunchAgent schedules, and `sandbox-exec` policy artifacts are **not yet part of the distribution** but will be added in a future iteration. They remain here as reference implementations.

> **Note:** The sandbox/policy artifacts (`host-broker.mjs`, `policy.mjs`, `secrets.mjs`, `shell-skill.mjs`, `launchd-preflight.mjs`, `permissions.example.json`, `openshell-gateway.example.toml`) and their tests are kept in this repo intentionally. They will be folded into the distribution once the OpenShell gateway install path is stable.

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
npm run intern -- runtime-probe
```
