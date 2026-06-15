import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createHostBroker } from "../src/host-broker.mjs";
import { generateHostBrokerPolicy } from "../src/policy.mjs";

const manifest = JSON.parse(fs.readFileSync("config/permissions.example.json", "utf8"));
const config = JSON.parse(fs.readFileSync("config/ao1-intern.example.json", "utf8"));
const policy = generateHostBrokerPolicy({ manifest, config });

test("test_host_broker_allows_reviewed_hermes_and_codex_invocations", () => {
  const calls = [];
  const broker = createHostBroker({
    policy,
    execFile: (command, args, options) => {
      calls.push({ command, args, options });
      return command === "codex" ? "{\"items\":[]}" : "{\"items\":[]}";
    }
  });

  const codexOutput = broker.codexExecFile("codex", [
    "exec",
    "--ignore-user-config",
    "-c",
    "service_tier=\"fast\"",
    "--model",
    "gpt-5.5",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--cd",
    "/Users/magnus/Documents/Projects/ao1-kb",
    "{\"task\":\"draft\"}"
  ], { encoding: "utf8" });

  const hermesOutput = broker.hermesExecFile("/Users/magnus/.local/bin/hermes", [
    "--oneshot",
    "{\"task\":\"finalize\"}"
  ], { cwd: "/Users/magnus/Documents/Projects/ao1-intern" });

  assert.equal(codexOutput, "{\"items\":[]}");
  assert.equal(hermesOutput, "{\"items\":[]}");
  assert.equal(calls.length, 2);
});

test("test_host_broker_rejects_unreviewed_execs_and_secret_prompts", () => {
  const broker = createHostBroker({ policy, execFile: () => "" });

  assert.throws(() => broker.codexExecFile("codex", [
    "exec",
    "--ignore-user-config",
    "--model",
    "gpt-5.5",
    "--sandbox",
    "workspace-write",
    "--ephemeral",
    "--cd",
    "/Users/magnus/Documents/Projects/ao1-kb",
    "{}"
  ], {}), /sandbox/i);

  assert.throws(() => broker.hermesExecFile("/bin/sh", ["--oneshot", "{}"], {
    cwd: "/Users/magnus/Documents/Projects/ao1-intern"
  }), /Hermes command/i);

  assert.doesNotThrow(() => broker.hermesExecFile("/Users/magnus/.local/bin/hermes", ["--yolo", "--oneshot", "{}"], {
    cwd: "/Users/magnus/Documents/Projects/ao1-intern"
  }));

  assert.throws(() => broker.hermesExecFile("/Users/magnus/.local/bin/hermes", [
    "--oneshot",
    "sk-test-secret-value-1234567890"
  ], { cwd: "/Users/magnus/Documents/Projects/ao1-intern" }), /secret/i);
});
