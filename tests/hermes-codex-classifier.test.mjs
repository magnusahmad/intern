import assert from "node:assert/strict";
import test from "node:test";
import { createHermesCodexClassifier, buildHermesCodexReviewPrompt } from "../src/hermes-codex-classifier.mjs";
import { sampleClassifierContext } from "./helpers.mjs";

test("test_hermes_codex_classifier_lets_hermes_finalize_codex_decisions", () => {
  const context = sampleClassifierContext();
  const calls = [];
  const classifier = createHermesCodexClassifier({
    repoPath: "/Users/magnus/Documents/Projects/ao1-kb",
    hermesConfig: {
      cwd: "/Users/magnus/Documents/Projects/ao1-intern"
    },
    codexExecFile: (command, args) => {
      calls.push({ command, args });
      return JSON.stringify({
        items: [{
          source_item_id: "notes/nemoclaw.md",
          conceptPath: "operations/runtime/hermes-nemoclaw.md",
          summary: "Codex draft summary.",
          classification: "operational todo",
          keptReason: "Codex selected it.",
          rulesConsulted: ["AGENTS.md"]
        }]
      });
    },
    hermesExecFile: (command, args, options) => {
      calls.push({ command, args, options });
      assert.equal(command, "/Users/magnus/.local/bin/hermes");
      assert.equal(options.cwd, "/Users/magnus/Documents/Projects/ao1-intern");
      const prompt = args.at(-1);
      assert.match(prompt, /Codex draft classifier output/);
      assert.match(prompt, /notes\/nemoclaw\.md/);
      return JSON.stringify({
        items: [{
          source_item_id: "notes/nemoclaw.md",
          conceptPath: "operations/runtime/hermes-nemoclaw.md",
          summary: "Hermes approved summary.",
          classification: "operational todo",
          keptReason: "Hermes accepted the Codex draft after checking KB rules.",
          rulesConsulted: ["AGENTS.md"]
        }]
      });
    }
  });

  const results = classifier(context);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, "codex");
  assert.equal(calls[1].command, "/Users/magnus/.local/bin/hermes");
  assert.equal(results[0].summary, "Hermes approved summary.");
  assert.equal(results[0].conceptPath, "operations/runtime/hermes-nemoclaw.md");
});

test("test_hermes_codex_review_prompt_is_bounded_and_json_only", () => {
  const context = sampleClassifierContext();
  const prompt = buildHermesCodexReviewPrompt({
    ...context,
    codexOutput: JSON.stringify({ items: [] })
  });

  assert.match(prompt, /You are Hermes orchestrating AO1 Intern filing/);
  assert.match(prompt, /Return exactly one JSON object/);
  assert.match(prompt, /Codex draft classifier output/);
  assert.match(prompt, /Do not include raw transcripts/);
  assert.ok(prompt.length < 20000);
});
