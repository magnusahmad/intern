import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadKbRules } from "../src/kb-rules.mjs";
import { makeTempRepo } from "./helpers.mjs";

test("test_kb_rules_load_authoritative_root_links_and_source_map", () => {
  const { kb } = makeTempRepo();
  writeRuleFixture(kb);

  const rules = loadKbRules(kb);
  const names = rules.files.map((entry) => entry.name);

  assert.deepEqual(names, [
    "AGENTS.md",
    "README.md",
    "index.md",
    "brand/index.md",
    "product/ideas.md",
    "meetings/index.md",
    "research/index.md",
    "shared/index.md",
    "shared/source-map/index.md"
  ]);
  assert.equal(rules.files.every((entry) => !entry.name.startsWith(".ao1/")), true);
  assert.match(rules.summary.join("\n"), /source-map/i);
});

test("test_kb_rules_ignore_external_and_escaping_links", () => {
  const { kb } = makeTempRepo();
  writeRuleFixture(kb, {
    extraIndexLinks: [
      "[External](https://example.com/rules.md)",
      "[Escape](../outside.md)",
      "[Anchor](#local)"
    ]
  });

  const names = loadKbRules(kb).files.map((entry) => entry.name);

  assert.equal(names.includes("https://example.com/rules.md"), false);
  assert.equal(names.includes("../outside.md"), false);
  assert.equal(names.includes("outside.md"), false);
});

function writeRuleFixture(kb, { extraIndexLinks = [] } = {}) {
  fs.writeFileSync(path.join(kb, "AGENTS.md"), "# Agents\n\nUse concept folders.\n");
  fs.writeFileSync(path.join(kb, "README.md"), "# Readme\n\nKeep Owner, Last reviewed, Sources, Related.\n");
  fs.writeFileSync(path.join(kb, "index.md"), [
    "# AO1 Internal Knowledge Base",
    "",
    "Related: [Brand](brand/index.md), [Product Ideas](product/ideas.md), [Meetings](meetings/index.md), [Research](research/index.md), [Shared](shared/index.md)",
    "",
    ...extraIndexLinks
  ].join("\n"));

  for (const file of [
    "brand/index.md",
    "product/ideas.md",
    "meetings/index.md",
    "research/index.md",
    "shared/index.md",
    "shared/source-map/index.md",
    ".ao1/raw/ignored.md"
  ]) {
    fs.mkdirSync(path.dirname(path.join(kb, file)), { recursive: true });
    fs.writeFileSync(path.join(kb, file), `# ${file}\n`);
  }
}
