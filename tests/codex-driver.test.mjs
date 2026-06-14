import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexExecInvocation, validateCodexOutput } from "../src/codex-driver.mjs";

test("test_codex_exec_driver_uses_machine_auth_without_persisting_secrets", () => {
  const invocation = buildCodexExecInvocation({
    repo: "/Users/magnus/Documents/Projects/ao1-kb",
    prompt: "Classify this manifest item without printing credentials."
  });
  assert.equal(invocation.command, "codex");
  assert.equal(invocation.args.includes("--ignore-user-config"), true);
  assert.equal(invocation.args.includes('service_tier="fast"'), true);
  assert.equal(invocation.args.includes("--model"), true);
  assert.equal(invocation.args.includes("gpt-5.5"), true);
  assert.equal(invocation.args.includes("--sandbox"), true);
  assert.equal(invocation.args.includes("read-only"), true);
  assert.deepEqual(invocation.args.slice(-2), ["/Users/magnus/Documents/Projects/ao1-kb", "Classify this manifest item without printing credentials."]);
  assert.equal(invocation.args.join(" ").includes("sk-"), false);
  assert.equal(invocation.args.join(" ").includes("OPENAI_API_KEY"), false);
});

test("test_codex_exec_output_is_shape_validated", () => {
  assert.equal(validateCodexOutput("Target concept: product/ideas/intern-agent-governance.md"), "Target concept: product/ideas/intern-agent-governance.md");
  assert.throws(() => validateCodexOutput("sk-test_abcdefghijklmnopqrstuvwxyz"), /Secret-like/);
  assert.throws(() => validateCodexOutput(""), /empty/);
});
