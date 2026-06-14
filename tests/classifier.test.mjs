import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileLatestSync } from "../src/filing.mjs";
import { heuristicClassifyItems, validateClassifiedItems } from "../src/classifier.mjs";
import { makeTempRepo, writeKbFixture } from "./helpers.mjs";

test("test_filing_uses_injected_agent_classifier", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);
  let called = false;

  const result = fileLatestSync({
    kbPath: kb,
    repoPath: intern,
    commit: false,
    classifier: ({ items, rules }) => {
      called = true;
      return [{
        file: items[0].file,
        item: items[0].item,
        conceptPath: "research/custom-agent-classifier.md",
        summary: "Classifier-selected summary.",
        classification: "client-context",
        keptReason: "The injected classifier selected this item.",
        rulesConsulted: rules.files.map((entry) => entry.name)
      }];
    }
  });

  assert.equal(called, true);
  assert.equal(result.status, "filed");
  const markdown = fs.readFileSync(result.outputs[0], "utf8");
  assert.match(markdown, /Target concept: research\/custom-agent-classifier\.md/);
  assert.match(markdown, /Classifier-selected summary/);
  assert.match(markdown, /The injected classifier selected this item/);
});

test("test_classifier_output_is_shape_validated", () => {
  const { kb } = makeTempRepo();
  writeKbFixture(kb);

  assert.throws(() => validateClassifiedItems([{ conceptPath: "missing-summary.md" }]), /summary/);
  assert.throws(() => validateClassifiedItems([{ summary: "x", classification: "client-context" }]), /conceptPath/);
  assert.doesNotThrow(() => validateClassifiedItems([{
    conceptPath: "product/ideas/example.md",
    summary: "Summary.",
    classification: "client-context",
    item: { source_item_id: "x" },
    rulesConsulted: ["AGENTS.md"]
  }]));
});

test("test_heuristic_classifier_remains_available_as_fallback", () => {
  const item = {
    file: "/tmp/item.json",
    item: {
      source: "local-files",
      source_item_id: "notes/nemoclaw.md",
      title: "NemoClaw Intern Governance",
      curatable: true,
      body_text: "AO1 should use NemoClaw for Hermes and Codex intern governance."
    }
  };
  const result = heuristicClassifyItems({
    items: [item],
    rules: { files: [{ name: "AGENTS.md" }] }
  });
  assert.equal(result[0].conceptPath, "product/ideas/intern-agent-governance.md");
});
