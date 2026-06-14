import assert from "node:assert/strict";
import test from "node:test";
import { probeRuntime } from "../src/runtime-probe.mjs";

test("test_runtime_probe_reports_missing_containment_layer", () => {
  const result = probeRuntime({
    commands: {
      hermes: "/Users/magnus/.local/bin/hermes",
      codex: "codex",
      nemoclaw: "nemoclaw",
      openshell: "openshell"
    },
    commandExists: (command) => command.includes("hermes") || command === "codex"
  });

  assert.equal(result.hermes.found, true);
  assert.equal(result.codex.found, true);
  assert.equal(result.nemoclaw.found, false);
  assert.equal(result.openshell.found, false);
  assert.equal(result.ready, false);
  assert.match(result.blockers.join("\n"), /NemoClaw or OpenShell/);
});

test("test_runtime_probe_ready_when_orchestrator_and_containment_exist", () => {
  const result = probeRuntime({
    commands: {
      hermes: "hermes",
      codex: "codex",
      nemoclaw: "nemoclaw",
      openshell: "openshell"
    },
    commandExists: (command) => ["hermes", "codex", "nemoclaw"].includes(command)
  });

  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
});

test("test_runtime_probe_requires_openshell_gateway_when_openshell_is_the_containment_layer", () => {
  const result = probeRuntime({
    commands: {
      hermes: "hermes",
      codex: "codex",
      nemoclaw: "nemoclaw",
      openshell: "/Users/magnus/.local/bin/openshell"
    },
    commandExists: (command) => ["hermes", "codex", "/Users/magnus/.local/bin/openshell"].includes(command),
    commandStatus: () => ({
      ok: false,
      output: "Error: client error (Connect)"
    })
  });

  assert.equal(result.openshell.found, true);
  assert.equal(result.openshell.gateway.checked, true);
  assert.equal(result.openshell.gateway.ready, false);
  assert.equal(result.ready, false);
  assert.match(result.blockers.join("\n"), /OpenShell gateway/);
});

test("test_runtime_probe_ready_with_connected_openshell_gateway", () => {
  const result = probeRuntime({
    commands: {
      hermes: "hermes",
      codex: "codex",
      nemoclaw: "nemoclaw",
      openshell: "/Users/magnus/.local/bin/openshell"
    },
    commandExists: (command) => ["hermes", "codex", "/Users/magnus/.local/bin/openshell"].includes(command),
    commandStatus: () => ({
      ok: true,
      output: "Server Status\nGateway: openshell-ao1\nServer: https://127.0.0.1:17670"
    })
  });

  assert.equal(result.openshell.found, true);
  assert.equal(result.openshell.gateway.checked, true);
  assert.equal(result.openshell.gateway.ready, true);
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
});
