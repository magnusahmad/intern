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
