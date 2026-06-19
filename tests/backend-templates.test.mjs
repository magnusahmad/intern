import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import {
  buildBackendLaunchTemplate,
  buildDelegationRoutePlan,
  selectDelegationBackend
} from "../src/backend-templates.mjs";

const target = {
  id: "memento-ai",
  cwd: "/Users/magnus/Documents/Projects/memento-ai",
  preferredBackend: "codex",
  agentsPath: "/Users/magnus/Documents/Projects/memento-ai/AGENTS.md",
  kbContextPointers: ["/Users/magnus/Documents/Projects/ao1-kb/product/ideas/mobile-to-cli-operations-intern.md"]
};

test("test_backend_selection_honors_explicit_user_choice_before_config_defaults", () => {
  assert.equal(selectDelegationBackend({
    explicitBackend: "claude",
    text: "Please use Claude for this bounded analysis.",
    target,
    config: { hermes_gateway: { default_backend: "codex" } }
  }), "claude");

  assert.equal(selectDelegationBackend({
    explicitBackend: "codex",
    text: "Use codex for the repo edit.",
    target,
    config: { hermes_gateway: { default_backend: "claude" } }
  }), "codex");

  assert.equal(selectDelegationBackend({
    text: "Summarize this repo.",
    target,
    config: { hermes_gateway: { default_backend: "claude" } }
  }), "claude");
});

test("test_route_plan_does_not_infer_target_or_backend_from_raw_chat_text", () => {
  const route = buildDelegationRoutePlan({
    message: "Use Claude to update the onboarding copy in memento.",
    config: { hermes_gateway: { default_backend: "codex" } }
  });

  assert.equal(route.status, "needs-input");
  assert.match(route.reason, /explicit target/i);
});

test("test_backend_templates_generate_commands_from_target_cwd_without_secret_material", () => {
  const codexBackground = buildBackendLaunchTemplate({
    target,
    backend: "codex",
    mode: "background-pty",
    task: "Update onboarding copy and run tests.",
    config: { codex_exec: { model: "gpt-5.5" } }
  });

  assert.equal(codexBackground.templateName, "codex-background-pty");
  assert.equal(codexBackground.command, "codex");
  assert.equal(codexBackground.cwd, target.cwd);
  assert.deepEqual(codexBackground.args.slice(-2), ["--cd", target.cwd]);
  assert.equal(codexBackground.hermesContinuity.owner, "hermes");
  assert.equal(JSON.stringify(codexBackground).includes("sk-"), false);

  const codexOneshot = buildBackendLaunchTemplate({
    target,
    backend: "codex",
    mode: "oneshot",
    task: "Inspect tests."
  });

  assert.equal(codexOneshot.templateName, "codex-oneshot");
  assert.equal(codexOneshot.args[0], "exec");
  assert.equal(codexOneshot.args.includes("--ignore-user-config"), true);
  assert.deepEqual(codexOneshot.args.slice(-2), [target.cwd, "Inspect tests."]);

  const claudePrint = buildBackendLaunchTemplate({
    target,
    backend: "claude",
    mode: "print",
    task: "Bounded code review."
  });

  assert.equal(claudePrint.templateName, "claude-print");
  assert.equal(claudePrint.command, "claude");
  assert.equal(claudePrint.cwd, target.cwd);
  assert.deepEqual(claudePrint.args, ["-p", "Bounded code review."]);
});

test("test_backend_templates_reject_secret_prompts_and_preserve_hermes_state_boundary", () => {
  assert.throws(() => buildBackendLaunchTemplate({
    target,
    backend: "claude",
    mode: "print",
    task: "Use sk-test-secret-value-1234567890"
  }), /secret/i);

  const route = buildDelegationRoutePlan({
    message: "Use Claude to update the onboarding copy in memento.",
    explicitTarget: "memento",
    explicitBackend: "claude",
    config: { hermes_gateway: { default_backend: "codex" } }
  });

  assert.equal(route.status, "ready");
  assert.equal(route.target.id, "memento-ai");
  assert.equal(route.backend, "claude");
  assert.equal(route.launch.templateName, "claude-print");
  assert.equal(route.continuity.owner, "hermes");
  assert.equal("waiting_for_user" in route, false);
  assert.equal("waiting_for_approval" in route, false);
});

test("test_plan_delegation_cli_outputs_route_plan_without_launching_worker", () => {
  const output = execFileSync(process.execPath, [
    path.resolve("src/cli.mjs"),
    "plan-delegation",
    "--message",
    "Use Claude to update the onboarding copy in memento.",
    "--target",
    "memento",
    "--backend",
    "claude"
  ], {
    cwd: path.resolve("."),
    encoding: "utf8"
  });
  const parsed = JSON.parse(output);

  assert.equal(parsed.status, "ready");
  assert.equal(parsed.target.id, "memento-ai");
  assert.equal(parsed.backend, "claude");
  assert.equal(parsed.launch.command, "claude");
});
