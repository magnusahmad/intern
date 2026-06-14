import assert from "node:assert/strict";
import test from "node:test";
import { heuristicClassifyItems } from "../src/classifier.mjs";
import { selectRuntimeClassifier } from "../src/runtime-classifier.mjs";

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
