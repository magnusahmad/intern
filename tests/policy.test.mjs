import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { generateHostBrokerPolicy, generateOpenShellPolicy, writePolicyArtifacts } from "../src/policy.mjs";
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
