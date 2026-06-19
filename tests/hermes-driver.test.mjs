import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHermesChatInvocation,
  buildHermesOneshotInvocation,
  extractLastAssistantMessage,
  runHermesChat,
  runHermesOneshot
} from "../src/hermes-driver.mjs";

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

test("test_hermes_chat_driver_builds_telegram_agent_invocation", () => {
  const invocation = buildHermesChatInvocation({
    command: "/Users/magnus/.local/bin/hermes",
    query: "Check the WhatsApp messages that landed in the KB.",
    model: "minimax/minimax-m2.7",
    provider: "openrouter",
    toolsets: ["all"],
    skills: ["ao1-intern"],
    source: "telegram",
    quiet: true,
    maxTurns: 25
  });

  assert.equal(invocation.command, "/Users/magnus/.local/bin/hermes");
  assert.deepEqual(invocation.args, [
    "chat",
    "--query",
    "Check the WhatsApp messages that landed in the KB.",
    "--quiet",
    "--model",
    "minimax/minimax-m2.7",
    "--provider",
    "openrouter",
    "--toolsets",
    "all",
    "--skills",
    "ao1-intern",
    "--source",
    "telegram",
    "--max-turns",
    "25"
  ]);
});

test("test_hermes_chat_driver_validates_programmatic_output", () => {
  const output = runHermesChat({
    query: "Explain what changed.",
    provider: "openrouter",
    skills: ["ao1-intern"],
    source: "telegram",
    execFile: (command, args, options) => {
      assert.equal(command, "/Users/magnus/.local/bin/hermes");
      assert.equal(args[0], "chat");
      assert.deepEqual(args.slice(1, 3), ["--query", "Explain what changed."]);
      assert.equal(options.cwd, "/Users/magnus/Documents/Projects/ao1-intern");
      return "Hermes answer.\n";
    },
    cwd: "/Users/magnus/Documents/Projects/ao1-intern"
  });

  assert.equal(output, "Hermes answer.\n");
});

test("test_hermes_chat_driver_extracts_codex_turn_completion_from_stderr", () => {
  const output = runHermesChat({
    query: "Ask Codex to inspect the KB.",
    provider: "openrouter",
    skills: ["ao1-intern"],
    source: "telegram",
    spawnFile: (command, args, options) => {
      assert.equal(command, "/Users/magnus/.local/bin/hermes");
      assert.equal(args[0], "chat");
      assert.equal(options.cwd, "/Users/magnus/Documents/Projects/ao1-intern");
      return {
        status: 0,
        stdout: "",
        stderr: [
          "session_id: 20260616_190956_ed4b8a",
          "/SkyComputerUseClient turn-ended {\"type\":\"agent-turn-complete\",\"last-assistant-message\":\"Investigated both repos.\\n\\nRun Contents: 11 WhatsApp items.\"}"
        ].join("\n")
      };
    },
    cwd: "/Users/magnus/Documents/Projects/ao1-intern"
  });

  assert.equal(output, "Investigated both repos.\n\nRun Contents: 11 WhatsApp items.");
});

test("test_hermes_chat_driver_prefers_stdout_over_progress_stderr", () => {
  const output = runHermesChat({
    query: "status",
    provider: "openrouter",
    skills: ["ao1-intern"],
    source: "telegram",
    spawnFile: () => ({
      status: 0,
      stdout: "Final Hermes reply.\n",
      stderr: "session_id: 20260616_190956_ed4b8a\n"
    }),
    cwd: "/Users/magnus/Documents/Projects/ao1-intern"
  });

  assert.equal(output, "Final Hermes reply.\n");
});

test("test_hermes_chat_driver_enforces_timeout", () => {
  assert.throws(() => runHermesChat({
    query: "status",
    provider: "openrouter",
    skills: ["ao1-intern"],
    source: "telegram",
    timeoutMs: 120000,
    spawnFile: (command, args, options) => {
      assert.equal(command, "/Users/magnus/.local/bin/hermes");
      assert.equal(args[0], "chat");
      assert.equal(options.timeout, 120000);
      assert.equal(options.killSignal, "SIGTERM");
      const error = new Error("spawnSync /Users/magnus/.local/bin/hermes ETIMEDOUT");
      error.code = "ETIMEDOUT";
      return { error, status: null, stdout: "", stderr: "" };
    },
    cwd: "/Users/magnus/Documents/Projects/ao1-intern"
  }), /timed out after 120000ms/);
});

test("test_extract_last_assistant_message_ignores_progress_without_completion_payload", () => {
  assert.equal(extractLastAssistantMessage("session_id: 20260616_190956_ed4b8a"), "");
});

test("test_hermes_chat_driver_surfaces_stderr_on_failure", () => {
  const failure = new Error("Command failed");
  failure.status = 1;
  failure.stderr = "OpenRouter authentication failed\n";
  failure.stdout = "";

  assert.throws(() => runHermesChat({
    query: "hello",
    provider: "openrouter",
    skills: ["ao1-intern"],
    source: "telegram",
    execFile: () => {
      throw failure;
    },
    cwd: "/Users/magnus/Documents/Projects/ao1-intern"
  }), /OpenRouter authentication failed/);
});
