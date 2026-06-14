import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createCodexClassifier, parseCodexClassifierOutput } from "../src/codex-classifier.mjs";
import { fileLatestSync } from "../src/filing.mjs";
import { makeTempRepo, writeKbFixture } from "./helpers.mjs";

test("test_codex_classifier_files_model_selected_concept_markdown", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);
  let prompt = "";
  const classifier = createCodexClassifier({
    repoPath: kb,
    execFile: (command, args) => {
      assert.equal(command, "codex");
      assert.equal(args.includes("--ignore-user-config"), true);
      assert.equal(args.includes("gpt-5.5"), true);
      prompt = args.at(-1);
      return JSON.stringify({
        items: [{
          source_item_id: "notes/nemoclaw.md",
          conceptPath: "product/ideas/intern-agent-governance.md",
          summary: "NemoClaw and OpenShell should be tested as the Intern runtime containment layer for Hermes and Codex orchestration.",
          classification: "product/brand",
          keptReason: "Codex selected it as durable intern governance context.",
          rulesConsulted: ["AGENTS.md", "README.md", "index.md"]
        }]
      });
    }
  });

  const result = fileLatestSync({
    kbPath: kb,
    repoPath: intern,
    commit: false,
    classifier
  });

  assert.equal(result.status, "filed");
  assert.match(prompt, /Return exactly one JSON object/);
  assert.match(prompt, /notes\/nemoclaw\.md/);
  assert.match(prompt, /Do not include raw transcripts/);

  const markdown = fs.readFileSync(result.outputs[0], "utf8");
  assert.match(markdown, /Target concept: product\/ideas\/intern-agent-governance\.md/);
  assert.match(markdown, /NemoClaw and OpenShell should be tested/);
  assert.match(markdown, /Codex selected it as durable intern governance context/);
});

test("test_codex_classifier_rejects_malformed_or_unmatched_output", () => {
  assert.throws(() => parseCodexClassifierOutput("not-json"), /JSON object/);
  assert.throws(() => parseCodexClassifierOutput(JSON.stringify({ items: {} })), /items array/);

  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);
  const classifier = createCodexClassifier({
    repoPath: kb,
    execFile: () => JSON.stringify({
      items: [{
        source_item_id: "notes/unknown.md",
        conceptPath: "product/ideas/intern-agent-governance.md",
        summary: "Unknown item.",
        classification: "client-context",
        keptReason: "No match.",
        rulesConsulted: ["AGENTS.md"]
      }]
    })
  });

  assert.throws(() => fileLatestSync({
    kbPath: kb,
    repoPath: intern,
    commit: false,
    classifier
  }), /unknown source_item_id/);
});
