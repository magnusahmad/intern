import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { generateHostBrokerPolicy, generateMacOSSandboxProfile, generateOpenShellGatewayLaunchAgent, generateOpenShellPolicy, writePolicyArtifacts } from "../src/policy.mjs";
import { makeTempRepo } from "./helpers.mjs";

const manifest = JSON.parse(fs.readFileSync("config/permissions.example.json", "utf8"));

test("test_permission_manifest_generates_runtime_policy", () => {
  const policy = generateOpenShellPolicy(manifest);

  assert.equal(policy.version, "ao1-intern.openshell-policy.v1");
  assert.deepEqual(policy.identity.users, ["Magnus", "Suley"]);
  assert.equal(policy.filesystem.read.some((entry) => entry.path === "/Users/magnus/Documents/Projects/ao1-kb"), true);
  assert.equal(policy.filesystem.write.some((entry) => entry.path.endsWith("/ao1-intern/runs")), true);
  assert.equal(policy.filesystem.kb_write_enabled, false);
  assert.equal(policy.network.allow.some((entry) => entry.target === "github.com:read"), true);
  assert.equal(policy.tools.allow.includes("codex-exec"), true);
  assert.equal(policy.tools.deny.includes("shell-unrestricted"), true);
});

test("test_policy_artifacts_are_reviewable_json_and_instructions", () => {
  const { intern } = makeTempRepo();
  const result = writePolicyArtifacts({
    manifest,
    config: JSON.parse(fs.readFileSync("config/ao1-intern.example.json", "utf8")),
    outDir: path.join(intern, ".ao1-intern", "policies")
  });

  assert.equal(fs.existsSync(result.policyPath), true);
  assert.equal(fs.existsSync(result.brokerPolicyPath), true);
  assert.equal(fs.existsSync(result.readmePath), true);
  const policy = JSON.parse(fs.readFileSync(result.policyPath, "utf8"));
  assert.equal(policy.version, "ao1-intern.openshell-policy.v1");
  const brokerPolicy = JSON.parse(fs.readFileSync(result.brokerPolicyPath, "utf8"));
  assert.equal(brokerPolicy.version, "ao1-intern.host-broker-policy.v1");
  assert.match(fs.readFileSync(result.readmePath, "utf8"), /Review this generated policy/);
  assert.match(fs.readFileSync(result.readmePath, "utf8"), /not applied automatically/);
});

test("test_policy_artifacts_include_macos_sandbox_profile_for_host_broker", () => {
  const { intern } = makeTempRepo();
  const config = JSON.parse(fs.readFileSync("config/ao1-intern.example.json", "utf8"));
  const result = writePolicyArtifacts({
    manifest,
    config,
    outDir: path.join(intern, ".ao1-intern", "policies")
  });

  assert.equal(fs.existsSync(result.macosSandboxProfilePath), true);
  const profile = fs.readFileSync(result.macosSandboxProfilePath, "utf8");
  assert.match(profile, /\(version 1\)/);
  assert.match(profile, /\(deny default\)/);
  assert.match(profile, /\(allow file-read\*/);
  assert.match(profile, /\(literal "\/"\)/);
  assert.match(profile, /\(literal "\/opt"\)/);
  assert.match(profile, /\/Users\/magnus\/Documents\/Projects\/ao1-kb/);
  assert.match(profile, /\(allow file-write\*/);
  assert.match(profile, /\/Users\/magnus\/Documents\/Projects\/ao1-intern\/runs/);
  assert.match(profile, /\/Users\/magnus\/Documents\/Projects\/ao1-intern\/\.ao1-intern/);
  assert.match(profile, /\/opt\/homebrew\/bin/);
  assert.match(profile, /\/opt\/homebrew\/etc/);
  assert.match(profile, /\/opt\/homebrew\/etc\/openssl@3/);
  assert.match(profile, /\/opt\/homebrew\/opt/);
  assert.match(profile, /\/opt\/homebrew\/Cellar/);
  assert.match(profile, /\/opt\/homebrew\/lib\/node_modules\/npm/);
  assert.match(profile, /\/Users\/magnus\/\.codex/);
  assert.match(profile, /\/Users\/magnus\/\.hermes\/hermes-agent/);
  assert.match(profile, /\/Users\/magnus\/\.local\/share\/uv\/python/);
  assert.match(profile, /\(allow file-map-executable/);
  assert.match(profile, /file-write\*[\s\S]*\/Users\/magnus\/\.codex/);
  assert.match(profile, /file-write\*[\s\S]*\/Users\/magnus\/\.hermes\/logs/);
  assert.match(profile, /\/private\/var\/select\/sh/);
  assert.match(profile, /\/private\/var\/folders\/2r\/mpm3k8f971132z3x_k6_z5km0000gn\/T/);
  assert.match(profile, /\(allow network-bind/);
  assert.match(profile, /\(allow network-outbound/);
  assert.match(profile, /Declared network targets: model-provider, github\.com:read/);
  assert.match(profile, /remote unix-socket/);
  assert.match(profile, /codex-ipc/);
  assert.doesNotMatch(profile, /file-write\*[\s\S]*\/Users\/magnus\/Documents\/Projects\/ao1-kb/);
  assert.match(fs.readFileSync(result.readmePath, "utf8"), /sandbox-exec/);
  assert.match(fs.readFileSync(result.readmePath, "utf8"), /manual OS-level enforcement/);

  assert.equal(generateMacOSSandboxProfile({
    brokerPolicy: generateHostBrokerPolicy({ manifest, config })
  }), profile);
});

test("test_policy_artifacts_include_reviewed_openshell_gateway_launchagent", () => {
  const { intern } = makeTempRepo();
  const config = JSON.parse(fs.readFileSync("config/ao1-intern.example.json", "utf8"));
  const result = writePolicyArtifacts({
    manifest,
    config,
    outDir: path.join(intern, ".ao1-intern", "policies")
  });

  assert.equal(fs.existsSync(result.openshellGatewayLaunchAgentPath), true);
  const plist = fs.readFileSync(result.openshellGatewayLaunchAgentPath, "utf8");
  assert.match(plist, /com\.ao1\.intern\.openshell-gateway/);
  assert.match(plist, /\/Users\/magnus\/\.local\/bin\/openshell-gateway/);
  assert.match(plist, /\/Users\/magnus\/\.config\/openshell\/ao1-gateway\.toml/);
  assert.match(plist, /\/Users\/magnus\/\.local\/state\/openshell\/ao1-gateway\/tls\/server\/tls\.crt/);
  assert.match(plist, /\/Users\/magnus\/\.local\/state\/openshell\/ao1-gateway\/tls\/server\/tls\.key/);
  assert.match(plist, /\/Users\/magnus\/\.local\/state\/openshell\/ao1-gateway\/tls\/ca\.crt/);
  assert.match(plist, /DOCKER_HOST/);
  assert.match(plist, /unix:\/\/\/Users\/magnus\/\.docker\/run\/docker\.sock/);
  assert.match(plist, /\.ao1-intern\/logs\/openshell-gateway\.out\.log/);
  assert.match(plist, /\.ao1-intern\/logs\/openshell-gateway\.err\.log/);
  assert.doesNotMatch(plist, /PRIVATE KEY|sk-[A-Za-z0-9_-]{16,}|refresh_token/);
  assert.match(fs.readFileSync(result.readmePath, "utf8"), /LaunchAgent/);
  assert.match(fs.readFileSync(result.readmePath, "utf8"), /launchctl bootstrap/);
  assert.match(fs.readFileSync(result.readmePath, "utf8"), /not installed automatically/);

  assert.equal(generateOpenShellGatewayLaunchAgent({
    config,
    repoPath: intern
  }), plist);
});

test("test_host_broker_policy_limits_hermes_codex_and_secrets", () => {
  const config = JSON.parse(fs.readFileSync("config/ao1-intern.example.json", "utf8"));
  const policy = generateHostBrokerPolicy({ manifest, config });

  assert.equal(policy.version, "ao1-intern.host-broker-policy.v1");
  assert.equal(policy.execution_boundary, "host-broker");
  assert.equal(policy.tools.hermes.command, "/Users/magnus/.local/bin/hermes");
  assert.equal(policy.tools.hermes.mode, "oneshot-json-finalizer");
  assert.equal(policy.tools.codex.command, "codex");
  assert.equal(policy.tools.codex.sandbox, "read-only");
  assert.equal(policy.tools.codex.ignore_user_config, true);
  assert.equal(policy.filesystem.kb_write_enabled, false);
  assert.equal(policy.filesystem.write.every((entry) => entry.path.includes("/ao1-intern/")), true);
  assert.deepEqual(policy.secrets.allowed_refs.sort(), [
    "keychain://ao1-intern/github",
    "keychain://ao1-intern/model-provider"
  ].sort());
  assert.doesNotMatch(JSON.stringify(policy), /sk-[A-Za-z0-9_-]{16,}|PRIVATE KEY|refresh_token/);
});

test("test_host_broker_policy_defaults_to_ignoring_codex_user_config", () => {
  const policy = generateHostBrokerPolicy({
    manifest,
    config: {
      runtime: {
        commands: {
          codex: "codex"
        }
      }
    }
  });

  assert.equal(policy.tools.codex.command, "codex");
  assert.equal(policy.tools.codex.model, "gpt-5.5");
  assert.equal(policy.tools.codex.service_tier, "fast");
  assert.equal(policy.tools.codex.sandbox, "read-only");
  assert.equal(policy.tools.codex.ignore_user_config, true);
  assert.equal(policy.tools.codex.ephemeral, true);

  assert.throws(() => generateHostBrokerPolicy({
    manifest,
    config: {
      codex_exec: {
        ignore_user_config: false
      }
    }
  }), /ignore user config/);
  assert.throws(() => generateHostBrokerPolicy({
    manifest,
    config: {
      codex_exec: {
        ephemeral: false
      }
    }
  }), /ephemeral/);
});

test("test_policy_generation_excludes_kb_write_roots_until_switch_enabled", () => {
  const config = JSON.parse(fs.readFileSync("config/ao1-intern.example.json", "utf8"));
  const kbWritePath = "/Users/magnus/Documents/Projects/ao1-kb";
  const disabledManifest = {
    ...manifest,
    kb: {
      ...manifest.kb,
      write: [kbWritePath],
      kb_write_enabled: false
    }
  };
  const enabledManifest = {
    ...manifest,
    kb: {
      ...manifest.kb,
      write: [kbWritePath],
      kb_write_enabled: true
    }
  };

  const disabledOpenShell = generateOpenShellPolicy(disabledManifest);
  assert.equal(disabledOpenShell.filesystem.write.some((entry) => entry.path === kbWritePath), false);
  assert.equal(disabledOpenShell.filesystem.kb_write_enabled, false);

  const disabledBroker = generateHostBrokerPolicy({ manifest: disabledManifest, config });
  assert.equal(disabledBroker.filesystem.write.some((entry) => entry.path === kbWritePath), false);
  assert.equal(disabledBroker.filesystem.kb_write_enabled, false);

  const enabledOpenShell = generateOpenShellPolicy(enabledManifest);
  assert.equal(enabledOpenShell.filesystem.write.some((entry) => entry.path === kbWritePath), true);
  assert.equal(enabledOpenShell.filesystem.kb_write_enabled, true);

  const enabledBroker = generateHostBrokerPolicy({ manifest: enabledManifest, config });
  assert.equal(enabledBroker.filesystem.write.some((entry) => entry.path === kbWritePath), true);
  assert.equal(enabledBroker.filesystem.kb_write_enabled, true);
});
