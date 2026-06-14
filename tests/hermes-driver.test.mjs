import assert from "node:assert/strict";
import test from "node:test";
import { buildHermesOneshotInvocation, runHermesOneshot } from "../src/hermes-driver.mjs";

test("test_hermes_oneshot_driver_builds_scriptable_orchestrator_invocation", () => {
  const invocation = buildHermesOneshotInvocation({
    command: "/Users/magnus/.local/bin/hermes",
    prompt: "Return JSON.",
    model: "minimax/minimax-m2.7",
    provider: "openrouter",
    toolsets: ["shell"],
    ignoreUserConfig: false,
    ignoreRules: false,
    yolo: false
  });

  assert.equal(invocation.command, "/Users/magnus/.local/bin/hermes");
  assert.deepEqual(invocation.args, [
    "--model",
    "minimax/minimax-m2.7",
    "--provider",
    "openrouter",
    "--toolsets",
    "shell",
    "--oneshot",
    "Return JSON."
  ]);
});

test("test_hermes_oneshot_driver_validates_output_without_persisting_secrets", () => {
  const output = runHermesOneshot({
    prompt: "Return JSON.",
    execFile: (command, args, options) => {
      assert.equal(command, "/Users/magnus/.local/bin/hermes");
      assert.equal(args.at(-2), "--oneshot");
      assert.equal(args.at(-1), "Return JSON.");
      assert.equal(options.cwd, "/Users/magnus/Documents/Projects/ao1-intern");
      return "{\"items\":[]}";
    },
    cwd: "/Users/magnus/Documents/Projects/ao1-intern"
  });

  assert.equal(output, "{\"items\":[]}");
  assert.throws(() => runHermesOneshot({
    prompt: "Return JSON.",
    execFile: () => "sk-test-secret-value-1234567890"
  }), /secret/i);
});
