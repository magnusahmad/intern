# AO1 Intern

AO1 dogfood repo for the internal Intern agent. V1 observes AO1 KB syncs, reads latest raw connector manifests, filters important information, and writes KB-ready markdown into this repo for review and later KB write-back.

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
npm run intern -- runtime-probe --config config/ao1-intern.example.json
npm run intern -- scheduled-runtime-smoke --config config/ao1-intern.example.json
```

The schedule command only writes reviewable cron/LaunchAgent artifacts and install instructions. It does not install anything. With the default config, the generated cron command wraps the observer in the reviewed macOS `host-broker.sb` sandbox profile.

The default runtime boundary is `host-broker`: the filing path enforces the generated broker policy before spawning Hermes one-shot or Codex exec. This prevents command, flag, cwd, and secret-prompt drift inside the checked-in runtime path.

The v1 commit policy is `per-run`: each successful filing run creates its own commit for auditability. Use `--commit-policy manual` or `--commit false` for local review runs that should leave files uncommitted.

Direct KB write-back is disabled by default. To enable it for a reviewed run, set `kb.kb_write_enabled` to `true` and declare an explicit KB write root in the permissions manifest passed with `--permissions`; otherwise filed markdown stays in the intern repo only. When enabled, new KB concept files are created and existing concept files are appended to rather than overwritten.

`policy-artifacts` also writes `host-broker.sb`, a reviewable macOS `sandbox-exec` profile generated from the same host-broker policy, plus `com.ao1.intern.openshell-gateway.plist`, a reviewed LaunchAgent artifact for the local OpenShell gateway. These artifacts are manual-only for now: review them before use, and do not install or apply them automatically.

Manual OS-level smoke after generating policy artifacts:

```bash
sandbox-exec -f .ao1-intern/policies/host-broker.sb /opt/homebrew/bin/npm run intern -- scheduled-runtime-smoke --config config/ao1-intern.example.json
```

Manual OpenShell gateway LaunchAgent install after review:

```bash
launchctl bootstrap gui/$(id -u) .ao1-intern/policies/com.ao1.intern.openshell-gateway.plist
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
