import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildChatIntentPlannerPrompt,
  createHermesChatIntentPlanner,
  heuristicPlanChatIntent,
  parseChatIntentPlannerOutput,
  selectChatIntentPlanner
} from "../src/chat-planner.mjs";
import { generateHostBrokerPolicy } from "../src/policy.mjs";

test("test_hermes_chat_planner_maps_natural_language_to_approved_intent", () => {
  const calls = [];
  const planner = createHermesChatIntentPlanner({
    hermesConfig: {
      command: "/Users/magnus/.local/bin/hermes",
      cwd: "/Users/magnus/Documents/Projects/ao1-intern"
    },
    execFile: (command, args, options) => {
      calls.push({ command, args, options });
      assert.equal(command, "/Users/magnus/.local/bin/hermes");
      assert.equal(args.at(-2), "--oneshot");
      assert.match(args.at(-1), /allowed_intents/);
      assert.match(args.at(-1), /WhatsApp items/);
      assert.equal(options.cwd, "/Users/magnus/Documents/Projects/ao1-intern");
      return JSON.stringify({
        intent: "review-latest-sync",
        confidence: 0.91,
        reason: "The user asked to review recent WhatsApp items."
      });
    }
  });

  const plan = planner({ text: "please review the new WhatsApp items and file anything important" });

  assert.equal(plan.intent, "review-latest-sync");
  assert.equal(plan.source, "hermes");
  assert.equal(plan.confidence, 0.91);
  assert.equal(calls.length, 1);
});

test("test_chat_planner_prompt_limits_hermes_to_predefined_skills", () => {
  const prompt = buildChatIntentPlannerPrompt({ text: "do anything you need" });

  assert.match(prompt, /The user may ask naturally/);
  assert.match(prompt, /review-latest-sync/);
  assert.match(prompt, /summarize-last-filing/);
  assert.match(prompt, /review-generated-artifacts/);
  assert.match(prompt, /run-shell-command/);
  assert.match(prompt, /arbitrary shell commands/);
});

test("test_chat_planner_rejects_unknown_planner_intents", () => {
  const plan = parseChatIntentPlannerOutput(JSON.stringify({
    intent: "delete-repo",
    confidence: 0.99,
    reason: "Not allowed."
  }));

  assert.equal(plan.intent, "unknown");
});

test("test_heuristic_chat_planner_supports_explicit_shell_and_codex_prompts", () => {
  const shell = heuristicPlanChatIntent({ text: "run: git status --short" });
  assert.equal(shell.intent, "run-shell-command");
  assert.equal(shell.command, "git status --short");

  const codex = heuristicPlanChatIntent({ text: "ask codex to summarize the repo status" });
  assert.equal(codex.intent, "run-shell-command");
  assert.match(codex.command, /codex exec/);
  assert.match(codex.command, /summarize the repo status/);
});

test("test_chat_planner_uses_host_broker_for_hermes_mode", () => {
  const manifest = JSON.parse(fs.readFileSync("config/permissions.example.json", "utf8"));
  const config = JSON.parse(fs.readFileSync("config/ao1-intern.example.json", "utf8"));
  const hostBrokerPolicy = generateHostBrokerPolicy({ manifest, config });
  const calls = [];
  const planner = selectChatIntentPlanner({
    config: {
      ...config,
      chat: {
        ...config.chat,
        intent_planner: { mode: "hermes" }
      }
    },
    repoPath: "/Users/magnus/Documents/Projects/ao1-intern",
    hostBrokerPolicy,
    execFile: (command, args, options) => {
      calls.push({ command, args, options });
      return JSON.stringify({ intent: "runtime-status", confidence: 0.8, reason: "Status request." });
    }
  });

  const plan = planner({ text: "are you healthy?" });

  assert.equal(plan.intent, "runtime-status");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/Users/magnus/.local/bin/hermes");
});
