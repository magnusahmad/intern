import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { heuristicClassifyItems } from "../src/classifier.mjs";
import { generateHostBrokerPolicy } from "../src/policy.mjs";
import { selectRuntimeClassifier } from "../src/runtime-classifier.mjs";
import { sampleClassifierContext } from "./helpers.mjs";

test("test_runtime_classifier_defaults_to_heuristic_and_supports_codex", () => {
  assert.equal(selectRuntimeClassifier({ mode: "heuristic" }), heuristicClassifyItems);

  const codex = selectRuntimeClassifier({
    mode: "codex",
    repoPath: "/Users/magnus/Documents/Projects/ao1-kb",
    execFile: () => JSON.stringify({
      items: [{
        source_item_id: "x",
        conceptPath: "product/ideas/example.md",
        summary: "Summary.",
        classification: "client-context",
        keptReason: "Selected.",
        rulesConsulted: ["AGENTS.md"]
      }]
    })
  });

  assert.equal(typeof codex, "function");

  const hermesCodex = selectRuntimeClassifier({
    mode: "hermes-codex",
    repoPath: "/Users/magnus/Documents/Projects/ao1-kb",
    internRepoPath: "/Users/magnus/Documents/Projects/ao1-intern",
    codexExecFile: () => JSON.stringify({
      items: [{
        source_item_id: "x",
        conceptPath: "product/ideas/example.md",
        summary: "Summary.",
        classification: "client-context",
        keptReason: "Selected.",
        rulesConsulted: ["AGENTS.md"]
      }]
    }),
    hermesExecFile: () => JSON.stringify({ items: [] })
  });

  assert.equal(typeof hermesCodex, "function");
  assert.throws(() => selectRuntimeClassifier({ mode: "unknown" }), /Unknown classifier/);
});

test("test_runtime_classifier_returns_error_for_unavailable_classifiers", () => {
  // Codex and hermes-codex classifiers are stubs that throw when invoked.
  // The factory functions exist (selectRuntimeClassifier returns a function) but
  // calling them fails with a clear error message.
  const codex = selectRuntimeClassifier({
    mode: "codex",
    repoPath: "/Users/magnus/Documents/Projects/ao1-kb"
  });
  assert.equal(typeof codex, "function");
  assert.throws(() => codex({ items: [], rules: {}, manifest: {}, sync: {}, curate: {} }), /Codex classifier is not available/);

  const hermesCodex = selectRuntimeClassifier({
    mode: "hermes-codex",
    repoPath: "/Users/magnus/Documents/Projects/ao1-kb",
    internRepoPath: "/Users/magnus/Documents/Projects/ao1-intern"
  });
  assert.equal(typeof hermesCodex, "function");
  assert.throws(() => hermesCodex({ items: [], rules: {}, manifest: {}, sync: {}, curate: {} }), /not available/);
});
