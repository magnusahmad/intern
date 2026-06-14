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

test("test_runtime_classifier_wraps_hermes_codex_execs_with_host_broker_policy", () => {
  const manifest = JSON.parse(fs.readFileSync("config/permissions.example.json", "utf8"));
  const config = JSON.parse(fs.readFileSync("config/ao1-intern.example.json", "utf8"));
  const hostBrokerPolicy = generateHostBrokerPolicy({ manifest, config });
  const calls = [];
  const classifier = selectRuntimeClassifier({
    mode: "hermes-codex",
    repoPath: "/Users/magnus/Documents/Projects/ao1-kb",
    internRepoPath: "/Users/magnus/Documents/Projects/ao1-intern",
    codexConfig: config.codex_exec,
    hermesConfig: config.hermes,
    hostBrokerPolicy,
    execFile: (command, args, options) => {
      calls.push({ command, args, options });
      return JSON.stringify({
        items: [{
          source_item_id: "notes/nemoclaw.md",
          conceptPath: "operations/runtime/hermes-nemoclaw.md",
          summary: "Summary.",
          classification: "operational todo",
          keptReason: "Selected.",
          rulesConsulted: ["AGENTS.md"]
        }]
      });
    }
  });

  const result = classifier(sampleClassifierContext());
  assert.equal(result.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, "codex");
  assert.equal(calls[1].command, "/Users/magnus/.local/bin/hermes");
});
