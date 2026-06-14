import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileLatestSync } from "../src/filing.mjs";
import { makeTempRepo, writeKbFixture, gitCommitCount } from "./helpers.mjs";

test("test_latest_sync_report_is_filed_once", () => {
  const { intern, kb } = makeTempRepo();
  const { runId } = writeKbFixture(kb);

  const result = fileLatestSync({ kbPath: kb, repoPath: intern });
  assert.equal(result.status, "filed");
  assert.equal(result.outputs.length, 1);
  assert.equal(gitCommitCount(intern), 1);

  const markdown = fs.readFileSync(result.outputs[0], "utf8");
  assert.match(markdown, /Owner: AO1/);
  assert.match(markdown, /Last reviewed:/);
  assert.match(markdown, /Sources: local-files:notes\/nemoclaw\.md/);
  assert.match(markdown, /Target concept: product\/ideas\/intern-agent-governance\.md/);
  assert.match(markdown, /KB Rules Consulted/);
  assert.match(markdown, /AGENTS\.md/);
  assert.match(markdown, /intended destination is the AO1 KB/);
  assert.doesNotMatch(markdown, /ao1-intern:curatable/);

  const second = fileLatestSync({ kbPath: kb, repoPath: intern });
  assert.equal(second.status, "already-filed");
  assert.equal(second.outputs.length, 0);
  assert.equal(gitCommitCount(intern), 1);

  const checkpoint = JSON.parse(fs.readFileSync(path.join(intern, ".ao1-intern", "checkpoint.json"), "utf8"));
  assert.equal(checkpoint.filed_runs[runId].status, "filed");
});

test("test_no_filing_when_no_new_curatable_manifest_items", () => {
  const { intern, kb } = makeTempRepo();
  const { runId } = writeKbFixture(kb, { added: 0 });

  const result = fileLatestSync({ kbPath: kb, repoPath: intern });
  assert.equal(result.status, "no-curatable-items");
  assert.deepEqual(result.outputs, []);
  assert.equal(fs.existsSync(path.join(intern, "runs")), false);
  assert.equal(gitCommitCount(intern), 0);

  const checkpoint = JSON.parse(fs.readFileSync(path.join(intern, ".ao1-intern", "checkpoint.json"), "utf8"));
  assert.equal(checkpoint.filed_runs[runId].status, "no-curatable-items");
});
